// 修复验证：打开设定集 → 对其发送真实 SC_MINIMIZE（等价于点“−”）→ 不应崩溃，应收起为图标。循环 3 次。
import { execFileSync } from 'node:child_process'

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
const MAIN = (url) => url === 'http://127.0.0.1:5173/'
const PROFILES = (url) => url.includes('window=profiles') && !url.includes('profiles-fab')
const FAB = (url) => url.includes('window=profiles-fab')

function pid() {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tmp-repro2' -and $_.CommandLine -notmatch '--type=' -and $_.Name -notmatch 'bash|powershell|cmd' } | Select-Object -ExpandProperty ProcessId"]).toString().trim()
  return out.split(/\r?\n/).map(Number)
}
function pressMinus(title) {
  for (const p of pid()) {
    try { execFileSync('powershell', ['-NoProfile', '-File', 'scripts/window-ops.ps1', '-TargetPid', String(p), '-TitlePart', title, '-Op', 'press-min', '-MinWidth', '300']) ; return true } catch { /* try next pid */ }
  }
  return false
}
async function mainAlive() {
  try { return (await targets()).some((t) => t.type === 'page' && MAIN(t.url)) } catch { return false }
}

const main = await findTarget(MAIN)
if (!main) { console.error('主窗口未找到'); process.exit(1) }
const session = new Cdp(main.webSocketDebuggerUrl)
await session.connect()
const evalJs = async (ex) => (await session.send('Runtime.evaluate', { expression: ex, awaitPromise: true, returnByValue: true })).result?.value

let failures = 0
for (let cycle = 1; cycle <= 3; cycle++) {
  await evalJs('window.readerAPI.toggleProfilesWindow()')
  const profiles = await findTarget(PROFILES, 8)
  if (!profiles) { console.log(`第${cycle}轮: 设定集未打开`); failures++; continue }
  await sleep(800)
  const sent = pressMinus('设定集')
  if (!sent) { console.log(`第${cycle}轮: 找不到设定集窗口句柄`); failures++; continue }
  console.log(`第${cycle}轮: 已发送 SC_MINIMIZE（= 点击 −）`)
  const fab = await findTarget(FAB, 8)
  await sleep(1500)
  const alive = await mainAlive()
  if (!alive) { console.log(`💥 第${cycle}轮: 主进程崩溃`); process.exit(2) }
  console.log(`第${cycle}轮: 未崩溃，悬浮图标 = ${fab ? 'OK' : 'NOT FOUND'}`)
  if (!fab) failures++
  // 从图标展开，进入下一轮
  if (fab) {
    const fs = new Cdp(fab.webSocketDebuggerUrl)
    await fs.connect()
    await fs.send('Runtime.evaluate', { expression: `document.querySelector('.profiles-fab-button')?.click()` })
    await sleep(1500)
    if (!await mainAlive()) { console.log(`💥 第${cycle}轮展开后: 主进程崩溃`); process.exit(2) }
  }
}
console.log(failures ? `完成，${failures} 个问题` : '3 轮“−”收起/展开全部通过，未崩溃')
process.exit(failures ? 1 : 0)
