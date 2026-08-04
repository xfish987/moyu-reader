const { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, net, safeStorage, screen, shell } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const { createHash, randomUUID } = require('crypto')
const chardet = require('chardet')
const iconv = require('iconv-lite')
const JSZip = require('jszip')
const { DOMParser } = require('@xmldom/xmldom')
const { collectModelCatalog } = require('./modelCatalog.cjs')

let mainWindow
let bossHidden = false
let windowPinned = false
let pendingExternalFiles = []
let windowBoundsTimer = null
let closingWindow = false
const hasSingleInstanceLock = app.requestSingleInstanceLock()
const largeTextCache = new Map()
const epubMetadataCache = new Map()
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
  'reader:last-book',
  'reader:book-status',
  'reader:bookmarks',
  'reader:book-metadata',
  'reader:window-bounds',
  'reader:entity-profiles',
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

function selectSummaryExcerpts(items, limit = 48, maxChars = 32000) {
  const unique = []
  const seen = new Set()
  for (const item of items) {
    const fingerprint = item.text.replace(/[\s\p{P}\p{S}]+/gu, '').slice(0, 260)
    if (!fingerprint || seen.has(fingerprint)) continue
    seen.add(fingerprint)
    unique.push(item)
  }
  const picked = unique.length <= limit ? unique : [
    ...unique.slice(0, Math.ceil(limit * 0.3)),
    ...Array.from({ length: Math.floor(limit * 0.4) }, (_, index) => unique[Math.floor((index + 1) * unique.length / (Math.floor(limit * 0.4) + 1))]).filter(Boolean),
    ...unique.slice(-Math.floor(limit * 0.3)),
  ]
  const result = []
  let chars = 0
  for (const item of picked) {
    const size = item.text.length + (item.chapter?.length || 0) + 20
    if (chars + size > maxChars) continue
    chars += size
    result.push(item)
  }
  return result
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
        const delta = parsed?.choices?.[0]?.delta?.content ?? parsed?.choices?.[0]?.message?.content ?? parsed?.text ?? ''
        emit(Array.isArray(delta) ? delta.map((part) => part?.text || '').join('') : String(delta || ''))
      } catch {}
    }
  }
  if (streamed) return { choices: [{ message: { content: raw }, finish_reason: null }] }
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
  })
}

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

