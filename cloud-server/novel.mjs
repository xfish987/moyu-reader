// so-novel 引擎代理：搜索、下载任务队列、三去向（直接下载 / 个人书架 / 共享书城）。
// 引擎以独立容器运行在内网（默认 http://so-novel:7765），不直接暴露公网。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { extractEpubCover } from './epubCover.mjs'

const ENGINE = (process.env.NOVEL_ENGINE_URL || 'http://so-novel:7765').replace(/\/$/, '')
let workerChain = Promise.resolve()

const sha256Of = (buffer) => createHash('sha256').update(buffer).digest('hex')
const publicJob = (job) => ({ id: job.id, url: job.url, title: job.title, author: job.author, status: job.status, phase: job.phase || '', progress: Number(job.progress) || 0, estimatedAt: job.estimatedAt || null, fileName: job.fileName || null, error: job.error || null, createdAt: job.createdAt, updatedAt: job.updatedAt || job.createdAt, addedToLibraryAt: job.addedToLibraryAt || null })

async function patchJob(job, patch, ctx) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
  await ctx.saveUsers()
}

async function engineFetch(path, options = {}) {
  const url = `${ENGINE}${path}`
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(options.timeout || 90_000) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || `引擎返回 ${response.status}`), { status: 502 })
  }
  return response
}

export async function searchNovel(keyword) {
  let response
  try {
    response = await engineFetch('/search/aggregated?kw=' + encodeURIComponent(keyword))
  } catch (error) {
    if (error.status) throw error
    throw Object.assign(new Error('搜书引擎暂时不可用，请稍后再试'), { status: 502 })
  }
  const payload = await response.json().catch(() => ({}))
  const results = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : []
  return results.map((item) => ({
    url: item.url, title: item.bookName || '', author: item.author || '', source: item.sourceName || '',
    category: item.category || '', latestChapter: item.latestChapter || '', status: item.status || '',
    wordCount: item.wordCount || '', updated: item.lastUpdateTime || '',
  })).filter((item) => item.url && item.title)
}

async function findEngineFile(titleHint, beforeFiles) {
  // 优先用本地书列表找到 /book-fetch 新增的文件
  const payload = await engineFetch('/local-books').then((r) => r.json()).catch(() => ({}))
  const list = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : []
  const candidates = list.filter((f) => !beforeFiles.has(f.name)).sort((a, b) => b.timestamp - a.timestamp)
  if (!candidates.length) return null
  // 如果书名提示存在，优先匹配文件名包含书名的最新文件
  const hint = String(titleHint || '').trim()
  if (hint) {
    const matched = candidates.find((f) => f.name.toLowerCase().includes(hint.toLowerCase()))
    if (matched) return matched.name
  }
  return candidates[0].name
}

async function runJob(job, ctx) {
  await patchJob(job, { status: 'running', phase: '正在连接书源', progress: 8, error: null, estimatedAt: new Date(Date.now() + 8 * 60_000).toISOString() }, ctx)
  const beforePayload = await engineFetch('/local-books').then((r) => r.json()).catch(() => ({}))
  const beforeList = Array.isArray(beforePayload) ? beforePayload : Array.isArray(beforePayload.data) ? beforePayload.data : []
  const beforeFiles = new Set(beforeList.map((f) => f.name))
  // 1. 触发下载到引擎服务器
  await patchJob(job, { phase: '正在抓取章节并制作', progress: 22, estimatedAt: new Date(Date.now() + 7 * 60_000).toISOString() }, ctx)
  await engineFetch('/book-fetch?url=' + encodeURIComponent(job.url) + '&format=epub', { timeout: 30 * 60_000 })
  // 2. 从引擎服务器取回文件
  const fileName = await findEngineFile(job.title, beforeFiles)
  if (!fileName) throw new Error('引擎未产出文件')
  await patchJob(job, { phase: '正在取回成品', progress: 88, estimatedAt: new Date(Date.now() + 60_000).toISOString() }, ctx)
  const response = await engineFetch('/book-download?filename=' + encodeURIComponent(fileName), { timeout: 5 * 60_000 })
  const data = Buffer.from(await response.arrayBuffer())
  if (!data.length) throw new Error('引擎返回空文件')
  const ext = path.extname(fileName).toLowerCase() || '.epub'
  const target = path.join(ctx.novelDir, `${job.id}${ext}`)
  await mkdir(ctx.novelDir, { recursive: true })
  await writeFile(target, data, { mode: 0o600 })
  await patchJob(job, { fileName: path.basename(target), status: 'done', phase: '制作完成', progress: 100, estimatedAt: new Date().toISOString() }, ctx)
}

function enqueue(job, ctx) {
  if (job._enqueued) return
  Object.defineProperty(job, '_enqueued', { value: true, writable: true, enumerable: false })
  workerChain = workerChain.catch(() => {}).then(() => runJob(job, ctx)).catch(async (error) => {
    await patchJob(job, { status: 'error', phase: '制作失败', error: error.message || '下载失败', estimatedAt: null }, ctx).catch(() => {})
  }).finally(() => { job._enqueued = false })
}

