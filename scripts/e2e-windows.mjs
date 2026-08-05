// CDP + Win32 端到端驱动：验证设定集窗口/悬浮图标的收起、渲染、跟随、最小化同步。
// CDP 负责页面内 evaluate / 截图 / 点击；窗口位置用 PowerShell EnumWindows 读取。
import fs from 'node:fs'
import { execFileSync, execSync } from 'node:child_process'

const CDP_HTTP = 'http://127.0.0.1:9222'
const MODE = process.env.E2E_MODE || 'dev' // dev: vite 页面；packaged: 打包 exe 的 file:// 页面
const MAIN_MATCH = MODE === 'packaged'
  ? (url) => url.startsWith('file://') && url.includes('index.html') && !url.includes('window=')
  : (url) => url === 'http://127.0.0.1:5173/'
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
    return Promise.race([
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        this.ws.send(JSON.stringify({ id, method, params }))
      }),
      new Promise((resolve) => setTimeout(() => { this.pending.delete(id); resolve({ __timeout: true }) }, 5000)),
    ])
  }
}

const targets = async () => (await fetch(`${CDP_HTTP}/json`)).json()
async function findTarget(match, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const t = (await targets()).find((t) => t.type === 'page' && match(t.url))
    if (t) return t
    await sleep(300)
  }
  return null
}

function electronPids() {
  const out = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'tmp-e2e\' -and $_.CommandLine -notmatch \'--type=\' -and $_.Name -notmatch \'bash|powershell|cmd\' } | Select-Object -ExpandProperty ProcessId"').toString().trim()
  return out ? out.split(/\r?\n/).map(Number) : []
}
function windowRects(pid) {
  const out = execFileSync('powershell', ['-NoProfile', '-File', 'scripts/window-rects.ps1', '-TargetPid', String(pid)]).toString().trim()
  if (!out) return []
  return out.split(/\r?\n/).map((line) => {
    const [title, l, t, r, b, visible, iconic] = line.split('|')
    return { title, left: +l, top: +t, right: +r, bottom: +b, width: r - l, height: b - t, visible: visible === 'True', iconic: iconic === 'True' }
  }).filter((w) => w.width > 0 && w.height > 0)
}

const log = (step, data) => console.log(`\n=== ${step} ===\n` + (typeof data === 'string' ? data : JSON.stringify(data)))
let failures = 0
const check = (name, ok, detail = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++ }

const candidates = electronPids()
if (!candidates.length) { console.error('找不到 E2E 进程'); process.exit(1) }
let pid = candidates[candidates.length - 1]
for (const candidate of candidates) {
  if (windowRects(candidate).some((w) => w.visible && w.width > 50)) { pid = candidate; break }
}
console.log('window owner pid =', pid, '(candidates:', candidates.join(', '), ')')

