// Packaged Electron smoke test: starts the unpacked desktop app, not a browser.
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import JSZip from 'jszip'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const debugPort = 9231
const debugHttp = `http://127.0.0.1:${debugPort}`
const userData = path.join(root, '.e2e-packaged-reader-data')
const fixtureDir = path.join(userData, 'fixtures')
const txtPath = path.join(fixtureDir, 'packaged-reader-smoke.txt')
const epubPath = path.join(fixtureDir, 'packaged-reader-smoke.epub')
const shelfTxtPath = path.join(fixtureDir, 'packaged-shelf-second-book.txt')
const koreanEpubPath = path.join(path.dirname(root), '怪谈 完 .epub')
const executable = path.join(root, 'release', 'win-unpacked', '墨读阅读器.exe')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

if (!fs.existsSync(executable)) throw new Error(`找不到打包桌面程序：${executable}`)
fs.mkdirSync(fixtureDir, { recursive: true })
fs.writeFileSync(txtPath, '第1章 打包 TXT 验证\n\n打包后的 Electron 程序必须显示这段 TXT 正文，而不是白屏。\n')
fs.writeFileSync(shelfTxtPath, '第1章 书架交互验证\n\n用于验证书架空白点击和分类整理。\n')

const epub = new JSZip()
epub.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
epub.file('META-INF/container.xml', `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`)
epub.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="book-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">packaged-reader-smoke</dc:identifier><dc:title>打包 EPUB 验证</dc:title><dc:language>zh-CN</dc:language></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>`)
epub.file('OEBPS/chapter.xhtml', `<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>打包 EPUB 验证</title></head><body><h1>打包 EPUB 验证</h1><p>打包后的 Electron 程序必须显示这段 EPUB 正文，而不是白屏。</p></body></html>`)
fs.writeFileSync(epubPath, await epub.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.errors = [] }
  async connect() {
    this.ws = new WebSocket(this.url)
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject })
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') this.errors.push(JSON.stringify(message.params.args || []))
      if (message.method === 'Runtime.exceptionThrown') this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || 'renderer exception')
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${method} timed out`)) } }, 12_000)
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
    return result.result?.value
  }
}

async function connect() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const targets = await (await fetch(`${debugHttp}/json`)).json()
      const page = targets.find((item) => item.type === 'page' && item.url.startsWith('file://') && item.url.includes('index.html') && !item.url.includes('window='))
      if (page) { const session = new Cdp(page.webSocketDebuggerUrl); await session.connect(); await session.send('Runtime.enable'); return session }
    } catch {}
    await sleep(250)
  }
  throw new Error('打包桌面应用的渲染窗口未就绪')
}

async function waitFor(page, expression, label) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (await page.evaluate(expression)) return
    await sleep(250)
  }
  const state = await page.evaluate(`(async () => { const frame = document.querySelector('.epub-host iframe'); return { body: document.body.innerText.slice(0, 500), cards: document.querySelectorAll('.book-open, .v-face-book, .v-spine').length, url: location.href, epubHost: Boolean(document.querySelector('.epub-host')), frame: frame ? { src: frame.src, body: frame.contentDocument?.body?.innerText?.slice(0, 300) || '', html: frame.contentDocument?.documentElement?.outerHTML?.slice(0, 500) || '' } : null, stored: (await window.readerAPI.getStoredValue('reader:manual-books').catch(() => null))?.value?.map?.(({id, title, format, path}) => ({id, title, format, path})), hidden: (await window.readerAPI.getStoredValue('reader:hidden-books').catch(() => null))?.value } })()`).catch(() => ({}))
  throw new Error(`等待 ${label} 超时：${JSON.stringify(state)}`)
}

async function capture(page, name) {
  const image = await page.send('Page.captureScreenshot', { format: 'png' })
  if (image.data) fs.writeFileSync(path.join(root, 'output', name), Buffer.from(image.data, 'base64'))
}

async function mouseClick(page, point, button = 'left') {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) throw new Error('找不到桌面交互目标')
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, clickCount: 1 })
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, clickCount: 1 })
}

async function pointFor(page, expression, label) {
  const point = await page.evaluate(expression)
  if (!point) throw new Error(`找不到 ${label}`)
  return point
}

const centerOf = (selector) => `(() => { const element = ${selector}; if (!element) return null; const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } })()`

const launch = (dataDirectory) => spawn(executable, [`--remote-debugging-port=${debugPort}`], {
  cwd: path.dirname(executable),
  windowsHide: true,
  env: { ...process.env, MOYU_E2E: '1', MOYU_E2E_USER_DATA: dataDirectory },
})
const stop = (app) => {
  if (!app?.killed && app?.pid) {
    try { execFileSync('taskkill', ['/pid', String(app.pid), '/t', '/f'], { stdio: 'ignore' }) } catch {}
  }
}

