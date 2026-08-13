// 起点模式冒烟验证：切换到起点模式 → webview 加载起点主页 → 进章节页 → 翻页 → 返回本地。
// 前置：vite (5173) 与 electron --remote-debugging-port=9222 已启动。
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

async function listTargets() {
  return (await (await fetch('http://127.0.0.1:9222/json')).json())
}
async function findTarget(predicate, attempts = 20) {
  for (let i = 0; i < attempts; i += 1) {
    const target = (await listTargets()).find(predicate)
    if (target) return target
    await sleep(500)
  }
  return null
}

const mainTarget = await findTarget((item) => item.type === 'page' && item.url.includes('127.0.0.1:5173') && !item.url.includes('window='))
if (!mainTarget) throw new Error('没有找到主窗口页面')
const app = new Cdp(mainTarget.webSocketDebuggerUrl)
await app.connect()
console.log('主窗口已连接:', mainTarget.url)

// 1. 点击“起”切换到起点模式（幂等：已在模式内则不点）
await app.evaluate(`if (!document.querySelector('.qidian-shell')) document.querySelector('.qidian-mode-toggle')?.click()`)
await sleep(1200)
const shellReady = await app.evaluate(`Boolean(document.querySelector('.qidian-shell webview'))`)
console.log('起点模式壳子:', shellReady ? 'OK' : 'FAIL')

// 2. 等待 webview 访客目标出现（起点主页）
const guestTarget = await findTarget((item) => item.url.includes('qidian.com'), 30)
if (!guestTarget) throw new Error('没有找到起点 webview 访客页面')
console.log('起点访客页面:', guestTarget.type, guestTarget.url)
await sleep(2500)
await app.screenshot(`${output}/qidian-home.png`)

// 3. 让访客进入章节页（直接用免费章节），等宿主注入翻页脚本
const guest = new Cdp(guestTarget.webSocketDebuggerUrl)
await guest.connect()
await guest.send('Page.enable')
await guest.send('Page.navigate', { url: 'https://www.qidian.com/chapter/1010868264/402733549/' })
await sleep(6000)

// 宿主是否识别为翻页模式（工具条出现翻页按钮与左右点击区）
const hostState = await app.evaluate(`({
  pagedButtons: Boolean(document.querySelector('.qidian-edge')),
  url: document.querySelector('.qidian-stage webview') ? 'present' : 'missing',
})`)
console.log('宿主翻页 UI:', JSON.stringify(hostState))

// 4. 访客内验证分页与翻页
const guestState = await guest.evaluate(`(() => ({
  booted: Boolean(window.__moyuBooted),
  clean: document.documentElement.classList.contains('moyu-clean'),
  pages: (() => { const s = document.querySelector('.chapter-wrapper > .relative'); return s ? Math.round(s.scrollWidth / s.clientWidth) : 0 })(),
}))()`)
console.log('访客分页状态:', JSON.stringify(guestState))
await app.screenshot(`${output}/qidian-reader-page1.png`)

const flipped = await guest.evaluate(`window.__moyuPage(1)`)
const afterFlip = await guest.evaluate(`(() => { const s = document.querySelector('.chapter-wrapper > .relative'); return { result: 'ok', scrollLeft: s ? s.scrollLeft : -1 } })()`)
console.log('翻页结果:', flipped, '滚动位置:', JSON.stringify(afterFlip))
await app.screenshot(`${output}/qidian-reader-page2.png`)

// 5. 宿主键盘翻页（A/D）通道
await app.evaluate(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true }))`)
await sleep(600)
const afterKey = await guest.evaluate(`(() => { const s = document.querySelector('.chapter-wrapper > .relative'); return s ? s.scrollLeft : -1 })()`)
console.log('键盘 D 翻页后滚动位置:', afterKey)

// 6. 返回本地书架
await app.evaluate(`document.querySelector('.qidian-mode-toggle')?.click()`)
await sleep(800)
const backHome = await app.evaluate(`Boolean(document.querySelector('.v-home, .shelf-view'))`)
console.log('返回本地书架:', backHome ? 'OK' : 'FAIL')
await app.screenshot(`${output}/qidian-back-home.png`)

const pass = shellReady && guestState.booted && guestState.clean && guestState.pages > 1 && afterFlip.scrollLeft > 0 && backHome
console.log(pass ? 'QIDIAN MODE SMOKE: PASS' : 'QIDIAN MODE SMOKE: FAIL')
process.exit(pass ? 0 : 1)
