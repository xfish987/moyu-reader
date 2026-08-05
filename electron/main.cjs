const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, net, safeStorage, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const fsSync = require('fs')
const { createHash, randomUUID } = require('crypto')
const chardet = require('chardet')
const iconv = require('iconv-lite')
const JSZip = require('jszip')
const { DOMParser } = require('@xmldom/xmldom')
const { collectModelCatalog } = require('./modelCatalog.cjs')
const { parseProfileJson } = require('./jsonRepair.cjs')
const { buildProfileMessages } = require('./profilePrompt.cjs')
const { buildDictionaryMessages, buildFollowupMessages } = require('./dictionaryPrompt.cjs')
const { selectSummaryExcerpts } = require('./excerptSelect.cjs')

let mainWindow
let profilesWindow = null
let profilesFabWindow = null
// 伴侣窗口吸附状态不再用事件时序闩锁，只记录“上一次吸附位置”：
// 当前位置仍等于它 → 吸附中；不等 → 用户已拖离。异步 move 事件不会误判。
let profilesLastDock = null
let companionFollowTimer = null
let companionFollowAgain = false
let bossHidden = false
let windowPinned = false
let pendingExternalFiles = []
let windowBoundsTimer = null
let closingWindow = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const largeTextCache = new Map()
const epubMetadataCache = new Map()

// ===== 持续运行日志：userData/logs/main.log，超过 512KB 轮替为 main.old.log =====
// 记录主进程异常、渲染进程崩溃、各窗口控制台错误与关键窗口事件，供故障排查。
// 纯原生崩溃瞬间无法记录，但崩溃前最后一个事件一定在日志里。
const LOG_DIR = () => path.join(app.getPath('userData'), 'logs')
const LOG_FILE = () => path.join(LOG_DIR(), 'main.log')
function logEvent(kind, detail) {
  try {
    fsSync.mkdirSync(LOG_DIR(), { recursive: true })
    const file = LOG_FILE()
    if (fsSync.existsSync(file) && fsSync.statSync(file).size > 512 * 1024) {
      try { fsSync.renameSync(file, path.join(LOG_DIR(), 'main.old.log')) } catch {}
    }
    const text = detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail)
    fsSync.appendFileSync(file, `${new Date().toISOString()} [${kind}] ${text}\n`)
  } catch {}
}
process.on('uncaughtException', (error) => logEvent('uncaughtException', error?.stack || String(error)))
process.on('unhandledRejection', (reason) => logEvent('unhandledRejection', reason?.stack || String(reason)))
app.on('render-process-gone', (_event, webContents, details) => logEvent('render-process-gone', { url: webContents?.getURL?.(), reason: details?.reason, exitCode: details?.exitCode }))
app.on('child-process-gone', (_event, details) => logEvent('child-process-gone', { type: details?.type, reason: details?.reason, exitCode: details?.exitCode }))
function watchWindow(win, tag) {
  if (!win || win.isDestroyed()) return
  win.webContents.on('console-message', (_event, level, message) => {
    if (level >= 2) logEvent(`console:${tag}`, String(message).slice(0, 500))
  })
  win.webContents.on('preload-error', (_event, preloadPath, error) => logEvent(`preload-error:${tag}`, String(error)))
}
const LARGE_TEXT_THRESHOLD = 500_000
const TEXT_CHUNK_SIZE = 32_000
const STORE_VERSION = 1
const STORE_FILE_NAME = 'reader-data.json'
const STORE_KEYS = new Set([
  'reader:directory',
  'reader:settings',
  'reader:progress',
  'reader:manual-books',
  'reader:hidden-books',
  'reader:tags',
  'reader:categories',
  'reader:notes',
  'reader:covers',
  'reader:pinned',
  'reader:shortcuts',
  'reader:last-book',
  'reader:book-status',
  'reader:bookmarks',
  'reader:book-metadata',
  'reader:window-bounds',
  'reader:entity-profiles',
  'reader:dictionary',
])
let storeCache = null
let storeWriteQueue = Promise.resolve()
let aiConfigCache = null
let aiConfigWriteQueue = Promise.resolve()
const AI_CONFIG_FILE_NAME = 'ai-settings.json'

const storeDirectory = () => path.join(app.getPath('userData'), 'data')
const storeFile = () => path.join(storeDirectory(), STORE_FILE_NAME)
const aiConfigFile = () => path.join(storeDirectory(), AI_CONFIG_FILE_NAME)
const backupDirectory = () => path.join(storeDirectory(), 'backups')
const epubCacheDirectory = () => path.join(app.getPath('userData'), 'cache', 'epub')

function defaultAiConfig() {
  return {
    version: 1,
    activeProviderId: '',
    providers: [],
  }
}

function sanitizeAiErrorText(value, secret = '') {
  let text = String(value || '').slice(0, 1200)
  if (secret) text = text.split(secret).join('[已隐藏]')
  return text
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[已隐藏]')
}

function validateProviderUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error('供应商 URL 格式无效') }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('供应商 URL 必须使用 HTTPS；仅本机地址允许 HTTP')
  if (url.username || url.password) throw new Error('供应商 URL 不能包含用户名或密码')
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/i, '').replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/$/, '')
}

function providerEndpoint(baseUrl, endpoint) {
  return `${baseUrl.replace(/\/+$/, '')}/${endpoint.replace(/^\/+/, '')}`
}

function publicAiConfig(config) {
  return {
    version: config.version || 1,
    activeProviderId: config.activeProviderId || '',
    providers: (config.providers || []).map(({ encryptedKey, ...provider }) => ({ ...provider, hasKey: Boolean(encryptedKey) })),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
  }
}

