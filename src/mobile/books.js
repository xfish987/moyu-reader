import JSZip from 'jszip'
import * as chardet from 'chardet'

const DB_NAME = 'moyu-mobile'
const DB_VERSION = 1
const LARGE_TEXT_THRESHOLD = 500_000
const TEXT_CHUNK_SIZE = 32_000
const decodedBooks = new Map()

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('本地数据库操作失败'))
  })
}

export function openMobileDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains('books')) database.createObjectStore('books', { keyPath: 'path' })
      if (!database.objectStoreNames.contains('state')) database.createObjectStore('state', { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开本地数据库'))
  })
}

async function storeRequest(storeName, mode, callback) {
  const database = await openMobileDatabase()
  try {
    const transaction = database.transaction(storeName, mode)
    const result = await callback(transaction.objectStore(storeName))
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve
      transaction.onerror = () => reject(transaction.error || new Error('本地数据库写入失败'))
      transaction.onabort = () => reject(transaction.error || new Error('本地数据库写入已取消'))
    })
    return result
  } finally {
    database.close()
  }
}

export const mobileState = {
  get: (key) => storeRequest('state', 'readonly', async (store) => requestResult(store.get(key))),
  set: (key, value) => storeRequest('state', 'readwrite', async (store) => requestResult(store.put({ key, value }))),
  entries: () => storeRequest('state', 'readonly', async (store) => requestResult(store.getAll())),
  replace: async (entries) => storeRequest('state', 'readwrite', (store) => {
    const requests = [requestResult(store.clear()), ...entries.map((entry) => requestResult(store.put(entry)))]
    return Promise.all(requests).then(() => true)
  }),
}

const getBookRecord = (path) => storeRequest('books', 'readonly', async (store) => requestResult(store.get(path)))
const putBookRecord = (record) => storeRequest('books', 'readwrite', async (store) => requestResult(store.put(record)))
const removeBookRecord = (path) => storeRequest('books', 'readwrite', async (store) => requestResult(store.delete(path)))

function bytesToBase64(bytes) {
  let binary = ''
  const step = 0x8000
  for (let index = 0; index < bytes.length; index += step) binary += String.fromCharCode(...bytes.subarray(index, index + step))
  return btoa(binary)
}

async function fingerprint(file) {
  const sampleSize = 64 * 1024
  const sizeBytes = new TextEncoder().encode(`${file.size}\0`)
  const first = new Uint8Array(await file.slice(0, Math.min(file.size, sampleSize)).arrayBuffer())
  const last = file.size > sampleSize * 2
    ? new Uint8Array(await file.slice(file.size - sampleSize).arrayBuffer())
    : new Uint8Array(await file.slice(first.length).arrayBuffer())
  const input = new Uint8Array(sizeBytes.length + first.length + last.length)
  input.set(sizeBytes)
  input.set(first, sizeBytes.length)
  input.set(last, sizeBytes.length + first.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input))
  return [...digest].map((value) => value.toString(16).padStart(2, '0')).join('').slice(0, 32)
}

function xmlElements(node, localName) {
  if (!node) return []
  const direct = [...node.getElementsByTagName(localName)]
  return direct.length ? direct : [...node.getElementsByTagNameNS('*', localName)]
}

function normalizeZipPath(value) {
  const parts = []
  String(value || '').replace(/\\/g, '/').split('/').forEach((part) => {
    if (!part || part === '.') return
    if (part === '..') parts.pop()
    else parts.push(part)
  })
  return parts.join('/')
}

function joinZipPath(base, relative) {
  return normalizeZipPath(`${base ? `${base}/` : ''}${relative || ''}`)
}

function zipEntry(zip, path) {
  const target = normalizeZipPath(path).toLocaleLowerCase()
  return Object.values(zip.files).find((entry) => normalizeZipPath(entry.name).toLocaleLowerCase() === target)
}

