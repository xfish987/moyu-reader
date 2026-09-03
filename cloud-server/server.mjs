import http from 'node:http'
import { createHash, randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto'
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { deflateRawSync } from 'node:zlib'
import Busboy from 'busboy'
import { createJobs as createNovelJobs, getJob as getNovelJob, jobToLibrary as novelJobToLibrary, jobToStore as novelJobToStore, listJobs as listNovelJobs, openJobFile as openNovelJobFile, retryJob as retryNovelJob, searchNovel } from './novel.mjs'
import { createJobs as createEpubMakerJobs, getJob as getEpubMakerJob, jobToLibrary as epubMakerJobToLibrary, jobToStore as epubMakerJobToStore, listJobs as listEpubMakerJobs, openJobFile as openEpubMakerJobFile, parseEpubMakerUpload, retryJob as retryEpubMakerJob } from './epubMaker.mjs'
import { extractEpubMeta } from './epubCover.mjs'

const scrypt = promisify(scryptCallback)
const PORT = Number(process.env.PORT || 8787)
const DATA_DIR = path.resolve(process.env.DATA_DIR || './cloud-data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')
const SNAPSHOT_DIR = path.join(DATA_DIR, 'snapshots')
const LIBRARY_DIR = path.join(DATA_DIR, 'library-files')
const COVER_DIR = path.join(DATA_DIR, 'bookstore-covers')
const NOVEL_DIR = path.join(DATA_DIR, 'novel-downloads')
const EPUB_MAKER_DIR = path.join(DATA_DIR, 'epub-maker-output')
// 0 means a session remains valid until explicit logout/password change/account deletion.
const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 0)
const SESSION_MS = SESSION_DAYS > 0 ? SESSION_DAYS * 86400000 : 0
const MAX_SNAPSHOT_BYTES = Number(process.env.MAX_SNAPSHOT_BYTES || 8 * 1024 ** 3)
const MAX_BOOK_BYTES = Number(process.env.MAX_BOOK_BYTES || 1024 ** 3)
const ALLOW_PUBLIC_REGISTRATION = process.env.ALLOW_PUBLIC_REGISTRATION === 'true'
const INVITE_CODE = String(process.env.INVITE_CODE || 'NOOMY')
const PRESET_CATEGORIES = ['起点', '晋江', '番茄', 'po', '日轻', '韩轻', '出版书籍']
const WEB_DIR = fileURLToPath(new URL('./web', import.meta.url))
const JSON_LIMIT = 64 * 1024
const SYNC_JSON_LIMIT = 32 * 1024 * 1024
const attempts = new Map()

await mkdir(SNAPSHOT_DIR, { recursive: true })
await mkdir(LIBRARY_DIR, { recursive: true })
await mkdir(COVER_DIR, { recursive: true })
await mkdir(NOVEL_DIR, { recursive: true })
await mkdir(EPUB_MAKER_DIR, { recursive: true })

// 数据库在内存中缓存一份，所有请求共享同一对象；写盘通过队列串行化，
// 避免并发请求 read-modify-write 互相覆盖（C8）。
let databaseCache = null
let saveQueue = Promise.resolve()

async function loadUsers() {
  if (databaseCache) return databaseCache
  try {
    const parsed = JSON.parse(await readFile(USERS_FILE, 'utf8'))
    databaseCache = parsed && typeof parsed === 'object' ? parsed : { users: [] }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    databaseCache = { users: [] }
  }
  return databaseCache
}

async function saveUsers(database) {
  const payload = `${JSON.stringify(database, null, 2)}\n`
  const write = saveQueue.then(async () => {
    const temporary = `${USERS_FILE}.${process.pid}.tmp`
    await writeFile(temporary, payload, { mode: 0o600 })
    await rename(temporary, USERS_FILE)
  })
  saveQueue = write.catch(() => {})
  return write
}

// 清理不再被任何账户引用的个人书库文件（C10）
async function collectOrphanLibraryFiles(database) {
  const referenced = new Set(database.users.flatMap((entry) => (entry.library || []).map((item) => item.fileName)))
  let entries
  try { entries = await readdir(LIBRARY_DIR) } catch { return }
  await Promise.all(entries.filter((name) => !referenced.has(name)).map((name) => rm(path.join(LIBRARY_DIR, name), { force: true })))
}

// 删除书城书籍的文件与封面
async function removeBookFiles(entry) {
  const files = normalizeBookFiles(entry)
  for (const f of files) await rm(path.join(DATA_DIR, 'bookstore', f.fileName), { force: true })
  if (entry.coverFileName) await rm(path.join(COVER_DIR, entry.coverFileName), { force: true })
}

async function removeUserJobFiles(user) {
  const novelNames = (user.novelJobs || []).map((job) => job.fileName).filter(Boolean)
  const makerNames = (user.epubMakerJobs || []).flatMap((job) => [job.fileName, job.inputFileName, job.coverFileName]).filter(Boolean)
  await Promise.all([
    ...novelNames.map((name) => rm(path.join(NOVEL_DIR, path.basename(name)), { force: true })),
    ...makerNames.map((name) => rm(path.join(EPUB_MAKER_DIR, path.basename(name)), { force: true })),
  ])
}

// 多文件书籍兼容：旧记录补齐 files 数组
function normalizeBookFiles(book) {
  if (Array.isArray(book.files) && book.files.length) return book.files
  if (book.fileName) {
    return [{
      id: randomUUID(),
      fileName: book.fileName,
      group: '',
      label: '',
      size: book.size || 0,
      sha256: book.sha256 || '',
      format: book.format || (book.extension === '.epub' ? 'EPUB' : 'TXT'),
      extension: book.extension || path.extname(book.fileName),
    }]
  }
  return []
}

function totalBookSize(book) {
  return normalizeBookFiles(book).reduce((sum, f) => sum + (Number(f.size) || 0), 0)
}

function syncLegacyBookFields(book) {
  const files = normalizeBookFiles(book)
  if (!files.length) return
  book.fileName = files[0].fileName
  book.size = files[0].size
  book.sha256 = files[0].sha256
  book.format = files[0].format
  book.extension = files[0].extension
}

// 启动时迁移旧书籍：补齐 files 数组与连载状态
async function migrateBooks(database) {
  if (!database.books) return
  let dirty = false
  for (const book of database.books) {
    if (!Array.isArray(book.files) || !book.files.length) {
      book.files = normalizeBookFiles(book)
      syncLegacyBookFields(book)
      dirty = true
    }
    if (!book.status) { book.status = 'completed'; dirty = true }
  }
  if (dirty) await saveUsers(database)
}

// 简单 ZIP 写入：把多个 { name, path } 打包成 Buffer
async function makeZip(entries) {
  const files = []
  let nextOffset = 0
  for (const entry of entries) {
    const data = await readFile(entry.path)
    const compressed = deflateRawSync(data)
    const useCompressed = compressed.length < data.length
    const payload = useCompressed ? compressed : data
    const crc = crc32(data)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(0x800, 6) // UTF-8 文件名
    localHeader.writeUInt16LE(useCompressed ? 8 : 0, 8) // compression method
    localHeader.writeUInt32LE(0, 10) // time/date
    localHeader.writeUInt32LE(crc, 14)
    localHeader.writeUInt32LE(payload.length, 18)
    localHeader.writeUInt32LE(data.length, 22)
    const nameBuf = Buffer.from(entry.name, 'utf8')
    localHeader.writeUInt16LE(nameBuf.length, 26)
    localHeader.writeUInt16LE(0, 28)
    const localOffset = nextOffset
    nextOffset += localHeader.length + nameBuf.length + payload.length
    files.push({ localHeader, nameBuf, payload, crc, compressed: useCompressed, size: data.length, localOffset })
  }

  const centralStart = nextOffset
  const central = []
  let centralSize = 0
  for (let i = 0; i < files.length; i++) {
    const f = files[i]
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x800, 8) // UTF-8 文件名
    header.writeUInt16LE(f.compressed ? 8 : 0, 10) // compression method
    header.writeUInt32LE(0, 12)
    header.writeUInt32LE(f.crc, 16)
    header.writeUInt32LE(f.payload.length, 20)
    header.writeUInt32LE(f.size, 24)
    header.writeUInt16LE(f.nameBuf.length, 28)
    header.writeUInt16LE(0, 30)
    header.writeUInt16LE(0, 32)
    header.writeUInt16LE(0, 34)
    header.writeUInt16LE(0, 36)
    header.writeUInt32LE(0, 38)
    header.writeUInt32LE(f.localOffset, 42)
    central.push({ header, nameBuf: f.nameBuf })
    centralSize += header.length + f.nameBuf.length
  }

  const parts = []
  for (const f of files) parts.push(f.localHeader, f.nameBuf, f.payload)
  for (const c of central) parts.push(c.header, c.nameBuf)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(files.length, 8)
  eocd.writeUInt16LE(files.length, 10)
  eocd.writeUInt32LE(centralSize, 12)
  eocd.writeUInt32LE(centralStart, 16)
  eocd.writeUInt16LE(0, 20)
  parts.push(eocd)
  return Buffer.concat(parts)
}