async function loadAiConfig() {
  if (aiConfigCache) return aiConfigCache
  try {
    const parsed = JSON.parse(await fs.readFile(aiConfigFile(), 'utf8'))
    aiConfigCache = { ...defaultAiConfig(), ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch {
    aiConfigCache = defaultAiConfig()
  }
  return aiConfigCache
}

async function writeAiConfig(snapshot) {
  await fs.mkdir(storeDirectory(), { recursive: true })
  const temporary = `${aiConfigFile()}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  try { await fs.rename(temporary, aiConfigFile()) }
  catch {
    await fs.copyFile(temporary, aiConfigFile())
    await fs.unlink(temporary).catch(() => {})
  }
}

function queueAiConfigWrite() {
  const snapshot = JSON.parse(JSON.stringify(aiConfigCache))
  aiConfigWriteQueue = aiConfigWriteQueue.catch(() => {}).then(() => writeAiConfig(snapshot))
  return aiConfigWriteQueue
}

function encryptApiKey(value) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('当前系统无法使用安全存储，未保存 API Key')
  const key = String(value || '').trim()
  if (!key || key.length > 4096) throw new Error('API Key 不能为空或过长')
  return safeStorage.encryptString(key).toString('base64')
}

function decryptApiKey(provider) {
  if (!provider?.encryptedKey) throw new Error('该供应商尚未保存 API Key')
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储当前不可用，无法读取 API Key')
  return safeStorage.decryptString(Buffer.from(provider.encryptedKey, 'base64'))
}

async function readResponseLimited(response, limit = 8 * 1024 * 1024) {
  if (!response.body?.getReader) return (await response.text()).slice(0, limit)
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      throw Object.assign(new Error('供应商响应过大，已停止读取'), { code: 'RESPONSE_TOO_LARGE' })
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => { merged.set(chunk, offset); offset += chunk.byteLength })
  return new TextDecoder().decode(merged)
}

function parseProviderError(response, body, stage, secret) {
  let parsed
  try { parsed = JSON.parse(body) } catch {}
  const remote = parsed?.error || parsed
  const message = sanitizeAiErrorText(remote?.message || body || response.statusText || '供应商请求失败', secret)
  return {
    stage,
    status: response.status,
    code: sanitizeAiErrorText(remote?.code || remote?.type || `HTTP_${response.status}`),
    type: sanitizeAiErrorText(remote?.type || ''),
    message,
  }
}

async function requestProvider(provider, endpoint, options, stage, signal) {
  const secret = decryptApiKey(provider)
  let response
  try {
    response = await net.fetch(providerEndpoint(provider.baseUrl, endpoint), {
      ...options,
      headers: { Accept: 'application/json', Authorization: `Bearer ${secret}`, ...(options.headers || {}) },
      redirect: 'manual',
      signal,
    })
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { aiError: { stage, status: 0, code: 'REQUEST_ABORTED', message: '请求已取消' } })
    throw Object.assign(new Error('无法连接 AI 供应商'), { aiError: { stage, status: 0, code: error?.code || 'NETWORK_ERROR', message: sanitizeAiErrorText(error?.message || '网络连接失败', secret) } })
  }
  const body = await readResponseLimited(response)
  if (response.status >= 300 && response.status < 400) {
    throw Object.assign(new Error('供应商返回了重定向'), { aiError: { stage, status: response.status, code: 'REDIRECT_BLOCKED', message: '为避免 API Key 泄漏，已拒绝供应商重定向' } })
  }
  if (!response.ok) throw Object.assign(new Error('供应商请求失败'), { aiError: parseProviderError(response, body, stage, secret) })
  try { return JSON.parse(body) } catch {
    throw Object.assign(new Error('供应商响应不是有效 JSON'), { aiError: { stage, status: response.status, code: 'INVALID_JSON', message: '供应商响应不是有效 JSON' } })
  }
}

async function requestProviderStreaming(provider, endpoint, options, stage, signal, onText, onStart) {
  const secret = decryptApiKey(provider)
  let response
  try {
    response = await net.fetch(providerEndpoint(provider.baseUrl, endpoint), {
      ...options,
      headers: { Accept: 'text/event-stream, application/json', Authorization: `Bearer ${secret}`, ...(options.headers || {}) },
      redirect: 'manual', signal,
    })
  } catch (error) {
    if (signal?.aborted) throw Object.assign(new Error('请求已取消'), { aiError: { stage, status: 0, code: 'REQUEST_ABORTED', message: '请求已取消' } })
    throw Object.assign(new Error('无法连接 AI 供应商'), { aiError: { stage, status: 0, code: error?.code || 'NETWORK_ERROR', message: sanitizeAiErrorText(error?.message || '网络连接失败', secret) } })
  }
  if (response.status >= 300 && response.status < 400) throw Object.assign(new Error('供应商返回了重定向'), { aiError: { stage, status: response.status, code: 'REDIRECT_BLOCKED', message: '为避免 API Key 泄漏，已拒绝供应商重定向' } })
  if (!response.ok) throw Object.assign(new Error('供应商请求失败'), { aiError: parseProviderError(response, await readResponseLimited(response), stage, secret) })
  const reader = response.body?.getReader?.()
  if (!reader) return JSON.parse(await readResponseLimited(response))
  const decoder = new TextDecoder()
  let buffer = ''
  let raw = ''
  let streamed = false
  let finishReason = null
  const emit = (text) => { if (text) { streamed = true; raw += text; onText?.(text) } }
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    onStart?.()
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const parsed = JSON.parse(payload)
        const choice = parsed?.choices?.[0]
        if (choice?.finish_reason) finishReason = choice.finish_reason
        const delta = choice?.delta?.content ?? choice?.message?.content ?? parsed?.text ?? ''
        emit(Array.isArray(delta) ? delta.map((part) => part?.text || '').join('') : String(delta || ''))
      } catch {}
    }
  }
  if (streamed) return { choices: [{ message: { content: raw }, finish_reason: finishReason }] }
  return JSON.parse(raw || buffer || '{}')
}

function responseText(message) {
  if (typeof message?.content === 'string') return message.content
  if (Array.isArray(message?.content)) return message.content.map((part) => typeof part === 'string' ? part : part?.text || '').join('')
  return ''
}


async function readEpubDiskCache(fingerprint) {
  try {
    const value = JSON.parse(await fs.readFile(path.join(epubCacheDirectory(), `${fingerprint}.json`), 'utf8'))
    return value && typeof value === 'object' ? value : null
  } catch { return null }
}

async function writeEpubDiskCache(fingerprint, metadata) {
  try {
    await fs.mkdir(epubCacheDirectory(), { recursive: true })
    await fs.writeFile(path.join(epubCacheDirectory(), `${fingerprint}.json`), JSON.stringify(metadata), 'utf8')
  } catch {}
}

function emptyStore() {
  return { version: STORE_VERSION, updatedAt: new Date().toISOString(), data: {} }
}

function validateStore(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('备份文件格式无效')
  const data = value.data && typeof value.data === 'object' && !Array.isArray(value.data) ? value.data : value
  const filtered = Object.fromEntries(Object.entries(data).filter(([key]) => STORE_KEYS.has(key)))
  if (!Object.keys(filtered).length && Object.keys(data).length) throw new Error('备份中没有可识别的阅读数据')
  return { version: STORE_VERSION, updatedAt: new Date().toISOString(), data: filtered }
}

async function readStoreFile(filePath) {
  return validateStore(JSON.parse(await fs.readFile(filePath, 'utf8')))
}

async function loadStore() {
  if (storeCache) return storeCache
  try {
    storeCache = await readStoreFile(storeFile())
    return storeCache
  } catch {}

  try {
    const backups = (await fs.readdir(backupDirectory()))
      .filter((name) => name.endsWith('.json'))
      .sort()
      .reverse()
    for (const name of backups) {
      try {
        storeCache = await readStoreFile(path.join(backupDirectory(), name))
        return storeCache
      } catch {}
    }
  } catch {}

  storeCache = emptyStore()
  return storeCache
}

async function createBackup(label = new Date().toISOString().slice(0, 10)) {
  const source = storeFile()
  const target = path.join(backupDirectory(), `reader-data-${label.replace(/[:.]/g, '-')}.json`)
  await fs.mkdir(backupDirectory(), { recursive: true })
  try {
    await fs.access(target)
    return target
  } catch {}
  try {
    await fs.copyFile(source, target)
    return target
  } catch {
    return null
  }
}

async function pruneBackups() {
  try {
    const backups = (await fs.readdir(backupDirectory()))
      .filter((name) => name.startsWith('reader-data-') && name.endsWith('.json'))
      .sort()
      .reverse()
    await Promise.all(backups.slice(10).map((name) => fs.unlink(path.join(backupDirectory(), name)).catch(() => {})))
  } catch {}
}

async function writeStore(snapshot) {
  await fs.mkdir(storeDirectory(), { recursive: true })
  await createBackup()
  const temporary = `${storeFile()}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
  try {
    await fs.rename(temporary, storeFile())
  } catch {
    await fs.copyFile(temporary, storeFile())
    await fs.unlink(temporary).catch(() => {})
  }
  await pruneBackups()
}

function queueStoreWrite() {
  storeCache.updatedAt = new Date().toISOString()
  const snapshot = JSON.parse(JSON.stringify(storeCache))
  storeWriteQueue = storeWriteQueue.catch(() => {}).then(() => writeStore(snapshot))
  return storeWriteQueue
}

const xmlElements = (document, localName) => Array.from(document.getElementsByTagName('*'))
  .filter((element) => element.localName === localName || element.nodeName.split(':').pop() === localName)

function normalizeZipPath(value) {
  return path.posix.normalize(String(value || '').replace(/\\/g, '/').replace(/^\/+/, ''))
}

function findZipEntry(zip, target) {
  const normalized = normalizeZipPath(target)
  const candidates = [normalized]
  try { candidates.push(normalizeZipPath(decodeURIComponent(normalized))) } catch {}
  for (const candidate of candidates) {
    const direct = zip.file(candidate)
    if (direct) return direct
  }
  const lower = candidates.map((candidate) => candidate.toLowerCase())
  return Object.values(zip.files).find((entry) => lower.includes(normalizeZipPath(entry.name).toLowerCase())) || null
}

async function readEpubMetadata(filePath, stats) {
  const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`
  if (epubMetadataCache.has(cacheKey)) return epubMetadataCache.get(cacheKey)
  const promise = (async () => {
    const zip = await JSZip.loadAsync(await fs.readFile(filePath))
    const containerEntry = findZipEntry(zip, 'META-INF/container.xml')
    if (!containerEntry) return {}
    const container = new DOMParser().parseFromString(await containerEntry.async('text'), 'application/xml')
    const rootfile = xmlElements(container, 'rootfile')[0]
    const opfPath = normalizeZipPath(rootfile?.getAttribute('full-path'))
    const opfEntry = findZipEntry(zip, opfPath)
    if (!opfEntry) return {}
    const opf = new DOMParser().parseFromString(await opfEntry.async('text'), 'application/xml')
    const metadata = xmlElements(opf, 'metadata')[0]
    const title = xmlElements(metadata || opf, 'title')[0]?.textContent?.replace(/\s+/g, ' ').trim()
    const author = xmlElements(metadata || opf, 'creator')[0]?.textContent?.replace(/\s+/g, ' ').trim()
    const items = xmlElements(opf, 'item')
    const coverMeta = xmlElements(opf, 'meta').find((element) => element.getAttribute('name')?.toLowerCase() === 'cover')
    const coverId = coverMeta?.getAttribute('content')
    const coverItem = items.find((element) => element.getAttribute('properties')?.split(/\s+/).includes('cover-image'))
      || items.find((element) => coverId && element.getAttribute('id') === coverId)
      || items.find((element) => /cover/i.test(`${element.getAttribute('id') || ''} ${element.getAttribute('href') || ''}`) && /^image\//i.test(element.getAttribute('media-type') || ''))
    let cover = null
    if (coverItem) {
      const coverPath = normalizeZipPath(path.posix.join(path.posix.dirname(opfPath), coverItem.getAttribute('href') || ''))
      const coverEntry = findZipEntry(zip, coverPath)
      if (coverEntry) {
        const bytes = await coverEntry.async('nodebuffer')
        if (bytes.length <= 4_000_000) {
          const mime = coverItem.getAttribute('media-type') || 'image/jpeg'
          cover = `data:${mime};base64,${bytes.toString('base64')}`
        }
      }
    }
    return { title, author, cover }
  })().catch(() => ({}))
  epubMetadataCache.set(cacheKey, promise)
  while (epubMetadataCache.size > 8) epubMetadataCache.delete(epubMetadataCache.keys().next().value)
  return promise
}

function detectEncoding(data) {
  const detected = chardet.detect(data.subarray(0, Math.min(data.length, 256_000))) || 'UTF-8'
  const aliases = { GB18030: 'gb18030', GB2312: 'gb18030', Big5: 'big5', UTF_16LE: 'utf16-le' }
  return { detected, encoding: aliases[detected] || detected.toLowerCase() }
}

function resolveEncoding(value) {
  const normalized = String(value || '').toUpperCase().replace(/[-_]/g, '')
  const encodings = {
    UTF8: { detected: 'UTF-8', encoding: 'utf8' },
    GB18030: { detected: 'GB18030', encoding: 'gb18030' },
    GBK: { detected: 'GB18030', encoding: 'gb18030' },
    BIG5: { detected: 'Big5', encoding: 'big5' },
    UTF16LE: { detected: 'UTF-16LE', encoding: 'utf16-le' },
    UTF16BE: { detected: 'UTF-16BE', encoding: 'utf16-be' },
  }
  return encodings[normalized]
}

function cacheLargeText(filePath, data, encoding, detected) {
  largeTextCache.delete(filePath)
  const cached = { data, encoding, detected, tocPromise: null }
  cached.tocPromise = buildTextToc(cached)
  largeTextCache.set(filePath, cached)
  while (largeTextCache.size > 3) largeTextCache.delete(largeTextCache.keys().next().value)
}

function isChapterTitle(value) {
  const line = value.replace(/[\u3000\t]+/g, ' ').trim()
  if (!line || line.length > 80) return false
  return /^(?:正文\s*)?第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节卷部篇回集幕]\s*.{0,50}$/i.test(line)
    || /^(?:卷|部|篇|章)\s*[0-9０-９零〇一二三四五六七八九十百千万两]+(?:[\s:：.-]+.{0,45})?$/i.test(line)
    || /^(?:序章|序言|前言|楔子|引子|后记|尾声|终章|大结局)(?:[\s:：.-]+.{0,45})?$/i.test(line)
    || /^(?:番外|外传|附录)\s*[0-9０-９零〇一二三四五六七八九十百千万两]*(?:[\s:：.-]+.{0,45})?$/i.test(line)
    || /^(?:chapter|part|volume|book)\s+[0-9ivxlcdm]+(?:[\s:：.-]+.{0,50})?$/i.test(line)
}

async function buildTextToc({ data, encoding }) {
  const toc = []
  let lineStart = 0
  let lastYield = 0
  for (let index = 0; index <= data.length;) {
    const breakLength = index < data.length ? newlineLengthAt(data, index, encoding) : 0
    if (index !== data.length && !breakLength) {
      index += 1
      continue
    }
    if (index - lineStart <= 420) {
      const line = iconv.decode(data.subarray(lineStart, index), encoding).replace(/[\r\u0000]+$/g, '').trim()
      if (isChapterTitle(line)) toc.push({ label: line, offset: lineStart })
    }
    lineStart = index + breakLength
    if (index - lastYield >= 2_000_000) {
      lastYield = index
      await new Promise((resolve) => setImmediate(resolve))
    }
    if (toc.length >= 10_000) break
    if (index === data.length) break
    index = lineStart
  }
  return toc
}

function newlineLengthAt(data, index, encoding) {
  const normalized = String(encoding || '').toLowerCase().replace(/_/g, '-')
  if (normalized === 'utf16-le' || normalized === 'utf-16le') {
    return data[index] === 0x0a && data[index + 1] === 0x00 ? 2 : 0
  }
  if (normalized === 'utf16-be' || normalized === 'utf-16be') {
    return data[index] === 0x00 && data[index + 1] === 0x0a ? 2 : 0
  }
  return data[index] === 0x0a ? 1 : 0
}

function paragraphBoundary(data, position, direction, encoding) {
  if (position <= 0) return 0
  if (position >= data.length) return data.length
  const radius = 2048
  const isUtf16 = encoding.startsWith('utf16') || encoding.startsWith('utf-16')
  if (direction === 'backward') {
    for (let index = position - 1; index >= Math.max(0, position - radius); index -= 1) {
      const breakLength = newlineLengthAt(data, index, encoding)
      if (breakLength) return Math.min(data.length, index + breakLength)
    }
    return isUtf16 ? position - (position % 2) : position
  }
  for (let index = position; index < Math.min(data.length, position + radius); index += 1) {
    const breakLength = newlineLengthAt(data, index, encoding)
    if (breakLength) return Math.min(data.length, index + breakLength)
  }
  return isUtf16 ? position + (position % 2) : position
}

// 分块边界构成固定栅格：每个边界都是「某个 TEXT_CHUNK_SIZE 整数倍处、向后
// 找到的下一个段落起点」，与翻页方向无关。这样往前、往后翻走的是同一组稳定
// 分块——旧实现里往后翻会重新计算块起点，导致整块内容的分页整体偏移，文字
// 位置越翻越“飘”，且偏移会随跨界次数累积。
function chunkLatticeBounds(data, index, encoding) {
  const gridStart = index * TEXT_CHUNK_SIZE
  const start = paragraphBoundary(data, gridStart, 'forward', encoding)
  let end = paragraphBoundary(data, gridStart + TEXT_CHUNK_SIZE, 'forward', encoding)
  if (end <= start) end = Math.min(data.length, start + TEXT_CHUNK_SIZE)
  return { start, end }
}

function getTextChunk(filePath, offset, direction = 'forward') {
  const cached = largeTextCache.get(filePath)
  if (!cached) throw new Error('文本缓存已失效，请重新打开书籍')
  const { data, encoding, detected } = cached
  const anchor = Math.max(0, Math.min(data.length, Math.round(offset) || 0))
  // 'backward' 在某块的第一页触发，要返回它前面那一块；其余方向都返回
  // 包含目标偏移的那一块。
  const target = direction === 'backward' ? Math.max(0, anchor - 1) : anchor
  let index = Math.max(0, Math.floor(target / TEXT_CHUNK_SIZE))
  let bounds = chunkLatticeBounds(data, index, encoding)
  // 超长段落会把吸附后的边界推过栅格点，前后微调找到真正包含目标的栅格块。
  while (bounds.end <= target && bounds.end < data.length) {
    index += 1
    bounds = chunkLatticeBounds(data, index, encoding)
  }
  while (bounds.start > target && index > 0) {
    index -= 1
    bounds = chunkLatticeBounds(data, index, encoding)
  }
  const { start, end } = bounds
  // 目标偏移在解码后块内容中的字符下标，供渲染端在块起点早于目标时仍能
  // 精确落到目标所在页。
  const anchorChar = iconv.decode(data.subarray(start, anchor), encoding).length
  return { content: iconv.decode(data.subarray(start, end), encoding), start, end, total: data.length, encoding: detected, anchor: anchorChar }
}

function toggleBossKey() {
  if (!mainWindow) return
  if (bossHidden) {
    mainWindow.setSkipTaskbar(false)
    mainWindow.show()
    mainWindow.focus()
  } else {
    mainWindow.setSkipTaskbar(true)
    mainWindow.hide()
  }
  bossHidden = !bossHidden
}

function restoredWindowBounds(saved) {
  if (!saved || typeof saved !== 'object') return { width: 1240, height: 820, maximized: false }
  const candidate = {
    x: Number.isFinite(saved.x) ? saved.x : 0,
    y: Number.isFinite(saved.y) ? saved.y : 0,
    width: Math.max(360, Number(saved.width) || 1240),
    height: Math.max(260, Number(saved.height) || 820),
  }
  const workArea = screen.getDisplayMatching(candidate).workArea
  const width = Math.min(candidate.width, workArea.width)
  const height = Math.min(candidate.height, workArea.height)
  return {
    width,
    height,
    x: Math.max(workArea.x, Math.min(candidate.x, workArea.x + workArea.width - Math.min(80, width))),
    y: Math.max(workArea.y, Math.min(candidate.y, workArea.y + workArea.height - Math.min(50, height))),
    maximized: Boolean(saved.maximized),
  }
}

async function saveWindowBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const store = await loadStore()
  store.data['reader:window-bounds'] = { ...mainWindow.getNormalBounds(), maximized: mainWindow.isMaximized() }
  await queueStoreWrite()
}

function scheduleWindowBoundsSave() {
  clearTimeout(windowBoundsTimer)
  windowBoundsTimer = setTimeout(() => saveWindowBounds().catch(() => {}), 250)
}

async function createWindow() {
  const store = await loadStore()
  const restored = restoredWindowBounds(store.data['reader:window-bounds'])
  mainWindow = new BrowserWindow({
    width: restored.width,
    height: restored.height,
    x: restored.x,
    y: restored.y,
    minWidth: 360,
    minHeight: 260,
    frame: false,
    thickFrame: true,
    resizable: true,
    transparent: false,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#f3f2ee',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  } else {
    mainWindow.loadURL('http://127.0.0.1:5173')
  }

  logEvent('window:create-main', { version: app.getVersion() })
  watchWindow(mainWindow, 'main')
  mainWindow.once('ready-to-show', () => {
    if (restored.maximized) mainWindow.maximize()
    mainWindow.show()
    setTimeout(() => flushExternalFiles().catch(() => {}), 250)
  })
  const emitMaximized = () => {
    mainWindow?.webContents.send('window:maximized', mainWindow.isMaximized())
    scheduleWindowBoundsSave()
  }
  mainWindow.on('maximize', emitMaximized)
  mainWindow.on('unmaximize', emitMaximized)
  mainWindow.on('resize', scheduleWindowBoundsSave)
  mainWindow.on('move', scheduleWindowBoundsSave)
  // 伴侣窗口与悬浮图标吸附在阅读窗右缘；阅读窗拖动/缩放/还原时实时跟随。
  mainWindow.on('move', scheduleCompanionFollow)
  mainWindow.on('resize', scheduleCompanionFollow)
  mainWindow.on('restore', scheduleCompanionFollow)
  mainWindow.on('close', (event) => {
    if (closingWindow) return
    event.preventDefault()
    closingWindow = true
    clearTimeout(windowBoundsTimer)
    saveWindowBounds().catch(() => {}).finally(() => mainWindow?.destroy())
  })
  mainWindow.on('closed', () => {
    mainWindow = null
    closingWindow = false
    if (profilesWindow && !profilesWindow.isDestroyed()) profilesWindow.destroy()
    if (profilesFabWindow && !profilesFabWindow.isDestroyed()) profilesFabWindow.destroy()
    if (dictionaryWindow && !dictionaryWindow.isDestroyed()) dictionaryWindow.destroy()
  })
}

// 阅读窗移动/缩放时，伴侣窗口与悬浮图标实时跟随（60ms 节流，带末次补偿）。
function scheduleCompanionFollow() {
  if (companionFollowTimer) { companionFollowAgain = true; return }
  companionFollowTimer = setTimeout(() => {
    companionFollowTimer = null
    followProfilesToMain()
    followDictionaryToMain()
    snapFabToReader()
    if (companionFollowAgain) { companionFollowAgain = false; scheduleCompanionFollow() }
  }, 60)
}

// 设定集独立窗口：标准带框窗口，首次打开贴着阅读窗口右侧，互不遮挡。
// 用户手动调整的尺寸/位置会持久化，下次打开恢复；吸附位置不算用户摆放，只记尺寸。
let profilesWindowBoundsTimer = null
function scheduleProfilesWindowBoundsSave() {
  clearTimeout(profilesWindowBoundsTimer)
  profilesWindowBoundsTimer = setTimeout(async () => {
    if (!profilesWindow || profilesWindow.isDestroyed()) return
    const bounds = profilesWindow.getBounds()
    const docked = profilesLastDock && Math.abs(bounds.x - profilesLastDock.x) <= 4 && Math.abs(bounds.y - profilesLastDock.y) <= 4
    const store = await loadStore()
    store.data['reader:profiles-window-bounds'] = docked ? { width: bounds.width, height: bounds.height } : bounds
    await queueStoreWrite()
  }, 400)
}

// 伴侣窗口在阅读窗右缘的吸附位置（超出工作区则收进屏幕内）。
function profilesDockPosition() {
  const bounds = mainWindow.getBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  const size = profilesWindow.getBounds()
  return {
    x: Math.min(bounds.x + bounds.width + 8, workArea.x + workArea.width - size.width),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - size.height)),
  }
}

// 吸附中的伴侣窗口跟随阅读窗移动/缩放；用户拖离后自动解除，回到吸附位则恢复。
function followProfilesToMain() {
  if (!profilesWindow || profilesWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  const current = profilesWindow.getBounds()
  if (!profilesLastDock) {
    // 兼容旧版本留下的位置：恰好站在吸附位也视为吸附。
    const dock = profilesDockPosition()
    if (Math.abs(current.x - dock.x) <= 6 && Math.abs(current.y - dock.y) <= 6) profilesLastDock = dock
    return
  }
  if (Math.abs(current.x - profilesLastDock.x) > 4 || Math.abs(current.y - profilesLastDock.y) > 4) {
    profilesLastDock = null // 用户已拖离
    return
  }
  const dock = profilesDockPosition()
  if (dock.x === current.x && dock.y === current.y) return
  profilesLastDock = dock
  profilesWindow.setPosition(dock.x, dock.y)
}

async function openProfilesWindow(focusName = '', forceDock = false) {
  if (profilesWindow && !profilesWindow.isDestroyed()) {
    if (focusName) profilesWindow.webContents.send('profiles:focus', focusName)
    profilesWindow.show()
    profilesWindow.focus()
    return
  }
  const store = await loadStore()
  const saved = store.data['reader:profiles-window-bounds']
  const mainBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : { x: 100, y: 100, width: 900, height: 700 }
  const workArea = screen.getDisplayMatching(mainBounds).workArea
  const width = Math.min(workArea.width, Math.max(420, Number(saved?.width) || Math.min(780, Math.max(520, Math.floor(workArea.width * 0.42)))))
  const height = Math.min(workArea.height, Math.max(360, Number(saved?.height) || Math.min(mainBounds.height, workArea.height)))
  // 尺寸始终记忆；位置默认记忆，但从悬浮图标展开时强制吸附回阅读窗口右缘。
  const dockX = Math.min(mainBounds.x + mainBounds.width + 8, workArea.x + workArea.width - width)
  const dockY = Math.max(workArea.y, Math.min(mainBounds.y, workArea.y + workArea.height - height))
  // 旧版本可能把吸附位置当成用户位置记了下来：与吸附位几乎重合时也按吸附处理。
  const nearDock = Number.isFinite(saved?.x) && Number.isFinite(saved?.y) && Math.abs(saved.x - dockX) <= 12 && Math.abs(saved.y - dockY) <= 12
  const useSaved = !forceDock && Number.isFinite(saved?.x) && Number.isFinite(saved?.y) && !nearDock
  const x = useSaved ? Math.max(workArea.x, Math.min(saved.x, workArea.x + workArea.width - width)) : dockX
  const y = useSaved ? Math.max(workArea.y, Math.min(saved.y, workArea.y + workArea.height - height)) : dockY
  profilesWindow = new BrowserWindow({
    width,
    height,
    x,
    y,
    minWidth: 420,
    minHeight: 360,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#f3f2ee',
    title: '设定集',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (app.isPackaged) profilesWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { window: 'profiles' } })
  else profilesWindow.loadURL('http://127.0.0.1:5173?window=profiles')
  logEvent('window:open-profiles', { forceDock })
  watchWindow(profilesWindow, 'profiles')
  profilesWindow.on('closed', () => { profilesWindow = null; profilesLastDock = null })
  profilesWindow.on('move', scheduleProfilesWindowBoundsSave)
  profilesWindow.on('resize', scheduleProfilesWindowBoundsSave)
  // 原生最小化按钮（−）：不收进任务栏，收起为阅读窗右缘的悬浮图标。
  // 注意：minimize 事件由 WM_SYSCOMMAND 同步触发，必须等消息处理返回后
  // 再销毁窗口，否则在窗口回调里销毁自身会让主进程崩溃（0xc000041d）。
  profilesWindow.on('minimize', (event) => {
    event.preventDefault()
    logEvent('profiles:minimize-to-fab')
    setImmediate(() => collapseProfilesToFab())
  })
  // 初始处于吸附位置（首次停靠或从图标展开）时进入吸附状态。
  profilesLastDock = (x === dockX && y === dockY) ? { x, y } : null
  profilesWindow.webContents.once('did-finish-load', () => {
    if (lastProfilesSnapshot) profilesWindow?.webContents.send('profiles:sync', lastProfilesSnapshot)
    mainWindow?.webContents.send('profiles:request-sync')
    if (focusName) profilesWindow?.webContents.send('profiles:focus', focusName)
  })
}

ipcMain.handle('profiles:open', async (_event, focusName) => {
  await openProfilesWindow(String(focusName || '').slice(0, 80))
  return true
})
// 工具栏按钮：开着就关，关着就开（悬浮图标状态下则展开）。
ipcMain.handle('profiles:toggle', async () => {
  if (profilesWindow && !profilesWindow.isDestroyed()) {
    profilesWindow.close()
    return false
  }
  if (profilesFabWindow && !profilesFabWindow.isDestroyed()) {
    profilesFabWindow.destroy()
    profilesFabWindow = null
  }
  await openProfilesWindow()
  return true
})
// 阅读窗口 → 设定集窗口/悬浮图标：状态快照（资料卡 + 生成任务）。
// 主进程自己留存一份：关窗/换书时快照变化不再“无处可去”，
// 新开的设定集窗口直接由主进程喂最新快照，不再依赖渲染端 localStorage 缓存（会残留上一本书）。
let lastProfilesSnapshot = null
ipcMain.on('profiles:sync', (_event, snapshot) => {
  lastProfilesSnapshot = snapshot || null
  for (const win of [profilesWindow, profilesFabWindow]) {
    if (win && !win.isDestroyed()) win.webContents.send('profiles:sync', snapshot)
  }
})
// 设定集窗口 → 阅读窗口：用户动作（确认生成、重试、删除等）。
ipcMain.on('profiles:action', (_event, action) => {
  mainWindow?.webContents.send('profiles:action', action)
})

// 收起为悬浮小图标：吸附到阅读器窗口外右侧，跟随阅读窗移动，拖拽松手后回吸。
// 图标窗是阅读窗的 owned 子窗口：阅读窗最小化/老板键隐藏/被其他窗口压下时，它同步跟随。
let profilesFabSnapTimer = null
let profilesFabPersistTimer = null
function snapFabToReader() {
  if (!profilesFabWindow || profilesFabWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  const bounds = mainWindow.getBounds()
  const fab = profilesFabWindow.getBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  const x = Math.min(bounds.x + bounds.width + 6, workArea.x + workArea.width - fab.width)
  const y = Math.max(workArea.y, Math.min(fab.y, Math.min(bounds.y + bounds.height - fab.height, workArea.y + workArea.height - fab.height)))
  if (x !== fab.x || y !== fab.y) profilesFabWindow.setPosition(x, y)
  clearTimeout(profilesFabPersistTimer)
  profilesFabPersistTimer = setTimeout(async () => {
    if (!profilesFabWindow || profilesFabWindow.isDestroyed()) return
    const store = await loadStore()
    store.data['reader:profiles-fab-dy'] = profilesFabWindow.getBounds().y - bounds.y
    await queueStoreWrite()
  }, 500)
}

async function openProfilesFabWindow() {
  if (profilesFabWindow && !profilesFabWindow.isDestroyed()) {
    profilesFabWindow.show()
    return
  }
  const store = await loadStore()
  const mainBounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : screen.getPrimaryDisplay().workArea
  const workArea = screen.getDisplayMatching(mainBounds).workArea
  const savedDy = Number(store.data['reader:profiles-fab-dy'])
  const dy = Number.isFinite(savedDy) ? savedDy : Math.floor(mainBounds.height * 0.3)
  profilesFabWindow = new BrowserWindow({
    width: 58,
    height: 78,
    x: Math.min(mainBounds.x + mainBounds.width + 6, workArea.x + workArea.width - 58),
    y: Math.max(workArea.y, Math.min(mainBounds.y + dy, workArea.y + workArea.height - 78)),
    frame: false,
    resizable: false,
    skipTaskbar: true,
    parent: mainWindow || undefined,
    autoHideMenuBar: true,
    backgroundColor: '#f3f2ee',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (app.isPackaged) profilesFabWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { window: 'profiles-fab' } })
  else profilesFabWindow.loadURL('http://127.0.0.1:5173?window=profiles-fab')
  logEvent('window:open-fab')
  watchWindow(profilesFabWindow, 'fab')
  profilesFabWindow.on('closed', () => { profilesFabWindow = null })
  profilesFabWindow.on('move', () => {
    // 用户拖动松手后自动回吸到阅读窗口右缘；手动拖拽进行中不回吸。
    if (fabManualDrag) return
    clearTimeout(profilesFabSnapTimer)
    profilesFabSnapTimer = setTimeout(snapFabToReader, 350)
  })
  profilesFabWindow.webContents.once('did-finish-load', () => {
    if (lastProfilesSnapshot) profilesFabWindow?.webContents.send('profiles:sync', lastProfilesSnapshot)
    mainWindow?.webContents.send('profiles:request-sync')
  })
}

function collapseProfilesToFab() {
  logEvent('profiles:collapse-to-fab')
  if (profilesWindow && !profilesWindow.isDestroyed()) profilesWindow.destroy()
  profilesWindow = null
  profilesLastDock = null
  openProfilesFabWindow()
}

ipcMain.on('profiles:collapse', collapseProfilesToFab)
ipcMain.on('profiles:expand', () => {
  if (profilesFabWindow && !profilesFabWindow.isDestroyed()) profilesFabWindow.destroy()
  profilesFabWindow = null
  openProfilesWindow('', true)
})
// 悬浮图标手动拖拽：渲染端按位移增量驱动，拖动中暂停自动回吸，松手后回吸一次。
let fabManualDrag = false
ipcMain.on('profiles:fab-drag', (_event, delta) => {
  if (!profilesFabWindow || profilesFabWindow.isDestroyed()) return
  fabManualDrag = true
  const [x, y] = profilesFabWindow.getPosition()
  profilesFabWindow.setPosition(x + Math.round(delta?.dx || 0), y + Math.round(delta?.dy || 0))
})
ipcMain.on('profiles:fab-drag-end', () => {
  fabManualDrag = false
  snapFabToReader()
})

// ===== 字典百科窗口：吸附在阅读窗口外上侧，同宽跟随，不遮挡正文 =====
// 上侧空间不足（阅读窗贴屏幕顶）时落到下侧。高度可由用户调整并跟随保持，
// 横向位置与宽度始终与阅读窗对齐；阅读窗移动/缩放时实时跟随。
let dictionaryWindow = null
let dictPlacement = 'above'
let lastDictSnapshot = null

function dictionaryOpenBounds() {
  const bounds = mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : { x: 100, y: 100, width: 900, height: 700 }
  const workArea = screen.getDisplayMatching(bounds).workArea
  const spaceAbove = bounds.y - workArea.y - 8
  const spaceBelow = workArea.y + workArea.height - (bounds.y + bounds.height) - 8
  const desired = Math.min(480, Math.max(280, Math.floor(bounds.height * 0.55)))
  dictPlacement = spaceAbove >= 240 || spaceAbove >= spaceBelow ? 'above' : 'below'
  const height = Math.max(220, Math.min(desired, dictPlacement === 'above' ? spaceAbove : spaceBelow))
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width))
  const y = dictPlacement === 'above'
    ? Math.max(workArea.y, bounds.y - height - 8)
    : Math.min(bounds.y + bounds.height + 8, workArea.y + workArea.height - height)
  return { x, y, width: bounds.width, height }
}

function followDictionaryToMain() {
  if (!dictionaryWindow || dictionaryWindow.isDestroyed() || !mainWindow || mainWindow.isDestroyed() || mainWindow.isMinimized()) return
  const bounds = mainWindow.getBounds()
  const workArea = screen.getDisplayMatching(bounds).workArea
  const current = dictionaryWindow.getBounds()
  const x = Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width))
  const y = dictPlacement === 'above'
    ? Math.max(workArea.y, bounds.y - current.height - 8)
    : Math.min(bounds.y + bounds.height + 8, workArea.y + workArea.height - current.height)
  if (current.x !== x || current.y !== y || current.width !== bounds.width) {
    dictionaryWindow.setBounds({ x, y, width: bounds.width, height: current.height })
  }
}

async function openDictionaryWindow(entryId = '') {
  if (dictionaryWindow && !dictionaryWindow.isDestroyed()) {
    if (entryId) dictionaryWindow.webContents.send('dict:focus', entryId)
    dictionaryWindow.show()
    dictionaryWindow.focus()
    return
  }
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = dictionaryOpenBounds()
  dictionaryWindow = new BrowserWindow({
    ...bounds,
    minWidth: 480,
    minHeight: 220,
    minimizable: false,
    maximizable: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    backgroundColor: '#f3f2ee',
    title: '字典百科',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  if (app.isPackaged) dictionaryWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { query: { window: 'dictionary' } })
  else dictionaryWindow.loadURL('http://127.0.0.1:5173?window=dictionary')
  logEvent('window:open-dictionary', { placement: dictPlacement })
  watchWindow(dictionaryWindow, 'dict')
  dictionaryWindow.on('closed', () => { dictionaryWindow = null })
  dictionaryWindow.webContents.once('did-finish-load', () => {
    if (lastDictSnapshot) dictionaryWindow?.webContents.send('dict:sync', lastDictSnapshot)
    mainWindow?.webContents.send('dict:request-sync')
    if (entryId) dictionaryWindow?.webContents.send('dict:focus', entryId)
  })
}

ipcMain.handle('dict:open', async (_event, entryId) => {
  await openDictionaryWindow(String(entryId || '').slice(0, 120))
  return true
})
ipcMain.on('dict:close', () => {
  if (dictionaryWindow && !dictionaryWindow.isDestroyed()) dictionaryWindow.close()
})
// 阅读窗口 → 字典窗口：条目快照（主进程留存一份，新开的窗口立即可用）。
ipcMain.on('dict:sync', (_event, snapshot) => {
  lastDictSnapshot = snapshot || null
  if (dictionaryWindow && !dictionaryWindow.isDestroyed()) dictionaryWindow.webContents.send('dict:sync', snapshot)
})
// 字典窗口 → 阅读窗口：重新生成、追问、删除追问等动作。
ipcMain.on('dict:action', (_event, action) => {
  if (action?.type === 'jump-to-source' && mainWindow && !mainWindow.isDestroyed()) {
    // 点击引用块跳原文：把阅读窗提到前台，让用户看到落点。
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  }
  mainWindow?.webContents.send('dict:action', action)
})

function supportedBookPaths(values = []) {
  return [...new Set(values.filter((value) => typeof value === 'string' && ['.txt', '.epub'].includes(path.extname(value).toLowerCase())))]
}

async function flushExternalFiles() {
  if (!mainWindow || mainWindow.webContents.isLoading() || !pendingExternalFiles.length) return
  const paths = pendingExternalFiles
  pendingExternalFiles = []
  const books = (await Promise.all(paths.map((filePath) => describeBook(filePath).catch(() => null)))).filter(Boolean)
  if (books.length) mainWindow.webContents.send('books:open-external', books)
}

function queueExternalFiles(values) {
  pendingExternalFiles.push(...supportedBookPaths(values))
  flushExternalFiles().catch(() => {})
}

async function scanBooks(directory) {
  const books = []

  async function walk(folder) {
    let entries
    try {
      entries = await fs.readdir(folder, { withFileTypes: true })
    } catch {
      return
    }

    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(folder, entry.name)
      if (entry.isDirectory()) {
        await walk(fullPath)
        return
      }

      const extension = path.extname(entry.name).toLowerCase()
      if (extension !== '.txt' && extension !== '.epub') return

      try {
        const stats = await fs.stat(fullPath)
        books.push(await describeBook(fullPath, stats))
      } catch {
        // A file can disappear while the directory is being scanned.
      }
    }))
  }

  await walk(directory)
  return books.sort((a, b) => b.modifiedAt - a.modifiedAt)
}

async function describeBook(filePath, knownStats) {
  const extension = path.extname(filePath).toLowerCase()
  if (extension !== '.txt' && extension !== '.epub') return null
  const stats = knownStats || await fs.stat(filePath)
  const fingerprint = await fingerprintBook(filePath, stats)
  let epubMetadata = {}
  if (extension === '.epub') {
    const memoryKey = `${filePath}:${stats.size}:${stats.mtimeMs}`
    epubMetadata = await readEpubDiskCache(fingerprint)
    if (epubMetadata) epubMetadataCache.set(memoryKey, Promise.resolve(epubMetadata))
    else {
      epubMetadata = await readEpubMetadata(filePath, stats)
      await writeEpubDiskCache(fingerprint, epubMetadata)
    }
  }
  return {
    id: `book:${fingerprint}`,
    fingerprint,
    legacyId: filePath,
    path: filePath,
    title: epubMetadata.title || path.basename(filePath, extension),
    author: epubMetadata.author || '',
    hasCover: Boolean(epubMetadata.cover),
    format: extension.slice(1).toUpperCase(),
    size: stats.size,
    modifiedAt: stats.mtimeMs,
  }
}

async function fingerprintBook(filePath, stats) {
  const sampleSize = 64 * 1024
  const handle = await fs.open(filePath, 'r')
  try {
    const hash = createHash('sha256').update(String(stats.size)).update('\0')
    if (stats.size <= sampleSize * 2) {
      hash.update(await fs.readFile(handle))
    } else {
      const first = Buffer.alloc(sampleSize)
      const last = Buffer.alloc(sampleSize)
      await handle.read(first, 0, sampleSize, 0)
      await handle.read(last, 0, sampleSize, stats.size - sampleSize)
      hash.update(first).update(last)
    }
    return hash.digest('hex').slice(0, 32)
  } finally {
    await handle.close()
  }
}

ipcMain.handle('books:choose-directory', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择书籍文件夹',
    properties: ['openDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const directory = result.filePaths[0]
  return { directory, books: await scanBooks(directory) }
})

ipcMain.handle('books:choose-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '添加书籍',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '电子书', extensions: ['txt', 'epub'] }],
  })
  if (result.canceled) return []
  const books = await Promise.all(result.filePaths.map((filePath) => describeBook(filePath)))
  return books.filter(Boolean)
})

ipcMain.handle('books:describe-paths', async (_event, paths) => {
  const books = await Promise.all(supportedBookPaths(Array.isArray(paths) ? paths : []).map((filePath) => describeBook(filePath).catch(() => null)))
  return books.filter(Boolean)
})

ipcMain.handle('books:relocate', async (_event, book) => {
  const extension = book?.format?.toLowerCase()
  const result = await dialog.showOpenDialog(mainWindow, {
    title: `重新定位《${book?.title || '书籍'}》`,
    properties: ['openFile'],
    filters: [{ name: '电子书', extensions: extension ? [extension] : ['txt', 'epub'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const candidate = await describeBook(result.filePaths[0])
  if (book?.fingerprint && candidate.fingerprint !== book.fingerprint) {
    const confirmation = await dialog.showMessageBox(mainWindow, {
      type: 'warning', title: '文件内容不同', message: '所选文件与原书内容指纹不一致。',
      detail: '继续后会把它视为另一本书，原有阅读数据不会自动关联。',
      buttons: ['取消', '仍然使用'], defaultId: 0, cancelId: 0, noLink: true,
    })
    if (confirmation.response !== 1) return null
  }
  return candidate
})

ipcMain.handle('books:scan-directory', async (_event, directory) => {
  if (!directory || typeof directory !== 'string') return []
  return scanBooks(directory)
})

ipcMain.handle('books:get-epub-cover', async (_event, filePath) => {
  if (path.extname(filePath).toLowerCase() !== '.epub') return null
  const stats = await fs.stat(filePath)
  return (await readEpubMetadata(filePath, stats)).cover || null
})

ipcMain.handle('books:open', async (_event, filePath, forcedEncoding) => {
  const extension = path.extname(filePath).toLowerCase()
  const data = await fs.readFile(filePath)

  if (extension === '.epub') {
    return { kind: 'epub', data: data.toString('base64') }
  }

  const { detected, encoding } = resolveEncoding(forcedEncoding) || detectEncoding(data)
  if (data.length > LARGE_TEXT_THRESHOLD) {
    cacheLargeText(filePath, data, encoding, detected)
    return { kind: 'text-large', ...getTextChunk(filePath, 0) }
  }
  cacheLargeText(filePath, data, encoding, detected)
  return { kind: 'text', content: iconv.decode(data, encoding), encoding: detected }
})

ipcMain.handle('books:read-text-chunk', async (_event, { filePath, offset, direction }) => getTextChunk(filePath, offset, direction))
ipcMain.handle('books:get-text-toc', async (_event, filePath) => {
  const cached = largeTextCache.get(filePath)
  if (!cached) return []
  return cached.tocPromise
})

ipcMain.handle('books:search-text', async (_event, { filePath, query, sample, fromOffset }) => {
  const cached = largeTextCache.get(filePath)
  const queries = (Array.isArray(query) ? query : [query]).map((value) => String(value || '').trim()).filter(Boolean)
  if (!cached || !queries.length) return { results: [], truncated: false }
  const results = []
  const limit = 5000
  const seen = new Set()
  const minOffset = Math.max(0, Number(fromOffset) || 0)
  if (sample) {
    // 两趟均匀采样：先数总量，再按步长挑选，几千章的书也能覆盖全程而不是只覆盖开头。
    // 长扫描周期性让出主进程事件循环，保证设定集窗口等其他 IPC 不被卡住。
    const needles = queries.map((value) => iconv.encode(value, cached.encoding)).filter((needle) => needle.length)
    const counts = []
    for (const needle of needles) {
      let count = 0
      let position = minOffset
      while (true) {
        const found = cached.data.indexOf(needle, position)
        if (found < 0) break
        count += 1
        position = found + Math.max(1, needle.length)
        if (count % 20000 === 0) await new Promise((resolve) => setImmediate(resolve))
      }
      counts.push(count)
    }
    const total = counts.reduce((sum, count) => sum + count, 0)
    for (let needleIndex = 0; needleIndex < needles.length; needleIndex += 1) {
      const needle = needles[needleIndex]
      const budget = Math.max(1, Math.round((limit * counts[needleIndex]) / Math.max(1, total)))
      const stride = Math.max(1, Math.ceil(counts[needleIndex] / budget))
      let hit = 0
      let position = minOffset
      while (results.length < limit) {
        const found = cached.data.indexOf(needle, position)
        if (found < 0) break
        hit += 1
        position = found + Math.max(1, needle.length)
        if (hit % 20000 === 0) await new Promise((resolve) => setImmediate(resolve))
        if ((hit - 1) % stride !== 0 || seen.has(found)) continue
        const lineStart = paragraphBoundary(cached.data, found, 'backward', cached.encoding)
        const lineEnd = paragraphBoundary(cached.data, found + needle.length, 'forward', cached.encoding)
        const label = iconv.decode(cached.data.subarray(lineStart, lineEnd), cached.encoding).replace(/[\r\n]+/g, ' ').trim()
        results.push({ label: label.slice(0, 180), offset: lineStart, matchOffset: found })
        seen.add(found)
      }
    }
    results.sort((a, b) => a.matchOffset - b.matchOffset)
    return { results, truncated: total > results.length, total }
  }
  let truncated = false
  for (const needleText of queries) {
    const needle = iconv.encode(needleText, cached.encoding)
    let position = minOffset
    while (results.length < limit) {
      const found = cached.data.indexOf(needle, position)
      if (found < 0) break
      const lineStart = paragraphBoundary(cached.data, found, 'backward', cached.encoding)
      const lineEnd = paragraphBoundary(cached.data, found + needle.length, 'forward', cached.encoding)
      if (!seen.has(found)) {
        const label = iconv.decode(cached.data.subarray(lineStart, lineEnd), cached.encoding).replace(/[\r\n\u0000]+/g, ' ').trim()
        results.push({ label: label.slice(0, 180), offset: lineStart, matchOffset: found })
        seen.add(found)
      }
      position = found + Math.max(1, needle.length)
    }
    if (results.length >= limit && cached.data.indexOf(needle, position) >= 0) truncated = true
  }
  results.sort((a, b) => a.matchOffset - b.matchOffset)
  return { results, truncated }
})

ipcMain.handle('storage:get', async (_event, key) => {
  if (!STORE_KEYS.has(key)) throw new Error('不支持的存储项目')
  const store = await loadStore()
  return Object.prototype.hasOwnProperty.call(store.data, key)
    ? { found: true, value: store.data[key] }
    : { found: false, value: null }
})

ipcMain.handle('storage:set', async (_event, key, value) => {
  if (!STORE_KEYS.has(key)) throw new Error('不支持的存储项目')
  const store = await loadStore()
  store.data[key] = value
  await queueStoreWrite()
  return true
})

ipcMain.handle('storage:export', async () => {
  const store = await loadStore()
  await storeWriteQueue
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出阅读数据',
    defaultPath: path.join(app.getPath('documents'), `墨读阅读数据-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: '墨读阅读数据', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePath) return null
  await fs.writeFile(result.filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8')
  return result.filePath
})

ipcMain.handle('storage:import', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '导入阅读数据',
    properties: ['openFile'],
    filters: [{ name: '墨读阅读数据', extensions: ['json'] }],
  })
  if (result.canceled || !result.filePaths[0]) return null
  const imported = await readStoreFile(result.filePaths[0])
  const confirmation = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    title: '导入阅读数据',
    message: '要用备份中的数据替换当前阅读数据吗？',
    detail: '当前数据会先自动备份。导入后应用将重新载入。',
    buttons: ['取消', '导入并替换'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  })
  if (confirmation.response !== 1) return null
  await storeWriteQueue
  await createBackup(`before-import-${new Date().toISOString()}`)
  storeCache = imported
  await queueStoreWrite()
  return { importedAt: storeCache.updatedAt, keyCount: Object.keys(storeCache.data).length }
})

