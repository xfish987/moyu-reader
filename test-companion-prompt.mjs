import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildChapterSummaryMessages, buildCompanionChatMessages } = require('./electron/companionPrompt.cjs')

// ===== buildChapterSummaryMessages =====
const summaryBase = {
  bookTitle: '测试之书',
  author: '某人',
  chapterLabel: '第十八章 归来',
  chapterText: '他推开城门，看见满目疮痍……',
  coverageNote: '已总结第1-8章，本次总结第18章，中间第9-17章尚未总结，请注意剧情可能有跳跃',
  previousSummaries: [
    { label: '第七章 远行', text: '主角离开家乡，踏上旅途。' },
    { label: '第八章 遇袭', text: '途中遭遇伏击，失去同伴。' },
  ],
}

const summary = buildChapterSummaryMessages(summaryBase)
assert.equal(summary.length, 5)
assert.equal(summary[0].role, 'system')
assert.equal(summary[1].role, 'user')
assert.equal(summary[2].role, 'user')
assert.equal(summary[3].role, 'assistant')
assert.equal(summary[4].role, 'user')
assert.ok(summary[0].content.includes('Luna'), 'system 应包含 Luna 人格')
assert.ok(summary[0].content.includes('No literary genre is excluded'), 'system 应覆盖各类小说')
assert.ok(summary[2].content.includes('reader who has entered this library'))
assert.ok(summary[3].content.includes('assigned professional duty'))
assert.ok(summary[0].content.includes('《测试之书》'), 'system 应包含书名')
assert.ok(summary[0].content.includes('某人'), 'system 应包含作者')
assert.ok(summary[0].content.includes('structured plot notes'))
assert.ok(summary[0].content.includes('timePoint'), 'system 应包含 JSON schema')
assert.ok(summary[0].content.includes('Do not') || summary[0].content.includes('Never'), 'system 应包含防剧透约束')
assert.ok(summary[0].content.includes('complete, valid JSON'), 'system 应要求闭合 JSON')
assert.ok(summary[1].content.includes('第十八章 归来'), '材料应包含章节标签')
assert.ok(summary[1].content.includes('他推开城门'), '材料应包含章节文本')
assert.ok(summary[1].content.includes('第9-17章尚未总结'), '材料应包含 coverageNote')
assert.ok(summary[1].content.includes('第七章 远行'), '材料应包含前序总结')
assert.ok(summary[1].content.includes('遭遇伏击'))
assert.ok(summary[4].content.includes('summarize the supplied chapter'))

// 无 previousSummaries / coverageNote 也应正常
const bare = buildChapterSummaryMessages({ bookTitle: '测试之书', chapterText: '正文……' })
assert.equal(bare.length, 5)
assert.ok(bare[1].content.includes('还没有任何章节总结'))
assert.ok(bare[1].content.includes('正文……'))
assert.ok(!bare[1].content.includes('COVERAGE NOTE'), '无 coverageNote 时不应出现该段落')

// 空兜底不应抛错
const emptySummary = buildChapterSummaryMessages()
assert.ok(emptySummary[1].content.includes('未知'))

// ===== buildCompanionChatMessages =====
const chatBase = {
  bookTitle: '测试之书',
  author: '某人',
  storyline: [
    { label: '第一章 开端', text: '主角在村中醒来。', timePoint: '清晨', location: '青牛村' },
    { label: '第二章 学艺', text: '主角拜入山门。' },
  ],
  entityProfiles: [
    { name: '方运', type: '人物', summary: '主角，性格沉稳。' },
    { name: '青云剑', type: '物品', summary: '家传宝剑。' },
  ],
  history: [
    { role: 'user', content: '主角为什么离开村子？' },
    { role: 'assistant', content: '因为村子被毁。' },
    { role: 'system', content: '不应被采纳' },
    { role: 'user', content: '' }, // 空内容应被过滤
  ],
  question: '青云剑现在还在主角手上吗？',
}

const chat = buildCompanionChatMessages(chatBase)
assert.equal(chat[0].role, 'system')
assert.ok(chat[0].content.includes('《测试之书》'), 'system 应包含书名')
assert.ok(chat[0].content.includes('某人'), 'system 应包含作者')
assert.ok(chat[0].content.includes('Never reveal'), 'system 应包含不剧透约束')
assert.ok(chat[0].content.includes('还没有相关信息'), 'system 应包含缺材料的兜底话术')
assert.ok(chat[0].content.includes('Simplified Chinese'))
assert.ok(chat[1].content.includes('第一章 开端'), '引用材料应包含剧情梳理')
assert.ok(chat[1].content.includes('青牛村'), '剧情梳理应包含地点')
assert.ok(chat[1].content.includes('方运'), '引用材料应包含设定集')
assert.ok(chat[1].content.includes('青云剑'))
// 结构：system + 引用材料 + history(有效2条) + 文书声明/确认 + user(question)
assert.equal(chat.length, 7)
assert.deepEqual(chat[2], { role: 'user', content: '主角为什么离开村子？' })
assert.deepEqual(chat[3], { role: 'assistant', content: '因为村子被毁。' })
assert.equal(chat[4].role, 'user')
assert.ok(chat[4].content.includes('reader who has entered this library'))
assert.equal(chat[5].role, 'assistant')
assert.ok(chat[5].content.includes('assigned professional duty'))
assert.equal(chat[6].role, 'user')
assert.equal(chat[6].content, '青云剑现在还在主角手上吗？')

// 空兜底不应抛错
const emptyChat = buildCompanionChatMessages({ question: 'q' })
assert.equal(emptyChat.length, 5)
assert.equal(emptyChat.at(-1).content, 'q')
assert.ok(emptyChat[1].content.includes('还没有剧情梳理'))
assert.ok(emptyChat[1].content.includes('还没有设定集资料'))

console.log('test-companion-prompt: all assertions passed')
