// v1.3.1 四项修复的 CDP 实测：面板关闭（X/Esc/点正文）、陪读底栏窗口、沉浸拖拽、标题不溢出。
// 前置：vite 5173 + electron 以 --remote-debugging-port=9222 启动并打开测试书。
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
async function findTarget(match, tries = 20) {
  for (let i = 0; i < tries; i++) {
    const t = (await targets()).find((t) => t.type === 'page' && match(t.url))
    if (t) return t
    await sleep(300)
  }
  return null
}

let failures = 0
const check = (name, ok, detail = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++ }

function electronPid() {
  const out = execFileSync('powershell', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'tmp-e2e|moyu-e2e' -and $_.CommandLine -notmatch '--type=' -and $_.Name -match 'electron' } | Select-Object -ExpandProperty ProcessId"]).toString().trim()
  return out.split(/\r?\n/).map(Number).filter(Boolean)
}
// 按 pid 找到“最大可见窗口”（主窗；底栏/图标都是小窗），直接句柄 MoveWindow。
// window-ops.ps1 的标题匹配在中文标题 + ANSI 读取下不可靠，这里不碰标题。
function moveMainWindow(pid, x, y, w, h) {
  const ps = `
$code = @'
using System;
using System.Runtime.InteropServices;
public class MV {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc cb, IntPtr l);
  delegate bool EnumWindowsProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
  public struct R { public int Left, Top, Right, Bottom; }
  public static IntPtr Find(uint p) {
    IntPtr best = IntPtr.Zero; long bestArea = -1;
    EnumWindows((hh, l) => {
      uint pid; GetWindowThreadProcessId(hh, out pid);
      if (pid != p || !IsWindowVisible(hh)) return true;
      R r; GetWindowRect(hh, out r);
      long area = (long)(r.Right - r.Left) * (r.Bottom - r.Top);
      if (area > bestArea) { bestArea = area; best = hh; }
      return true;
    }, IntPtr.Zero);
    return best;
  }
}
'@
Add-Type -TypeDefinition $code
$h = [MV]::Find([uint32]${pid})
if ($h -eq [IntPtr]::Zero) { Write-Error 'no window'; exit 1 }
[MV]::MoveWindow($h, ${x}, ${y}, ${w}, ${h}, $true) | Out-Null
Write-Output 'ok'
`
  execFileSync('powershell', ['-NoProfile', '-Command', ps])
}

const main = await findTarget((url) => url === 'http://127.0.0.1:5173/')
if (!main) { console.error('main window target not found'); process.exit(1) }
const page = new Cdp(main.webSocketDebuggerUrl)
await page.connect()
const evalJs = async (expression) => (await page.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value
// 窗口矩形读渲染端的 screenX/screenY/outerWidth/outerHeight（Win32 EnumWindows 对 owned 子窗场景读数不可靠）。
const RECT_EXPR = `JSON.stringify({ left: window.screenX, top: window.screenY, width: window.outerWidth, height: window.outerHeight })`
const rectFromSession = async (session) => {
  const raw = (await session.send('Runtime.evaluate', { expression: RECT_EXPR, returnByValue: true })).result?.value
  const r = raw ? JSON.parse(raw) : null
  return r ? { ...r, right: r.left + r.width, bottom: r.top + r.height } : null
}
const mainRect = () => rectFromSession(page)

// 0. 确认阅读器已打开测试书（外部文件参数直接打开，或从书架点开）
await sleep(1500)
let inReader = await evalJs(`Boolean(document.querySelector('.reader-view'))`)
if (!inReader) {
  await evalJs(`document.querySelector('.book-card, [class*="book"]')?.click()`)
  await sleep(1200)
  inReader = await evalJs(`Boolean(document.querySelector('.reader-view'))`)
}
check('阅读器已打开测试书', inReader)

// 1. 窄屏化主窗口（宽度 480 触发紧凑工具栏）
const pid = electronPid()[electronPid().length - 1]
let rect = await mainRect()
console.log('主窗矩形', JSON.stringify(rect))
moveMainWindow(pid, rect.left, Math.max(0, rect.top - 40), 480, 640)
await sleep(800)
const compact = await evalJs(`Boolean(document.querySelector('.toolbar-overflow'))`)
check('窄屏触发紧凑工具栏（溢出菜单存在）', compact)

// 标题不溢出：章节名单行（span scrollHeight <= lineHeight*1.6 且 offsetWidth <= 容器）
const heading = await evalJs(`(() => { const s = document.querySelector('.book-heading span'); if (!s) return null; return { sw: s.scrollWidth, ow: s.offsetWidth, sh: s.scrollHeight, oh: s.offsetHeight } })()`)
check('窄屏章节名单行省略不溢出', heading && heading.sw <= heading.ow + 1 && heading.sh <= heading.oh + 2, JSON.stringify(heading))

// 2. 面板关闭四条路径（以「摘录与笔记」为例）
const openNotes = async () => {
  await evalJs(`document.querySelector('.toolbar-overflow > button')?.click()`)
  await sleep(250)
  await evalJs(`[...document.querySelectorAll('.toolbar-overflow-menu button')].find((b) => b.textContent.includes('摘录与笔记'))?.click()`)
  await sleep(350)
}
const panelOpen = () => evalJs(`Boolean(document.querySelector('.notes-panel'))`)

await openNotes()
check('溢出菜单打开摘录笔记面板', await panelOpen())
await evalJs(`document.querySelector('.notes-panel .panel-close')?.click()`)
await sleep(250)
check('路径1：X 按钮关闭', !(await panelOpen()))

await openNotes()
await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 })
await sleep(250)
check('路径2：Esc 关闭', !(await panelOpen()))