ipcMain.handle('books:delete-source', async (_event, filePath) => {
  const extension = path.extname(filePath).toLowerCase()
  if (extension !== '.txt' && extension !== '.epub') throw new Error('不支持删除此文件类型')
  await shell.trashItem(filePath)
  return true
})

ipcMain.handle('notes:save-share', async (_event, { dataUrl, bookPath, quote }) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/png;base64,')) throw new Error('无效的分享图片')
  const safeQuote = String(quote || '摘录').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 18) || '摘录'
  const defaultPath = path.join(path.dirname(bookPath), `${safeQuote}-墨读分享.png`)
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '保存分享图片',
    defaultPath,
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  })
  if (result.canceled || !result.filePath) return null
  await fs.writeFile(result.filePath, Buffer.from(dataUrl.split(',')[1], 'base64'))
  return result.filePath
})

ipcMain.handle('notes:export-markdown', async (_event, { title, notes }) => {
  const safeTitle = String(title || '阅读笔记').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').slice(0, 80) || '阅读笔记'
  const result = await dialog.showSaveDialog(mainWindow, {
    title: '导出笔记',
    defaultPath: path.join(app.getPath('documents'), `${safeTitle}-笔记.md`),
    filters: [{ name: 'Markdown 文档', extensions: ['md'] }],
  })
  if (result.canceled || !result.filePath) return null
  const body = [`# ${safeTitle}`, '', ...(Array.isArray(notes) ? notes : []).flatMap((note) => [
    `> ${String(note.text || '').replace(/\r?\n/g, '\n> ')}`,
    note.comment ? `\n${note.comment}` : '',
    `\n_${new Date(note.createdAt || Date.now()).toLocaleDateString('zh-CN')}_`, '',
  ])].join('\n')
  await fs.writeFile(result.filePath, body, 'utf8')
  return result.filePath
})

