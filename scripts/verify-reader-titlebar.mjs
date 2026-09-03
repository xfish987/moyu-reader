// 验证阅读器顶栏缝隙修复：启动 Electron（dev 页面），打开最近在读第一本书，截图阅读器顶部。
import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CDP_HTTP = 'http://127.0.0.1:9222'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const fixturePath = path.resolve(root, 'test-fixtures/desktop-reader-smoke.txt')
const e2eUserData = path.resolve(root, '.e2e-user-data')
fs.mkdirSync(path.join(e2eUserData, 'data'), { recursive: true })
fs.writeFileSync(path.join(e2eUserData, 'data', 'reader-data.json'), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), data: {
  'reader:manual-books': [{ id: 'e2e-desktop-reader', path: fixturePath, title: '桌面阅读器冒烟测试', author: '', extension: '.txt', format: 'TXT', size: fs.statSync(fixturePath).size, modifiedAt: Date.now() }],
  'reader:settings': { fontFamily:'serif', fontWeight:400, titleFontFamily:'serif', titleFontWeight:700, fontSize:20, lineHeight:1.9, paragraphGap:16, letterSpacing:.5, pageMargin:68, opacity:.92, theme:'light', showProgress:true, showReaderThoughts:true, scriptConversion:'none', layoutMode:'landscape' }
} }, null, 2))

// 启动 vite 已就绪的前提下拉起 electron
const electron = spawn('npx', ['electron', '.', '--remote-debugging-port=9222'], { cwd: root, stdio: 'ignore', shell: true, env: { ...process.env, MOYU_E2E: '1', MOYU_E2E_USER_DATA: e2eUserData } })

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map() }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.onopen = () => resolve()
      this.ws.onerror = () => reject(new Error('ws error'))
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.method === 'Runtime.exceptionThrown') console.error('page exception:', JSON.stringify(msg.params?.exceptionDetails))
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') console.error('page console:', JSON.stringify(msg.params.args))
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
  await session.send('Runtime.enable')

  // 使用隔离测试账户中的固定 TXT，不接触用户真实书架。
  await sleep(3500)
  await evaluate(session, `(() => { const button = [...document.querySelectorAll('button')].find((item) => item.textContent.includes('打开完整书架')); button?.click(); return !!button })()`)
  await sleep(1500)
  const opened = await evaluate(session, `(() => {
    const btn = [...document.querySelectorAll('.book-open, .v-face-book, .v-spine')].find((item) => {
      const label = item.textContent + ' ' + (item.getAttribute('aria-label') || '')
      return label.includes('桌面阅读器冒烟测试') || label.includes('desktop-reader-smoke')
    })
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
  const reader = await evaluate(session, `(() => ({
    toolbar: !!document.querySelector('.reader-toolbar'),
    text: document.querySelector('.text-columns')?.innerText || '',
    back: !!document.querySelector('.reader-toolbar button'),
    landscape: !!document.querySelector('.reader-view.layout-landscape')
  }))()`)
  console.log('reader:', JSON.stringify(reader))
  if (!reader?.toolbar || !reader?.text?.includes('桌面阅读器冒烟测试')) throw new Error('阅读器真实打开验证失败')

  const shot = await session.send('Page.captureScreenshot', { format: 'png' })
  if (shot?.data) {
    fs.writeFileSync('output/reader-titlebar-check.png', Buffer.from(shot.data, 'base64'))
    console.log('screenshot: output/reader-titlebar-check.png')
  }
} finally {
  try { execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq \'electron.exe\' -and $_.CommandLine -match \'remote-debugging-port=9222\' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"') } catch {}
  try { electron.kill() } catch {}
}
