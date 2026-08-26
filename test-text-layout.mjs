import assert from 'node:assert/strict'
import { isTxtChapter, layoutTxtParagraphs } from './src/textLayout.js'

assert.equal(isTxtChapter('第十二章 夜雨'), true)
assert.equal(isTxtChapter('这不是章节，只是一句普通正文。'), false)
assert.deepEqual(layoutTxtParagraphs('第1章 开始\n这是被固定宽度\n截断的一句话。\n\n　　这是新段。'), [
  '第1章 开始',
  '这是被固定宽度截断的一句话。',
  '这是新段。',
])
assert.deepEqual(layoutTxtParagraphs('第一段完整结束。\n第二段完整结束！'), ['第一段完整结束。', '第二段完整结束！'])
assert.deepEqual(layoutTxtParagraphs('An English line\nwrapped here.\n\nNext paragraph.'), ['An English line wrapped here.', 'Next paragraph.'])
console.log('TXT 自动排版测试通过')
