import assert from 'node:assert/strict'
import { addHighlight, excerptWindow, normalizeHighlights, segmentByHighlights } from './src/noteHighlights.js'

const text = '天地不仁，以万物为刍狗。圣人不仁，以百姓为刍狗。'

// normalizeHighlights：清洗、排序、合并
assert.deepEqual(normalizeHighlights(null, 100), [])
assert.deepEqual(normalizeHighlights([{ start: 5, end: 5 }, { start: 8, end: 3 }], 100), [])
assert.deepEqual(normalizeHighlights([{ start: 10, end: 14 }, { start: 2, end: 5 }], text.length), [{ start: 2, end: 5 }, { start: 10, end: 14 }])
assert.deepEqual(normalizeHighlights([{ start: 2, end: 8 }, { start: 6, end: 12 }], text.length), [{ start: 2, end: 12 }])
assert.deepEqual(normalizeHighlights([{ start: 2, end: 6 }, { start: 6, end: 9 }], text.length), [{ start: 2, end: 9 }])
assert.deepEqual(normalizeHighlights([{ start: -4, end: 999 }], text.length), [{ start: 0, end: text.length }])

// addHighlight：追加后自动合并
assert.deepEqual(addHighlight([{ start: 2, end: 5 }], { start: 4, end: 9 }, text.length), [{ start: 2, end: 9 }])
assert.deepEqual(addHighlight([], { start: 3, end: 7 }, text.length), [{ start: 3, end: 7 }])

// excerptWindow：无高亮 → 全文；有高亮 → 上下文窗口
assert.deepEqual(excerptWindow(text, []), { start: 0, end: text.length })
assert.deepEqual(excerptWindow('', [{ start: 0, end: 1 }]), { start: 0, end: 0 })
{
  const long = 'a'.repeat(100) + '核心句子' + 'b'.repeat(100)
  const start = 100
  const end = 104
  const window = excerptWindow(long, [{ start, end }], 40)
  assert.deepEqual(window, { start: 60, end: 144 })
}
{
  // 多个高亮：窗口覆盖第一个到最后一个
  const long = 'x'.repeat(50) + '甲' + 'y'.repeat(80) + '乙' + 'z'.repeat(50)
  const window = excerptWindow(long, [{ start: 50, end: 51 }, { start: 131, end: 132 }], 10)
  assert.deepEqual(window, { start: 40, end: 142 })
}

// segmentByHighlights：切段与窗口裁剪
{
  const segments = segmentByHighlights(text, [{ start: 0, end: 6 }])
  assert.deepEqual(segments, [
    { text: '天地不仁，以', highlighted: true },
    { text: text.slice(6), highlighted: false },
  ])
}
{
  // 窗口裁掉高亮两侧时仍能正确分段
  const segments = segmentByHighlights(text, [{ start: 4, end: 8 }], 2, 10)
  assert.deepEqual(segments, [
    { text: text.slice(2, 4), highlighted: false },
    { text: text.slice(4, 8), highlighted: true },
    { text: text.slice(8, 10), highlighted: false },
  ])
}
{
  // 窗口外的高亮被忽略
  assert.deepEqual(segmentByHighlights(text, [{ start: 20, end: 24 }], 0, 5), [{ text: text.slice(0, 5), highlighted: false }])
}

console.log('note-highlights tests passed')
