// Desktop-only smoke check. Connects to the running Electron renderer through
// Electron's debugging endpoint; it does not launch or control a web browser.
const CDP_HTTP = process.env.CDP_HTTP || 'http://127.0.0.1:9222'
const samplePaths = process.argv.slice(2)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map() }
  async connect() {
    this.ws = new WebSocket(this.url)
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject })
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result)
    }
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    return response.result?.value
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

async function connect() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
    const target = targets.find((item) => item.type === 'page' && (item.url === 'http://127.0.0.1:5173/' || (item.url.startsWith('file://') && item.url.includes('index.html') && !item.url.includes('window='))))
    if (target) { const page = new Cdp(target.webSocketDebuggerUrl); await page.connect(); return page }
    await sleep(200)
  }
  throw new Error('Electron renderer not found')
}

const check = (name, pass, detail = '') => {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`)
  if (!pass) process.exitCode = 1
}

if (samplePaths.length < 2) throw new Error('Pass at least two TXT/EPUB sample paths')
let page = await connect()
const seeded = await page.evaluate(`(async () => {
  const books = await window.readerAPI.describeBookPaths(${JSON.stringify(samplePaths)})
  await window.readerAPI.setStoredValue('reader:directory', '')
  await window.readerAPI.setStoredValue('reader:manual-books', books)
  await window.readerAPI.setStoredValue('reader:recent-books', [])
  await window.readerAPI.setStoredValue('reader:shelf-book-order', {})
  await window.readerAPI.setStoredValue('reader:wheel-mode', 'scroll')
  return books.map(({ id, title }) => ({ id, title }))
})()`)
check('测试书籍已载入桌面应用', seeded.length >= 2, `${seeded.length} 本`)
await page.evaluate('location.reload()').catch(() => {})
await sleep(1200)
page = await connect()

const reorder = await page.evaluate(`(async () => {
  const items = [...document.querySelectorAll('.v-shelf-row')].find((row) => row.querySelector('.v-shelf-heading strong')?.textContent.trim() === '全部')?.querySelectorAll('.v-face-book[draggable="true"], .v-spine[draggable="true"]')
  if (!items || items.length < 2) return { ok: false, reason: '可拖动书籍不足', rows: [...document.querySelectorAll('.v-shelf-row')].map((row) => row.textContent.trim().slice(0, 40)), draggable: document.querySelectorAll('[draggable="true"]').length, body: document.body.innerText.slice(0, 120) }
  const source = items[0]
  const target = items[1]
  const transfer = new DataTransfer()
  source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const rect = target.getBoundingClientRect()
  target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.right - 1 }))
  await new Promise((resolve) => setTimeout(resolve, 50))
  const marker = target.dataset.dropPosition
  target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: rect.right - 1 }))
  await new Promise((resolve) => setTimeout(resolve, 350))
  const order = await window.readerAPI.getStoredValue('reader:shelf-book-order')
  return { ok: Array.isArray(order?.value?.__all_books__) && order.value.__all_books__.length >= 2, marker, order: order?.value?.__all_books__ }
})()`)
check('书脊首页显示拖放位置', Boolean(reorder.marker), reorder.marker || `${reorder.reason} ${JSON.stringify(reorder.rows || [])} draggable=${reorder.draggable} ${reorder.body || ''}`)
check('书籍拖放顺序已持久化', Boolean(reorder.ok), JSON.stringify(reorder.order || []))

const txtIndex = seeded.findIndex((book, index) => samplePaths[index].toLowerCase().endsWith('.txt'))
if (txtIndex >= 0) {
  await page.evaluate(`document.querySelectorAll('.v-face-book, .v-spine')[${txtIndex}]?.click()`)
  await sleep(1200)
  const navigation = await page.evaluate(`(async () => {
    document.querySelector('.reader-actions button[title="目录"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 100))
    const chapters = [...document.querySelectorAll('.toc-list button')]
    const target = chapters[Math.min(9, chapters.length - 1)]
    const label = target?.textContent?.trim()
    target?.click()
    await new Promise((resolve) => setTimeout(resolve, 4000))
    const activeLayer = document.querySelector('.large-text-layer.is-active') || document
    const viewport = activeLayer.querySelector('.text-viewport.is-scroll')
    const heading = [...activeLayer.querySelectorAll('.text-columns h2')].find((item) => item.textContent.trim().includes(label || ''))
    if (!viewport || !heading) return { ok: false, count: chapters.length, label }
    const gap = heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    viewport.scrollTop += 17
    await new Promise((resolve) => setTimeout(resolve, 180))
    const x = viewport.getBoundingClientRect().left + 40
    const y = viewport.getBoundingClientRect().top + 2
    const range = document.caretRangeFromPoint(x, y)
    let clipped = null
    if (range?.startContainer?.nodeType === Node.TEXT_NODE) {
      const glyph = document.createRange()
      const offset = Math.min(range.startOffset, Math.max(0, range.startContainer.length - 1))
      glyph.setStart(range.startContainer, offset)
      glyph.setEnd(range.startContainer, Math.min(range.startContainer.length, offset + 1))
      clipped = glyph.getClientRects()[0]?.top < viewport.getBoundingClientRect().top - .5
    }
    const viewportRect = viewport.getBoundingClientRect()
    const walker = document.createTreeWalker(activeLayer.querySelector('.text-columns'), NodeFilter.SHOW_TEXT)
    const visibleRects = []
    let textNode = walker.nextNode()
    while (textNode) {
      const textRange = document.createRange()
      textRange.selectNodeContents(textNode)
      for (const rect of textRange.getClientRects()) if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) visibleRects.push({ top: rect.top, bottom: rect.bottom })
      textNode = walker.nextNode()
    }
    const clippedRect = visibleRects.find((rect) => rect.top < viewportRect.bottom && rect.bottom > viewportRect.bottom + .5)
    return { ok: heading.textContent.includes(label), label, heading: heading.textContent.trim(), gap, clipped, bottomClipped: Boolean(clippedRect), clippedRect, viewportBottom: viewportRect.bottom, guard: viewport.style.getPropertyValue('--scroll-bottom-guard'), background: getComputedStyle(activeLayer.querySelector('.text-columns')).backgroundColor }
  })()`)
  check('目录点击精确显示章节标题', Boolean(navigation.ok), `${navigation.label || ''} -> ${navigation.heading || '未显示'}`)
  check('章节标题落在阅读区顶部', navigation.gap >= 0 && navigation.gap <= 90, `顶部间距 ${Math.round(navigation.gap || -1)}px`)
  check('滚动停止后首行完整', navigation.clipped === false, `clipped=${navigation.clipped}`)
  check('普通窗口末行完整', navigation.bottomClipped === false, `clipped=${navigation.bottomClipped} guard=${navigation.guard} bottom=${navigation.viewportBottom} rect=${JSON.stringify(navigation.clippedRect || {})}`)
  check('正文背景保持透明', navigation.background === 'rgba(0, 0, 0, 0)', navigation.background)
  const immersive = await page.evaluate(`(async () => {
    document.querySelector('button[title="沉浸阅读 (F11)"]')?.click()
    await new Promise((resolve) => setTimeout(resolve, 350))
    const activeLayer = document.querySelector('.large-text-layer.is-active') || document
    const viewport = activeLayer.querySelector('.text-viewport.is-scroll')
    const heading = [...activeLayer.querySelectorAll('.text-columns h2')].find((item) => item.textContent.includes(${JSON.stringify('第十章 甲骨老棺')}))
    if (!viewport || !heading) return { ok: false }
    const padding = parseFloat(getComputedStyle(activeLayer.querySelector('.text-columns')).paddingTop) || 0
    viewport.scrollTop += heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top - padding
    await new Promise((resolve) => setTimeout(resolve, 180))
    const gap = heading.getBoundingClientRect().top - viewport.getBoundingClientRect().top
    viewport.scrollTop += 17
    await new Promise((resolve) => setTimeout(resolve, 180))
    const viewportRect = viewport.getBoundingClientRect()
    const walker = document.createTreeWalker(activeLayer.querySelector('.text-columns'), NodeFilter.SHOW_TEXT)
    const visibleTops = []
    let bottomClipped = false
    let node = walker.nextNode()
    while (node) {
      const textRange = document.createRange()
      textRange.selectNodeContents(node)
      for (const rect of textRange.getClientRects()) if (rect.bottom > viewportRect.top && rect.top < viewportRect.bottom) {
        visibleTops.push(rect.top)
        if (rect.bottom > viewportRect.bottom + .5) bottomClipped = true
      }
      node = walker.nextNode()
    }
    const clipped = visibleTops.length ? Math.min(...visibleTops) < viewportRect.top - .5 : null
    return { ok: true, gap, padding, clipped, bottomClipped, guard: viewport.style.getPropertyValue('--scroll-bottom-guard'), viewportBottom: viewportRect.bottom }
  })()`)
  check('沉浸模式章节标题按当前上边距置顶', immersive.ok && Math.abs(immersive.gap - immersive.padding) <= 2, `间距 ${Math.round(immersive.gap || -1)}px / 期望 ${Math.round(immersive.padding || -1)}px`)
  check('沉浸模式滚动停止后首行完整', immersive.clipped === false, `clipped=${immersive.clipped}`)
  check('沉浸模式末行完整', immersive.bottomClipped === false, `clipped=${immersive.bottomClipped} guard=${immersive.guard} bottom=${immersive.viewportBottom}`)
}

process.exit(process.exitCode || 0)
