import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildDictionaryMessages, buildFollowupMessages } = require('./electron/dictionaryPrompt.cjs')

const base = {
  bookTitle: '测试之书',
  author: '某人',
  chapterLabel: '第十二章 夜谈',
  readPercent: 0.42,
  selectedText: '他终究没有拔剑',
  paragraph: '他终究没有拔剑，只是笑了笑。',
  contextBefore: '前文……',
  contextAfter: '后文……',
  entityProfiles: [{ name: '方运', type: '人物', aliases: ['方大'], summary: '主角', relations: [{ targetName: 'x'.repeat(500) }] }],
}

const explain = buildDictionaryMessages(base)
assert.equal(explain.length, 2)
assert.equal(explain[0].role, 'system')
assert.equal(explain[1].role, 'user')
assert.ok(explain[0].content.includes('严禁'), 'system 应包含约束')
assert.ok(explain[0].content.includes('语境'), 'system 应强调语境')
assert.ok(explain[1].content.includes('《测试之书》'))
assert.ok(explain[1].content.includes('第十二章 夜谈'))
assert.ok(explain[1].content.includes('42%'))
assert.ok(explain[1].content.includes('他终究没有拔剑'))
assert.ok(explain[1].content.includes('方运'))
assert.ok(explain[1].content.includes('前文……'))
assert.ok(explain[1].content.includes('后文……'))
assert.ok(!explain[1].content.includes('x'.repeat(500)), '设定集不应包含超长的 relations 等字段')

const follow = buildFollowupMessages({
  ...base,
  chapterText: '章节全文……',
  explanation: '之前的解释',
  followUps: [
    { question: 'q1', answer: 'a1' },
    { question: 'q2', answer: '' }, // 未回答的不进历史
    { question: 'q3', answer: 'a3' },
  ],
  question: '那主角为啥不拔剑？',
})
assert.equal(follow[0].role, 'system')
assert.ok(follow[0].content.includes('追问'))
assert.ok(follow[1].content.includes('章节全文……'))
assert.ok(follow[1].content.includes('之前的解释'))
assert.ok(follow[1].content.includes('问：q1'))
assert.ok(!follow[1].content.includes('问：q2'))
assert.ok(follow[1].content.includes('问：q3'))
assert.ok(follow[1].content.includes('那主角为啥不拔剑？'))

// 空兜底不应抛错
const empty = buildDictionaryMessages()
assert.ok(empty[1].content.includes('未知'))
const emptyFollow = buildFollowupMessages({ question: 'q' })
assert.ok(emptyFollow[1].content.includes('q'))

console.log('test-dictionary-prompt: all assertions passed')
