// 剧情梳理：AI 陪读逐章/逐段总结的本地数据层。
// 条目按 order（章节序号，无章节书按 5000 字段号）排序插入，
// 乱序阅读（先总结 1-8 章、跳到 18 章、再回头补 9 章）也能正确归位，
// AI 只负责单个单元的总结，排序与缺口判断全在本地完成。

export function sortStorylineEntries(entries) {
  return [...(entries || [])].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0))
}

// 插入或替换（同 unitKey 覆盖），返回按 order 排序的新数组。
export function upsertStorylineEntry(entries, entry) {
  if (!entry || !entry.unitKey) return sortStorylineEntries(entries)
  const next = sortStorylineEntries(entries).filter((item) => item.unitKey !== entry.unitKey)
  next.push(entry)
  return sortStorylineEntries(next)
}

export function removeStorylineEntry(entries, entryId) {
  return sortStorylineEntries(entries).filter((item) => item.id !== entryId)
}

// 该条目与前一条之间是否存在未总结的缺口（order 不连续）。
export function hasGapBefore(sortedEntries, index) {
  if (index <= 0) return false
  const previous = Number(sortedEntries[index - 1].order) || 0
  const current = Number(sortedEntries[index].order) || 0
  return current - previous > 1
}

// 把已总结条目压缩为连续范围描述，如 「第1章」~「第8章」、「第18章」。
function describeRanges(sortedEntries) {
  const ranges = []
  let start = null
  let end = null
  sortedEntries.forEach((entry) => {
    const order = Number(entry.order) || 0
    if (start && order === (Number(end.order) || 0) + 1) {
      end = entry
      return
    }
    if (start) ranges.push({ start, end })
    start = entry
    end = entry
  })
  if (start) ranges.push({ start, end })
  return ranges.map(({ start: from, end: to }) => (from === to ? `「${from.label}」` : `「${from.label}」~「${to.label}」`))
}

// 生成发给 AI 的覆盖说明：已总结了哪些、本次总结的单元处在什么位置、中间是否有缺口。
export function buildCoverageNote(entries, order, label) {
  const sorted = sortStorylineEntries(entries)
  const target = Number(order) || 0
  if (!sorted.length) return `这是为本书总结的第一段剧情（${label}），之后的内容还没有总结过。`
  const previous = [...sorted].reverse().find((item) => (Number(item.order) || 0) < target) || null
  const next = sorted.find((item) => (Number(item.order) || 0) > target) || null
  let rangesText = describeRanges(sorted).join('、')
  if (rangesText.length > 180) rangesText = `${rangesText.slice(0, 180)}…等共 ${sorted.length} 段`
  if (previous && next) {
    return `此前已总结：${rangesText}。本次补总结的是 ${label}，它在剧情顺序上位于已总结的「${previous.label}」与「${next.label}」之间，是对中间缺失部分的补充，不是「${next.label}」之后的新剧情。`
  }
  if (previous) {
    const gap = target - (Number(previous.order) || 0)
    if (gap > 1) {
      return `此前已总结：${rangesText}。本次总结的是 ${label}，它与已总结的「${previous.label}」之间还有 ${gap - 1} 个章节/段落没有总结，剧情可能存在跳跃，请仅依据提供的文本总结，不要脑补缺失部分。`
    }
    return `此前已总结到「${previous.label}」。本次接着总结 ${label}。`
  }
  return `此前已总结：${rangesText}。本次补总结的是 ${label}，它位于所有已总结内容之前。`
}

// 取剧情顺序上紧邻本单元之前的最多 limit 条总结，作为 AI 的上下文。
export function selectPreviousSummaries(entries, order, limit = 3) {
  const target = Number(order) || 0
  return sortStorylineEntries(entries)
    .filter((item) => (Number(item.order) || 0) < target && item.text)
    .slice(-limit)
    .map((item) => ({ label: item.label, text: String(item.text).slice(0, 500) }))
}