let app
try {
  const fixtures = [
    { path: txtPath, format: 'TXT', expected: '打包后的 Electron 程序必须显示这段 TXT 正文' },
    { path: epubPath, format: 'EPUB', expected: '打包后的 Electron 程序必须显示这段 EPUB 正文' },
    // 用户实际提供的韩文 EPUB：目录标签为“001화”，用于回归章节识别。
    ...(fs.existsSync(koreanEpubPath) ? [{ path: koreanEpubPath, format: 'EPUB', expected: '', korean: true }] : []),
  ]
  for (const fixture of fixtures) {
    const dataDirectory = path.join(userData, fixture.korean ? 'korean-epub' : fixture.format.toLowerCase())
    fs.rmSync(dataDirectory, { recursive: true, force: true })
    app = launch(dataDirectory)
    let page = await connect()
    const book = await page.evaluate(`(async () => {
      const books = await window.readerAPI.describeBookPaths(${JSON.stringify([fixture.path])})
      const selected = books[0]
      await window.readerAPI.setStoredValue('reader:directory', '')
      await window.readerAPI.setStoredValue('reader:manual-books', selected ? [selected] : [])
      await window.readerAPI.setStoredValue('reader:hidden-books', [])
      await window.readerAPI.setStoredValue('reader:recent-books', [])
      await window.readerAPI.setStoredValue('reader:shelf-book-order', {})
      return selected ? { id: selected.id, title: selected.title, format: selected.format } : null
    })()`)
    if (!book || book.format !== fixture.format) throw new Error(`无法在打包桌面程序中载入 ${fixture.format} 测试书：${JSON.stringify(book)}`)
    await page.evaluate('location.reload()')
    await sleep(1000)
    page = await connect()
    await page.evaluate(`[...document.querySelectorAll('button')].find((item) => item.textContent.includes('打开完整书架') || /^全部 \\d+ 本/.test(item.textContent.trim()))?.click()`)
    await waitFor(page, `Boolean([...document.querySelectorAll('.book-open, .v-face-book, .v-spine')].find((item) => (item.textContent + ' ' + (item.getAttribute('aria-label') || '')).includes(${JSON.stringify(book.title)})))`, `${book.format} 书架卡片`)
    const clicked = await page.evaluate(`(() => {
      const card = [...document.querySelectorAll('.book-open, .v-face-book, .v-spine')].find((item) => (item.textContent + ' ' + (item.getAttribute('aria-label') || '')).includes(${JSON.stringify(book.title)}) )
      card?.click()
      return Boolean(card)
    })()`)
    if (!clicked) throw new Error(`无法点击 ${book.format} 书架卡片`)

    if (book.format === 'TXT') {
      await waitFor(page, `document.querySelector('.text-columns')?.innerText.includes(${JSON.stringify(fixture.expected)})`, 'TXT 正文')
      await capture(page, 'packaged-reader-txt.png')
    } else {
      if (fixture.korean) {
        await waitFor(page, "Boolean(document.querySelector('.reader-toolbar'))", '韩文 EPUB 阅读器工具栏')
        const openedToc = await page.evaluate(`(() => {
          const button = [...document.querySelectorAll('.reader-toolbar button')].find((item) => item.title === '目录')
          button?.click()
          return Boolean(button)
        })()`)
        if (!openedToc) {
          const toolbar = await page.evaluate("[...document.querySelectorAll('.reader-toolbar button')].map((item) => item.title)")
          throw new Error(`找不到目录按钮：${JSON.stringify(toolbar)}`)
        }
        await waitFor(page, "document.querySelectorAll('.toc-list button').length > 100", '韩文 EPUB 目录')
        const enteredChapter = await page.evaluate(`(() => {
          const chapter = [...document.querySelectorAll('.toc-list button')].find((item) => item.textContent.includes('001화'))
          chapter?.click()
          return Boolean(chapter)
        })()`)
        if (!enteredChapter) throw new Error('韩文 EPUB 目录中找不到 001화')
      }
      const bodyCheck = fixture.expected
        ? `frame?.contentDocument?.body?.innerText?.includes(${JSON.stringify(fixture.expected)})`
        : 'frame?.contentDocument?.body?.innerText?.trim().length > 30'
      await waitFor(page, `(() => { const frame = document.querySelector('.epub-host iframe'); return Boolean(${bodyCheck}) })()`, 'EPUB 正文')
      if (fixture.korean) {
        const started = await page.evaluate(`(() => {
          const button = document.querySelector('[title="翻译当前章节"]')
          button?.click()
          return Boolean(button)
        })()`)
        if (!started) throw new Error('找不到翻译当前章节按钮')
        await sleep(800)
        const translationError = await page.evaluate("document.querySelector('.translation-error')?.textContent || ''")
        if (translationError.includes('当前章节无法识别')) throw new Error(`韩文 EPUB 翻译单元识别失败：${translationError}`)
        console.log('PASS packaged Korean EPUB: TOC and translation unit resolved')
      } else await capture(page, 'packaged-reader-epub.png')
    }
    console.log(`PASS packaged ${book.format}: ${book.title}`)
    if (page.errors.length) throw new Error(`桌面渲染报错：${page.errors.join('\n')}`)
    stop(app)
    app = null
    await sleep(800)
  }
  const shelfDataDirectory = path.join(userData, 'shelf-interactions')
  fs.rmSync(shelfDataDirectory, { recursive: true, force: true })
  app = launch(shelfDataDirectory)
  let page = await connect()
  const shelfBooks = await page.evaluate(`(async () => {
    const books = await window.readerAPI.describeBookPaths(${JSON.stringify([txtPath, shelfTxtPath])})
    await window.readerAPI.setStoredValue('reader:directory', '')
    await window.readerAPI.setStoredValue('reader:manual-books', books)
    await window.readerAPI.setStoredValue('reader:hidden-books', [])
    await window.readerAPI.setStoredValue('reader:recent-books', [])
    await window.readerAPI.setStoredValue('reader:tags', {})
    await window.readerAPI.setStoredValue('reader:shelf-book-order', {})
    return books.map(({ id, title }) => ({ id, title }))
  })()`)
  if (shelfBooks.length !== 2) throw new Error('无法准备书架交互测试书')
  await page.evaluate('location.reload()')
  await sleep(1000)
  page = await connect()
  await mouseClick(page, await pointFor(page, centerOf(`[...document.querySelectorAll('button')].find((item) => item.textContent.includes('打开完整书架'))`), '打开完整书架按钮'))
  await waitFor(page, 'Boolean(document.querySelector(\'.library-catalog\'))', '管理书架')

  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('[aria-label="批量管理书籍"]')`), '批量管理按钮'))
  await waitFor(page, 'document.querySelectorAll(\'.book-select\').length === 2', '书籍多选控件')
  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('.book-select')`), '第一本书选择控件'))
  await waitFor(page, 'Boolean(document.querySelector(\'.selection-count\'))', '已选择一本书')
  const blankPoint = await pointFor(page, `(() => {
    const cards = [...document.querySelectorAll('.book-item')].map((item) => item.getBoundingClientRect())
    if (cards.length < 2) return null
    const left = cards[0]
    const right = cards[1]
    if (right.left - left.right < 4) return null
    return { x: (left.right + right.left) / 2, y: Math.min(left.top, right.top) + 4 }
  })()`, '两本书之间的空白区域')
  await mouseClick(page, blankPoint)
  await waitFor(page, '!document.querySelector(\'.selection-count\') && !document.querySelector(\'.reader-view\')', '空白点击取消多选且不打开书')

  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('[aria-label="批量管理书籍"]')`), '退出批量管理按钮'))
  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('[aria-label="新建分类"]')`), '顶部新建分类按钮'))
  await waitFor(page, 'Boolean(document.querySelector(\'[aria-label="新分类名称"]\'))', '顶部分类输入框')
  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('[aria-label="新分类名称"]')`), '顶部分类输入框'))
  await page.send('Input.insertText', { text: '顶部分类' })
  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('[aria-label="确认新建分类"]')`), '顶部分类确认按钮'))
  await waitFor(page, `[...document.querySelectorAll('.category-row button')].some((item) => item.textContent.includes('顶部分类'))`, '顶部新建的分类')

  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('.book-item')`), '第一本书卡片'), 'right')
  await waitFor(page, 'Boolean(document.querySelector(\'.book-manager\'))', '右键整理窗口')
  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('[aria-label="新建分类名称"]')`), '整理窗口分类输入框'))
  await page.send('Input.insertText', { text: '右键分类' })
  await mouseClick(page, await pointFor(page, centerOf(`document.querySelector('[aria-label="创建分类并归入"]')`), '整理窗口创建并归入按钮'))
  await waitFor(page, `document.querySelector('.category-tip')?.textContent.includes('右键分类') && [...document.querySelectorAll('.category-checklist button')].some((item) => item.textContent.includes('右键分类'))`, '右键创建并归类')
  await capture(page, 'packaged-shelf-interactions.png')
  if (page.errors.length) throw new Error(`桌面渲染报错：${page.errors.join('\n')}`)
  console.log('PASS packaged shelf: blank click, selection cancel, category creation, and right-click classification')
  stop(app)
  app = null
  console.log('Packaged TXT and EPUB desktop reader smoke test passed')
} finally {
  stop(app)
}