ipcMain.handle('ai:get-settings', async () => publicAiConfig(await loadAiConfig()))

ipcMain.handle('ai:save-provider', async (_event, input) => {
  const config = await loadAiConfig()
  const id = typeof input?.id === 'string' && input.id ? input.id.slice(0, 80) : randomUUID()
  const existing = config.providers.find((item) => item.id === id)
  const name = String(input?.name || '').trim().slice(0, 80)
  if (!name) throw new Error('请填写供应商名称')
  const baseUrl = validateProviderUrl(input?.baseUrl)
  const encryptedKey = String(input?.apiKey || '').trim() ? encryptApiKey(input.apiKey) : existing?.encryptedKey
  if (!encryptedKey) throw new Error('请填写 API Key')
  const provider = {
    ...existing,
    id,
    name,
    baseUrl,
    encryptedKey,
    model: String(input?.model ?? existing?.model ?? '').trim().slice(0, 160),
    maxTokens: Math.max(64, Math.min(128000, Number(input?.maxTokens ?? existing?.maxTokens) || 8000)),
    tokenParameter: ['auto', 'max_completion_tokens', 'max_tokens'].includes(input?.tokenParameter) ? input.tokenParameter : (existing?.tokenParameter || 'auto'),
    models: Array.isArray(input?.models) ? [...new Set(input.models.map((value) => typeof value === 'string' ? value : value?.id || value?.name || value?.model).filter(Boolean).map((value) => String(value).trim().slice(0, 160)))] : (Array.isArray(existing?.models) ? existing.models : []),
    updatedAt: Date.now(),
  }
  config.providers = [...config.providers.filter((item) => item.id !== id), provider]
  if (!config.activeProviderId) config.activeProviderId = id
  await queueAiConfigWrite()
  return publicAiConfig(config)
})

