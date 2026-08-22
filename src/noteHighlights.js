// 笔记高亮区间的规范化、合并与卡片节选窗口计算。
// highlight = { start, end }，相对 note.text 的字符偏移。

// 清洗 + 排序 + 合并重叠/相邻区间。
export function normalizeHighlights(highlights, textLength) {
  if (!Array.isArray(highlights)) return []
  const limit = Math.max(0, Number(textLength) || 0)
  const ranges = highlights
    .map((range) => ({
      start: Math.max(0, Math.min(limit, Math.trunc(Number(range?.start)) || 0)),
      end: Math.max(0, Math.min(limit, Math.trunc(Number(range?.end)) || 0)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged = []
  for (const range of ranges) {
    const last = merged[merged.length - 1]
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end)
    else merged.push({ ...range })
  }
  return merged
}

// 追加一段高亮并重新合并。
export function addHighlight(highlights, range, textLength) {
  return normalizeHighlights([...normalizeHighlights(highlights, textLength), range], textLength)
}

// 卡片显示窗口：以高亮为中心，前后各带 context 个字符的淡淡上下文；
// 无高亮时从头显示全文（交给 CSS line-clamp 截断）。
export function excerptWindow(text, highlights, context = 42) {
  const length = text?.length || 0
  if (!length) return { start: 0, end: 0 }
  const merged = normalizeHighlights(highlights, length)
  if (!merged.length) return { start: 0, end: length }
  const start = Math.max(0, merged[0].start - context)
  const end = Math.min(length, merged[merged.length - 1].end + context)
  return { start, end }
}

// 把 [start, end) 窗口内的文本按高亮区间切段，供渲染淡显/正显 span。
export function segmentByHighlights(text, highlights, start = 0, end = text.length) {
  if (!text) return []
  const merged = normalizeHighlights(highlights, text.length)
  const segments = []
  let cursor = start
  for (const range of merged) {
    if (range.end <= start || range.start >= end) continue
    const from = Math.max(range.start, start)
    const to = Math.min(range.end, end)
    if (from > cursor) segments.push({ text: text.slice(cursor, from), highlighted: false })
    if (to > from) segments.push({ text: text.slice(from, to), highlighted: true })
    cursor = to
  }
  if (cursor < end) segments.push({ text: text.slice(cursor, end), highlighted: false })
  return segments.filter((segment) => segment.text)
}
