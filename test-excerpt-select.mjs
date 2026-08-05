import assert from 'node:assert/strict'
import { selectSummaryExcerpts } from './electron/excerptSelect.cjs'

// 主角式场景：30 章 × 4 段日常提及 + 3 条身份/关系高密度片段。
const mundane = []
for (let chapter = 1; chapter <= 30; chapter += 1) {
  for (let index = 0; index < 4; index += 1) {
    mundane.push({ order: mundane.length + 1, chapter: `第${chapter}章`, text: `方运走进屋子，坐下喝茶，又与众人说了几句话，随后离开。第${chapter}章第${index}段日常描写。` })
  }
}
const dense = [
  { order: 10.5, chapter: '第3章', text: '方运本是地球人，图书馆失火后重生到圣元大陆，获得文宫与过目不忘之能。' },
  { order: 50.5, chapter: '第8章', text: '杨玉环是方运的童养媳，父母早亡后二人相依为命。' },
  { order: 90.5, chapter: '第15章', text: '方运初次遇见贺裕樘，二人结识成为好友，贺裕樘决心追随他。' },
]
const items = [...mundane.slice(0, 10), dense[0], ...mundane.slice(10, 50), dense[1], ...mundane.slice(50, 90), dense[2], ...mundane.slice(90)]

const picked = selectSummaryExcerpts(items, { limit: 24, maxChars: 8000, knownNames: ['杨玉环', '贺裕樘'] })
assert.ok(picked.length <= 24, 'limit respected')
assert.ok(picked.some((item) => item.text.includes('重生到圣元大陆')), 'identity-dense excerpt kept')
assert.ok(picked.some((item) => item.text.includes('童养媳')), 'relationship excerpt kept')
assert.ok(picked.some((item) => item.text.includes('初次遇见')), 'known-entity co-occurrence excerpt kept')

// 首尾锚点必保，整体按阅读顺序输出。
assert.equal(picked[0], items[0])
assert.ok(picked.includes(items[items.length - 1]))
const orders = picked.map((item) => item.order)
assert.deepEqual(orders, [...orders].sort((a, b) => a - b), 'reading order preserved')

// 每章最多 3 条，避免扎堆。
const counts = {}
for (const item of picked) counts[item.chapter] = (counts[item.chapter] || 0) + 1
assert.ok(Math.max(...Object.values(counts)) <= 3, 'per-chapter cap respected')

// 去重：重复文本只保留一条。
const dup = [{ order: 1, chapter: 'A', text: '同一段文字。' }, { order: 2, chapter: 'B', text: '同一段文字。' }, ...items.slice(0, 60)]
const deduped = selectSummaryExcerpts(dup, { limit: 10, maxChars: 8000 })
assert.equal(deduped.filter((item) => item.text === '同一段文字。').length, 1)

// 小样本原样通过。
const few = items.slice(0, 5)
assert.equal(selectSummaryExcerpts(few).length, 5)

// 字符预算硬性约束。
const tight = selectSummaryExcerpts(items, { limit: 48, maxChars: 500 })
const totalChars = tight.reduce((sum, item) => sum + item.text.length + (item.chapter?.length || 0) + 20, 0)
assert.ok(totalChars <= 500, 'maxChars respected')

console.log('excerpt selection tests passed')
