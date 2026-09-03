// 验证阅读器顶栏缝隙修复：启动 Electron（dev 页面），打开最近在读第一本书，截图阅读器顶部。
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'

const CDP_HTTP = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 启动 vite 已就绪的前提下拉起 electron
const electron = spawn('npx', ['electron', '.', '--remote-debugging-port=9222'], { cwd: new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'), stdio: 'ignore', shell: true, env: { ...process.env, MOYU_E2E: '1' } })

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
          const { resolve: res, reject: rej } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
        }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve) => {
      this.pending.set(id, { resolve, reject: () => {} })
      this.ws.send(JSON.stringify({ id, method, params }))
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); resolve({ __timeout: true }) } }, 8000)
    })
  }
}

async function evaluate(session, expression) {
  const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  return result?.result?.value
}

try {
  let page = null
  for (let i = 0; i < 40 && !page; i++) {
    try {
      const targets = await (await fetch(`${CDP_HTTP}/json`)).json()
      page = targets.find((t) => t.type === 'page' && t.url === 'http://127.0.0.1:5173/')
    } catch {}
    if (!page) await sleep(500)
  }
  if (!page) throw new Error('找不到主窗口页面')
  const session = new Cdp(page.webSocketDebuggerUrl)
  await session.connect()

  // 等书架渲染后点击最近在读的第一本书
  await sleep(3500)
  const opened = await evaluate(session, `(() => {
    const btn = document.querySelector('.v-face-book, .v-spine-book')
    if (!btn) return 'no-book'
    btn.click()
    return 'clicked'
  })()`)
  console.log('open book:', opened)
  await sleep(4500)

  // 量一下 window-bar 底边与 reader-toolbar 顶边的距离
  const metrics = await evaluate(session, `(() => {
    const bar = document.querySelector('.window-bar')
    const toolbar = document.querySelector('.reader-toolbar')
    if (!bar || !toolbar) return { error: '元素缺失', hasBar: !!bar, hasToolbar: !!toolbar }
    const a = bar.getBoundingClientRect(), b = toolbar.getBoundingClientRect()
    const shadow = getComputedStyle(bar).boxShadow
    return { barBottom: a.bottom, toolbarTop: b.top, gap: b.top - a.bottom, boxShadow: shadow }
  })()`)
  console.log('metrics:', JSON.stringify(metrics))

  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    fs.writeFileSync('output/reader-titlebar-check.png', Buffer.from(shot.data, 'base64'))
    console.log('screenshot: output/reader-titlebar-check.png')
  }
} finally {
  try { execSync('powershell -NoProfile -Command "Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match \'remote-debugging-port=9222\' } | Stop-Process -Force"') } catch {}
  try { electron.kill() } catch {}
}
