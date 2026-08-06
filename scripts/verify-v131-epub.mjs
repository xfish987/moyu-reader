// v1.3.1 EPUB 补充实测：iframe 内点击关闭面板（onDismissPanel 兜底路径）。
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
          const { resolve: res, reject: rej } = this.pending.get(msg.id)
          this.pending.delete(msg.id)
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
        }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
}

const targets = async () => (await fetch(`${CDP_HTTP}/json`)).json()
let main
for (let i = 0; i < 20 && !main; i++) {
  main = (await targets()).find((t) => t.type === 'page' && t.url === 'http://127.0.0.1:5173/')
  if (!main) await sleep(300)
}
if (!main) { console.error('main window target not found'); process.exit(1) }
const page = new Cdp(main.webSocketDebuggerUrl)
await page.connect()
const evalJs = async (expression) => (await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value

let failures = 0
const check = (name, ok, detail = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++ }

await sleep(2500)
check('EPUB 阅读器打开（epub-host 存在）', await evalJs(`Boolean(document.querySelector('.epub-host iframe'))`))

// 打开目录面板（pinned 按钮），再往 iframe 正文里派真实鼠标点击
await evalJs(`[...document.querySelectorAll('.reader-actions .toolbar-button')][0]?.click()`)
await sleep(400)
check('目录面板打开', await evalJs(`Boolean(document.querySelector('.toc-panel'))`))

// 用 CDP 真实鼠标事件点击 iframe 区域中心（iframe 内点击不冒泡，靠 rendition 内绑定的 click 监听兜底）
const pt = await evalJs(`(() => { const f = document.querySelector('.epub-host iframe').getBoundingClientRect(); return JSON.stringify({ x: Math.round(f.left + f.width / 2), y: Math.round(f.top + f.height / 2) }) })()`)
const { x, y } = JSON.parse(pt)
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
await sleep(400)
check('EPUB iframe 内点击关闭面板', !(await evalJs(`Boolean(document.querySelector('.toc-panel'))`)))

console.log(`\n=== EPUB 实测完成：${failures} 个失败 ===`)
process.exit(failures ? 2 : 0)
