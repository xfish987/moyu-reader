import assert from 'node:assert/strict'
import { stripLegacyNoteFields } from './src/noteMigration.js'

// 有 comment/color 的笔记被剥掉旧字段，其余字段原样保留
{
  const input = {
    bookA: [
      { id: '1', text: '摘录一', comment: '旧评论', color: 'amber', createdAt: 1 },
      { id: '2', text: '摘录二', createdAt: 2 },
    ],
    bookB: [{ id: '3', text: '摘录三', comment: '', color: 'rose', paragraphIndex: 7, createdAt: 3 }],
  }
  const { notesMap, changed } = stripLegacyNoteFields(input)
  assert.equal(changed, true)
  assert.deepEqual(notesMap, {
    bookA: [
      { id: '1', text: '摘录一', createdAt: 1 },
      { id: '2', text: '摘录二', createdAt: 2 },
    ],
    bookB: [{ id: '3', text: '摘录三', paragraphIndex: 7, createdAt: 3 }],
  })
}

// 无旧字段时不产生变更，原对象原样返回（避免多余写盘）
{
  const input = { bookA: [{ id: '1', text: '摘录', title: '小哥初见', highlights: [{ start: 0, end: 2 }], createdAt: 1 }] }
  const { notesMap, changed } = stripLegacyNoteFields(input)
  assert.equal(changed, false)
  assert.equal(notesMap, input)
}

// 异常输入容错
assert.deepEqual(stripLegacyNoteFields(null), { notesMap: null, changed: false })
assert.deepEqual(stripLegacyNoteFields({}), { notesMap: {}, changed: false })
{
  // 没有任何旧字段时不做变更，原值（含异常项）原样返回
  const input = { bookA: 'not-an-array', bookB: [null] }
  const { notesMap, changed } = stripLegacyNoteFields(input)
  assert.equal(changed, false)
  assert.equal(notesMap, input)
}

console.log('note-migration tests passed')
