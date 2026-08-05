import assert from 'node:assert/strict'
import { isCorruptProfile, mergeEntityProfiles, removeEntityProfile, setEntityIdentity, splitEntityAlias, upsertEntityProfile } from './src/entityProfiles.js'

const base = { id: 'a', name: '韩立', aliases: ['二愣子'], distinctFrom: [], readPosition: 100, summary: '旧资料' }
const updated = upsertEntityProfile([base], { id: 'new', name: '韩立', aliases: ['韩跑跑'], readPosition: 200, summary: '新资料' })
assert.equal(updated.length, 1)
assert.deepEqual(updated[0].aliases.sort(), ['二愣子', '韩跑跑'].sort())
assert.equal(updated[0].summary, '新资料')

const locked = setEntityIdentity(updated, 'a', { name: '韩立', aliases: ['二愣子'], distinctFrom: ['韩某'] }, 300)
const ignoredRename = upsertEntityProfile(locked, { id: 'a', name: '韩某', aliases: ['韩立'], readPosition: 400, summary: '更后资料' })
assert.equal(ignoredRename[0].name, '韩立')
assert.deepEqual(ignoredRename[0].aliases, ['二愣子'])
assert.equal(ignoredRename[0].summary, '更后资料')

const split = splitEntityAlias(locked, 'a', '二愣子', 500, 'b')
assert.equal(split.length, 2)
assert.equal(split.find((item) => item.id === 'b').name, '二愣子')
assert.ok(split.find((item) => item.id === 'a').distinctFrom.includes('二愣子'))

const merged = mergeEntityProfiles(split, 'a', 'b', 600)
assert.equal(merged.length, 1)
assert.ok(merged[0].aliases.includes('二愣子'))
assert.equal(merged[0].identityLocked, true)

// 损坏缓存检测：summary 是裸 JSON 的旧卡要被识别，正常卡不误报。
assert.equal(isCorruptProfile({ summary: '{"type":"人物","canonicalName":"方运","summary":"..."}' }), true)
assert.equal(isCorruptProfile({ summary: '本书主角，寒门子弟。' }), false)
assert.equal(isCorruptProfile({}), false)

// 删除资料卡：按 id 移除，其余不受影响。
const afterDelete = removeEntityProfile(merged, 'a')
assert.equal(afterDelete.length, 0)
assert.equal(removeEntityProfile(merged, 'missing').length, 1)

console.log('entity profile identity tests passed')

