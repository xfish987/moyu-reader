// 为书城存量书籍补抓 EPUB 作者与封面。
// 用法: node scripts/backfill-bookstore-metadata.mjs <本地书目录> <账户凭证txt>
import { readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import JSZip from 'jszip'
import { DOMParser } from '@xmldom/xmldom'

const [bookDir, credentialFile] = process.argv.slice(2)
const base = (process.env.MOYU_CLOUD_URL || 'https://modu.cxnnn.cn/moyu-reader-cloud').replace(/\/$/, '')
if (!bookDir || !credentialFile) throw new Error('用法: node scripts/backfill-bookstore-metadata.mjs <本地书目录> <账户凭证txt>')

const credentials = await readFile(credentialFile, 'utf8')
const username = credentials.match(/用户名\s*[:：]\s*(\S+)/)?.[1]
const password = credentials.match(/密码\s*[:：]\s*(\S+)/)?.[1]
if (!username || !password) throw new Error('凭证文件中找不到用户名或密码')

const login = await fetch(`${base}/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username, password }) })
if (!login.ok) throw new Error(`登录失败：${login.status}`)
const token = (await login.json()).token
const auth = { authorization: `Bearer ${token}` }

const normalize = (value) => String(value || '').replace(/\s+/g, '').toLowerCase()
const xmlText = (text) => String(text || '').replace(/^[\uFEFF\s]+/, '')
const xml = (doc, name) => Array.from(doc.getElementsByTagName('*')).filter((el) => el.localName === name || el.nodeName.split(':').pop() === name)

async function epubMetadata(filePath) {
  const zip = await JSZip.loadAsync(await readFile(filePath))
  const find = (target) => zip.file(target) || Object.values(zip.files).find((entry) => entry.name.toLowerCase() === target.toLowerCase()) || null
  const containerEntry = find('META-INF/container.xml')
  if (!containerEntry) return {}
  const container = new DOMParser().parseFromString(xmlText(await containerEntry.async('text')), 'application/xml')
  const opfPath = xml(container, 'rootfile')[0]?.getAttribute('full-path')
  const opfEntry = opfPath && find(opfPath)
  if (!opfEntry) return {}
  const opf = new DOMParser().parseFromString(xmlText(await opfEntry.async('text')), 'application/xml')
  const author = xml(opf, 'creator')[0]?.textContent?.replace(/\s+/g, ' ').trim() || ''
  const items = xml(opf, 'item')
  const coverId = xml(opf, 'meta').find((el) => el.getAttribute('name')?.toLowerCase() === 'cover')?.getAttribute('content')
  const coverItem = items.find((el) => el.getAttribute('properties')?.split(/\s+/).includes('cover-image'))
    || items.find((el) => coverId && el.getAttribute('id') === coverId)
    || items.find((el) => /cover/i.test(`${el.getAttribute('id') || ''} ${el.getAttribute('href') || ''}`) && /^image\//i.test(el.getAttribute('media-type') || ''))
  let cover = null
  if (coverItem) {
    const coverPath = path.posix.normalize(path.posix.join(path.posix.dirname(opfPath), coverItem.getAttribute('href') || ''))
    const coverEntry = find(coverPath) || Object.values(zip.files).find((entry) => entry.name.toLowerCase().endsWith(`/${coverPath.toLowerCase()}`))
    if (coverEntry) {
      const bytes = await coverEntry.async('nodebuffer')
      if (bytes.length && bytes.length <= 3 * 1024 * 1024) cover = { bytes, mime: coverItem.getAttribute('media-type') || 'image/jpeg' }
    }
  }
  return { author, cover }
}

const localFiles = new Map()
for (const file of await readdir(bookDir, { recursive: true })) {
  const name = String(file)
  if (name.toLowerCase().endsWith('.epub')) localFiles.set(normalize(path.basename(name, path.extname(name))), path.join(bookDir, name))
}
console.log(`本地 EPUB：${localFiles.size} 个`)

const list = await (await fetch(`${base}/v1/store/books`, { headers: auth })).json()
const books = list.books || []
console.log(`书城书籍：${books.length} 本`)

let authorUpdated = 0, coverUploaded = 0, matched = 0, failed = 0
for (const [index, book] of books.entries()) {
  const localPath = localFiles.get(normalize(book.title))
  if (!localPath) { console.log(`[${index + 1}/${books.length}] 跳过（本地找不到）：${book.title}`); continue }
  matched += 1
  try {
    const { author, cover } = await epubMetadata(localPath)
    if (author && book.author !== author) {
      const patch = await fetch(`${base}/v1/store/books/${book.id}`, { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ author }) })
      if (patch.ok) authorUpdated += 1
      else console.log(`  作者更新失败(${patch.status})：${book.title}`)
    }
    if (cover && !book.hasCover) {
      const put = await fetch(`${base}/v1/store/books/${book.id}/cover`, { method: 'PUT', headers: { ...auth, 'content-type': cover.mime, 'content-length': String(cover.bytes.length) }, body: cover.bytes })
      if (put.ok) coverUploaded += 1
      else console.log(`  封面上传失败(${put.status})：${book.title}`)
    }
    if ((index + 1) % 10 === 0) console.log(`进度 ${index + 1}/${books.length}：作者 ${authorUpdated}，封面 ${coverUploaded}`)
  } catch (error) {
    failed += 1
    console.log(`  解析失败：${book.title}（${error.message}）`)
  }
}
console.log(JSON.stringify({ matched, authorUpdated, coverUploaded, failed }))
