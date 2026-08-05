// Selects representative excerpts for profile summarization.
// High-frequency names (e.g. the protagonist) produce thousands of mundane
// mentions; uniform sampling wastes the context budget on filler. Score
// excerpts by identity/relationship signals so the budget goes to
// information-dense passages, while anchors (first/last) and a per-chapter
// cap keep coverage spread across the whole read range.

const IDENTITY_MARKERS = [
  '名叫', '姓名', '叫做', '称为', '身份', '本是', '转世', '重生', '穿越', '来历',
  '父亲', '母亲', '师父', '师傅', '弟子', '徒弟', '妻子', '夫人', '相公', '夫君',
  '兄弟', '姐妹', '好友', '仇敌', '主人', '麾下', '族人',
  '获得', '得到', '觉醒', '突破', '晋升', '加入', '拜入', '创立', '成为',
  '杀死', '救下', '认主', '契约', '传承', '初次', '首次', '第一次', '初识', '相遇', '结识',
]

function excerptScore(text, knownNames) {
  let score = 0
  for (const marker of IDENTITY_MARKERS) if (text.includes(marker)) score += 1
  let linked = 0
  for (const name of knownNames) {
    if (name && text.includes(name)) linked += 1
    if (linked >= 3) break
  }
  return score + linked * 2
}

function selectSummaryExcerpts(items, options = {}) {
  const { limit = 48, maxChars = 32000, knownNames = [] } = options
  const unique = []
  const seen = new Set()
  for (const item of items) {
    const fingerprint = item.text.replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 260)
    if (!fingerprint || seen.has(fingerprint)) continue
    seen.add(fingerprint)
    unique.push(item)
  }
  if (unique.length <= limit) return unique

  const sizeOf = (item) => item.text.length + (item.chapter?.length || 0) + 20
  const perChapter = new Map()
  const picked = new Map()
  let chars = 0
  const take = (index) => {
    if (picked.has(index)) return true
    const item = unique[index]
    const size = sizeOf(item)
    if (chars + size > maxChars) return false
    picked.set(index, item)
    chars += size
    const chapter = item.chapter || ''
    perChapter.set(chapter, (perChapter.get(chapter) || 0) + 1)
    return true
  }

  // Anchors: the introduction (first hits) and the current state (recent hits)
  // always survive, regardless of score. Recent anchors still spread across
  // chapters so the tail is not four paragraphs from the same scene.
  const chapterCap = 3
  take(0)
  take(1)
  const recentCount = Math.min(8, Math.floor(limit * 0.2))
  for (let index = unique.length - 1; index >= 0 && picked.size < 2 + recentCount; index -= 1) {
    if ((perChapter.get(unique[index].chapter || '') || 0) >= chapterCap) continue
    take(index)
  }

  // Fill the rest by information density, capped per chapter so picks spread
  // across the whole read range instead of clustering where mentions pile up.
  const names = (Array.isArray(knownNames) ? knownNames : []).map((name) => String(name || '').trim()).filter(Boolean).slice(0, 60)
  const scored = unique
    .map((item, index) => ({ index, score: excerptScore(item.text, names) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
  for (const { index } of scored) {
    if (picked.size >= limit || chars >= maxChars) break
    if ((perChapter.get(unique[index].chapter || '') || 0) >= chapterCap) continue
    take(index)
  }

  // Return in reading order so the model sees a coherent timeline.
  return [...picked.keys()].sort((a, b) => a - b).map((index) => unique[index])
}

module.exports = { selectSummaryExcerpts, excerptScore }
