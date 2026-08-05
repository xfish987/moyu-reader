// 真实数据复现：打开《儒道至圣》→ 打开设定集 → 收起，观察崩溃。
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
          res(msg.result || msg.error)
        }
      }
    })
  }
  send(method, params = {}) {
    const id = ++this.id
    return Promise.race([
      new Promise((resolve) => { this.pending.set(id, { resolve }); this.ws.send(JSON.stringify({ id, method, params })) }),
      new Promise((resolve) => setTimeout(() => { this.pending.delete(id); resolve({ __timeout: true }) }, 5000)),
    ])
  }
}

const targets = async () => (await fetch(`${CDP_HTTP}/json`)).json()
async function findTarget(match, tries = 20) {
  for (let i = 0; i < tries; i++) {
    try {
      const t = (await targets()).find((t) => t.type === 'page' && match(t.url))
      if (t) return t
    } catch { return null }
    await sleep(400)
  }
  return null
}
const MAIN = (url) => url.startsWith('file://') && url.includes('index.html') && !url.includes('window=')

const main = await findTarget(MAIN)
if (!main) { console.error('主窗口 target 未找到'); process.exit(1) }
let session = new Cdp(main.webSocketDebuggerUrl)
await session.connect()
const evalJs = async (expression) => (await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value

// 书架上的《儒道至圣》
const found = await evalJs(`(() => {
  const items = [...document.querySelectorAll('.book-item')]
  const target = items.find((el) => el.textContent.includes('儒道至圣'))
  if (!target) return { found: false, titles: items.slice(0, 5).map((el) => el.textContent.slice(0, 20)) }
  target.querySelector('.book-open')?.click()
  return { found: true }
})()`)
console.log('找到儒道至圣 =', JSON.stringify(found))
if (!found?.found) process.exit(1)
await sleep(6000)
console.log('阅读视图 =', await evalJs(`Boolean(document.querySelector('.reader-view'))`))

// 观察崩溃的辅助
async function watch(tag, seconds) {
  for (let i = 0; i < seconds / 2; i++) {
    await sleep(2000)
    let list = null
    try { list = await targets() } catch { list = null }
    if (!list) { console.log(`[${tag} t=${(i + 1) * 2}s] CDP 无响应 —— 进程崩溃`); process.exit(2) }
    const mainAlive = list.some((t) => t.type === 'page' && MAIN(t.url))
    if (!mainAlive) { console.log(`[${tag} t=${(i + 1) * 2}s] 主窗口消失 —— 崩溃`); process.exit(2) }
  }
  console.log(`[${tag}] ${seconds}s 未崩溃`)
}

// 路径 A：打开设定集窗口
console.log('== 打开设定集窗口 ==')
await evalJs('window.readerAPI.toggleProfilesWindow()')
const profiles = await findTarget((url) => url.includes('window=profiles') && !url.includes('profiles-fab'), 8)
console.log('设定集窗口 =', profiles ? 'OK' : 'NOT FOUND')
await watch('设定集打开后', 8)

// 路径 B：收起为图标
if (profiles) {
  console.log('== 收起为悬浮图标 ==')
  const ps = new Cdp(profiles.webSocketDebuggerUrl)
  await ps.connect()
  await ps.send('Runtime.evaluate', { expression: 'window.readerAPI.collapseProfilesWindow()' })
  await watch('收起后', 12)
}
console.log('未复现崩溃')
process.exit(0)
