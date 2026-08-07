export const SPINE_COLORS = ['#091831', '#042b58', '#2a5d85', '#7394b7', '#d0e5ef']

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
    width: 24 + (seed % 7),
    heightRatio: 0.9 + ((seed >>> 6) % 9) / 100,
    color: SPINE_COLORS[colorIndex],
    darkText: colorIndex >= 3,
  }
}

export function shortSpineTitle(title) {
  return Array.from(String(title || '').trim()).slice(0, 9).join('')
}

export function coverWidthForShelf(width) {
  return Math.round(Math.min(94, Math.max(68, 68 + (Math.max(320, width) - 320) * 26 / 720)))
}

export function coverCountForShelf(width, bookCount) {
  if (!bookCount) return 0
  const count = Math.min(7, 3 + Math.floor(Math.max(0, width - 320) / 180))
  return Math.min(bookCount, count)
}

export function layoutShelfBooks(books, measuredWidth) {
  const width = Math.max(280, Number(measuredWidth) || 320)
  const coverWidth = coverWidthForShelf(width)
  const coverCount = coverCountForShelf(width, books.length)
  const covers = books.slice(0, coverCount)
  const coverGap = 8
  const spineGap = 3
  const sectionGap = covers.length && books.length > covers.length ? 12 : 0
  let remaining = width - (covers.length * coverWidth) - (Math.max(0, covers.length - 1) * coverGap) - sectionGap
  const spines = []
  for (const book of books.slice(coverCount)) {
    const metrics = spineMetrics(book)
    const required = metrics.width + (spines.length ? spineGap : 0)
    if (required > remaining) break
    spines.push({ book, metrics })
    remaining -= required
  }
  return { coverWidth, covers, spines }
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

export function moveBeforeOrAfter(values, source, target, position = 'before') {
  if (source === target || !values.includes(source) || !values.includes(target)) return values
  const next = values.filter((value) => value !== source)
  const targetIndex = next.indexOf(target)
  next.splice(targetIndex + (position === 'after' ? 1 : 0), 0, source)
  return next
}