const main = await findTarget(MAIN_MATCH)
if (!main) { console.error('main window target not found'); process.exit(1) }
const mainSession = new Cdp(main.webSocketDebuggerUrl)
await mainSession.connect()
const evalMain = async (expression) => (await mainSession.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value

const rectOf = (pred) => windowRects(pid).find(pred)
const dump = (tag) => console.log(`-- ${tag} --\n` + windowRects(pid).map((w) => JSON.stringify(w)).join('\n'))
const mainRect = () => rectOf((w) => w.title.includes('墨读阅读器') && w.width > 400)
const profilesRect = () => rectOf((w) => w.title.includes('设定集'))
const fabRect = () => rectOf((w) => w.width < 200 && w.height < 200)

// 1. 打开设定集窗口
await evalMain('window.readerAPI.toggleProfilesWindow()')
await sleep(1200)
const profiles = await findTarget((url) => url.includes('window=profiles') && !url.includes('profiles-fab'), 6)
check('打开设定集窗口', Boolean(profiles))
dump('打开设定集后全部窗口')
const m1 = mainRect()
const p1 = profilesRect()
if (m1 && p1) {
  check('设定集吸附在主窗右侧', Math.abs(p1.left - (m1.right + 8)) <= 30 || Math.abs(p1.left - m1.left) > 100, `设定集 x=${p1.left} 主窗右缘=${m1.right}`)
}

// 2. 收起为悬浮图标
const profilesSession = new Cdp(profiles.webSocketDebuggerUrl)
await profilesSession.connect()
await profilesSession.send('Runtime.evaluate', { expression: 'window.readerAPI.collapseProfilesWindow()' })
await sleep(1200)
const profilesGone = !(await findTarget((url) => url.includes('window=profiles') && !url.includes('profiles-fab'), 2))
check('收起后设定集窗口消失', profilesGone)
const fab = await findTarget((url) => url.includes('window=profiles-fab'), 6)
check('悬浮图标窗口出现', Boolean(fab))

let fabSession
if (fab) {
  fabSession = new Cdp(fab.webSocketDebuggerUrl)
  await fabSession.connect()
  await sleep(500)
  const fabText = (await fabSession.send('Runtime.evaluate', { expression: 'document.body.innerText.trim().slice(0, 80)', returnByValue: true })).result?.value
  const fabUrl = (await fabSession.send('Runtime.evaluate', { expression: 'location.href', returnByValue: true })).result?.value
  console.log('fab location =', fabUrl)
  check('悬浮图标内容正确（无书架文字）', !fabText || !fabText.includes('D:'), JSON.stringify(fabText))
  const shot = await fabSession.send('Page.captureScreenshot', { format: 'png' })
  if (shot.data) fs.writeFileSync('e2e-fab.png', Buffer.from(shot.data, 'base64'))
  const f1 = fabRect()
  const m2 = mainRect()
  if (f1 && m2) check('图标吸附主窗右缘', Math.abs(f1.left - (m2.right + 6)) <= 30, `图标 x=${f1.left} 期望≈${m2.right + 6}`)
}

// 3. 移动主窗口（用 OS 级 MoveWindow）
if (fab) {
  dump('移动前全部窗口')
  // 确保主窗处于还原状态（可能被手动最小化）
  try { execFileSync('powershell', ['-NoProfile', '-File', 'scripts/window-ops.ps1', '-TargetPid', String(pid), '-TitlePart', '墨读阅读器', '-Op', 'restore', '-MinWidth', '0']) } catch {}
  await sleep(600)
  const before = mainRect()
  if (!before) { console.error('找不到主窗口'); process.exit(3) }
  execFileSync('powershell', ['-NoProfile', '-File', 'scripts/window-ops.ps1', '-TargetPid', String(pid), '-TitlePart', '墨读阅读器', '-Op', 'move', '-X', String(before.left + 150), '-Y', String(before.top + 80), '-W', String(before.width), '-H', String(before.height)])
  await sleep(900)
  const m3 = mainRect()
  const f3 = fabRect()
  console.log('移动后主窗', JSON.stringify(m3), '图标', JSON.stringify(f3))
  check('主窗已移动', m3 && Math.abs(m3.left - (before.left + 150)) <= 20)
  check('图标跟随主窗', f3 && m3 && Math.abs(f3.left - (m3.right + 6)) <= 40, `图标 x=${f3?.left} 期望≈${m3 ? m3.right + 6 : '?'}`)
}

// 4. 最小化主窗 → 图标同步隐藏；还原 → 回来
await evalMain('window.readerAPI.minimize()')
await sleep(900)
const fMin = windowRects(pid).find((w) => w.width < 200 && w.height < 200)
const mMin = windowRects(pid).find((w) => w.width > 500)
console.log('最小化状态：主窗 iconic=', mMin?.iconic, '图标 visible=', fMin?.visible, 'iconic=', fMin?.iconic)
check('主窗最小化时图标同步隐藏', Boolean(fMin) && (!fMin.visible || fMin.iconic), JSON.stringify(fMin))
execFileSync('powershell', ['-NoProfile', '-File', 'scripts/window-ops.ps1', '-TargetPid', String(pid), '-TitlePart', '墨读阅读器', '-Op', 'restore', '-MinWidth', '0'])
await sleep(900)
const fBack = fabRect()
check('主窗还原后图标恢复可见', Boolean(fBack && fBack.visible), JSON.stringify(fBack))

// 5. 单击图标（不拖动）→ 展开设定集窗口
if (fab && fabSession) {
  await fabSession.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 29, y: 39, button: 'left', clickCount: 1 })
  await fabSession.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 29, y: 39, button: 'left', clickCount: 1 })
  await sleep(1200)
  const profilesBack = await findTarget((url) => url.includes('window=profiles') && !url.includes('profiles-fab'), 4)
  check('单击图标展开设定集', Boolean(profilesBack))
}

console.log(`\n=== E2E 完成：${failures} 个失败 ===`)
process.exit(failures ? 2 : 0)
