// cn-epub-maker 代理：上传 TXT 制作 EPUB，支持队列与三去向（直接下载 / 个人书架 / 共享书城）。
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import Busboy from 'busboy'
import { extractEpubCover } from './epubCover.mjs'

const MAKER = (process.env.EPUB_MAKER_URL || 'http://epub-maker:8080').replace(/\/$/, '')
const MAX_TXT_BYTES = 500 * 1024 * 1024
const MAX_COVER_BYTES = 3 * 1024 * 1024
let workerChain = Promise.resolve()

const sha256Of = (buffer) => createHash('sha256').update(buffer).digest('hex')
const publicJob = (job) => ({ id: job.id, title: job.title, author: job.author, status: job.status, phase: job.phase || '', progress: Number(job.progress) || 0, estimatedAt: job.estimatedAt || null, fileName: job.fileName || null, error: job.error || null, createdAt: job.createdAt, updatedAt: job.updatedAt || job.createdAt, options: job.options, addedToLibraryAt: job.addedToLibraryAt || null })

async function patchJob(job, patch, ctx) {
  Object.assign(job, patch, { updatedAt: new Date().toISOString() })
  await ctx.saveUsers()
}

async function makerFetch(path, options = {}) {
  const response = await fetch(MAKER + path, { ...options, signal: AbortSignal.timeout(options.timeout || 10 * 60_000) })
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw Object.assign(new Error(body.error || `EPUB 服务返回 ${response.status}`), { status: 502 })
  }
  return response
}

async function runJob(job, ctx) {
  await patchJob(job, { status: 'running', phase: '正在读取文本', progress: 10, error: null, estimatedAt: new Date(Date.now() + 4 * 60_000).toISOString() }, ctx)
  const txtBuffer = await readFile(path.join(ctx.epubMakerDir, path.basename(job.inputFileName)))
  const form = new FormData()
  form.append('title', job.title)
  form.append('author', job.author)
  form.append('txt', new Blob([txtBuffer], { type: 'text/plain' }), 'input.txt')
  if (job.coverFileName) {
    const coverBuffer = await readFile(path.join(ctx.epubMakerDir, path.basename(job.coverFileName)))
    const ext = job.coverExt || '.jpg'
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
    form.append('cover', new Blob([coverBuffer], { type: mime }), 'cover' + ext)
  }
  if (job.options?.horizontal) form.append('horizontal', 'true')
  if (job.options?.noConvert) form.append('no_convert', 'true')
  if (job.options?.noRenumber) form.append('no_renumber', 'true')
  if (job.options?.keepArabic) form.append('keep_arabic', 'true')
  if (job.options?.keepQuotes) form.append('keep_quotes', 'true')

  await patchJob(job, { phase: '正在排版与生成 EPUB', progress: 28, estimatedAt: new Date(Date.now() + 3 * 60_000).toISOString() }, ctx)
  const response = await makerFetch('/convert', { method: 'POST', body: form, timeout: 10 * 60_000 })
  await patchJob(job, { phase: '正在保存成品', progress: 92, estimatedAt: new Date(Date.now() + 30_000).toISOString() }, ctx)
  const data = Buffer.from(await response.arrayBuffer())
  if (!data.length) throw new Error('EPUB 服务返回空文件')
  const target = path.join(ctx.epubMakerDir, `${job.id}.epub`)
  await mkdir(ctx.epubMakerDir, { recursive: true })
  await writeFile(target, data, { mode: 0o600 })
  await patchJob(job, { fileName: path.basename(target), status: 'done', phase: '制作完成', progress: 100, estimatedAt: new Date().toISOString() }, ctx)
  await Promise.all([job.inputFileName, job.coverFileName].filter(Boolean).map((name) => rm(path.join(ctx.epubMakerDir, path.basename(name)), { force: true })))
}

function enqueue(job, ctx) {
  if (job._enqueued) return
  Object.defineProperty(job, '_enqueued', { value: true, writable: true, enumerable: false })
  workerChain = workerChain.catch(() => {}).then(() => runJob(job, ctx)).catch(async (error) => {
    await patchJob(job, { status: 'error', phase: '制作失败', error: error.message || '制作失败', estimatedAt: null }, ctx).catch(() => {})
  }).finally(() => { job._enqueued = false })
}