ipcMain.handle('books:search-text', async (_event, { filePath, query }) => {
  const cached = largeTextCache.get(filePath)
  const queries = (Array.isArray(query) ? query : [query]).map((value) => String(value || '').trim()).filter(Boolean)
  if (!cached || !queries.length) return { results: [], truncated: false }
  const results = []
  const limit = 5000
  const seen = new Set()
  let truncated = false
  for (const needleText of queries) {
    const needle = iconv.encode(needleText, cached.encoding)
    let position = 0
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

ipcMain.handle('ai:summarize-entity', async (event, input) => {
  const config = await loadAiConfig()
  const provider = config.providers.find((item) => item.id === (input?.providerId || config.activeProviderId))
  if (!provider) return { ok: false, error: { stage: 'setup', status: 0, code: 'PROVIDER_NOT_FOUND', message: '请先设置并选择 AI 供应商' } }
  const model = String(input?.model || provider.model || '').trim().slice(0, 160)
  if (!model) return { ok: false, error: { stage: 'setup', status: 0, code: 'MODEL_REQUIRED', message: '请选择或填写模型' } }
  const name = String(input?.name || '').trim().slice(0, 80)
  const excerpts = (Array.isArray(input?.excerpts) ? input.excerpts : []).slice(0, 160).map((item, index) => ({
    order: Number(item?.order) || index + 1,
    chapter: String(item?.chapter || '').slice(0, 120),
    text: String(item?.text || '').replace(/\s+/g, ' ').trim().slice(0, 900),
  })).filter((item) => item.text)
  const knownEntities = (Array.isArray(input?.knownEntities) ? input.knownEntities : []).slice(0, 120).map((item) => ({
    name: String(item?.name || '').slice(0, 80),
    aliases: (Array.isArray(item?.aliases) ? item.aliases : []).slice(0, 30).map((value) => String(value).slice(0, 80)),
    distinctFrom: (Array.isArray(item?.distinctFrom) ? item.distinctFrom : []).slice(0, 30).map((value) => String(value).slice(0, 80)),
    identityLocked: Boolean(item?.identityLocked),
  })).filter((item) => item.name)
  if (!name || !excerpts.length) return { ok: false, error: { stage: 'search', status: 0, code: 'NO_PRIOR_EVIDENCE', message: '在当前阅读位置之前没有找到可用于总结的相关片段' } }
  // Deduplicate frequent-name hits and sample first/latest/middle chapters before sending.
  const compactExcerpts = selectSummaryExcerpts(excerpts)
  if (!compactExcerpts.length) return { ok: false, error: { stage: 'summary', status: 0, code: 'SUMMARY_CONTEXT_TOO_LARGE', message: '已读依据过大，请缩小检索范围后重试' } }
  const controller = new AbortController()
  let timedOut = false
  let timeout = setTimeout(() => { timedOut = true; controller.abort() }, 30000)
  // 资料卡优先快速完成；即使供应商保存了更大的通用输出上限，这类短回顾也不超过 2400 token。
  const requestedMaxTokens = Math.max(256, Math.min(2400, Number(input?.maxTokens ?? provider.maxTokens) || 1600))
  const outputMaxChars = Math.max(1200, Math.min(12000, Math.floor(requestedMaxTokens * 1.5)))
  try {
    let tokenParameter = provider.tokenParameter === 'max_tokens' ? 'max_tokens' : 'max_completion_tokens'
    const messages = [
          { role: 'system', content: '你是一个严格防剧透的阅读回顾助手。仅依据用户提供的已读片段工作，禁止外部知识、后文知识和无证据推测。识别所选名称属于人物、物品、地点、组织、能力或事件。别名只有在片段存在明确同一性证据时才能关联；名字相似或同姓不是证据。用户人工确认的同一/不同规则拥有最高优先级，绝不能推翻。资料卡要让久未阅读的人立即想起对象：人物必须详细说明与主角的关系、何时如何相识、与其他人的关系、身份和所做之事；若尚未与主角相识，明确写出并交代其当前关系网。物品必须说明归属、若属于主角则何时如何获得、用途与能力。地点必须说明位置、性质、内部有什么、相关人物势力和已发生事件。任一项在已读片段中无证据时，必须写“截至当前阅读进度尚未交代”，不得补全。同时提取有明确证据的关联：地点位于国家/城市、人物隶属势力、物品归属某人等。关联目标使用书中明确名称，每条只表达一个事实。只输出合法 JSON，不要 Markdown 代码围栏，结构为：{"type":"人物|物品|地点|组织|能力|事件|未分类","canonicalName":"主名称","aliases":["已确认别名"],"summary":"用一段话说明这是谁或什么，以及为何重要","details":{"protagonistRelation":"人物与主角关系","firstEncounter":"人物与主角初识时间和经过","relationships":"人物关系网","identity":"人物身份与行动","owner":"物品归属","acquisition":"物品获得时间与经过","purpose":"物品用途能力","location":"地点位置与性质","features":"地点内容与特点","relatedPeople":"地点相关人物势力","relatedEvents":"地点已发生事件"},"relations":[{"relation":"located_in|owned_by|member_of|contains|owns|has_member|related_to|learned_from","targetName":"另一对象的名称","label":"适合读者的简短关系词","note":"已读内的关系说明"}],"evidence":[{"chapter":"章节标签","text":"简短依据"}],"identityConfidence":"high|medium|low"}。details 只保留符合类型的字段。' },
          { role: 'system', content: `输出长度控制：本次允许的最大输出 token 为 ${requestedMaxTokens}，总中文字符建议控制在 600-${outputMaxChars} 以内。必须尽快完成合法 JSON；summary 建议 120–320 个中文字符，details 每个有值字段建议 40–260 个中文字符，relations 最多 16 条，evidence 最多 5 条。资料不足时优先保留人物关系/物品归属/地点位置等核心字段，不要重复片段原文；如果接近上限，先压缩措辞而不是截断 JSON。` },
          { role: 'user', content: `要回顾的名称：${name}\n\n本书已有身份规则（identityLocked=true 为用户人工确认，distinctFrom 表示明确不是同一对象）：\n${JSON.stringify(knownEntities)}\n\n已读范围内共找到 ${Number(input?.totalMatches) || excerpts.length} 处，本次提供 ${compactExcerpts.length} 处：\n\n${compactExcerpts.map((item) => `[${item.chapter || `片段 ${item.order}`}] ${item.text}`).join('\n\n')}` },
        ]
    const execute = (parameter) => requestProviderStreaming(provider, 'chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, [parameter]: requestedMaxTokens, stream: true, messages }),
    }, 'summary', controller.signal,
      (text) => event.sender.send('ai:summary-progress', { phase: 'first-chunk', text: text.slice(0, 80) }),
      () => { if (timeout) { clearTimeout(timeout); timeout = null }; event.sender.send('ai:summary-progress', { phase: 'stream-started' }) })
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
    if (finishReason === 'length') return { ok: false, partial: summary, error: { stage: 'summary', status: 200, code: 'OUTPUT_TRUNCATED', message: '资料总结达到最大输出长度，未保存不完整卡片；请提高输出长度或更换模型后重试', finishReason } }
    let profile
    try {
      const parsed = JSON.parse(summary.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''))
      profile = {
        type: String(parsed?.type || '未分类').slice(0, 20),
        canonicalName: String(parsed?.canonicalName || name).trim().slice(0, 80) || name,
        aliases: (Array.isArray(parsed?.aliases) ? parsed.aliases : []).map((value) => String(value).trim().slice(0, 80)).filter(Boolean).slice(0, 30),
        summary: String(parsed?.summary || '').trim().slice(0, 4000),
        details: Object.fromEntries(Object.entries(parsed?.details && typeof parsed.details === 'object' ? parsed.details : {}).slice(0, 12).map(([key, value]) => [String(key).slice(0, 40), String(value || '').trim().slice(0, 1600)]).filter(([, value]) => value)),
        relations: (Array.isArray(parsed?.relations) ? parsed.relations : []).slice(0, 40).map((item) => ({ relation: String(item?.relation || 'related_to').slice(0, 40), targetName: String(item?.targetName || '').trim().slice(0, 80), label: String(item?.label || '').trim().slice(0, 40), note: String(item?.note || '').trim().slice(0, 500) })).filter((item) => item.targetName),
        evidence: (Array.isArray(parsed?.evidence) ? parsed.evidence : []).slice(0, 8).map((item) => ({ chapter: String(item?.chapter || '').slice(0, 120), text: String(item?.text || '').slice(0, 500) })),
        identityConfidence: ['high', 'medium', 'low'].includes(parsed?.identityConfidence) ? parsed.identityConfidence : 'low',
      }
      if (!profile.summary) profile.summary = summary
    } catch {
      profile = { type: '未分类', canonicalName: name, aliases: [], summary, evidence: [], identityConfidence: 'low' }
    }
    if (!profile.aliases.includes(name) && profile.canonicalName !== name) profile.aliases.unshift(name)
    return { ok: true, profile, summary: profile.summary, finishReason, usage: response?.usage || null, providerId: provider.id, providerName: provider.name, model }
  } catch (error) {
    return { ok: false, error: error.aiError || { stage: 'summary', status: 0, code: timedOut ? 'REQUEST_TIMEOUT' : (error.code || 'UNKNOWN_ERROR'), message: timedOut ? '供应商在 30 秒内没有返回资料，请减少已读依据、降低输出长度或检查供应商连接' : sanitizeAiErrorText(error.message) } }
  } finally { if (timeout) clearTimeout(timeout) }
})

ipcMain.handle('reader:selection-menu', (event, options = {}) => new Promise((resolve) => {
  let settled = false
  const finish = (value) => { if (!settled) { settled = true; resolve(value) } }
  const template = []
  if (options.hasSelection !== false) {
    template.push(
      { label: '复制', role: 'copy', click: () => finish('copy') },
      { type: 'separator' },
      { label: '添加笔记 / 评论', click: () => finish('note') },
    )
    if (options.canLookupEntity) template.push({ label: '查看资料（仅检索已读内容）', click: () => finish('lookup-entity') })
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
    queueExternalFiles(process.argv.slice(1))
    await createWindow()
    globalShortcut.register('F10', toggleBossKey)
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
