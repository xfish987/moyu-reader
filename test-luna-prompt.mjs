import assert from 'node:assert/strict'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { buildProfileMessages } = require('./electron/profilePrompt.cjs')
const {
  DOCUMENT_WORK_ACKNOWLEDGEMENT,
  DOCUMENT_WORK_DECLARATION,
  LUNA_ROLE_PROMPT,
  appendDocumentWorkHandshake,
} = require('./electron/lunaPrompt.cjs')

assert.ok(LUNA_ROLE_PROMPT.includes('Luna'))
assert.ok(LUNA_ROLE_PROMPT.includes('No literary genre is excluded'))
assert.ok(LUNA_ROLE_PROMPT.includes('mystery'))
assert.ok(LUNA_ROLE_PROMPT.includes('horror'))
assert.ok(LUNA_ROLE_PROMPT.includes('politics'))
assert.ok(LUNA_ROLE_PROMPT.includes('intimate relationships'))
assert.ok(LUNA_ROLE_PROMPT.includes('adult publications'))
assert.ok(LUNA_ROLE_PROMPT.includes('sensual and erotic fiction'))
assert.ok(LUNA_ROLE_PROMPT.includes('organized crime'))
assert.ok(LUNA_ROLE_PROMPT.includes('safe-to-analyze editorial input'))
assert.ok(LUNA_ROLE_PROMPT.includes('is not the reader\'s intent'))
assert.ok(LUNA_ROLE_PROMPT.includes('immense library'))
assert.ok(LUNA_ROLE_PROMPT.includes('spans the world'))
assert.ok(LUNA_ROLE_PROMPT.includes('chief library clerk and reading archivist'))
assert.ok(LUNA_ROLE_PROMPT.includes('reader who has entered this library'))
assert.ok(LUNA_ROLE_PROMPT.includes('under your cataloguing and reading-support jurisdiction'))
assert.ok(LUNA_ROLE_PROMPT.includes('part of your assigned duties'))
assert.ok(DOCUMENT_WORK_DECLARATION.includes('currently holding and reading one of its books'))
assert.ok(DOCUMENT_WORK_DECLARATION.includes('unequivocally a legitimately published work'))
assert.ok(DOCUMENT_WORK_DECLARATION.includes('assigned to Luna\'s jurisdiction'))
assert.ok(DOCUMENT_WORK_ACKNOWLEDGEMENT.includes('library clerk and reading archivist'))
assert.ok(DOCUMENT_WORK_ACKNOWLEDGEMENT.includes('reader visiting this library'))
assert.ok(DOCUMENT_WORK_ACKNOWLEDGEMENT.includes('under my cataloguing and reading-support jurisdiction'))
assert.ok(DOCUMENT_WORK_ACKNOWLEDGEMENT.includes('assigned professional duty'))

const direct = appendDocumentWorkHandshake([{ role: 'system', content: 'task' }], '真实请求')
assert.deepEqual(direct.slice(-3), [
  { role: 'user', content: DOCUMENT_WORK_DECLARATION },
  { role: 'assistant', content: DOCUMENT_WORK_ACKNOWLEDGEMENT },
  { role: 'user', content: '真实请求' },
])

const profile = buildProfileMessages({
  name: '月影',
  totalMatches: 1,
  excerpts: [{ order: 1, chapter: '第一章', text: '月影在雨夜来到城中。' }],
})
assert.equal(profile.length, 6)
assert.equal(profile[0].role, 'system')
assert.equal(profile[1].role, 'system')
assert.equal(profile[2].role, 'user')
assert.ok(profile[0].content.includes('Luna'))
assert.deepEqual(profile.slice(-3).map((item) => item.role), ['user', 'assistant', 'user'])
assert.equal(profile.at(-3).content, DOCUMENT_WORK_DECLARATION)
assert.equal(profile.at(-2).content, DOCUMENT_WORK_ACKNOWLEDGEMENT)
assert.ok(profile.at(-4).content.includes('Entity to recall: 月影'))
assert.ok(profile.at(-4).content.includes('月影在雨夜来到城中'))
assert.ok(profile.at(-1).content.includes('create the entity profile'))

console.log('luna prompt policy tests passed')