ipcMain.handle('ai:delete-provider', async (_event, providerId) => {
  const config = await loadAiConfig()
  config.providers = config.providers.filter((item) => item.id !== providerId)
  if (config.activeProviderId === providerId) config.activeProviderId = config.providers[0]?.id || ''
  await queueAiConfigWrite()
  return publicAiConfig(config)
})

ipcMain.handle('ai:refresh-provider', async (_event, providerId) => {
  const config = await loadAiConfig()
  const provider = config.providers.find((item) => item.id === providerId)
  if (!provider) return { ok: false, error: { stage: 'models', status: 0, code: 'PROVIDER_NOT_FOUND', message: '没有找到该 AI 供应商' } }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  try {
    const base = new URL(provider.baseUrl)
    const basePath = base.pathname.replace(/\/+$/, '') || '/'
    const catalog = await collectModelCatalog({ request: async (endpoint) => {
      if (/^https?:\/\//i.test(endpoint) || endpoint.startsWith('/')) {
        const url = new URL(endpoint, providerEndpoint(provider.baseUrl, 'models'))
        if (url.origin !== base.origin || !(url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))) throw Object.assign(new Error('供应商分页地址跨越了不同主机或路径'), { aiError: { stage: 'models', status: 0, code: 'PAGINATION_ORIGIN_BLOCKED', message: '供应商返回了不安全的分页地址' } })
        endpoint = `${url.pathname}${url.search}`
      }
      return requestProvider(provider, endpoint, { method: 'GET' }, 'models', controller.signal)
    } })
    const fetchedModels = catalog.models
    const uniqueModels = fetchedModels.length ? fetchedModels : (Array.isArray(provider.models) ? provider.models : [])
    provider.models = uniqueModels
    provider.lastCheckedAt = Date.now()
    provider.lastStatus = fetchedModels.length ? 'ok' : 'empty'
    if (!provider.model && uniqueModels.length) provider.model = uniqueModels[0]
    await queueAiConfigWrite()
    return { ok: true, models: uniqueModels, fetchedModelCount: fetchedModels.length, fetchedPages: catalog.pages, partial: catalog.partial, usedCachedModels: !fetchedModels.length, settings: publicAiConfig(config) }
  } catch (error) {
    const aiError = error.aiError || { stage: 'models', status: 0, code: error.code || 'UNKNOWN_ERROR', message: sanitizeAiErrorText(error.message) }
    provider.lastCheckedAt = Date.now()
    provider.lastStatus = 'error'
    provider.lastError = aiError
    await queueAiConfigWrite()
    return { ok: false, error: aiError, settings: publicAiConfig(config) }
  } finally { clearTimeout(timeout) }
})