await openNotes()
await evalJs(`(() => { const el = document.querySelector('.text-viewport p') || document.querySelector('.reading-stage'); el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })) })()`)
await sleep(250)
check('路径3：点击正文（pointerdown 外部关闭）', !(await panelOpen()))

// 书签名面板同样有关闭按钮
await evalJs(`document.querySelector('.toolbar-overflow > button')?.click()`)
await sleep(250)
await evalJs(`[...document.querySelectorAll('.toolbar-overflow-menu button')].find((b) => b.textContent.trim() === '书签')?.click()`)
await sleep(350)
const bmPanel = await evalJs(`Boolean(document.querySelector('.notes-panel .panel-close'))`)
check('书签面板带 X 关闭按钮', bmPanel)
await evalJs(`document.querySelector('.notes-panel .panel-close')?.click()`)

// 3. 陪读底栏窗口：开启 → 出现在主窗底边外侧同宽；移动主窗跟随；关闭 → 消失
await evalJs(`window.readerAPI.setCompanionBarVisible(true)`)
await sleep(1200)
const barTarget = await findTarget((url) => url.includes('window=companion-bar'), 6)
check('底栏窗口创建', Boolean(barTarget))
// 底栏矩形同样读其渲染端窗口坐标。
let barPage = null
if (barTarget) { barPage = new Cdp(barTarget.webSocketDebuggerUrl); await barPage.connect() }
const barRect = () => (barPage ? rectFromSession(barPage) : null)
let bar = await barRect()
rect = await mainRect()
check('底栏吸附主窗底边外侧且同宽', Boolean(bar && rect && Math.abs(bar.left - rect.left) <= 4 && Math.abs(bar.width - rect.width) <= 4 && Math.abs(bar.top - rect.bottom) <= 12), JSON.stringify({ bar, main: rect }))
if (barPage) {
  const barText = (await barPage.send('Runtime.evaluate', { expression: 'document.body.innerText.trim()', returnByValue: true })).result?.value
  check('底栏内容渲染（陪读状态 + 三按钮）', Boolean(barText && barText.includes('陪读') && barText.includes('停止')), JSON.stringify(barText))
}
// 移动主窗 → 跟随
moveMainWindow(pid, rect.left + 120, rect.top, rect.width, rect.height)
await sleep(900)
const bar2 = await barRect()
const rect2 = await mainRect()
check('主窗移动后底栏跟随', Boolean(bar2 && rect2 && Math.abs(bar2.left - rect2.left) <= 8 && Math.abs(bar2.top - rect2.bottom) <= 12), JSON.stringify({ bar: bar2, main: rect2 }))
await evalJs(`window.readerAPI.setCompanionBarVisible(false)`)
await sleep(900)
const barGone = !(await findTarget((url) => url.includes('window=companion-bar'), 2))
check('底栏关闭后窗口销毁', barGone)

// 4. 沉浸模式顶栏拖拽：F11 进沉浸 → 鼠标移到顶部 → 按住顶栏拖动 → 主窗位移
await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })
await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })
await sleep(600)
const immersive = await evalJs(`Boolean(document.querySelector('.reader-view.is-immersive'))`)
check('F11 进入沉浸模式', immersive)
await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200, y: 4 })
await sleep(700)
const topbarVisible = await evalJs(`Boolean(document.querySelector('.immersive-topbar.is-visible'))`)
check('顶栏随鼠标悬停显示', topbarVisible)
const before = await mainRect()
await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 200, y: 26, button: 'left', clickCount: 1 })
for (let i = 1; i <= 6; i++) {
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200 + i * 20, y: 26 + i * 8, button: 'left' })
  await sleep(80)
}
await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 320, y: 74, button: 'left', clickCount: 1 })
await sleep(600)
const after = await mainRect()
check('顶栏拖拽移动窗口', Boolean(before && after && (Math.abs(after.left - before.left) > 30 || Math.abs(after.top - before.top) > 20)), `拖拽前 (${before?.left},${before?.top}) 后 (${after?.left},${after?.top})`)
// 退出沉浸
await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })
await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'F11', code: 'F11', windowsVirtualKeyCode: 122 })

console.log(`\n=== 实测完成：${failures} 个失败 ===`)
process.exit(failures ? 2 : 0)
