import assert from 'node:assert/strict'
import { buildCoverageNote, hasGapBefore, removeStorylineEntry, selectPreviousSummaries, sortStorylineEntries, upsertStorylineEntry } from './src/storyline.js'

const make = (order, label, text = `总结${order}`) => ({ id: `id-${order}`, unitKey: `ch-${order}`, order, label, text })

// 乱序插入后按 order 排序（先 1-8，跳 18，再补 9）。
let entries = []
for (let index = 0; index < 8; index += 1) entries = upsertStorylineEntry(entries, make(index, `第${index + 1}章`))
entries = upsertStorylineEntry(entries, make(17, '第18章'))
entries = upsertStorylineEntry(entries, make(8, '第9章'))
assert.deepEqual(sortStorylineEntries(entries).map((item) => item.order), [0, 1, 2, 3, 4, 5, 6, 7, 8, 17])

// 同 unitKey 覆盖而不是追加。
entries = upsertStorylineEntry(entries, { ...make(8, '第9章'), text: '重新总结' })
assert.equal(entries.filter((item) => item.unitKey === 'ch-8').length, 1)
assert.equal(entries.find((item) => item.unitKey === 'ch-8').text, '重新总结')

// 缺口判断：第18章（order 17）前面缺 9-17 章，第9章（order 8）前面是连续的。
const sorted = sortStorylineEntries(entries)
assert.equal(hasGapBefore(sorted, 9), true)
assert.equal(hasGapBefore(sorted, 8), false)
assert.equal(hasGapBefore(sorted, 0), false)

// 覆盖说明：补中间章节。
const noteInsert = buildCoverageNote(entries, 8, '第9章')
assert.ok(noteInsert.includes('第1章') && noteInsert.includes('第8章') && noteInsert.includes('第18章'))
assert.ok(noteInsert.includes('之间'))

// 覆盖说明：跳到远处，提示剧情跳跃。
const noteJump = buildCoverageNote(entries.filter((item) => item.order < 8), 17, '第18章')
assert.ok(noteJump.includes('跳跃'))
assert.ok(noteJump.includes('9 个章节/段落'))

// 覆盖说明：紧邻续读。
const noteNext = buildCoverageNote(entries.filter((item) => item.order < 8), 8, '第9章')
assert.ok(noteNext.includes('接着总结'))

// 覆盖说明：第一次总结 / 补最前面的内容。
assert.ok(buildCoverageNote([], 0, '第1章').includes('第一段'))
assert.ok(buildCoverageNote([make(5, '第6章')], 2, '第3章').includes('之前'))

// 前序总结选取：只取本单元之前的、最多 3 条、按顺序。
const previous = selectPreviousSummaries(entries, 17, 3)
assert.deepEqual(previous.map((item) => item.label), ['第7章', '第8章', '第9章'])
assert.equal(selectPreviousSummaries(entries, 0).length, 0)

// 删除。
assert.equal(removeStorylineEntry(entries, 'id-8').length, entries.length - 1)

console.log('test-storyline: ok')
