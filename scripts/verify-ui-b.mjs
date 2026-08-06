// UI B smoke/visual check against a running Electron window with --remote-debugging-port=9222.
import fs from 'node:fs'

const output = 'output/playwright'
fs.mkdirSync(output, { recursive: true })
const sampleFiles = ['D:/tools/book/book/北宋穿越指南.epub']
const requestedCount = Math.max(1, Number.parseInt(process.argv[2] || '30', 10) || 30)
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
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    }
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Runtime evaluation failed')
    return result?.result?.value
  }
  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
  }
}

async function connectMain() {
  const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
  const target = targets.find((item) => item.type === 'page' && item.url.includes('127.0.0.1:5173'))
  if (!target) throw new Error('没有找到 UI B 主窗口 CDP 页面')
  const page = new Cdp(target.webSocketDebuggerUrl)
  await page.connect()
  return page
}

let page = await connectMain()
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
console.log('connected')
const filePath = sampleFiles[0] || 'D:/tools/book/book/北宋穿越指南.epub'
console.log('describing')
const count = await page.evaluate(`(async () => {
  const sourceBooks = await window.readerAPI.describeBookPaths(${JSON.stringify(sampleFiles.length ? sampleFiles : [filePath])})
  const books = Array.from({ length: ${requestedCount} }, (_, index) => {
    const source = sourceBooks[index % sourceBooks.length]
    return { ...source, id: source.id + '-layout-' + index, title: index < sourceBooks.length ? source.title : source.title + ' · ' + (index + 1) }
  })
  await window.readerAPI.setStoredValue('reader:directory', '')
  await window.readerAPI.setStoredValue('reader:manual-books', books)
  await window.readerAPI.setStoredValue('reader:last-book', '')
  await window.readerAPI.setStoredValue('reader:appearance-v2', null)
  return books.length
})()`)
console.log('described', count)
await page.evaluate('location.reload()').catch(() => {})
console.log('reload requested')
await sleep(2400)
page = await connectMain()
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
await page.evaluate("window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))")
await sleep(350)
console.log('reconnected')
await page.screenshot(`${output}/ui-b-library-${requestedCount}.png`)
console.log('library shot')
const snapshot = await page.evaluate(`({
  title: document.title,
  books: document.querySelectorAll('.v-spine').length,
  shell: Boolean(document.querySelector('.ui-b .v-bookshelf-scene')),
  background: (() => { const el = document.querySelector('.b-background-image'); const style = el ? getComputedStyle(el) : null; return style ? { image: style.backgroundImage.slice(0, 90), opacity: style.opacity } : null })(),
  errors: window.__uiBErrors || 0,
})`)
const beforeBooks = await page.evaluate("[...document.querySelectorAll('.v-spine')].map((el) => { const r=el.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom } })")
const hoverIndex = await page.evaluate("Math.max(0, Math.min(document.querySelectorAll('.v-spine').length - 1, Math.floor((document.querySelector('.v-shelf-row')?.dataset.bookCount || 1) / 2)))")
await page.evaluate(`document.querySelectorAll('.v-spine')[${hoverIndex}]?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`)
await sleep(500)
await page.screenshot(`${output}/ui-b-book-expanded-${requestedCount}.png`)
const expandedMetrics = await page.evaluate("(() => { const el=document.querySelector('.v-spine.is-active'); const r=el?.getBoundingClientRect(); const rects=[...document.querySelectorAll('.v-spine')].map((item) => { const x=item.getBoundingClientRect(); return { left:x.left, right:x.right, top:x.top, bottom:x.bottom } }); return { className: el?.className, width: r?.width, height: r?.height, openWidth: el?.style.getPropertyValue('--open-width'), transform: getComputedStyle(el).transform, volumeTransform: getComputedStyle(el?.querySelector('.v-book-volume')).transform, rects } })()")
const yMovements = expandedMetrics.rects.map((rect, index) => ({ index, top: Math.abs(rect.top - beforeBooks[index].top), bottom: Math.abs(rect.bottom - beforeBooks[index].bottom) })).filter((item) => item.top > 0.5 || item.bottom > 0.5)
const layout = { noOverlap: expandedMetrics.rects.every((rect, index, items) => !items[index + 1] || Math.abs(rect.bottom - items[index + 1].bottom) > 1 || rect.right <= items[index + 1].left + 0.5), maxYMovement: yMovements.length ? Math.max(...yMovements.flatMap((item) => [item.top, item.bottom])) : 0, yMovements }
console.log('expanded metrics', expandedMetrics, layout)
await page.evaluate("document.querySelector('.v-spine.is-active')?.click()")
console.log('open requested')
await sleep(2200)
await page.screenshot(`${output}/ui-b-reader-${requestedCount}.png`)
console.log('reader shot')
const reader = await page.evaluate(`({ reader: Boolean(document.querySelector('.reader-view')), paper: Boolean(document.querySelector('.text-columns, .epub-host')), toolbar: Boolean(document.querySelector('.reader-toolbar')) })`)
await page.evaluate("document.querySelector('.reader-toolbar .back')?.click()").catch(() => {})
await sleep(500)
await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
await sleep(300)
const narrow = await page.evaluate(`(() => {
  const overflow = [...document.querySelectorAll('button, [role="button"], .v-bottom-dock span')].filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map((el) => ({ text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40), width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight }))
  return { viewport: [innerWidth, innerHeight], overflow }
})()`)
await page.screenshot(`${output}/ui-b-home-mobile-${requestedCount}.png`)
console.log(JSON.stringify({ scanned: count, library: snapshot, expanded: { width: expandedMetrics.width, openWidth: expandedMetrics.openWidth, volumeTransform: expandedMetrics.volumeTransform, ...layout }, reader, narrow }, null, 2))
process.exit(0)