function crc32(buf) {
  // 简单 CRC32 表实现
  const table = crc32.table || (crc32.table = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    return c >>> 0
  }))
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// 写入一条通知；dedupeMs 内同类型同书同操作者不重复（用于下载通知防刷屏）
function pushNotification(database, recipientId, payload, dedupeMs = 0) {
  if (!recipientId) return
  database.notifications ||= []
  if (dedupeMs && database.notifications.some((entry) => entry.userId === recipientId && entry.type === payload.type && entry.bookId === payload.bookId && entry.actor === payload.actor && Date.now() - new Date(entry.createdAt).getTime() < dedupeMs)) return
  database.notifications.push({ id: randomUUID(), userId: recipientId, read: false, createdAt: new Date().toISOString(), ...payload })
  const owned = database.notifications.filter((entry) => entry.userId === recipientId)
  if (owned.length > 200) {
    const remove = new Set(owned.slice(0, owned.length - 200).map((entry) => entry.id))
    database.notifications = database.notifications.filter((entry) => !remove.has(entry.id))
  }
}

const WEB_MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2' }

// 托管 Web 版书城（静态 SPA，与 API 同域）
async function serveStatic(pathname, response) {
  let relative
  try { relative = decodeURIComponent(pathname).replace(/^\/+/, '') } catch { return json(response, 400, { error: '路径无效' }) }
  if (!relative || relative.endsWith('/')) relative += 'index.html'
  const target = path.join(WEB_DIR, relative)
  if (!target.startsWith(WEB_DIR)) return json(response, 403, { error: '禁止访问' })
  let filePath = target
  try { if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html') } catch { filePath = path.join(WEB_DIR, 'index.html') }
  try {
    const info = await stat(filePath)
    response.writeHead(200, { 'content-type': WEB_MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream', 'content-length': info.size, 'cache-control': 'no-cache' })
    const file = await open(filePath, 'r')
    file.createReadStream().pipe(response)
  } catch { json(response, 404, { error: '页面不存在' }) }
}

const normalizeUsername = (value) => String(value || '').trim().toLowerCase()
const validUsername = (value) => /^[a-z0-9_\-.]{3,32}$/.test(value)
const validPassword = (value) => typeof value === 'string' && value.length >= 10 && value.length <= 128
const tokenHash = (token) => createHash('sha256').update(token).digest('hex')

async function passwordHash(password, salt = randomBytes(16).toString('hex')) {
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return { salt, hash: Buffer.from(derived).toString('hex') }
}

async function passwordMatches(password, user) {
  const candidate = await passwordHash(password, user.passwordSalt)
  const left = Buffer.from(candidate.hash, 'hex')
  const right = Buffer.from(user.passwordHash, 'hex')
  return left.length === right.length && timingSafeEqual(left, right)
}

function json(response, status, body) {
  const payload = Buffer.from(JSON.stringify(body))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': payload.length, 'cache-control': 'no-store' })
  response.end(payload)
}

async function readJson(request, limit = JSON_LIMIT) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > limit) throw Object.assign(new Error('请求内容过大'), { status: 413 })
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw Object.assign(new Error('JSON 格式无效'), { status: 400 }) }
}

function clientKey(request) { return String(request.headers['x-forwarded-for'] || request.socket.remoteAddress || '').split(',')[0].trim() }
function rateLimited(request, limit = 20) {
  const key = clientKey(request)
  const now = Date.now()
  const recent = (attempts.get(key) || []).filter((time) => now - time < 10 * 60_000)
  recent.push(now)
  attempts.set(key, recent)
  if (attempts.size > 5000) attempts.clear()
  return recent.length > limit
}

async function authenticate(request, database) {
  const token = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const hashed = tokenHash(token)
  const now = Date.now()
  for (const user of database.users) {
    user.sessions = (user.sessions || []).filter((session) => !session.expiresAt || session.expiresAt > now)
    const session = user.sessions.find((entry) => entry.tokenHash === hashed)
    if (session) return user
  }
  return null
}

function publicUser(user) {
  return { id: user.id, username: user.username, nickname: user.nickname || user.username, avatar: user.avatar || '', createdAt: user.createdAt, snapshot: user.snapshot || null, sync: user.sync ? { updatedAt: user.sync.updatedAt, size: user.sync.size } : null, libraryCount: (user.library || []).length }
}

function publicLibraryBook(book) {
  return { id: book.id, clientBookId: book.clientBookId, title: book.title, author: book.author || '', format: book.format, size: book.size, sha256: book.sha256, uploadedAt: book.uploadedAt }
}

function parseLibraryMetadata(request) {
  try {
    const parsed = JSON.parse(Buffer.from(String(request.headers['x-moyu-library-book'] || ''), 'base64url').toString('utf8'))
    const clientBookId = String(parsed.clientBookId || '').trim().slice(0, 80)
    const title = String(parsed.title || '').trim().slice(0, 160)
    const author = String(parsed.author || '').trim().slice(0, 100)
    const extension = String(parsed.extension || '').toLowerCase()
    if (!clientBookId || !title || !['.txt', '.epub'].includes(extension)) throw new Error()
    return { clientBookId, title, author, extension, format: extension === '.epub' ? 'EPUB' : 'TXT' }
  } catch { throw Object.assign(new Error('个人书库信息无效'), { status: 400 }) }
}

function publicBook(book, currentUserId) {
  const reviews = Array.isArray(book.reviews) ? book.reviews : []
  const rated = reviews.filter((review) => Number.isInteger(review.rating))
  const averageRating = rated.length ? rated.reduce((sum, review) => sum + review.rating, 0) / rated.length : null
  const files = normalizeBookFiles(book)
  return {
    id: book.id,
    title: book.title,
    author: book.author || '',
    category: book.category,
    format: files[0]?.format || book.format,
    size: totalBookSize(book),
    sha256: files[0]?.sha256 || book.sha256,
    uploadedAt: book.uploadedAt,
    uploader: book.uploader,
    uploaderDisplay: book.uploaderDisplay || book.uploader,
    uploaderAvatar: book.uploaderAvatar || '',
    hasCover: Boolean(book.coverFileName),
    canManage: book.uploaderId === currentUserId,
    ratingCount: rated.length,
    averageRating,
    status: book.status || 'completed',
    fileCount: files.length,
    files: files.map(({ id, group, label, size, format, extension }) => ({ id, group, label, size, format, extension })),
    reviews: reviews.map(({ userId, ...review }) => ({ ...review, mine: userId === currentUserId })),
  }
}

function parseBookMetadata(request) {
  try {
    const encoded = String(request.headers['x-moyu-book'] || '')
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    const title = String(parsed.title || '').trim().slice(0, 160)
    const author = String(parsed.author || '').trim().slice(0, 100)
    const category = String(parsed.category || '').trim().slice(0, 40)
    const status = parsed.status === 'ongoing' ? 'ongoing' : 'completed'
    const extension = String(parsed.extension || '').toLowerCase()
    // 单文件上传保持旧字段兼容
    if (extension && !['.txt', '.epub'].includes(extension)) throw new Error()
    const files = Array.isArray(parsed.files)
      ? parsed.files.map((f, i) => ({
          id: String(f.id || '').trim() || randomUUID(),
          group: String(f.group || '').trim().slice(0, 80),
          label: String(f.label || '').trim().slice(0, 80) || (i === 0 ? '' : `第 ${i + 1} 部`),
          extension: String(f.extension || extension || '').toLowerCase(),
        })).filter((f) => ['.txt', '.epub'].includes(f.extension))
      : []
    if (!title || !category) throw new Error()
    if (extension && !files.length) files.push({ id: randomUUID(), label: '', extension })
    if (!files.length) throw new Error()
    return { title, author, category, status, files }
  } catch { throw Object.assign(new Error('书籍信息无效'), { status: 400 }) }
}

