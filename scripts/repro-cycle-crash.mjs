// 复现：真实数据 + 儒道至圣 → 反复 收起/展开 设定集，抓第二次循环的崩溃。
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
const DEV = process.env.E2E_MODE !== 'packaged'
const MAIN = DEV ? (url) => url === 'http://127.0.0.1:5173/' : (url) => url.startsWith('file://') && url.includes('index.html') && !url.includes('window=')
const PROFILES = (url) => url.includes('window=profiles') && !url.includes('profiles-fab')
const FAB = (url) => url.includes('window=profiles-fab')

async function alive() {
  try {
    const list = await targets()
    return { main: list.some((t) => t.type === 'page' && MAIN(t.url)), profiles: list.some((t) => t.type === 'page' && PROFILES(t.url)), fab: list.some((t) => t.type === 'page' && FAB(t.url)) }
  } catch { return null }
}
async function watchOrCrash(tag, seconds) {
  for (let i = 0; i < seconds * 2; i++) {
    await sleep(500)
    const state = await alive()
    if (!state || !state.main) { console.log(`💥 [${tag}] 崩溃`); return false }
  }
  return true
}

const main = await findTarget(MAIN)
if (!main) { console.error('主窗口 target 未找到'); process.exit(1) }
const session = new Cdp(main.webSocketDebuggerUrl)
await session.connect()
const evalJs = async (expression) => (await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value

const found = await evalJs(`(() => {
  const items = [...document.querySelectorAll('.book-item')]
  const target = items.find((el) => el.textContent.includes('儒道至圣'))
  if (!target) return false
  target.querySelector('.book-open')?.click()
  return true
})()`)
console.log('打开儒道至圣 =', found)
await sleep(6000)

for (let cycle = 1; cycle <= 4; cycle++) {
  console.log(`\n===== 第 ${cycle} 轮 =====`)
  // 打开设定集（toggle：fab 存在时会先销毁 fab 再开窗）
  await evalJs('window.readerAPI.toggleProfilesWindow()')
  const profiles = await findTarget(PROFILES, 8)
  console.log('设定集窗口 =', profiles ? 'OK' : 'NOT FOUND')
  if (!await watchOrCrash(`第${cycle}轮·打开`, 4)) process.exit(2)
  if (!profiles) continue
  // 收起
  const ps = new Cdp(profiles.webSocketDebuggerUrl)
  await ps.connect()
  await ps.send('Runtime.evaluate', { expression: 'window.readerAPI.collapseProfilesWindow()' })
  const fab = await findTarget(FAB, 8)
  console.log('悬浮图标 =', fab ? 'OK' : 'NOT FOUND')
  if (!await watchOrCrash(`第${cycle}轮·收起`, 4)) process.exit(2)
  // 从图标展开（点击图标按钮）
  if (fab) {
    const fs = new Cdp(fab.webSocketDebuggerUrl)
    await fs.connect()
    await fs.send('Runtime.evaluate', { expression: `document.querySelector('.profiles-fab-button')?.click()` })
    if (!await watchOrCrash(`第${cycle}轮·展开`, 4)) process.exit(2)
    console.log('展开完成')
  }
}
console.log('\n4 轮循环未崩溃')
process.exit(0)