export async function createJobs(user, items, ctx) {
  user.novelJobs ||= []
  const created = []
  for (const item of items.slice(0, 10)) {
    const job = { id: randomUUID(), url: String(item.url || '').slice(0, 500), title: String(item.title || '').slice(0, 160), author: String(item.author || '').slice(0, 100), status: 'queued', phase: '等待制作', progress: 0, estimatedAt: new Date(Date.now() + 10 * 60_000).toISOString(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    if (!job.url || !/^https?:\/\//.test(job.url)) continue
    user.novelJobs.push(job)
    created.push(job)
    enqueue(job, ctx)
  }
  await ctx.saveUsers()
  return created.map(publicJob)
}

export function listJobs(user, ctx) {
  user.novelJobs ||= []
  for (const job of user.novelJobs) if ((job.status === 'queued' || job.status === 'running') && !job._enqueued) {
    if (job.status === 'running') { job.status = 'queued'; job.phase = '恢复制作'; job.progress = Math.min(Number(job.progress) || 0, 20) }
    enqueue(job, ctx)
  }
  return [...user.novelJobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicJob)
}

export function getJob(user, id) {
  return (user.novelJobs || []).find((job) => job.id === String(id || '')) || null
}

export async function retryJob(user, id, ctx) {
  const job = getJob(user, id)
  if (!job) throw Object.assign(new Error('任务不存在'), { status: 404 })
  if (job.status !== 'error') throw Object.assign(new Error('只有失败任务可以重试'), { status: 409 })
  await patchJob(job, { status: 'queued', phase: '等待重试', progress: 0, error: null, estimatedAt: new Date(Date.now() + 10 * 60_000).toISOString() }, ctx)
  enqueue(job, ctx)
  return publicJob(job)
}

// 加入个人书架（与 /v1/library/books 同一存储格式，app 登录后同步可见）
export async function jobToLibrary(user, job, meta, ctx) {
  const data = await readFile(path.join(ctx.novelDir, job.fileName))
  const extension = path.extname(job.fileName).toLowerCase()
  if (!['.epub', '.txt'].includes(extension)) throw Object.assign(new Error('仅支持 EPUB 或 TXT'), { status: 400 })
  const sha256 = sha256Of(data)
  const clientBookId = `novel-${sha256.slice(0, 16)}`
  const finalName = `${sha256}${extension}`
  const finalPath = path.join(ctx.libraryDir, finalName)
  await mkdir(ctx.libraryDir, { recursive: true })
  try { await stat(finalPath) } catch { await writeFile(finalPath, data, { mode: 0o600 }) }
  const existing = user.library.find((entry) => entry.clientBookId === clientBookId)
  const item = { id: existing?.id || randomUUID(), clientBookId, title: meta.title, author: meta.author, extension, format: extension === '.epub' ? 'EPUB' : 'TXT', size: data.length, sha256, fileName: finalName, uploadedAt: new Date().toISOString() }
  user.library = [...user.library.filter((entry) => entry.clientBookId !== clientBookId), item]
  job.addedToLibraryAt = new Date().toISOString()
  await ctx.saveUsers()
  return { book: item, deduplicated: Boolean(existing) }
}

// 分享到共享书城（与 /v1/store/books 同一存储格式，自动提取 EPUB 封面）
export async function jobToStore(user, job, meta, ctx, database) {
  const data = await readFile(path.join(ctx.novelDir, job.fileName))
  const extension = path.extname(job.fileName).toLowerCase()
  if (!['.epub', '.txt'].includes(extension)) throw Object.assign(new Error('仅支持 EPUB 或 TXT'), { status: 400 })
  const sha256 = sha256Of(data)
  const duplicate = database.books.find((book) => book.sha256 === sha256 || (book.files || []).some((file) => file.sha256 === sha256))
  if (duplicate) throw Object.assign(new Error(`这本书已经由 ${duplicate.uploader} 上传`), { status: 409 })
  const id = randomUUID()
  const target = path.join(ctx.dataDir, 'bookstore', `${id}${extension}`)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, data, { mode: 0o600 })
  const storedFile = { id: randomUUID(), fileName: path.basename(target), group: '', label: '', size: data.length, sha256, format: extension === '.epub' ? 'EPUB' : 'TXT', extension }
  const book = { id, title: meta.title, author: meta.author, category: meta.category, extension, format: storedFile.format, size: data.length, sha256, fileName: storedFile.fileName, files: [storedFile], status: 'completed', uploaderId: user.id, uploader: user.username, uploaderDisplay: user.nickname || user.username, uploaderAvatar: user.avatar || '', uploadedAt: new Date().toISOString(), reviews: [] }
  if (extension === '.epub') {
    const cover = extractEpubCover(data)
    if (cover) {
      const ext = cover.mime === 'image/png' ? '.png' : cover.mime === 'image/webp' ? '.webp' : '.jpg'
      await mkdir(ctx.coverDir, { recursive: true })
      await writeFile(path.join(ctx.coverDir, `${id}${ext}`), cover.data, { mode: 0o600 })
      book.coverFileName = `${id}${ext}`
      book.coverMime = cover.mime
    }
  }
  database.books.push(book)
  await ctx.saveUsers()
  return { book }
}

export async function openJobFile(job, ctx) {
  const target = path.join(ctx.novelDir, path.basename(job.fileName))
  const info = await stat(target)
  const file = await open(target, 'r')
  return { stream: file.createReadStream(), size: info.size, extension: path.extname(target).toLowerCase() }
}
