import assert from 'node:assert/strict'
import { coverCountForShelf, layoutShelfBooks, moveBeforeOrAfter, orderBooksByIds, shortSpineTitle, spineMetrics } from './src/ui-b/shelfLayout.js'

const books = Array.from({ length: 40 }, (_, index) => ({ id: `book-${index}`, title: `第${index}本测试书籍` }))

assert.deepEqual([320, 500, 680, 860, 1040].map((width) => coverCountForShelf(width, books.length)), [3, 4, 5, 6, 7])

let lastVisible = 0
for (const width of [320, 500, 680, 860, 1040, 1180]) {
  const layout = layoutShelfBooks(books, width)
  const ids = [...layout.covers.map((book) => book.id), ...layout.spines.map(({ book }) => book.id)]
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.length >= lastVisible, `visible book count should grow at ${width}px`)
  lastVisible = ids.length
}

assert.equal(shortSpineTitle('一二三四五六七八九十十一'), '一二三四五六七八九')
assert.equal(spineMetrics(books[0]).color, spineMetrics(books[0]).color)
assert.deepEqual(orderBooksByIds(books.slice(0, 4), ['book-2', 'missing', 'book-0']).map((book) => book.id), ['book-2', 'book-0', 'book-1', 'book-3'])
assert.deepEqual(moveBeforeOrAfter(['空分类', '文学', '历史', '科技'], '科技', '文学'), ['空分类', '科技', '文学', '历史'])

console.log('shelf layout tests passed')
