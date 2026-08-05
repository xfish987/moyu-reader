// 复现“生成资料弹出上一本书的设定集”：
// A 书 → 开设定集（缓存快照）→ 关设定集 → 回书架 → 开 B 书 → 再开设定集，观察初始快照与同步后快照。
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
async function findTarget(match, tries = 25) {
  for (let i = 0; i < tries; i++) {
    try {
      const t = (await targets()).find((t) => t.type === 'page' && match(t.url))
      if (t) return t
    } catch { return null }
    await sleep(400)
  }
  return null
}
const DEV = process.env.E2E_MODE !== 'packaged'
const MAIN = DEV ? (url) => url === 'http://127.0.0.1:5173/' : (url) => url.startsWith('file://') && url.includes('index.html') && !url.includes('window=')
const PROFILES = (url) => url.includes('window=profiles') && !url.includes('profiles-fab')

const main = await findTarget(MAIN)
if (!main) { console.error('主窗口未找到'); process.exit(1) }
let ms = new Cdp(main.webSocketDebuggerUrl)
await ms.connect()
const evalMain = async (ex) => (await ms.send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true })).result?.value
const snapshotOf = async () => {
  const p = await findTarget(PROFILES, 2)
  if (!p) return null
  const ps = new Cdp(p.webSocketDebuggerUrl)
  await ps.connect()
  const title = (await ps.send('Runtime.evaluate', { expression: `document.querySelector('.profiles-window-header strong')?.textContent || ''`, returnByValue: true })).result?.value
  return title
}
const openBook = async (name) => evalMain(`(() => {
  const items = [...document.querySelectorAll('.book-item')]
  const t = items.find((el) => el.textContent.includes('${name}'))
  if (!t) return false
  t.querySelector('.book-open')?.click()
  return true
})()`)

// 0. 状态归位：若在阅读页先回书架；若设定集开着先关掉
await evalMain(`document.querySelector('.toolbar-button.back')?.click()`)
await sleep(1500)
try { const snap = await evalMain(`(async()=>{ const open = await window.readerAPI.toggleProfilesWindow(); return open })()`); if (snap) { await evalMain('window.readerAPI.toggleProfilesWindow()'); await sleep(800) } } catch {}

// 1. 打开 A 书（书架第一本），开设定集让快照缓存
const firstTitle = await evalMain(`[...document.querySelectorAll('.book-info strong')].map(el=>el.textContent).find(t=>!t.includes('儒道至圣')) || ''`)
console.log('A 书 =', firstTitle)
await openBook(firstTitle)
await sleep(5000)
await evalMain('window.readerAPI.toggleProfilesWindow()')
await sleep(2500)
console.log('设定集显示 =', await snapshotOf())

// 2. 关闭设定集窗口（WM_CLOSE）
await evalMain('window.readerAPI.toggleProfilesWindow()') // toggle 开着就关
await sleep(1200)
console.log('设定集已关闭 =', !(await findTarget(PROFILES, 2)))

// 3. 回书架，开 B 书（儒道至圣）
await evalMain(`document.querySelector('.toolbar-button.back')?.click()`)
await sleep(2000)
await openBook('儒道至圣')
await sleep(5000)
console.log('B 书已打开（儒道至圣）')

// 4. 再开设定集：立即读一次（同步前），2 秒后再读
await evalMain('window.readerAPI.toggleProfilesWindow()')
await sleep(150)
console.log('【开窗瞬间】设定集显示 =', await snapshotOf())
await sleep(600)
console.log('【同步前】设定集显示 =', await snapshotOf())
await sleep(2200)
console.log('【同步后】设定集显示 =', await snapshotOf())
process.exit(0)
