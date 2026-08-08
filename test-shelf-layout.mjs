import assert from 'node:assert/strict'
import { MAX_SECTION_GAP, countSpinesHiddenForExpansion, coverCountForShelf, coverWidthForShelf, layoutShelfBooks, moveBeforeOrAfter, orderBooksByIds, orderBooksWithNewFirst, shortSpineTitle, spineMetrics } from './src/ui-b/shelfLayout.js'

const books = Array.from({ length: 40 }, (_, index) => ({ id: `book-${index}`, title: `第${index}本测试书籍` }))

assert.deepEqual([206, 304, 680, 872, 954, 1120].map((width) => coverCountForShelf(width, books.length)), [1, 2, 3, 4, 5, 6])
assert.equal(coverWidthForShelf(2000), 98)

let lastVisible = 0
for (const width of [206, 304, 520, 700, 920, 1100]) {
  const layout = layoutShelfBooks(books, width)
  const ids = [...layout.covers.map((book) => book.id), ...layout.spines.map(({ book }) => book.id)]
  const occupied = layout.covers.length * layout.coverWidth
    + Math.max(0, layout.covers.length - 1) * layout.coverGap
    + layout.sectionGap
    + layout.spines.reduce((total, spine) => total + spine.metrics.width, 0)
    + Math.max(0, layout.spines.length - 1) * 5.74
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.length >= lastVisible, `visible book count should grow at ${width}px`)
  assert.ok(layout.sectionGap <= MAX_SECTION_GAP, `section gap should be capped at ${width}px`)
  assert.ok(occupied <= width + 0.01, `books should fit at ${width}px`)
  lastVisible = ids.length
}

const sparseLayout = layoutShelfBooks(books.slice(0, 7), 520)
assert.equal(sparseLayout.spines.length, 4)
assert.ok(sparseLayout.sectionGap <= MAX_SECTION_GAP)

assert.equal(shortSpineTitle('一二三四五六七八九十十一'), '一二三四五六七八九')
assert.equal(spineMetrics(books[0]).color, spineMetrics(books[0]).color)
assert.deepEqual(orderBooksByIds(books.slice(0, 4), ['book-2', 'missing', 'book-0']).map((book) => book.id), ['book-2', 'book-0', 'book-1', 'book-3'])
assert.deepEqual(orderBooksWithNewFirst(books.slice(0, 4), ['book-2', 'book-0']).map((book) => book.id), ['book-1', 'book-3', 'book-2', 'book-0'])
assert.deepEqual(moveBeforeOrAfter(['空分类', '文学', '历史', '科技'], '科技', '文学'), ['空分类', '科技', '文学', '历史'])
assert.equal(countSpinesHiddenForExpansion(100, [180, 200]), 0)
assert.equal(countSpinesHiddenForExpansion(100, [140, 155, 170, 190]), 2)
assert.equal(countSpinesHiddenForExpansion(100, [140, 155]), 2)

console.log('shelf layout tests passed')
