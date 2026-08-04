import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const { modelValues, nextModelPage } = createRequire(import.meta.url)('./electron/modelCatalog.cjs')

assert.deepEqual(modelValues({ data: [{ id: 'a' }, { id: 'b' }], models: ['c'], items: [{ name: 'd' }] }), ['a', 'b', 'c', 'd'])
assert.deepEqual(nextModelPage({ data: [{ id: 'a' }], has_more: true, last_id: 'a' }), { type: 'cursor', key: 'last_id', parameter: 'after', value: 'a' })
assert.deepEqual(nextModelPage({ next_cursor: 'cursor-2' }), { type: 'cursor', key: 'next_cursor', parameter: 'cursor', value: 'cursor-2' })
assert.deepEqual(nextModelPage({ next_page: '/v1/models?page=2' }), { type: 'url', value: '/v1/models?page=2' })
assert.deepEqual(nextModelPage({ has_more: true, page: 1, total_pages: 3 }), { type: 'page', key: 'page', parameter: 'page', value: '2' })
console.log('model catalog pagination tests passed')
