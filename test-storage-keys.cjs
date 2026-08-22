const assert = require('node:assert/strict')
const fs = require('node:fs')

const appSource = fs.readFileSync('src/App.jsx', 'utf8')
const mainSource = fs.readFileSync('electron/main.cjs', 'utf8')
const usedKeys = [...appSource.matchAll(/useStoredState\(\s*['"]([^'"]+)['"]/g)].map((match) => match[1])
const storeBlock = mainSource.match(/const STORE_KEYS = new Set\(\[([\s\S]*?)\]\)/)?.[1] || ''
const allowedKeys = new Set([...storeBlock.matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]))
const missing = usedKeys.filter((key) => !allowedKeys.has(key))

assert.deepEqual(missing, [], `Electron STORE_KEYS 缺少前端持久化键：${missing.join(', ')}`)
console.log(`storage key whitelist tests passed (${usedKeys.length} keys)`)