ipcMain.handle('ai:save-preferences', async (_event, input) => {
  const config = await loadAiConfig()
  if (typeof input?.activeProviderId === 'string' && config.providers.some((item) => item.id === input.activeProviderId)) config.activeProviderId = input.activeProviderId
  const provider = config.providers.find((item) => item.id === (input?.providerId || config.activeProviderId))
  if (provider) {
    if (typeof input?.model === 'string') provider.model = input.model.trim().slice(0, 160)
    if (input?.maxTokens !== undefined) provider.maxTokens = Math.max(64, Math.min(128000, Number(input.maxTokens) || 8000))
    if (['auto', 'max_completion_tokens', 'max_tokens'].includes(input?.tokenParameter)) provider.tokenParameter = input.tokenParameter
  }
  await queueAiConfigWrite()
  return publicAiConfig(config)
})

// 把模型输出的 JSON 归一化为资料卡结构；类型缺失时按 details 字段推断。
function normalizeParsedProfile(parsed, name) {
  const parsedDetails = parsed?.details && typeof parsed.details === 'object' ? parsed.details : {}
  let inferredType = String(parsed?.type || '未分类').slice(0, 20)
  if (inferredType === '未分类') {
    const detailKeys = Object.keys(parsedDetails)
    if (detailKeys.some((key) => ['protagonistRelation', 'firstEncounter', 'relationships', 'identity'].includes(key))) inferredType = '人物'
    else if (detailKeys.some((key) => ['owner', 'acquisition', 'purpose'].includes(key))) inferredType = '物品'
    else if (detailKeys.some((key) => ['location', 'features', 'relatedPeople', 'relatedEvents'].includes(key))) inferredType = '地点'
  }
  return {
    type: inferredType,
    canonicalName: String(parsed?.canonicalName || name).trim().slice(0, 80) || name,
    aliases: (Array.isArray(parsed?.aliases) ? parsed.aliases : []).map((value) => String(value).trim().slice(0, 80)).filter(Boolean).slice(0, 30),
    summary: String(parsed?.summary || '').trim().slice(0, 4000),
    details: Object.fromEntries(Object.entries(parsedDetails).slice(0, 12).map(([key, value]) => [String(key).slice(0, 40), String(value || '').trim().slice(0, 1600)]).filter(([, value]) => value)),
    relations: (Array.isArray(parsed?.relations) ? parsed.relations : []).slice(0, 40).map((item) => ({ relation: String(item?.relation || 'related_to').slice(0, 40), targetName: String(item?.targetName || '').trim().slice(0, 80), label: String(item?.label || '').trim().slice(0, 40), note: String(item?.note || '').trim().slice(0, 500) })).filter((item) => item.targetName),
    evidence: (Array.isArray(parsed?.evidence) ? parsed.evidence : []).slice(0, 8).map((item) => ({ chapter: String(item?.chapter || '').slice(0, 120), text: String(item?.text || '').slice(0, 500) })),
    identityConfidence: ['high', 'medium', 'low'].includes(parsed?.identityConfidence) ? parsed.identityConfidence : 'low',
  }
}