export async function createJobs(user, items, ctx) {
  user.epubMakerJobs ||= []
  const created = []
  for (const item of items.slice(0, 10)) {
    const title = String(item.title || '').trim().slice(0, 160)
    const author = String(item.author || '').trim().slice(0, 100)
    if (!title || !item.txtBuffer || !item.txtBuffer.length) continue
    if (item.txtBuffer.length > MAX_TXT_BYTES) continue
    const job = {
      id: randomUUID(),
      title, author,
      coverExt: item.coverExt,
      options: item.options || {},
      status: 'queued', phase: '等待制作', progress: 0,
      estimatedAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    await mkdir(ctx.epubMakerDir, { recursive: true })
    job.inputFileName = `${job.id}.input.txt`
    await writeFile(path.join(ctx.epubMakerDir, job.inputFileName), item.txtBuffer, { mode: 0o600 })
    if (item.coverBuffer?.length) {
      job.coverFileName = `${job.id}.cover${item.coverExt || '.jpg'}`
      await writeFile(path.join(ctx.epubMakerDir, job.coverFileName), item.coverBuffer, { mode: 0o600 })
    }
    user.epubMakerJobs.push(job)
    created.push(job)
    enqueue(job, ctx)
  }
  await ctx.saveUsers()
  return created.map(publicJob)
}

export function listJobs(user, ctx) {
  user.epubMakerJobs ||= []
  for (const job of user.epubMakerJobs) if ((job.status === 'queued' || job.status === 'running') && !job._enqueued) {
    if (job.status === 'running') { job.status = 'queued'; job.phase = '恢复制作'; job.progress = Math.min(Number(job.progress) || 0, 20) }
    enqueue(job, ctx)
  }
  return [...user.epubMakerJobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicJob)
}

export function getJob(user, id) {
  return (user.epubMakerJobs || []).find((job) => job.id === String(id || '')) || null
}

export async function retryJob(user, id, ctx) {
  const job = getJob(user, id)
  if (!job) throw Object.assign(new Error('任务不存在'), { status: 404 })
  if (job.status !== 'error') throw Object.assign(new Error('只有失败任务可以重试'), { status: 409 })
  try { await stat(path.join(ctx.epubMakerDir, path.basename(job.inputFileName))) } catch { throw Object.assign(new Error('原始 TXT 已不存在，请重新提交制作'), { status: 410 }) }
  await patchJob(job, { status: 'queued', phase: '等待重试', progress: 0, error: null, estimatedAt: new Date(Date.now() + 5 * 60_000).toISOString() }, ctx)
  enqueue(job, ctx)
  return publicJob(job)
}

// 解析 multipart/form-data 上传：多个 "txt_*" 文件 + 可选 "cover_*" 封面 + "meta" JSON
export function parseEpubMakerUpload(request, uploadDir) {
  return new Promise((resolve, reject) => {
    const meta = {}
    const txts = new Map() // fieldName -> { buffer, filename, size }
    const covers = new Map()
    let busboyError = null
    let parsedMeta = false

    const busboy = Busboy({
      headers: request.headers,
      limits: { fileSize: MAX_TXT_BYTES, files: 20, fields: 20 },
      defParamCharset: 'utf8',
    })

    busboy.on('field', (name, value) => {
      if (name === 'meta') {
        try { meta.raw = JSON.parse(value) } catch { busboyError = Object.assign(new Error('元数据 JSON 格式无效'), { status: 400 }) }
        parsedMeta = true
      }
    })

    busboy.on('file', (name, file, info) => {
      const chunks = []
      let size = 0
      const isTxt = /^txt_/.test(name)
      const isCover = /^cover_/.test(name)
      if (!isTxt && !isCover) {
        file.resume()
        return
      }
      file.on('data', (chunk) => {
        size += chunk.length
        if (isCover && size > MAX_COVER_BYTES) {
          busboyError = Object.assign(new Error('封面不能超过 3 MB'), { status: 413 })
          file.resume()
          return
        }
        if (isTxt && size > MAX_TXT_BYTES) {
          busboyError = Object.assign(new Error('TXT 文件不能超过 500 MB'), { status: 413 })
          file.resume()
          return
        }
        chunks.push(chunk)
      })
      file.on('limit', () => { busboyError = Object.assign(new Error('文件超过大小限制'), { status: 413 }) })
      file.on('end', () => {
        const buffer = Buffer.concat(chunks)
        if (isTxt) txts.set(name, { buffer, filename: info.filename || '', size })
        if (isCover) covers.set(name, { buffer, filename: info.filename || '', ext: path.extname(info.filename || '').toLowerCase(), size })
      })
    })

    busboy.on('error', (err) => reject(err))
    busboy.on('finish', () => {
      if (busboyError) return reject(busboyError)
      if (!parsedMeta || !meta.raw || !Array.isArray(meta.raw)) return reject(Object.assign(new Error('缺少书籍元数据'), { status: 400 }))
      const items = []
      for (const entry of meta.raw) {
        const txtKey = 'txt_' + entry.id
        const coverKey = 'cover_' + entry.id
        const txt = txts.get(txtKey)
        if (!txt) continue
        const title = String(entry.title || '').trim().slice(0, 160)
        if (!title) continue
        const cover = covers.get(coverKey)
        items.push({
          title,
          author: String(entry.author || '').trim().slice(0, 100),
          txtBuffer: txt.buffer,
          coverBuffer: cover?.buffer,
          coverExt: cover?.ext,
          options: entry.options && typeof entry.options === 'object' ? entry.options : {},
        })
      }
      if (!items.length) return reject(Object.assign(new Error('没有可制作的 TXT 文件'), { status: 400 }))
      resolve(items)
    })

    request.pipe(busboy)
  })
}

export async function jobToLibrary(user, job, meta, ctx) {
  const data = await readFile(path.join(ctx.epubMakerDir, job.fileName))
  const extension = '.epub'
  const sha256 = sha256Of(data)
  const clientBookId = `epub-${sha256.slice(0, 16)}`
  const finalName = `${sha256}${extension}`
  const finalPath = path.join(ctx.libraryDir, finalName)
  await mkdir(ctx.libraryDir, { recursive: true })
  try { await stat(finalPath) } catch { await writeFile(finalPath, data, { mode: 0o600 }) }
  const existing = user.library.find((entry) => entry.clientBookId === clientBookId)
  const item = { id: existing?.id || randomUUID(), clientBookId, title: meta.title, author: meta.author, extension, format: 'EPUB', size: data.length, sha256, fileName: finalName, uploadedAt: new Date().toISOString() }
  user.library = [...user.library.filter((entry) => entry.clientBookId !== clientBookId), item]
  job.addedToLibraryAt = new Date().toISOString()
  await ctx.saveUsers()
  return { book: item, deduplicated: Boolean(existing) }
}

export async function jobToStore(user, job, meta, ctx, database) {
  const data = await readFile(path.join(ctx.epubMakerDir, job.fileName))
  const extension = '.epub'
  const sha256 = sha256Of(data)
  const duplicate = database.books.find((book) => book.sha256 === sha256 || (book.files || []).some((file) => file.sha256 === sha256))
  if (duplicate) throw Object.assign(new Error(`这本书已经由 ${duplicate.uploader} 上传`), { status: 409 })
  const id = randomUUID()
  const target = path.join(ctx.dataDir, 'bookstore', `${id}${extension}`)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, data, { mode: 0o600 })
  const storedFile = { id: randomUUID(), fileName: path.basename(target), group: '', label: '', size: data.length, sha256, format: 'EPUB', extension }
  const book = { id, title: meta.title, author: meta.author, category: meta.category, extension, format: 'EPUB', size: data.length, sha256, fileName: storedFile.fileName, files: [storedFile], status: 'completed', uploaderId: user.id, uploader: user.username, uploaderDisplay: user.nickname || user.username, uploaderAvatar: user.avatar || '', uploadedAt: new Date().toISOString(), reviews: [] }
  const cover = extractEpubCover(data)
  if (cover) {
    const ext = cover.mime === 'image/png' ? '.png' : cover.mime === 'image/webp' ? '.webp' : '.jpg'
    await mkdir(ctx.coverDir, { recursive: true })
    await writeFile(path.join(ctx.coverDir, `${id}${ext}`), cover.data, { mode: 0o600 })
    book.coverFileName = `${id}${ext}`
    book.coverMime = cover.mime
  }
  database.books.push(book)
  await ctx.saveUsers()
  return { book }
}

export async function openJobFile(job, ctx) {
  const target = path.join(ctx.epubMakerDir, path.basename(job.fileName))
  const info = await stat(target)
  const file = await open(target, 'r')
  return { stream: file.createReadStream(), size: info.size, extension: '.epub' }
}