async function readEpubMetadata(file) {
  try {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const containerEntry = zipEntry(zip, 'META-INF/container.xml')
    if (!containerEntry) return {}
    const parser = new DOMParser()
    const container = parser.parseFromString(await containerEntry.async('text'), 'application/xml')
    const opfPath = xmlElements(container, 'rootfile')[0]?.getAttribute('full-path')
    const opfEntry = zipEntry(zip, opfPath)
    if (!opfEntry) return {}
    const opf = parser.parseFromString(await opfEntry.async('text'), 'application/xml')
    const metadata = xmlElements(opf, 'metadata')[0] || opf
    const title = xmlElements(metadata, 'title')[0]?.textContent?.replace(/\s+/g, ' ').trim()
    const author = xmlElements(metadata, 'creator')[0]?.textContent?.replace(/\s+/g, ' ').trim()
    const items = xmlElements(opf, 'item')
    const coverId = xmlElements(opf, 'meta').find((element) => element.getAttribute('name')?.toLowerCase() === 'cover')?.getAttribute('content')
    const coverItem = items.find((element) => element.getAttribute('properties')?.split(/\s+/).includes('cover-image'))
      || items.find((element) => coverId && element.getAttribute('id') === coverId)
      || items.find((element) => /cover/i.test(`${element.getAttribute('id') || ''} ${element.getAttribute('href') || ''}`) && /^image\//i.test(element.getAttribute('media-type') || ''))
    let cover = null
    if (coverItem) {
      const directory = normalizeZipPath(opfPath).split('/').slice(0, -1).join('/')
      const entry = zipEntry(zip, joinZipPath(directory, coverItem.getAttribute('href')))
      if (entry) {
        const bytes = await entry.async('uint8array')
        if (bytes.length <= 4_000_000) cover = `data:${coverItem.getAttribute('media-type') || 'image/jpeg'};base64,${bytesToBase64(bytes)}`
      }
    }
    return { title, author, cover }
  } catch {
    return {}
  }
}

async function describeFile(file) {
  const extension = file.name.toLocaleLowerCase().match(/\.(txt|epub)$/)?.[1]
  if (!extension) return null
  const contentFingerprint = await fingerprint(file)
  const epubMetadata = extension === 'epub' ? await readEpubMetadata(file) : {}
  const path = `mobile-book:${contentFingerprint}`
  const meta = {
    id: `book:${contentFingerprint}`,
    fingerprint: contentFingerprint,
    legacyId: path,
    path,
    title: epubMetadata.title || file.name.replace(/\.(txt|epub)$/i, ''),
    author: epubMetadata.author || '',
    hasCover: Boolean(epubMetadata.cover),
    format: extension.toUpperCase(),
    size: file.size,
    modifiedAt: file.lastModified || Date.now(),
  }
  await putBookRecord({ path, file, meta, cover: epubMetadata.cover || null })
  return meta
}

function pickFiles({ multiple = true, accept = '.txt,.epub,text/plain,application/epub+zip' } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = multiple
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    let settled = false
    const finish = (files = []) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(files)
    }
    const onFocus = () => setTimeout(() => finish([]), 500)
    window.addEventListener('focus', onFocus, { once: true })
    input.addEventListener('change', () => finish([...input.files]))
    input.click()
  })
}

function normalizeEncoding(value) {
  const key = String(value || '').toUpperCase().replace(/[-_]/g, '')
  const aliases = { UTF8: ['UTF-8', 'utf-8'], GB18030: ['GB18030', 'gb18030'], GBK: ['GB18030', 'gb18030'], GB2312: ['GB18030', 'gb18030'], BIG5: ['Big5', 'big5'], UTF16LE: ['UTF-16LE', 'utf-16le'], UTF16BE: ['UTF-16BE', 'utf-16be'] }
  return aliases[key]
}

function detectTextEncoding(bytes, forcedEncoding) {
  const forced = normalizeEncoding(forcedEncoding)
  if (forced) return forced
  const detected = chardet.detect(bytes.subarray(0, Math.min(bytes.length, 256_000))) || 'UTF-8'
  return normalizeEncoding(detected) || [detected, detected.toLowerCase()]
}