// 本地修复早期版本缓存的坏卡（summary 里是裸 JSON）：不调用模型，零成本。
ipcMain.handle('ai:repair-profile-json', (_event, payload) => {
  const text = String((payload && typeof payload === 'object' ? payload.text : payload) || '').slice(0, 200000)
  const name = String((payload && typeof payload === 'object' ? payload.name : '') || '').trim().slice(0, 80)
  if (!text) return { ok: false }
  const result = parseProfileJson(text)
  if (!result) return { ok: false }
  return { ok: true, profile: normalizeParsedProfile(result.value, name || String(result.value?.canonicalName || '资料')) }
})

async function summarizeEntity(event, input) {
  const config = await loadAiConfig()
  const provider = config.providers.find((item) => item.id === (input?.providerId || config.activeProviderId))
  if (!provider) return { ok: false, error: { stage: 'setup', status: 0, code: 'PROVIDER_NOT_FOUND', message: '请先设置并选择 AI 供应商' } }
  const model = String(input?.model || provider.model || '').trim().slice(0, 160)
  if (!model) return { ok: false, error: { stage: 'setup', status: 0, code: 'MODEL_REQUIRED', message: '请选择或填写模型' } }
  const name = String(input?.name || '').trim().slice(0, 80)
  // 高频名称（如主角）命中极多：缩短单片段窗口，同样预算可覆盖更多章节。
  const totalMatches = Number(input?.totalMatches) || 0
  const denseContext = totalMatches > 600 || (Array.isArray(input?.excerpts) && input.excerpts.length > 120)
  const perExcerptMaxChars = denseContext ? 420 : 900
  // 候选池放宽到 400 条（本地 IPC 无成本），让信息密度打分有更多候选可选。
  const excerpts = (Array.isArray(input?.excerpts) ? input.excerpts : []).slice(0, 400).map((item, index) => ({
    order: Number(item?.order) || index + 1,
    chapter: String(item?.chapter || '').slice(0, 120),
    text: String(item?.text || '').replace(/\s+/g, ' ').trim().slice(0, perExcerptMaxChars),
  })).filter((item) => item.text)
  const knownEntities = (Array.isArray(input?.knownEntities) ? input.knownEntities : []).slice(0, 120).map((item) => ({
    name: String(item?.name || '').slice(0, 80),
    aliases: (Array.isArray(item?.aliases) ? item.aliases : []).slice(0, 30).map((value) => String(value).slice(0, 80)),
    distinctFrom: (Array.isArray(item?.distinctFrom) ? item.distinctFrom : []).slice(0, 30).map((value) => String(value).slice(0, 80)),
    identityLocked: Boolean(item?.identityLocked),
  })).filter((item) => item.name)
  // 增量更新：旧资料卡 + 只送上次进度之后的新片段，重复查看主角时大幅省 token。
  const previousInput = input?.previousProfile && typeof input.previousProfile === 'object' ? input.previousProfile : null
  const previousProfile = previousInput && String(previousInput.summary || '').trim() ? {
    type: String(previousInput.type || '').slice(0, 20),
    summary: String(previousInput.summary || '').slice(0, 1200),
    details: Object.fromEntries(Object.entries(previousInput.details && typeof previousInput.details === 'object' ? previousInput.details : {}).slice(0, 10).map(([key, value]) => [String(key).slice(0, 40), String(value || '').slice(0, 400)]).filter(([, value]) => value)),
    relations: (Array.isArray(previousInput.relations) ? previousInput.relations : []).slice(0, 12).map((item) => ({ targetName: String(item?.targetName || '').slice(0, 80), label: String(item?.label || '').slice(0, 40) })).filter((item) => item.targetName),
  } : null
  if (!name || !excerpts.length) return { ok: false, error: { stage: 'search', status: 0, code: 'NO_PRIOR_EVIDENCE', message: '在当前阅读位置之前没有找到可用于总结的相关片段' } }
  // 按信息密度选片段：身份/关系信号词与已知实体共现优先，首尾锚点必保，每章限 3 条。
  // 预算分档：增量更新最小，高频名称（如主角）适中，低频名称宽松（反正命中少）。
  const knownNames = [...new Set(knownEntities.flatMap((item) => [item.name, ...(item.aliases || [])]))]
  const budget = previousProfile ? { limit: 24, maxChars: 12000 } : denseContext ? { limit: 40, maxChars: 24000 } : { limit: 48, maxChars: 32000 }
  const compactExcerpts = selectSummaryExcerpts(excerpts, { ...budget, knownNames })
  if (!compactExcerpts.length) return { ok: false, error: { stage: 'summary', status: 0, code: 'SUMMARY_CONTEXT_TOO_LARGE', message: '已读依据过大，请缩小检索范围后重试' } }
  const controller = new AbortController()
  let timedOut = false
  let timeout = setTimeout(() => { timedOut = true; controller.abort() }, 30000)
  // 提示词把输出预算压到约 1200 中文字符；token 上限保底 4096，给 JSON 完整闭合留足余量。
  const requestedMaxTokens = Math.max(4096, Math.min(8192, Number(input?.maxTokens ?? provider.maxTokens) || 4096))
  try {
    let tokenParameter = provider.tokenParameter === 'max_tokens' ? 'max_tokens' : 'max_completion_tokens'
    const messages = buildProfileMessages({ name, knownEntities, totalMatches: Number(input?.totalMatches) || excerpts.length, excerpts: compactExcerpts, previousProfile })
    const execute = (parameter) => requestProviderStreaming(provider, 'chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, [parameter]: requestedMaxTokens, stream: true, messages }),
    }, 'summary', controller.signal,
      (text) => event.sender.send('ai:summary-progress', { phase: 'first-chunk', text: text.slice(0, 80) }),
      () => {
        // 首字节前 30 秒超时；开始后每个 chunk 重置 60 秒心跳超时，流中途挂起也能失败退出。
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => { timedOut = true; controller.abort() }, 60000)
        event.sender.send('ai:summary-progress', { phase: 'stream-started' })
      })
    let response
    try { response = await execute(tokenParameter) }
    catch (error) {
      const detail = `${error.aiError?.code || ''} ${error.aiError?.message || ''}`
      const canFallback = provider.tokenParameter === 'auto' && error.aiError?.status === 400 && /max[_ -]?(completion[_ -]?)?tokens|unknown parameter|unsupported/i.test(detail)
      if (!canFallback) throw error
      tokenParameter = tokenParameter === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
      response = await execute(tokenParameter)
    }
    const choice = response?.choices?.[0]
    const summary = responseText(choice?.message).trim()
    const finishReason = choice?.finish_reason ?? null
    if (!summary) {
      const refusal = choice?.message?.refusal
      return { ok: false, error: { stage: 'summary', status: 200, code: finishReason === 'content_filter' || refusal ? 'CONTENT_FILTERED' : 'EMPTY_RESPONSE', message: sanitizeAiErrorText(refusal || '供应商没有返回资料总结'), finishReason } }
    }
    // 任何情况下都要产出资料卡：先完整解析，再修复截断 JSON，最后退化为纯文本卡片。
    let profile = null
    let truncated = finishReason === 'length'
    const parsedResult = parseProfileJson(summary)
    if (parsedResult) {
      profile = normalizeParsedProfile(parsedResult.value, name)
      if (parsedResult.repaired) truncated = true
    }
    if (!profile) {
      const salvaged = summary.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)/)
      const fallbackText = (salvaged ? salvaged[1] : summary)
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/```(?:json)?/gi, '')
        .trim()
        .slice(0, 2000)
      profile = {
        type: '未分类',
        canonicalName: name,
        aliases: [],
        summary: fallbackText || '模型输出不完整，未能解析出结构化资料；请重试。',
        details: {},
        relations: [],
        evidence: [],
        identityConfidence: 'low',
      }
      truncated = true
    }
    if (!profile.summary) profile.summary = '模型未给出摘要内容；请重试。'
    if (!profile.aliases.includes(name) && profile.canonicalName !== name) profile.aliases.unshift(name)
    profile.truncated = truncated
    return { ok: true, profile, summary: profile.summary, finishReason, usage: response?.usage || null, providerId: provider.id, providerName: provider.name, model }
  } catch (error) {
    return { ok: false, error: error.aiError || { stage: 'summary', status: 0, code: timedOut ? 'REQUEST_TIMEOUT' : (error.code || 'UNKNOWN_ERROR'), message: timedOut ? '供应商响应超时，请检查供应商连接、减少已读依据或稍后重试' : sanitizeAiErrorText(error.message) } }
  } finally { if (timeout) clearTimeout(timeout) }
}

ipcMain.handle('ai:summarize-entity', summarizeEntity)

// 字典百科：解释选中文字 / 回答追问。提示词在主进程组装（与资料卡同一模式），
// 渲染端只传素材；返回纯文本解释，不做 JSON 解析。
ipcMain.handle('ai:dictionary-chat', async (event, input) => {
  const config = await loadAiConfig()
  const provider = config.providers.find((item) => item.id === (input?.providerId || config.activeProviderId)) || config.providers[0]
  if (!provider) return { ok: false, error: { stage: 'setup', status: 0, code: 'PROVIDER_NOT_FOUND', message: '请先设置并选择 AI 供应商' } }
  const model = String(input?.model || provider.model || '').trim().slice(0, 160)
  if (!model) return { ok: false, error: { stage: 'setup', status: 0, code: 'MODEL_REQUIRED', message: '请选择或填写模型' } }
  const mode = input?.mode === 'followup' ? 'followup' : 'explain'
  const textOf = (value, limit) => String(value || '').trim().slice(0, limit)
  const entityProfiles = (Array.isArray(input?.entityProfiles) ? input.entityProfiles : []).slice(0, 40).map((item) => ({
    name: textOf(item?.name, 80),
    aliases: (Array.isArray(item?.aliases) ? item.aliases : []).slice(0, 10).map((value) => textOf(value, 80)).filter(Boolean),
    type: textOf(item?.type, 20),
    summary: textOf(item?.summary, 400),
  })).filter((item) => item.name)
  const payload = {
    bookTitle: textOf(input?.bookTitle, 120),
    author: textOf(input?.author, 80),
    chapterLabel: textOf(input?.chapterLabel, 160),
    readPercent: Math.max(0, Math.min(1, Number(input?.readPercent) || 0)),
    selectedText: textOf(input?.selectedText, 2000),
    paragraph: textOf(input?.paragraph, 4000),
    contextBefore: textOf(input?.contextBefore, 6000),
    contextAfter: textOf(input?.contextAfter, 6000),
    chapterText: textOf(input?.chapterText, 24000),
    explanation: textOf(input?.explanation, 4000),
    followUps: (Array.isArray(input?.followUps) ? input.followUps : []).slice(-8).map((item) => ({ question: textOf(item?.question, 500), answer: textOf(item?.answer, 4000) })),
    question: textOf(input?.question, 500),
    entityProfiles,
  }
  if (!payload.selectedText) return { ok: false, error: { stage: 'dictionary', status: 0, code: 'EMPTY_SELECTION', message: '选中的文字为空' } }
  if (mode === 'followup' && !payload.question) return { ok: false, error: { stage: 'dictionary', status: 0, code: 'EMPTY_QUESTION', message: '追问内容为空' } }
  const messages = mode === 'followup' ? buildFollowupMessages(payload) : buildDictionaryMessages(payload)
  const controller = new AbortController()
  let timedOut = false
  let timeout = setTimeout(() => { timedOut = true; controller.abort() }, 30000)
  const requestedMaxTokens = Math.max(1024, Math.min(8192, Number(input?.maxTokens ?? provider.maxTokens) || 4096))
  try {
    let tokenParameter = provider.tokenParameter === 'max_tokens' ? 'max_tokens' : 'max_completion_tokens'
    const execute = (parameter) => requestProviderStreaming(provider, 'chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, [parameter]: requestedMaxTokens, stream: true, messages }),
    }, 'dictionary', controller.signal,
      null,
      () => {
        // 首字节前 30 秒超时；流开始后每个 chunk 重置 60 秒心跳超时。
        if (timeout) clearTimeout(timeout)
        timeout = setTimeout(() => { timedOut = true; controller.abort() }, 60000)
      })
    let response
    try { response = await execute(tokenParameter) }
    catch (error) {
      const detail = `${error.aiError?.code || ''} ${error.aiError?.message || ''}`
      const canFallback = provider.tokenParameter === 'auto' && error.aiError?.status === 400 && /max[_ -]?(completion[_ -]?)?tokens|unknown parameter|unsupported/i.test(detail)
      if (!canFallback) throw error
      tokenParameter = tokenParameter === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
      response = await execute(tokenParameter)
    }
    const choice = response?.choices?.[0]
    const text = responseText(choice?.message).trim()
    if (!text) {
      const refusal = choice?.message?.refusal
      return { ok: false, error: { stage: 'dictionary', status: 200, code: choice?.finish_reason === 'content_filter' || refusal ? 'CONTENT_FILTERED' : 'EMPTY_RESPONSE', message: sanitizeAiErrorText(refusal || '供应商没有返回解释') } }
    }
    return { ok: true, text: text.slice(0, 4000), providerId: provider.id, providerName: provider.name, model }
  } catch (error) {
    return { ok: false, error: error.aiError || { stage: 'dictionary', status: 0, code: timedOut ? 'REQUEST_TIMEOUT' : (error.code || 'UNKNOWN_ERROR'), message: timedOut ? '供应商响应超时，请检查供应商连接后重试' : sanitizeAiErrorText(error.message) } }
  } finally { if (timeout) clearTimeout(timeout) }
})

// Headless smoke test of the profile chain against the locally stored provider:
//   MOYU_PROFILE_SELFTEST=test-profile-fixture.json npx electron .
// MOYU_TEST_API_KEY can override the stored key (useful when the stored key was
// encrypted by a different executable, e.g. the packaged build).
async function runProfileSelfTest(fixturePath) {
  try {
    const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'))
    const config = await loadAiConfig()
    const provider = config.providers.find((item) => item.id === config.activeProviderId) || config.providers[0]
    if (provider && process.env.MOYU_TEST_API_KEY) provider.encryptedKey = encryptApiKey(process.env.MOYU_TEST_API_KEY)
    const result = await summarizeEntity({ sender: { send: () => {} } }, {
      name: fixture.name || '方运',
      excerpts: fixture.excerpts || [],
      totalMatches: fixture.totalMatches || (fixture.excerpts || []).length,
      providerId: provider?.id,
      model: provider?.model,
      knownEntities: fixture.knownEntities || [],
      previousProfile: fixture.previousProfile || null,
    })
    const profile = result.profile
    const report = {
      ok: result.ok,
      error: result.error || null,
      finishReason: result.finishReason || null,
      truncated: profile?.truncated ?? null,
      profile: profile ? {
        type: profile.type,
        canonicalName: profile.canonicalName,
        summaryLength: profile.summary.length,
        details: Object.fromEntries(Object.entries(profile.details || {}).map(([key, value]) => [key, String(value).length])),
        relations: profile.relations?.length || 0,
        evidence: profile.evidence?.length || 0,
        summary: profile.summary,
      } : null,
    }
    console.log('[selftest]', JSON.stringify(report, null, 2))
    // Packaged builds have no console; also persist the report next to the fixture.
    await fs.writeFile(`${fixturePath}.result.json`, JSON.stringify(report, null, 2))
  } catch (error) {
    console.error('[selftest] failed:', error.message)
    try { await fs.writeFile(`${fixturePath}.result.json`, JSON.stringify({ ok: false, error: { message: error.message } }, null, 2)) } catch {}
    app.exit(1)
    return
  }
  app.exit(0)
}

ipcMain.handle('reader:selection-menu', (event, options = {}) => new Promise((resolve) => {
  // 自动化测试钩子：设置 MOYU_TEST_MENU_ACTION 时直接返回指定动作，不弹原生菜单。
  if (process.env.MOYU_TEST_MENU_ACTION) { resolve(process.env.MOYU_TEST_MENU_ACTION); return }
  let settled = false
  const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
  const template = []
  if (options.hasSelection !== false) {
    template.push(
      { label: '复制', role: 'copy', click: () => finish('copy') },
      { type: 'separator' },
      { label: '添加笔记 / 评论', click: () => finish('note') },
      { label: '字典百科（AI 解说这段文字）', click: () => finish('dictionary') },
    )
    if (options.canLookupEntity) {
      template.push(
        { label: '查看资料', enabled: Boolean(options.hasEntityProfile), click: () => finish('view-entity') },
        { label: options.hasEntityProfile ? '更新资料（仅检索已读内容）' : '生成资料（仅检索已读内容）', click: () => finish('lookup-entity') },
        { label: '关联到已有资料…', enabled: Boolean(options.hasAnyProfile), click: () => finish('link-entity') },
      )
    }
  }
  if (!template.length) return finish('cancel')
  const menu = Menu.buildFromTemplate(template)
  menu.on('menu-will-close', () => setTimeout(() => finish('cancel'), 0))
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) })
}))

ipcMain.on('window:minimize', () => mainWindow?.minimize())
ipcMain.on('window:maximize', () => {
  if (!mainWindow) return
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('window:close', () => mainWindow?.close())
ipcMain.on('window:pin', (_event, enabled) => {
  if (!mainWindow) return
  windowPinned = Boolean(enabled)
  mainWindow.setAlwaysOnTop(windowPinned, 'floating')
})

// 老板键是全局快捷键，按键可在书架页“快捷键”里修改（仅 F1–F12，字母会劫持系统输入）。
let bossAccelerator = null
function registerBossKey(key) {
  const accelerator = /^F([1-9]|1[0-2])$/.test(String(key || '')) ? String(key) : 'F10'
  if (bossAccelerator === accelerator) return
  if (bossAccelerator) { try { globalShortcut.unregister(bossAccelerator) } catch {} }
  bossAccelerator = null
  try {
    if (globalShortcut.register(accelerator, toggleBossKey)) bossAccelerator = accelerator
    else logEvent('boss-key-register-failed', accelerator)
  } catch (error) { logEvent('boss-key-register-error', String(error)) }
}
ipcMain.on('shortcuts:boss-key', (_event, key) => registerBossKey(key))

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    if (!mainWindow) return
    mainWindow.setSkipTaskbar(false)
    mainWindow.show()
    mainWindow.focus()
    bossHidden = false
    queueExternalFiles(argv)
  })
  app.whenReady().then(async () => {
    if (process.env.MOYU_PROFILE_SELFTEST) { await runProfileSelfTest(process.env.MOYU_PROFILE_SELFTEST); return }
    queueExternalFiles(process.argv.slice(1))
    await createWindow()
    registerBossKey('F10')
  })
}
app.on('open-file', (event, filePath) => {
  event.preventDefault()
  queueExternalFiles([filePath])
})
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(() => {})
})