// 校验单个上传文件内容并落盘；source 可以是 stream 或 Buffer
async function saveUploadedBookFile(source, extension, target) {
  await mkdir(path.dirname(target), { recursive: true })
  const temporary = `${target}.${randomUUID()}.tmp`
  const file = await open(temporary, 'wx', 0o600)
  const hash = createHash('sha256')
  let size = 0
  let prefix = Buffer.alloc(0)
  try {
    if (Buffer.isBuffer(source)) {
      size = source.length
      if (size > MAX_BOOK_BYTES) throw Object.assign(new Error('单文件超过上传限制'), { status: 413 })
      prefix = source.subarray(0, 512)
      hash.update(source)
      await file.write(source)
    } else {
      for await (const chunk of source) {
        size += chunk.length
        if (size > MAX_BOOK_BYTES) throw Object.assign(new Error('单文件超过上传限制'), { status: 413 })
        if (prefix.length < 512) prefix = Buffer.concat([prefix, chunk]).subarray(0, 512)
        hash.update(chunk)
        await file.write(chunk)
      }
    }
    await file.close()
    if (extension === '.epub' && prefix.subarray(0, 2).toString() !== 'PK') throw Object.assign(new Error('EPUB 文件格式无效'), { status: 400 })
    if (extension === '.txt' && prefix.includes(0)) throw Object.assign(new Error('TXT 文件包含无效二进制内容'), { status: 400 })
    const sha256 = hash.digest('hex')
    await rename(temporary, target)
    return { size, sha256 }
  } catch (error) {
    await file.close().catch(() => {})
    await rm(temporary, { force: true })
    throw error
  }
}

// 解析 multipart/form-data，返回 { fields: { metadata: object }, files: [{ file, label, extension }] }
function parseMultipart(request) {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'] || 0)
    if (!declared || declared > MAX_BOOK_BYTES) return reject(Object.assign(new Error('上传为空或超过限制'), { status: 413 }))
    const contentType = String(request.headers['content-type'] || '')
    if (!contentType.includes('multipart/form-data')) return reject(Object.assign(new Error('请求格式错误'), { status: 400 }))
    const busboy = Busboy({ headers: request.headers, limits: { files: 200, fileSize: MAX_BOOK_BYTES, fields: 10 } })
    const files = []
    let metadata = null
    let totalSize = 0
    busboy.on('file', (fieldname, file, info) => {
      const original = info.filename || ''
      const extension = path.extname(original).toLowerCase()
      if (!['.txt', '.epub'].includes(extension)) { file.resume(); return }
      const chunks = []
      file.on('data', (chunk) => { chunks.push(chunk); totalSize += chunk.length })
      file.on('limit', () => { reject(Object.assign(new Error('单文件超过上传限制'), { status: 413 })) })
      file.on('end', () => { files.push({ buffer: Buffer.concat(chunks), extension }) })
    })
    busboy.on('field', (name, value) => {
      if (name === 'metadata') {
        try {
          const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
          metadata = parseBookMetadata({ headers: { 'x-moyu-book': Buffer.from(JSON.stringify(parsed)).toString('base64url') } })
        } catch { /* 稍后统一校验 */ }
      }
    })
    busboy.on('error', (err) => reject(Object.assign(err, { status: 400 })))
    busboy.on('finish', () => {
      if (totalSize > MAX_BOOK_BYTES) return reject(Object.assign(new Error('总大小超过上传限制'), { status: 413 }))
      resolve({ metadata, files })
    })
    request.pipe(busboy)
  })
}

// 处理单文件流式上传（旧客户端兼容）
async function uploadSingleBookFile(request, metadata) {
  const extension = metadata.files[0].extension
  const id = randomUUID()
  const target = path.join(DATA_DIR, 'bookstore', `${id}${extension}`)
  const { size, sha256 } = await saveUploadedBookFile(request, extension, target)
  return [{
    id: metadata.files[0].id || randomUUID(),
    fileName: path.basename(target),
    group: metadata.files[0].group || '',
    label: metadata.files[0].label || '',
    size,
    sha256,
    format: extension === '.epub' ? 'EPUB' : 'TXT',
    extension,
  }]
}

// 将 multipart 解析出的 Buffer 数组落盘，生成 files 记录
async function saveMultipartFiles(uploads, metadata) {
  if (!uploads.length) throw Object.assign(new Error('没有接收到有效文件'), { status: 400 })
  if (uploads.length !== metadata.files.length) throw Object.assign(new Error('文件数量与元数据不匹配'), { status: 400 })
  const result = []
  try {
    for (let i = 0; i < uploads.length; i++) {
      const up = uploads[i]
      const metaFile = metadata.files[i]
      if (up.extension !== metaFile.extension) throw Object.assign(new Error(`第 ${i + 1} 个文件格式与元数据不一致`), { status: 400 })
      const id = randomUUID()
      const target = path.join(DATA_DIR, 'bookstore', `${id}${up.extension}`)
      const { size, sha256 } = await saveUploadedBookFile(up.buffer, up.extension, target)
      result.push({
        id: metaFile.id || randomUUID(), fileName: path.basename(target), group: metaFile.group || up.group || '',
        label: metaFile.label || up.label || (i === 0 ? '' : `第 ${i + 1} 部`), size, sha256,
        format: up.extension === '.epub' ? 'EPUB' : 'TXT', extension: up.extension,
      })
    }
    return result
  } catch (error) {
    await removeStoredUploads(result)
    throw error
  }
}

async function removeStoredUploads(files) {
  await Promise.all((files || []).map((file) => rm(path.join(DATA_DIR, 'bookstore', path.basename(file.fileName)), { force: true })))
}

function findDuplicateUpload(files, books) {
  const seen = new Set()
  for (const file of files) {
    if (seen.has(file.sha256)) return true
    seen.add(file.sha256)
    if (books.some((book) => normalizeBookFiles(book).some((existing) => existing.sha256 === file.sha256))) return true
  }
  return false
}

// 处理多文件上传（追加新卷）
async function uploadMultipleBookFiles(request, metadata) {
  const { files: uploads } = await parseMultipart(request)
  return saveMultipartFiles(uploads, metadata)
}

// 保存书籍封面兜底提取（EPUB）
async function extractAndSaveCover(book, filePath, bookId) {
  if (path.extname(filePath).toLowerCase() !== '.epub') return
  try {
    const meta = extractEpubMeta(await readFile(filePath))
    if (!meta) return
    if (!book.title && meta.title) book.title = meta.title.slice(0, 160)
    if (!book.author && meta.author) book.author = meta.author.slice(0, 100)
    if (meta.cover && !book.coverFileName) {
      const ext = meta.cover.mime === 'image/png' ? '.png' : meta.cover.mime === 'image/webp' ? '.webp' : '.jpg'
      await writeFile(path.join(COVER_DIR, `${bookId}${ext}`), meta.cover.data, { mode: 0o600 })
      book.coverFileName = `${bookId}${ext}`
      book.coverMime = meta.cover.mime
    }
  } catch { /* 忽略解析失败 */ }
}

function createSession(user) {
  const token = randomBytes(32).toString('base64url')
  user.sessions = [...(user.sessions || []), { tokenHash: tokenHash(token), createdAt: Date.now(), expiresAt: SESSION_MS ? Date.now() + SESSION_MS : null }].slice(-8)
  return token
}

