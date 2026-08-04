const { app, BrowserWindow, dialog, globalShortcut, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs/promises')
const chardet = require('chardet')
const iconv = require('iconv-lite')
const JSZip = require('jszip')
const { DOMParser } = require('@xmldom/xmldom')

let mainWindow
let bossHidden = false
let windowPinned = false
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
])
let storeCache = null
let storeWriteQueue = Promise.resolve()

const storeDirectory = () => path.join(app.getPath('userData'), 'data')
const storeFile = () => path.join(storeDirectory(), STORE_FILE_NAME)
const backupDirectory = () => path.join(storeDirectory(), 'backups')

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

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
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

  mainWindow.once('ready-to-show', () => mainWindow.show())
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
  const epubMetadata = extension === '.epub' ? await readEpubMetadata(filePath, stats) : {}
  return {
    id: filePath,
    path: filePath,
    title: epubMetadata.title || path.basename(filePath, extension),
    author: epubMetadata.author || '',
    hasCover: Boolean(epubMetadata.cover),
    format: extension.slice(1).toUpperCase(),
    size: stats.size,
    modifiedAt: stats.mtimeMs,
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
  const needleText = String(query || '').trim()
  if (!cached || !needleText) return []
  const needle = iconv.encode(needleText, cached.encoding)
  const results = []
  let position = 0
  while (results.length < 100) {
    const found = cached.data.indexOf(needle, position)
    if (found < 0) break
    const lineStart = paragraphBoundary(cached.data, found, 'backward', cached.encoding)
    const lineEnd = paragraphBoundary(cached.data, found + needle.length, 'forward', cached.encoding)
    const label = iconv.decode(cached.data.subarray(lineStart, lineEnd), cached.encoding).replace(/[\r\n\u0000]+/g, ' ').trim()
    results.push({ label: label.slice(0, 180), offset: lineStart })
    position = found + Math.max(1, needle.length)
  }
  return results
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
  app.on('second-instance', () => {
    if (!mainWindow) return
    mainWindow.setSkipTaskbar(false)
    mainWindow.show()
    mainWindow.focus()
    bossHidden = false
  })
  app.whenReady().then(() => {
    createWindow()
    globalShortcut.register('F10', toggleBossKey)
  })
}
app.on('will-quit', () => globalShortcut.unregisterAll())
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