function decodeText(bytes, forcedEncoding) {
  const [detected, encoding] = detectTextEncoding(bytes, forcedEncoding)
  try { return { content: new TextDecoder(encoding).decode(bytes), detected } }
  catch { return { content: new TextDecoder('utf-8').decode(bytes), detected: 'UTF-8' } }
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

function textToc(content) {
  const toc = []
  let offset = 0
  for (const line of content.split(/\n/)) {
    const label = line.replace(/\r$/, '').trim()
    if (isChapterTitle(label)) toc.push({ label, offset })
    offset += line.length + 1
    if (toc.length >= 10_000) break
  }
  return toc
}

function chunkBounds(content, offset, direction = 'forward') {
  const anchor = Math.max(0, Math.min(content.length, Math.round(offset) || 0))
  const target = direction === 'backward' ? Math.max(0, anchor - 1) : anchor
  const index = Math.max(0, Math.floor(target / TEXT_CHUNK_SIZE))
  let start = index * TEXT_CHUNK_SIZE
  let end = Math.min(content.length, (index + 1) * TEXT_CHUNK_SIZE)
  if (start > 0) start = (content.indexOf('\n', start) + 1) || start
  if (end < content.length) end = (content.indexOf('\n', end) + 1) || end
  if (direction === 'backward' && start >= anchor && index > 0) return chunkBounds(content, (index - 1) * TEXT_CHUNK_SIZE, 'forward')
  return { start, end, anchor }
}

async function decodedRecord(path, forcedEncoding) {
  const cacheKey = `${path}:${forcedEncoding || 'auto'}`
  if (decodedBooks.has(cacheKey)) return decodedBooks.get(cacheKey)
  const record = await getBookRecord(path)
  if (!record?.file) throw new Error('本地书籍文件已不可用，请重新添加')
  const bytes = new Uint8Array(await record.file.arrayBuffer())
  const decoded = decodeText(bytes, forcedEncoding)
  const result = { ...decoded, toc: textToc(decoded.content) }
  decodedBooks.set(cacheKey, result)
  while (decodedBooks.size > 3) decodedBooks.delete(decodedBooks.keys().next().value)
  return result
}

export function createMobileBookApi() {
  return {
    chooseBooks: async () => (await Promise.all((await pickFiles()).map(describeFile))).filter(Boolean),
    chooseDirectory: async () => ({ directory: '', books: (await Promise.all((await pickFiles()).map(describeFile))).filter(Boolean) }),
    scanDirectory: async () => [],
    describeBookPaths: async () => [],
    relocateBook: async () => (await Promise.all((await pickFiles({ multiple: false })).map(describeFile))).filter(Boolean)[0] || null,
    getPathForFile: () => '',
    getEpubCover: async (path) => (await getBookRecord(path))?.cover || null,
    openBook: async (path, forcedEncoding) => {
      const record = await getBookRecord(path)
      if (!record?.file) throw new Error('本地书籍文件已不可用，请重新添加')
      if (record.meta?.format === 'EPUB') return { kind: 'epub', data: bytesToBase64(new Uint8Array(await record.file.arrayBuffer())) }
      const decoded = await decodedRecord(path, forcedEncoding)
      if (record.file.size <= LARGE_TEXT_THRESHOLD) return { kind: 'text', content: decoded.content, encoding: decoded.detected }
      const bounds = chunkBounds(decoded.content, 0)
      return { kind: 'text-large', content: decoded.content.slice(bounds.start, bounds.end), start: bounds.start, end: bounds.end, total: decoded.content.length, encoding: decoded.detected, anchor: 0 }
    },
    readTextChunk: async (path, offset, direction) => {
      const decoded = await decodedRecord(path)
      const bounds = chunkBounds(decoded.content, offset, direction)
      return { content: decoded.content.slice(bounds.start, bounds.end), start: bounds.start, end: bounds.end, total: decoded.content.length, encoding: decoded.detected, anchor: Math.max(0, bounds.anchor - bounds.start) }
    },
    getTextToc: async (path) => (await decodedRecord(path)).toc,
    searchText: async (path, query, options = {}) => {
      const content = (await decodedRecord(path)).content
      const queries = (Array.isArray(query) ? query : [query]).map(String).filter(Boolean)
      const limit = Math.max(1, Math.min(5000, Number(options.limit) || 5000))
      const minOffset = Math.max(0, Number(options.minOffset) || 0)
      const results = []
      for (const needle of queries) {
        let position = minOffset
        while (results.length < limit) {
          const found = content.indexOf(needle, position)
          if (found < 0) break
          const start = Math.max(content.lastIndexOf('\n', found) + 1, found - 90)
          const endBreak = content.indexOf('\n', found + needle.length)
          const end = Math.min(endBreak < 0 ? content.length : endBreak, found + needle.length + 120)
          results.push({ label: content.slice(start, end).replace(/[\r\n]+/g, ' ').trim(), offset: start, matchOffset: found })
          position = found + Math.max(1, needle.length)
        }
      }
      results.sort((a, b) => a.matchOffset - b.matchOffset)
      return { results, truncated: results.length >= limit }
    },
    deleteSource: async (path) => {
      decodedBooks.delete(path)
      await removeBookRecord(path)
      return true
    },
  }
}
