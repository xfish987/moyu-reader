// 视觉确认截图：开启陪读底栏 → 分别截主窗与底栏窗口到 output/。
import fs from 'node:fs'

const CDP_HTTP = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map() }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('ws error'))
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          res(msg.result)
        }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve) => {
      this.pending.set(id, { resolve })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
const main = targets.find((t) => t.type === 'page' && t.url === 'http://127.0.0.1:5173/')
const page = new Cdp(main.webSocketDebuggerUrl)
await page.connect()
await page.send('Runtime.evaluate', { expression: 'window.readerAPI.setCompanionBarVisible(true)' })
await sleep(1500)
const targets2 = await (await fetch(`${CDP_HTTP}/json`)).json()
const bar = targets2.find((t) => t.type === 'page' && t.url.includes('window=companion-bar'))
if (bar) {
  const barPage = new Cdp(bar.webSocketDebuggerUrl)
  await barPage.connect()
  const shot = await barPage.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) fs.writeFileSync('output/verify-companion-bar.png', Buffer.from(shot.data, 'base64'))
}
const shotMain = await page.send('Page.captureScreenshot', { format: 'png' })
if (shotMain?.data) fs.writeFileSync('output/verify-reader.png', Buffer.from(shotMain.data, 'base64'))
console.log('bar target:', Boolean(bar), 'shots done')
process.exit(0)
