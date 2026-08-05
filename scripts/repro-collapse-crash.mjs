// 复现：打包 exe + 打开真实书籍 + 打开设定集 + 收起为图标，观察进程是否崩溃。
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
if (!main) { console.error('主窗口 target 未找到（进程可能已退出）'); process.exit(1) }
let session = new Cdp(main.webSocketDebuggerUrl)
await session.connect()
const evalJs = async (expression) => (await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value

// 1. 指向真实书库并刷新
console.log('== 设置书库目录并刷新 ==')
await evalJs(`localStorage.setItem('reader:directory', JSON.stringify('D:/tools/book/book')); location.reload(); 'ok'`)
await sleep(4000)
const main2 = await findTarget(MAIN)
session = new Cdp(main2.webSocketDebuggerUrl)
await session.connect()
const bookCount = await evalJs(`document.querySelectorAll('.book-open').length`)
console.log('书架书籍数 =', bookCount)
if (!bookCount) { console.error('没有书，无法复现'); process.exit(1) }

// 2. 打开第一本书
console.log('== 打开第一本书 ==')
await evalJs(`document.querySelector('.book-open')?.click(); 'ok'`)
await sleep(5000)
const inReader = await evalJs(`Boolean(document.querySelector('.reader-view'))`)
console.log('阅读视图已打开 =', inReader)

// 3. 打开设定集窗口
console.log('== 打开设定集窗口 ==')
await evalJs('window.readerAPI.toggleProfilesWindow()')
const profiles = await findTarget((url) => url.includes('window=profiles') && !url.includes('profiles-fab'), 8)
console.log('设定集窗口 =', profiles ? 'OK' : 'NOT FOUND')
await sleep(1500)

// 4. 收起为图标
console.log('== 收起为悬浮图标 ==')
const profilesSession = new Cdp(profiles.webSocketDebuggerUrl)
await profilesSession.connect()
await profilesSession.send('Runtime.evaluate', { expression: 'window.readerAPI.collapseProfilesWindow()' })

// 5. 观察 20 秒：fab 是否出现、主进程是否存活
for (let i = 0; i < 10; i++) {
  await sleep(2000)
  let list = null
  try { list = await targets() } catch { /* fallthrough */ }
  if (!list) { console.log(`[t=${(i + 1) * 2}s] CDP 无响应 —— 主进程已崩溃/退出`); process.exit(2) }
  const mainAlive = list.some((t) => t.type === 'page' && MAIN(t.url))
  const fabAlive = list.some((t) => t.type === 'page' && t.url.includes('window=profiles-fab'))
  console.log(`[t=${(i + 1) * 2}s] 主窗=${mainAlive ? '在' : '消失'} 图标=${fabAlive ? '在' : '消失'}`)
  if (!mainAlive) { console.log('主窗口消失 —— 复现崩溃'); process.exit(2) }
}
console.log('20 秒内未崩溃')
process.exit(0)