async function handle(request, response) {
  const url = new URL(request.url, 'http://localhost')
  if (request.method === 'GET' && url.pathname === '/health') return json(response, 200, { ok: true, service: 'moyu-reader-cloud' })
  if (request.method === 'GET' && !url.pathname.startsWith('/v1/')) return serveStatic(url.pathname, response)

  const database = await loadUsers()
  await migrateBooks(database)
  if (request.method === 'POST' && url.pathname === '/v1/auth/register') {
    if (!ALLOW_PUBLIC_REGISTRATION) return json(response, 403, { error: '此服务不开放注册，请联系管理员创建账户' })
    if (rateLimited(request)) return json(response, 429, { error: '尝试次数过多，请稍后再试' })
    const body = await readJson(request)
    if (String(body.inviteCode || '').trim().toUpperCase() !== INVITE_CODE.toUpperCase()) return json(response, 403, { error: '邀请码不正确，注册需要有效邀请码' })
    const username = normalizeUsername(body.username)
    if (!validUsername(username)) return json(response, 400, { error: '用户名需为 3–32 位字母、数字、点、横线或下划线' })
    if (!validPassword(body.password)) return json(response, 400, { error: '密码长度需为 10–128 位' })
    if (database.users.some((user) => user.username === username)) return json(response, 409, { error: '用户名已存在' })
    const password = await passwordHash(body.password)
    const user = { id: randomUUID(), username, passwordSalt: password.salt, passwordHash: password.hash, createdAt: new Date().toISOString(), sessions: [] }
    const token = createSession(user)
    database.users.push(user)
    await saveUsers(database)
    return json(response, 201, { token, user: publicUser(user) })
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/login') {
    if (rateLimited(request)) return json(response, 429, { error: '尝试次数过多，请稍后再试' })
    const body = await readJson(request)
    const user = database.users.find((entry) => entry.username === normalizeUsername(body.username))
    if (!user || !await passwordMatches(body.password, user)) return json(response, 401, { error: '用户名或密码错误' })
    const token = createSession(user)
    await saveUsers(database)
    return json(response, 200, { token, user: publicUser(user) })
  }

  const user = await authenticate(request, database)
  if (!user) return json(response, 401, { error: '登录已失效，请重新登录' })

  if (request.method === 'GET' && url.pathname === '/v1/account') return json(response, 200, { user: publicUser(user) })

  database.books ||= []
  database.thoughts ||= []
  database.notifications ||= []
  user.library ||= []
  const novelCtx = { dataDir: DATA_DIR, novelDir: NOVEL_DIR, libraryDir: LIBRARY_DIR, coverDir: COVER_DIR, saveUsers: () => saveUsers(database) }
  const epubMakerCtx = { dataDir: DATA_DIR, epubMakerDir: EPUB_MAKER_DIR, libraryDir: LIBRARY_DIR, coverDir: COVER_DIR, saveUsers: () => saveUsers(database) }

  if (request.method === 'PATCH' && url.pathname === '/v1/account/profile') {
    const body = await readJson(request, 2 * 1024 * 1024)
    const nickname = String(body.nickname || '').trim().slice(0, 32)
    const avatar = String(body.avatar || '')
    if (!nickname) return json(response, 400, { error: '昵称不能为空' })
    if (avatar && (!/^data:image\/(png|jpeg|webp);base64,/i.test(avatar) || Buffer.byteLength(avatar) > 1400 * 1024)) return json(response, 400, { error: '头像格式无效或超过 1 MB' })
    user.nickname = nickname; user.avatar = avatar
    for (const thought of database.thoughts) {
      if (thought.userId === user.id) { thought.nickname = nickname; thought.avatar = avatar }
      for (const reply of thought.replies || []) if (reply.userId === user.id) { reply.nickname = nickname; reply.avatar = avatar }
    }
    for (const book of database.books) {
      if (book.uploaderId === user.id) { book.uploaderDisplay = nickname; book.uploaderAvatar = avatar }
      for (const review of book.reviews || []) if (review.userId === user.id) { review.nickname = nickname; review.avatar = avatar }
    }
    await saveUsers(database)
    return json(response, 200, { user: publicUser(user) })
  }

  if (request.method === 'GET' && url.pathname === '/v1/account/export') {
    const ownedThoughts = database.thoughts.filter((thought) => thought.userId === user.id || (thought.replies || []).some((reply) => reply.userId === user.id))
    const reviews = database.books.flatMap((book) => (book.reviews || []).filter((review) => review.userId === user.id).map((review) => ({ bookId: book.id, bookTitle: book.title, ...review })))
    return json(response, 200, { exportedAt: new Date().toISOString(), user: publicUser(user), sync: user.sync || null, translationData: user.translationData || null, novelJobs: listNovelJobs(user, novelCtx), epubMakerJobs: listEpubMakerJobs(user, epubMakerCtx), library: user.library.map(publicLibraryBook), thoughts: ownedThoughts, reviews })
  }

  if (request.method === 'POST' && url.pathname === '/v1/account/clear') {
    const body = await readJson(request)
    if (body.confirmation !== '我确认清空账户数据') return json(response, 400, { error: '确认文字不正确' })
    const ownedStoreBooks = database.books.filter((book) => book.uploaderId === user.id)
    database.books = database.books.filter((book) => book.uploaderId !== user.id).map((book) => ({ ...book, reviews: (book.reviews || []).filter((review) => review.userId !== user.id) }))
    database.thoughts = database.thoughts.filter((thought) => thought.userId !== user.id).map((thought) => ({ ...thought, likedBy: (thought.likedBy || []).filter((id) => id !== user.id), replies: (thought.replies || []).filter((reply) => reply.userId !== user.id) }))
    database.notifications = (database.notifications || []).filter((entry) => entry.userId !== user.id)
    await Promise.all(ownedStoreBooks.map((book) => removeBookFiles(book)))
    await rm(path.join(SNAPSHOT_DIR, `${user.id}.zip`), { force: true })
    await removeUserJobFiles(user)
    user.snapshot = null; user.sync = null; user.translationData = null; user.translationDataUpdatedAt = null; user.library = []; user.novelJobs = []; user.epubMakerJobs = []
    await saveUsers(database)
    await collectOrphanLibraryFiles(database)
    return json(response, 200, { ok: true, user: publicUser(user) })
  }

  if (request.method === 'DELETE' && url.pathname === '/v1/account') {
    const body = await readJson(request)
    if (body.confirmation !== '我确认删除账号') return json(response, 400, { error: '确认文字不正确' })
    const ownedStoreBooks = database.books.filter((book) => book.uploaderId === user.id)
    database.users = database.users.filter((entry) => entry.id !== user.id)
    database.books = database.books.filter((book) => book.uploaderId !== user.id).map((book) => ({ ...book, reviews: (book.reviews || []).filter((review) => review.userId !== user.id) }))
    database.thoughts = database.thoughts.filter((thought) => thought.userId !== user.id).map((thought) => ({ ...thought, likedBy: (thought.likedBy || []).filter((id) => id !== user.id), replies: (thought.replies || []).filter((reply) => reply.userId !== user.id) }))
    database.notifications = (database.notifications || []).filter((entry) => entry.userId !== user.id)
    await Promise.all(ownedStoreBooks.map((book) => removeBookFiles(book)))
    await removeUserJobFiles(user)
    await rm(path.join(SNAPSHOT_DIR, `${user.id}.zip`), { force: true })
    await saveUsers(database)
    await collectOrphanLibraryFiles(database)
    return json(response, 200, { ok: true })
  }

  if (request.method === 'GET' && url.pathname === '/v1/sync') {
    return json(response, 200, { sync: user.sync || null })
  }

  if (request.method === 'PUT' && url.pathname === '/v1/sync') {
    const body = await readJson(request, SYNC_JSON_LIMIT)
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return json(response, 400, { error: '同步数据格式无效' })
    const serialized = JSON.stringify(body.data)
    user.sync = { version: 1, updatedAt: new Date().toISOString(), size: Buffer.byteLength(serialized), data: body.data }
    await saveUsers(database)
    return json(response, 200, { sync: { updatedAt: user.sync.updatedAt, size: user.sync.size } })
  }

  // 章节翻译与名词库按账户独立存储；桌面端增量保存，不依赖手动整库同步。
  if (request.method === 'GET' && url.pathname === '/v1/translation-data') {
    return json(response, 200, { data: user.translationData || null, updatedAt: user.translationDataUpdatedAt || null })
  }
  if (request.method === 'PUT' && url.pathname === '/v1/translation-data') {
    const body = await readJson(request, SYNC_JSON_LIMIT)
    if (!body.data || typeof body.data !== 'object' || Array.isArray(body.data)) return json(response, 400, { error: '翻译数据格式无效' })
    user.translationData = body.data
    user.translationDataUpdatedAt = new Date().toISOString()
    await saveUsers(database)
    return json(response, 200, { updatedAt: user.translationDataUpdatedAt })
  }

  // ===== 搜书制作（so-novel 引擎代理，仅限已登录用户） =====
  if (request.method === 'GET' && url.pathname === '/v1/novel/search') {
    const q = String(url.searchParams.get('q') || '').trim().slice(0, 60)
    if (!q) return json(response, 400, { error: '请输入搜索关键词' })
    const results = await searchNovel(q)
    return json(response, 200, { results })
  }

  if (request.method === 'POST' && url.pathname === '/v1/novel/jobs') {
    const body = await readJson(request)
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) return json(response, 400, { error: '请选择要制作的书籍' })
    return json(response, 201, { jobs: await createNovelJobs(user, items, novelCtx) })
  }

  if (request.method === 'GET' && url.pathname === '/v1/novel/jobs') return json(response, 200, { jobs: listNovelJobs(user, novelCtx) })

  const novelFileMatch = url.pathname.match(/^\/v1\/novel\/jobs\/([0-9a-f-]+)\/file$/)
  const novelRetryMatch = url.pathname.match(/^\/v1\/novel\/jobs\/([0-9a-f-]+)\/retry$/)
  const novelActionMatch = url.pathname.match(/^\/v1\/novel\/jobs\/([0-9a-f-]+)\/(to-library|to-store)$/)
  if (request.method === 'POST' && novelRetryMatch) return json(response, 200, { job: await retryNovelJob(user, novelRetryMatch[1], novelCtx) })

  if (request.method === 'GET' && novelFileMatch) {
    const job = getNovelJob(user, novelFileMatch[1])
    if (!job || job.status !== 'done' || !job.fileName) return json(response, 404, { error: '文件不存在或尚未完成' })
    const { stream, size, extension } = await openNovelJobFile(job, novelCtx)
    response.writeHead(200, { 'content-type': extension === '.epub' ? 'application/epub+zip' : 'text/plain; charset=utf-8', 'content-length': size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${job.title || 'book'}${extension}`)}`, 'cache-control': 'private, no-store' })
    stream.pipe(response)
    return
  }

  if (request.method === 'POST' && novelActionMatch) {
    const job = getNovelJob(user, novelActionMatch[1])
    if (!job || job.status !== 'done' || !job.fileName) return json(response, 404, { error: '任务不存在或尚未完成' })
    const body = await readJson(request)
    const title = String(body.title || job.title || '').trim().slice(0, 160)
    const author = String(body.author || job.author || '').trim().slice(0, 100)
    if (!title) return json(response, 400, { error: '书名不能为空' })
    if (novelActionMatch[2] === 'to-library') {
      const result = await novelJobToLibrary(user, job, { title, author }, novelCtx)
      return json(response, 200, result)
    }
    const category = String(body.category || '').trim().slice(0, 40)
    if (!category) return json(response, 400, { error: '分类不能为空' })
    const result = await novelJobToStore(user, job, { title, author, category }, novelCtx, database)
    return json(response, 201, { ok: true, book: publicBook(result.book, user.id) })
  }

  // ===== EPUB 制作（cn-epub-maker TXT 转 EPUB 代理，仅限已登录用户）=====
  if (request.method === 'POST' && url.pathname === '/v1/epub-maker/jobs') {
    const items = await parseEpubMakerUpload(request, EPUB_MAKER_DIR)
    return json(response, 201, { jobs: await createEpubMakerJobs(user, items, epubMakerCtx) })
  }

  if (request.method === 'GET' && url.pathname === '/v1/epub-maker/jobs') return json(response, 200, { jobs: listEpubMakerJobs(user, epubMakerCtx) })

  const epubMakerFileMatch = url.pathname.match(/^\/v1\/epub-maker\/jobs\/([0-9a-f-]+)\/file$/)
  const epubMakerRetryMatch = url.pathname.match(/^\/v1\/epub-maker\/jobs\/([0-9a-f-]+)\/retry$/)
  const epubMakerActionMatch = url.pathname.match(/^\/v1\/epub-maker\/jobs\/([0-9a-f-]+)\/(to-library|to-store)$/)
  if (request.method === 'POST' && epubMakerRetryMatch) return json(response, 200, { job: await retryEpubMakerJob(user, epubMakerRetryMatch[1], epubMakerCtx) })

  if (request.method === 'GET' && epubMakerFileMatch) {
    const job = getEpubMakerJob(user, epubMakerFileMatch[1])
    if (!job || job.status !== 'done' || !job.fileName) return json(response, 404, { error: '文件不存在或尚未完成' })
    const { stream, size } = await openEpubMakerJobFile(job, epubMakerCtx)
    response.writeHead(200, { 'content-type': 'application/epub+zip', 'content-length': size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${job.title || 'book'}.epub`)}`, 'cache-control': 'private, no-store' })
    stream.pipe(response)
    return
  }

  if (request.method === 'POST' && epubMakerActionMatch) {
    const job = getEpubMakerJob(user, epubMakerActionMatch[1])
    if (!job || job.status !== 'done' || !job.fileName) return json(response, 404, { error: '任务不存在或尚未完成' })
    const body = await readJson(request)
    const title = String(body.title || job.title || '').trim().slice(0, 160)
    const author = String(body.author || job.author || '').trim().slice(0, 100)
    if (!title) return json(response, 400, { error: '书名不能为空' })
    if (epubMakerActionMatch[2] === 'to-library') {
      const result = await epubMakerJobToLibrary(user, job, { title, author }, epubMakerCtx)
      return json(response, 200, result)
    }
    const category = String(body.category || '').trim().slice(0, 40)
    if (!category) return json(response, 400, { error: '分类不能为空' })
    const result = await epubMakerJobToStore(user, job, { title, author, category }, epubMakerCtx, database)
    return json(response, 201, { ok: true, book: publicBook(result.book, user.id) })
  }

  if (request.method === 'GET' && url.pathname === '/v1/notifications') {
    const mine = (database.notifications || []).filter((entry) => entry.userId === user.id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    return json(response, 200, { notifications: mine.slice(0, 100), unreadCount: mine.filter((entry) => !entry.read).length })
  }

  if (request.method === 'POST' && url.pathname === '/v1/notifications/read') {
    const body = await readJson(request)
    const ids = Array.isArray(body.ids) ? new Set(body.ids) : null
    for (const entry of database.notifications || []) if (entry.userId === user.id && (!ids || ids.has(entry.id))) entry.read = true
    await saveUsers(database)
    return json(response, 200, { ok: true })
  }

  if (request.method === 'GET' && url.pathname === '/v1/library/books') {
    return json(response, 200, { books: user.library.map(publicLibraryBook).sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt))) })
  }

  if (request.method === 'POST' && url.pathname === '/v1/library/books') {
    const metadata = parseLibraryMetadata(request)
    const declared = Number(request.headers['content-length'] || 0)
    if (!declared || declared > MAX_BOOK_BYTES) return json(response, 413, { error: '书籍为空或超过上传限制' })
    const temporary = path.join(LIBRARY_DIR, `${randomUUID()}.tmp`)
    const file = await open(temporary, 'wx', 0o600)
    const hash = createHash('sha256')
    let size = 0
    let prefix = Buffer.alloc(0)
    try {
      for await (const chunk of request) {
        size += chunk.length
        if (size > MAX_BOOK_BYTES) throw Object.assign(new Error('书籍超过上传限制'), { status: 413 })
        if (prefix.length < 512) prefix = Buffer.concat([prefix, chunk]).subarray(0, 512)
        hash.update(chunk); await file.write(chunk)
      }
      await file.close()
      if (metadata.extension === '.epub' && prefix.subarray(0, 2).toString() !== 'PK') throw Object.assign(new Error('EPUB 文件格式无效'), { status: 400 })
      if (metadata.extension === '.txt' && prefix.includes(0)) throw Object.assign(new Error('TXT 文件包含无效二进制内容'), { status: 400 })
      const sha256 = hash.digest('hex')
      const finalPath = path.join(LIBRARY_DIR, `${sha256}${metadata.extension}`)
      try { await stat(finalPath); await rm(temporary, { force: true }) } catch { await rename(temporary, finalPath) }
      const existing = user.library.find((entry) => entry.clientBookId === metadata.clientBookId)
      const item = { id: existing?.id || randomUUID(), ...metadata, size, sha256, fileName: path.basename(finalPath), uploadedAt: new Date().toISOString() }
      user.library = [...user.library.filter((entry) => entry.clientBookId !== metadata.clientBookId), item]
      await saveUsers(database)
      return json(response, existing ? 200 : 201, { book: publicLibraryBook(item), deduplicated: Boolean(existing) })
    } catch (error) { await file.close().catch(() => {}); await rm(temporary, { force: true }); throw error }
  }

  const libraryMatch = url.pathname.match(/^\/v1\/library\/books\/([0-9a-f-]+)$/)
  if (request.method === 'GET' && libraryMatch) {
    const book = user.library.find((entry) => entry.id === libraryMatch[1])
    if (!book) return json(response, 404, { error: '这本书不属于当前账户' })
    const target = path.join(LIBRARY_DIR, book.fileName)
    let info
    try { info = await stat(target) } catch { return json(response, 404, { error: '云端书籍文件不存在' }) }
    response.writeHead(200, { 'content-type': book.format === 'EPUB' ? 'application/epub+zip' : 'text/plain; charset=utf-8', 'content-length': info.size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}${book.extension}`)}`, 'cache-control': 'private, no-store' })
    const file = await open(target, 'r'); file.createReadStream().pipe(response); return
  }

  if (request.method === 'DELETE' && libraryMatch) {
    const book = user.library.find((entry) => entry.id === libraryMatch[1])
    if (!book) return json(response, 404, { error: '这本书不属于当前账户' })
    user.library = user.library.filter((entry) => entry.id !== book.id)
    await saveUsers(database)
    // 文件按内容哈希去重，可能仍被其他账户引用；这里只删除当前账户的映射。
    const stillReferenced = database.users.some((entry) => (entry.library || []).some((item) => item.fileName === book.fileName))
    if (!stillReferenced) await rm(path.join(LIBRARY_DIR, book.fileName), { force: true })
    return json(response, 200, { ok: true, clientBookId: book.clientBookId })
  }

  if (request.method === 'GET' && url.pathname === '/v1/thoughts') {
    const bookKey = String(url.searchParams.get('bookKey') || '').slice(0, 128)
    const thoughts = database.thoughts.filter((thought) => thought.bookKey === bookKey).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).map((thought) => ({
      ...thought,
      userId: undefined,
      mine: thought.userId === user.id,
      liked: (thought.likedBy || []).includes(user.id),
      likeCount: (thought.likedBy || []).length,
      likedBy: undefined,
      replies: (thought.replies || []).map((reply) => ({ ...reply, userId: undefined, mine: reply.userId === user.id })),
    }))
    return json(response, 200, { thoughts })
  }

  if (request.method === 'POST' && url.pathname === '/v1/thoughts') {
    if (rateLimited(request, 60)) return json(response, 429, { error: '操作过于频繁，请稍后再试' })
    const body = await readJson(request)
    const bookKey = String(body.bookKey || '').trim().slice(0, 128)
    const bookTitle = String(body.bookTitle || '').trim().slice(0, 160)
    const quote = String(body.quote || '').trim().slice(0, 4000)
    const content = String(body.content || '').trim().slice(0, 3000)
    const anchor = body.anchor && typeof body.anchor === 'object' ? JSON.parse(JSON.stringify(body.anchor)) : null
    if (!bookKey || !quote || !content) return json(response, 400, { error: '书籍、原句和想法内容不能为空' })
    const thought = { id: randomUUID(), bookKey, bookTitle, quote, content, anchor, userId: user.id, username: user.username, nickname: user.nickname || user.username, avatar: user.avatar || '', createdAt: new Date().toISOString(), likedBy: [], replies: [] }
    database.thoughts.push(thought)
    await saveUsers(database)
    return json(response, 201, { thought: { ...thought, userId: undefined, mine: true, liked: false, likeCount: 0, likedBy: undefined } })
  }

  const thoughtMatch = url.pathname.match(/^\/v1\/thoughts\/([0-9a-f-]+)$/)
  const likeMatch = url.pathname.match(/^\/v1\/thoughts\/([0-9a-f-]+)\/like$/)
  const replyMatch = url.pathname.match(/^\/v1\/thoughts\/([0-9a-f-]+)\/replies(?:\/([0-9a-f-]+))?$/)
  const thought = database.thoughts.find((entry) => entry.id === (thoughtMatch?.[1] || likeMatch?.[1] || replyMatch?.[1]))

  if (request.method === 'DELETE' && thoughtMatch) {
    if (!thought) return json(response, 404, { error: '想法不存在' })
    if (thought.userId !== user.id) return json(response, 403, { error: '只能删除自己的想法' })
    database.thoughts = database.thoughts.filter((entry) => entry.id !== thought.id)
    await saveUsers(database)
    return json(response, 200, { ok: true })
  }

  if (request.method === 'POST' && likeMatch) {
    if (!thought) return json(response, 404, { error: '想法不存在' })
    thought.likedBy ||= []
    thought.likedBy = thought.likedBy.includes(user.id) ? thought.likedBy.filter((id) => id !== user.id) : [...thought.likedBy, user.id]
    await saveUsers(database)
    return json(response, 200, { liked: thought.likedBy.includes(user.id), likeCount: thought.likedBy.length })
  }

  if (request.method === 'POST' && replyMatch && !replyMatch[2]) {
    if (!thought) return json(response, 404, { error: '想法不存在' })
    if (rateLimited(request, 60)) return json(response, 429, { error: '操作过于频繁，请稍后再试' })
    const body = await readJson(request)
    const content = String(body.content || '').trim().slice(0, 1200)
    if (!content) return json(response, 400, { error: '回复不能为空' })
    const reply = { id: randomUUID(), userId: user.id, username: user.username, nickname: user.nickname || user.username, avatar: user.avatar || '', content, createdAt: new Date().toISOString() }
    thought.replies ||= []
    thought.replies.push(reply)
    await saveUsers(database)
    return json(response, 201, { reply: { ...reply, userId: undefined, mine: true } })
  }

  if (request.method === 'DELETE' && replyMatch?.[2]) {
    if (!thought) return json(response, 404, { error: '想法不存在' })
    const reply = (thought.replies || []).find((entry) => entry.id === replyMatch[2])
    if (!reply) return json(response, 404, { error: '回复不存在' })
    if (reply.userId !== user.id) return json(response, 403, { error: '只能删除自己的回复' })
    thought.replies = thought.replies.filter((entry) => entry.id !== reply.id)
    await saveUsers(database)
    return json(response, 200, { ok: true })
  }

  if (request.method === 'GET' && url.pathname === '/v1/store/books') {
    const query = String(url.searchParams.get('q') || '').trim().toLowerCase().slice(0, 100)
    const category = String(url.searchParams.get('category') || '').trim().slice(0, 40)
    const books = database.books
      .filter((book) => (!query || `${book.title} ${book.author || ''} ${book.uploader}`.toLowerCase().includes(query)) && (!category || book.category === category))
      .sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)))
      .map((book) => publicBook(book, user.id))
    const categories = [...new Set([...PRESET_CATEGORIES, ...database.books.map((book) => book.category)])]
    return json(response, 200, { books, categories })
  }

  if (request.method === 'POST' && url.pathname === '/v1/store/books') {
    const contentType = String(request.headers['content-type'] || '')
    const isMultipart = contentType.includes('multipart/form-data')
    let metadata
    let uploadedFiles = []
    if (isMultipart) {
      const parsed = await parseMultipart(request)
      if (!parsed.metadata) return json(response, 400, { error: '书籍信息无效' })
      metadata = parsed.metadata
      uploadedFiles = parsed.files
    } else {
      metadata = parseBookMetadata(request)
    }

    const declared = Number(request.headers['content-length'] || 0)
    if (!declared || declared > MAX_BOOK_BYTES) return json(response, 413, { error: '书籍为空或超过上传限制' })

    const id = randomUUID()
    let files = []
    try {
      files = isMultipart
        ? await saveMultipartFiles(uploadedFiles, metadata)
        : await uploadSingleBookFile(request, metadata)
    } catch (error) {
      if (error.status) return json(response, error.status, { error: error.message })
      throw error
    }

    // 全局 sha256 去重
    if (findDuplicateUpload(files, database.books)) {
      await removeStoredUploads(files)
      return json(response, 409, { error: '有文件重复，或已经由其他书籍上传过' })
    }

    const book = {
      id,
      title: metadata.title,
      author: metadata.author,
      category: metadata.category,
      status: metadata.status,
      files,
      uploaderId: user.id,
      uploader: user.username,
      uploaderDisplay: user.nickname || user.username,
      uploaderAvatar: user.avatar || '',
      uploadedAt: new Date().toISOString(),
      reviews: [],
    }
    syncLegacyBookFields(book)

    // EPUB：客户端没读到（或没带）元数据时，服务端兜底提取书名 / 作者 / 封面
    const firstFilePath = files[0] ? path.join(DATA_DIR, 'bookstore', files[0].fileName) : null
    if (firstFilePath) await extractAndSaveCover(book, firstFilePath, id)

    database.books.push(book)
    await saveUsers(database)
    return json(response, 201, { book: publicBook(book, user.id) })
  }

  const bookMatch = url.pathname.match(/^\/v1\/store\/books\/([0-9a-f-]+)$/)
  const reviewMatch = url.pathname.match(/^\/v1\/store\/books\/([0-9a-f-]+)\/review$/)
  const coverMatch = url.pathname.match(/^\/v1\/store\/books\/([0-9a-f-]+)\/cover$/)
  const fileMatch = url.pathname.match(/^\/v1\/store\/books\/([0-9a-f-]+)\/files\/([0-9a-f-]+)$/)
  const downloadAllMatch = url.pathname.match(/^\/v1\/store\/books\/([0-9a-f-]+)\/download-all$/)
  const filesMatch = url.pathname.match(/^\/v1\/store\/books\/([0-9a-f-]+)\/files$/)
  const matchedBookId = bookMatch?.[1] || reviewMatch?.[1] || coverMatch?.[1] || fileMatch?.[1] || downloadAllMatch?.[1] || filesMatch?.[1]
  const book = database.books.find((entry) => entry.id === matchedBookId)
  const coverBook = database.books.find((entry) => entry.id === coverMatch?.[1])

  if (request.method === 'GET' && coverMatch) {
    if (!coverBook?.coverFileName) return json(response, 404, { error: '这本书没有封面' })
    const target = path.join(COVER_DIR, coverBook.coverFileName)
    let info
    try { info = await stat(target) } catch { return json(response, 404, { error: '封面文件不存在' }) }
    // 封面按书 id 寻址且内容基本不变：ETag + 长缓存，重复访问秒开
    const etag = `"${coverBook.id}-${info.size}-${Math.round(info.mtimeMs)}"`
    if (request.headers['if-none-match'] === etag) { response.writeHead(304, { etag, 'cache-control': 'private, max-age=604800' }); response.end(); return }
    response.writeHead(200, { 'content-type': coverBook.coverMime || 'image/jpeg', 'content-length': info.size, etag, 'cache-control': 'private, max-age=604800' })
    const file = await open(target, 'r')
    file.createReadStream().pipe(response)
    return
  }

  if (request.method === 'PUT' && coverMatch) {
    if (!coverBook) return json(response, 404, { error: '书籍不存在' })
    if (coverBook.uploaderId !== user.id) return json(response, 403, { error: '只能更新自己上传的书籍' })
    const mime = String(request.headers['content-type'] || '').split(';')[0].trim().toLowerCase()
    const extension = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[mime]
    if (!extension) return json(response, 400, { error: '封面仅支持 JPEG、PNG 或 WebP' })
    const fileName = `${coverBook.id}${extension}`
    const target = path.join(COVER_DIR, fileName)
    const temporary = `${target}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    let size = 0
    try {
      for await (const chunk of request) {
        size += chunk.length
        if (size > 3 * 1024 * 1024) throw Object.assign(new Error('封面不能超过 3 MB'), { status: 413 })
        await file.write(chunk)
      }
      await file.close()
      if (!size) throw Object.assign(new Error('封面为空'), { status: 400 })
      if (coverBook.coverFileName && coverBook.coverFileName !== fileName) await rm(path.join(COVER_DIR, coverBook.coverFileName), { force: true })
      await rename(temporary, target)
      coverBook.coverFileName = fileName
      coverBook.coverMime = mime
      await saveUsers(database)
      return json(response, 200, { ok: true })
    } catch (error) {
      await file.close().catch(() => {})
      await rm(temporary, { force: true })
      throw error
    }
  }

  if (request.method === 'GET' && bookMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    const files = normalizeBookFiles(book)
    if (!files.length) return json(response, 404, { error: '书籍没有文件' })
    const first = files[0]
    const target = path.join(DATA_DIR, 'bookstore', first.fileName)
    let info
    try { info = await stat(target) } catch { return json(response, 404, { error: '书籍文件不存在' }) }
    if (book.uploaderId !== user.id) { pushNotification(database, book.uploaderId, { type: 'download', bookId: book.id, bookTitle: book.title, actor: user.nickname || user.username }, 24 * 3600_000); await saveUsers(database) }
    response.writeHead(200, { 'content-type': first.format === 'EPUB' ? 'application/epub+zip' : 'text/plain; charset=utf-8', 'content-length': info.size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}${first.extension}`)}`, 'cache-control': 'private, no-store' })
    const file = await open(target, 'r')
    file.createReadStream().pipe(response)
    return
  }

  if (request.method === 'GET' && fileMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    const f = normalizeBookFiles(book).find((entry) => entry.id === fileMatch[2])
    if (!f) return json(response, 404, { error: '文件不存在' })
    const target = path.join(DATA_DIR, 'bookstore', f.fileName)
    let info
    try { info = await stat(target) } catch { return json(response, 404, { error: '文件不存在' }) }
    if (book.uploaderId !== user.id) { pushNotification(database, book.uploaderId, { type: 'download', bookId: book.id, bookTitle: book.title, actor: user.nickname || user.username }, 24 * 3600_000); await saveUsers(database) }
    const filename = `${book.title}${f.group ? ` - ${f.group}` : ''}${f.label ? ` - ${f.label}` : ''}${f.extension}`
    response.writeHead(200, { 'content-type': f.format === 'EPUB' ? 'application/epub+zip' : 'text/plain; charset=utf-8', 'content-length': info.size, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`, 'cache-control': 'private, no-store' })
    const file = await open(target, 'r')
    file.createReadStream().pipe(response)
    return
  }

  if (request.method === 'GET' && downloadAllMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    const files = normalizeBookFiles(book)
    if (!files.length) return json(response, 404, { error: '书籍没有文件' })
    const entries = []
    for (const f of files) {
      const target = path.join(DATA_DIR, 'bookstore', f.fileName)
      try { if (!(await stat(target)).isFile()) continue } catch { continue }
      const zipName = (f.group ? `${f.group}/` : '') + (f.label || `卷${files.indexOf(f) + 1}`) + f.extension
      entries.push({ name: zipName, path: target })
    }
    if (!entries.length) return json(response, 404, { error: '没有可下载的文件' })
    const zipBuffer = await makeZip(entries)
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': zipBuffer.length, 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}.zip`)}`, 'cache-control': 'private, no-store' })
    response.end(zipBuffer)
    return
  }

  if (request.method === 'PATCH' && bookMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    if (book.uploaderId !== user.id) return json(response, 403, { error: '只能整理自己上传的书籍' })
    const body = await readJson(request)
    const category = String(body.category || '').trim().slice(0, 40)
    const title = String(body.title || '').trim().slice(0, 160)
    const author = String(body.author || '').trim().slice(0, 100)
    if (body.category !== undefined) {
      if (!category) return json(response, 400, { error: '分类不能为空' })
      book.category = category
    }
    if (body.title !== undefined) {
      if (!title) return json(response, 400, { error: '书名不能为空' })
      book.title = title
    }
    if (body.author !== undefined) book.author = author
    if (body.status === 'ongoing' || body.status === 'completed') book.status = body.status
    if (Array.isArray(body.files)) {
      const existing = normalizeBookFiles(book)
      const requestedIds = body.files.map((item) => String(item.id || '').trim())
      if (requestedIds.length !== existing.length || new Set(requestedIds).size !== existing.length || existing.some((file) => !requestedIds.includes(file.id))) {
        return json(response, 400, { error: '整理分卷时必须保留全部文件；删除分卷请使用删除按钮' })
      }
      const updated = []
      for (const item of body.files) {
        const id = String(item.id || '').trim()
        const existingFile = existing.find((f) => f.id === id)
        if (!existingFile) continue
        updated.push({
          ...existingFile,
          group: String((item.group !== undefined && item.group !== null) ? item.group : existingFile.group).trim().slice(0, 80),
          label: String((item.label !== undefined && item.label !== null) ? item.label : existingFile.label).trim().slice(0, 80),
        })
      }
      book.files = updated
      syncLegacyBookFields(book)
    }
    await saveUsers(database)
    return json(response, 200, { book: publicBook(book, user.id) })
  }

  if (request.method === 'POST' && filesMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    if (book.uploaderId !== user.id) return json(response, 403, { error: '只能为自己上传的书籍追加文件' })
    const contentType = String(request.headers['content-type'] || '')
    const isMultipart = contentType.includes('multipart/form-data')
    let metadata
    let uploadedFiles = []
    if (isMultipart) {
      const parsed = await parseMultipart(request)
      if (!parsed.metadata) return json(response, 400, { error: '书籍信息无效' })
      metadata = parsed.metadata
      uploadedFiles = parsed.files
    } else {
      metadata = parseBookMetadata(request)
    }
    if (!metadata.files.length) return json(response, 400, { error: '没有要追加的文件' })
    let newFiles = []
    try {
      newFiles = isMultipart
        ? await saveMultipartFiles(uploadedFiles, metadata)
        : await uploadSingleBookFile(request, metadata)
    } catch (error) {
      if (error.status) return json(response, error.status, { error: error.message })
      throw error
    }
    if (findDuplicateUpload(newFiles, database.books)) {
      await removeStoredUploads(newFiles)
      return json(response, 409, { error: '有文件重复，或已经由其他书籍上传过' })
    }
    book.files = normalizeBookFiles(book).concat(newFiles)
    syncLegacyBookFields(book)
    // 若追加的首个文件是 EPUB 且尚无封面，尝试提取封面
    if (!book.coverFileName && newFiles[0]) await extractAndSaveCover(book, path.join(DATA_DIR, 'bookstore', newFiles[0].fileName), book.id)
    await saveUsers(database)
    // 通知关注用户（下载过、评价过）
    const followers = new Set((book.reviews || []).map((r) => r.userId).filter((id) => id !== user.id))
    for (const followerId of followers) {
      pushNotification(database, followerId, { type: 'update', bookId: book.id, bookTitle: book.title, actor: user.nickname || user.username, message: '书籍更新了新的分卷' })
    }
    if (followers.size) await saveUsers(database)
    return json(response, 200, { book: publicBook(book, user.id) })
  }

  if (request.method === 'DELETE' && fileMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    if (book.uploaderId !== user.id) return json(response, 403, { error: '只能删除自己上传的书籍文件' })
    const files = normalizeBookFiles(book)
    if (files.length <= 1) return json(response, 400, { error: '至少保留一个文件' })
    const idx = files.findIndex((f) => f.id === fileMatch[2])
    if (idx === -1) return json(response, 404, { error: '文件不存在' })
    const [removed] = files.splice(idx, 1)
    book.files = files
    syncLegacyBookFields(book)
    await rm(path.join(DATA_DIR, 'bookstore', removed.fileName), { force: true })
    await saveUsers(database)
    return json(response, 200, { book: publicBook(book, user.id) })
  }

  if (request.method === 'DELETE' && bookMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    if (book.uploaderId !== user.id) return json(response, 403, { error: '只能删除自己上传的书籍' })
    database.books = database.books.filter((entry) => entry.id !== book.id)
    await removeBookFiles(book)
    await saveUsers(database)
    return json(response, 200, { ok: true })
  }

  if (request.method === 'PUT' && reviewMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    if (rateLimited(request, 60)) return json(response, 429, { error: '操作过于频繁，请稍后再试' })
    const body = await readJson(request)
    const rating = Number(body.rating)
    const comment = String(body.comment || '').trim().slice(0, 1200)
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return json(response, 400, { error: '评分必须是 1–5 分' })
    book.reviews = (book.reviews || []).filter((review) => review.userId !== user.id)
    book.reviews.push({ id: randomUUID(), userId: user.id, username: user.username, nickname: user.nickname || user.username, avatar: user.avatar || '', rating, comment, createdAt: new Date().toISOString() })
    if (book.uploaderId !== user.id) pushNotification(database, book.uploaderId, { type: 'review', bookId: book.id, bookTitle: book.title, actor: user.nickname || user.username, rating })
    await saveUsers(database)
    return json(response, 200, { book: publicBook(book, user.id) })
  }

  if (request.method === 'DELETE' && reviewMatch) {
    if (!book) return json(response, 404, { error: '书籍不存在' })
    book.reviews = (book.reviews || []).filter((review) => review.userId !== user.id)
    await saveUsers(database)
    return json(response, 200, { book: publicBook(book, user.id) })
  }

  if (request.method === 'POST' && url.pathname === '/v1/auth/logout') {
    const supplied = String(request.headers.authorization || '').replace(/^Bearer\s+/i, '')
    user.sessions = (user.sessions || []).filter((session) => session.tokenHash !== tokenHash(supplied))
    await saveUsers(database)
    return json(response, 200, { ok: true })
  }

  if (request.method === 'POST' && url.pathname === '/v1/account/password') {
    const body = await readJson(request)
    if (!await passwordMatches(body.currentPassword, user)) return json(response, 403, { error: '当前密码不正确' })
    if (!validPassword(body.newPassword)) return json(response, 400, { error: '新密码长度需为 10–128 位' })
    const password = await passwordHash(body.newPassword)
    user.passwordSalt = password.salt
    user.passwordHash = password.hash
    user.sessions = []
    const token = createSession(user)
    await saveUsers(database)
    return json(response, 200, { token, user: publicUser(user) })
  }

  if (request.method === 'PUT' && url.pathname === '/v1/snapshot') {
    const declared = Number(request.headers['content-length'] || 0)
    if (declared > MAX_SNAPSHOT_BYTES) return json(response, 413, { error: '同步数据超过服务器限制' })
    const target = path.join(SNAPSHOT_DIR, `${user.id}.zip`)
    const temporary = `${target}.${randomUUID()}.tmp`
    const file = await open(temporary, 'wx', 0o600)
    let size = 0
    const hash = createHash('sha256')
    try {
      for await (const chunk of request) {
        size += chunk.length
        if (size > MAX_SNAPSHOT_BYTES) throw Object.assign(new Error('同步数据超过服务器限制'), { status: 413 })
        hash.update(chunk)
        await file.write(chunk)
      }
      await file.close()
      await rename(temporary, target)
    } catch (error) {
      await file.close().catch(() => {})
      await rm(temporary, { force: true })
      throw error
    }
    user.snapshot = { size, sha256: hash.digest('hex'), updatedAt: new Date().toISOString() }
    await saveUsers(database)
    return json(response, 200, { snapshot: user.snapshot })
  }

  if (request.method === 'GET' && url.pathname === '/v1/snapshot') {
    const target = path.join(SNAPSHOT_DIR, `${user.id}.zip`)
    let info
    try { info = await stat(target) } catch { return json(response, 404, { error: '还没有云端数据' }) }
    response.writeHead(200, { 'content-type': 'application/zip', 'content-length': info.size, 'content-disposition': 'attachment; filename="moyu-reader-data.zip"', 'cache-control': 'no-store' })
    const file = await open(target, 'r')
    file.createReadStream().pipe(response)
    return
  }

  return json(response, 404, { error: '接口不存在' })
}

const server = http.createServer((request, response) => {
  handle(request, response).catch((error) => {
    console.error(new Date().toISOString(), error)
    if (!response.headersSent) json(response, error.status || 500, { error: error.status ? error.message : '服务器内部错误' })
    else response.destroy()
  })
})

server.requestTimeout = 30 * 60_000
server.headersTimeout = 30_000
const startupDatabase = await loadUsers()
await migrateBooks(startupDatabase)
for (const startupUser of startupDatabase.users) {
  startupUser.library ||= []
  const base = { dataDir: DATA_DIR, libraryDir: LIBRARY_DIR, coverDir: COVER_DIR, saveUsers: () => saveUsers(startupDatabase) }
  listNovelJobs(startupUser, { ...base, novelDir: NOVEL_DIR })
  listEpubMakerJobs(startupUser, { ...base, epubMakerDir: EPUB_MAKER_DIR })
}
server.listen(PORT, '0.0.0.0', () => console.log(`moyu-reader-cloud listening on ${PORT}`))
