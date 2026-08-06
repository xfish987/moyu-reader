// 窄窗管理视图回归：视图互切、按钮溢出、滚动恢复。
import fs from 'node:fs'

const output = 'output/playwright'
fs.mkdirSync(output, { recursive: true })
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

const targets = await (await fetch('http://127.0.0.1:9222/json')).json()
const target = targets.find((item) => item.type === 'page' && item.url.includes('127.0.0.1:5173'))
if (!target) throw new Error('没有找到 UI B 主窗口 CDP 页面')
const page = new Cdp(target.webSocketDebuggerUrl)
await page.connect()

// 窄窗进入管理视图
await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
await page.evaluate(`[...document.querySelectorAll('.v-bottom-dock button')].find((b) => b.textContent.includes('管理视图'))?.click()`)
await sleep(700)

const library = await page.evaluate(`(() => {
  const view = document.querySelector('.shelf-view') ? 'library' : 'virtual'
  const buttons = [...document.querySelectorAll('.shelf-actions .shelf-book-command')].map((el) => {
    const label = el.querySelector('.command-label')
    return { text: label?.textContent || '', width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight, labelDisplay: label ? getComputedStyle(label).display : 'none' }
  })
  const overflow = [...document.querySelectorAll('.shelf-view button, .shelf-view input, .shelf-view select')].filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1).map((el) => ({ text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30), width: el.clientWidth, scrollWidth: el.scrollWidth, height: el.clientHeight, scrollHeight: el.scrollHeight }))
  return { view, viewport: [innerWidth, innerHeight], buttons, overflow }
})()`)
await page.screenshot(`${output}/ui-b-library-narrow.png`)

// 滚动到中部，切回书脊视图，再切回管理视图，检查滚动位置是否恢复
const scrollCheck = await page.evaluate(`(async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const shelf = document.querySelector('.shelf-view')
  shelf.scrollTop = 400
  await sleep(120)
  const before = shelf.scrollTop
  document.querySelector('.shelf-actions .shelf-book-command')?.click()
  await sleep(500)
  const backToVirtual = Boolean(document.querySelector('.v-home'))
  const scene = document.querySelector('.v-bookshelf-scene')
  if (scene) scene.scrollTop = 260
  await sleep(120)
  const virtualScroll = scene?.scrollTop ?? -1
  ;[...document.querySelectorAll('.v-bottom-dock button')].find((b) => b.textContent.includes('管理视图'))?.click()
  await sleep(500)
  const shelfAgain = document.querySelector('.shelf-view')
  const restored = shelfAgain?.scrollTop ?? -1
  ;[...document.querySelectorAll('.shelf-actions .shelf-book-command')].find((b) => b.textContent.includes('书脊视图'))?.click()
  await sleep(500)
  const sceneAgain = document.querySelector('.v-bookshelf-scene')
  const virtualRestored = sceneAgain?.scrollTop ?? -1
  return { before, backToVirtual, virtualScroll, restored, virtualRestored }
})()`)

// 宽窗管理视图截图
await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false })
await page.evaluate(`[...document.querySelectorAll('.v-bottom-dock button')].find((b) => b.textContent.includes('管理视图'))?.click()`)
await sleep(600)
await page.screenshot(`${output}/ui-b-library-wide.png`)
await page.evaluate(`[...document.querySelectorAll('.shelf-actions .shelf-book-command')].find((b) => b.textContent.includes('书脊视图'))?.click()`)
await sleep(500)
await page.screenshot(`${output}/ui-b-home-wide.png`)

console.log(JSON.stringify({ library, scrollCheck }, null, 2))
process.exit(0)
