export const SPINE_COLORS = ['#091831', '#042b58', '#2a5d85', '#7394b7', '#d0e5ef']
export const ALL_BOOKS_ORDER_KEY = '__all_books__'
const SPINE_WIDTHS = [17, 13, 17, 17]
export const MAX_SECTION_GAP = 22.07
const MIN_SECTION_GAP = 12
const BASE_COVER_WIDTH = 73
const MAX_COVER_WIDTH = 98

export function hashSeed(value) {
  let hash = 2166136261
  for (const character of String(value || 'book')) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

export function spineMetrics(book) {
  const seed = hashSeed(book.id || book.path || book.title)
  const colorIndex = seed % SPINE_COLORS.length
  return {
    width: SPINE_WIDTHS[seed % SPINE_WIDTHS.length],
    heightRatio: 0.9 + ((seed >>> 6) % 9) / 100,
    color: SPINE_COLORS[colorIndex],
    darkText: colorIndex >= 3,
  }
}

export function shortSpineTitle(title) {
  return Array.from(String(title || '').trim()).slice(0, 9).join('')
}

// 分类标签（管理视图标签条 / 书脊视图排标题）横排展示：超过 4 个字时只露出前 4 个字加省略号。
export function shortCategoryLabel(name) {
  const chars = Array.from(String(name || '').trim())
  return chars.length > 4 ? `${chars.slice(0, 4).join('')}…` : chars.join('')
}

export function coverWidthForShelf(width) {
  const available = Math.max(0, Number(width) || 0)
  const progress = Math.min(1, Math.max(0, (available - 620) / 536))
  return BASE_COVER_WIDTH + (MAX_COVER_WIDTH - BASE_COVER_WIDTH) * progress
}

export function coverCountForShelf(width, bookCount) {
  if (!bookCount) return 0
  const available = Math.max(0, Number(width) || 0)
  const count = available < 250 ? 1
    : available < 520 ? 2
      : available < 700 ? 3
        : available < 920 ? 4
          : available < 1100 ? 5
            : 6
  return Math.min(bookCount, count)
}

export function coverGapForShelf(width) {
  const available = Math.max(0, Number(width) || 0)
  return Math.round(Math.min(38, Math.max(19, 19 + Math.max(0, available - 304) * 19 / 650)))
}

export function layoutShelfBooks(books, measuredWidth) {
  const width = Math.max(160, Number(measuredWidth) || 320)
  const coverWidth = coverWidthForShelf(width)
  const spineScale = coverWidth / BASE_COVER_WIDTH
  const coverCount = coverCountForShelf(width, books.length)
  const covers = books.slice(0, coverCount)
  let coverGap = coverGapForShelf(width)
  const spineGap = 5.74
  const hasSpines = covers.length < books.length
  const minimumSectionGap = covers.length && hasSpines ? MIN_SECTION_GAP : 0
  let remaining = width - (covers.length * coverWidth) - (Math.max(0, covers.length - 1) * coverGap) - minimumSectionGap
  const spines = []
  for (const book of books.slice(coverCount)) {
    const baseMetrics = spineMetrics(book)
    const metrics = { ...baseMetrics, width: baseMetrics.width * spineScale }
    const required = metrics.width + (spines.length ? spineGap : 0)
    if (required > remaining) break
    spines.push({ book, metrics })
    remaining -= required
  }

  let sectionGap = 0
  if (spines.length) {
    const spineWidth = spines.reduce((total, item) => total + item.metrics.width, 0) + Math.max(0, spines.length - 1) * spineGap
    const coverGaps = Math.max(0, covers.length - 1)
    let availableGap = width - (covers.length * coverWidth) - (coverGaps * coverGap) - spineWidth

    // Use equal cover spacing to absorb sub-pixel leftovers before capping the gap between groups.
    if (availableGap > MAX_SECTION_GAP && coverGaps) {
      const expandable = Math.max(0, 38 - coverGap) * coverGaps
      const absorbed = Math.min(availableGap - MAX_SECTION_GAP, expandable)
      coverGap += absorbed / coverGaps
      availableGap -= absorbed
    }
    sectionGap = Math.min(MAX_SECTION_GAP, Math.max(MIN_SECTION_GAP, availableGap))
  }

  return { coverWidth, coverGap, spineScale, sectionGap, covers, spines }
}

// 首页"最近在读"行只用正面封面：悬停展开时后续封面整体右移 59px（ui-b.css 的
// .v-face-book.is-expanded ~ .v-face-book），且展开面板（宽 = 封面高 × 1.368，高 = 封面宽 × 1.333）
// 会超出自身占位，所以按两者中较大的值预留右侧空间，保证任何窗口宽度下都不溢出书架容器。
const FACE_SHIFT_RESERVE = 59
const FACE_OPEN_EXTRA_RATIO = 1.333 * 1.368 - 1
const MIN_FACE_COUNT = 3

export function layoutFaceOnlyBooks(books, measuredWidth) {
  const width = Math.max(160, Number(measuredWidth) || 320)
  const coverWidth = coverWidthForShelf(width)
  const spineScale = coverWidth / BASE_COVER_WIDTH
  const coverGap = coverGapForShelf(width)
  const reserve = Math.max(FACE_SHIFT_RESERVE, Math.ceil(coverWidth * FACE_OPEN_EXTRA_RATIO))
  const fit = Math.floor((width - reserve + coverGap) / (coverWidth + coverGap))
  const count = Math.min(books.length, Math.max(MIN_FACE_COUNT, fit))
  return { coverWidth, coverGap, spineScale, sectionGap: 0, covers: books.slice(0, count), spines: [] }
}

export function countSpinesHiddenForExpansion(faceRight, spineLefts, expansionWidth = 68.42) {
  if (!spineLefts.length) return 0
  const firstClearIndex = spineLefts.findIndex((left) => left - faceRight >= expansionWidth)
  return firstClearIndex === -1 ? spineLefts.length : firstClearIndex
}

export function orderBooksByIds(books, orderedIds = []) {
  const byId = new Map(books.map((book) => [book.id, book]))
  const seen = new Set()
  const ordered = []
  for (const id of orderedIds) {
    const book = byId.get(id)
    if (book && !seen.has(id)) {
      ordered.push(book)
      seen.add(id)
    }
  }
  for (const book of books) {
    if (!seen.has(book.id)) ordered.push(book)
  }
  return ordered
}

export function orderBooksWithNewFirst(books, orderedIds = []) {
  if (!orderedIds.length) return [...books]
  const knownIds = new Set(orderedIds)
  const newBooks = books.filter((book) => !knownIds.has(book.id))
  const knownBooks = books.filter((book) => knownIds.has(book.id))
  return [...newBooks, ...orderBooksByIds(knownBooks, orderedIds)]
}

export function moveBeforeOrAfter(values, source, target, position = 'before') {
  if (source === target || !values.includes(source) || !values.includes(target)) return values
  const next = values.filter((value) => value !== source)
  const targetIndex = next.indexOf(target)
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source)
  return next
}
