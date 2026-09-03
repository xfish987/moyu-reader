import { createReadStream } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const sourceDirectory = process.argv[2]
const credentialFile = process.argv[3]
const category = process.argv[4] || '私人藏书'
const server = (process.env.MOYU_CLOUD_URL || 'https://modu.cxnnn.cn/moyu-reader-cloud').replace(/\/+$/, '')
if (!sourceDirectory || !credentialFile) throw new Error('用法：node scripts/upload-bookstore.mjs <书籍目录> <凭据文件> [分类]')

const credentials = await readFile(credentialFile, 'utf8')
const username = credentials.match(/用户名\s*[:：]\s*([^\r\n]+)/)?.[1]?.trim()
const password = credentials.match(/(?:临时)?密码\s*[:：]\s*([^\r\n]+)/)?.[1]?.trim()
if (!username || !password) throw new Error('无法从凭据文件读取用户名或密码')

const loginResponse = await fetch(`${server}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
const login = await loginResponse.json().catch(() => ({}))
if (!loginResponse.ok) throw new Error(login.error || `登录失败（${loginResponse.status}）`)

async function collect(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name)
    if (entry.isDirectory()) result.push(...await collect(target))
    else if (['.txt', '.epub'].includes(path.extname(entry.name).toLowerCase())) result.push(target)
  }
  return result
}

const files = (await collect(sourceDirectory)).sort((a, b) => a.localeCompare(b, 'zh-CN'))
let uploaded = 0, skipped = 0, failed = 0
console.log(`准备上传 ${files.length} 本书到“${category}”`)
for (const [index, file] of files.entries()) {
  const extension = path.extname(file).toLowerCase()
  const title = path.basename(file, extension).trim().slice(0, 160)
  const info = await stat(file)
  const metadata = Buffer.from(JSON.stringify({ title, author: '', category, extension })).toString('base64url')
  try {
    const response = await fetch(`${server}/v1/store/books`, { method: 'POST', headers: { authorization: `Bearer ${login.token}`, 'content-type': extension === '.epub' ? 'application/epub+zip' : 'text/plain', 'content-length': String(info.size), 'x-moyu-book': metadata }, body: createReadStream(file), duplex: 'half' })
    const result = await response.json().catch(() => ({}))
    if (response.status === 409) { skipped += 1; console.log(`[${index + 1}/${files.length}] 已存在，跳过：${title}`); continue }
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`)
    uploaded += 1
    console.log(`[${index + 1}/${files.length}] 已上传：${title}`)
  } catch (error) {
    failed += 1
    console.error(`[${index + 1}/${files.length}] 失败：${title} — ${error.message}`)
  }
}
console.log(`上传结束：新增 ${uploaded}，已存在 ${skipped}，失败 ${failed}，合计 ${files.length}`)
if (failed) process.exitCode = 1
