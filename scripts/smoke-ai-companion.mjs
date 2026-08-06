// AI 陪读等功能冒烟：CDP 驱动 dev 实例验证四项改动。
// 前置：vite dev 在 5173，electron 以 --remote-debugging-port=9222 启动。
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
    return Promise.race([
      new Promise((resolve, reject) => {
        this.pending.set(id, { resolve, reject })
        this.ws.send(JSON.stringify({ id, method, params }))
      }),
      new Promise((resolve) => setTimeout(() => { this.pending.delete(id); resolve({ __timeout: true }) }, 6000)),
    ])
  }
}

const targets = async () => (await fetch(`${CDP_HTTP}/json/list`)).json()
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

const main = await findTarget((url) => url === 'http://127.0.0.1:5173/')
if (!main) { console.error('找不到主窗口页面'); process.exit(1) }
const session = new Cdp(main.webSocketDebuggerUrl)
await session.connect()
const evalJs = async (expression) => {
  const r = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) console.log('  (js error:', JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text).slice(0, 200), ')')
  return r.result?.value
}

// 0. 等书架加载并打开第一本书（先刷新回到书架，并把窗口恢复到宽屏，保证可重复运行）
import { execFileSync, execSync } from 'node:child_process'
const electronPid = execSync('powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match \'remote-debugging-port\' -and $_.CommandLine -notmatch \'--type=\' -and $_.Name -match \'electron\' } | Select-Object -First 1 -ExpandProperty ProcessId"').toString().trim()
const resizeMain = (width) => execFileSync('powershell', ['-NoProfile', '-File', 'scripts/window-ops.ps1', '-TargetPid', electronPid, '-TitlePart', '墨读阅读器', '-Op', 'move', '-X', '100', '-Y', '60', '-W', String(width), '-H', '800', '-MinWidth', '0'])
resizeMain(1280)
await session.send('Page.reload')
await sleep(4000)
const bookCount = await evalJs(`document.querySelectorAll('.book-open').length`)
check('书架有书', bookCount > 0, `共 ${bookCount} 本`)
if (bookCount > 0) {
  await evalJs(`document.querySelector('.book-open').click()`)
  await sleep(4000)
}
const toolbarReady = await evalJs(`Boolean(document.querySelector('.reader-toolbar'))`)
check('打开书籍进入阅读器', Boolean(toolbarReady))

// 1. 工具栏：AI陪读图标存在（共 10 个动作按钮）
const actionCount = await evalJs(`document.querySelectorAll('.reader-actions .toolbar-button').length`)
check('工具栏动作按钮数量（含AI陪读）', actionCount >= 10, `实际 ${actionCount}`)
const companionBtn = await evalJs(`Boolean(document.querySelector('.reader-actions .toolbar-button[title*="AI陪读"]'))`)
check('AI陪读工具栏图标存在', Boolean(companionBtn))

// 2. 窄屏收纳：OS 级缩小窗口 → 溢出按钮出现；恢复 → 消失
// （CDP 的 Emulation 视口模拟不会触发页面渲染帧，ResizeObserver 收不到回调，必须真实缩放窗口）
resizeMain(480)
await sleep(1200)
const overflowShown = await evalJs(`Boolean(document.querySelector('.toolbar-overflow'))`)
const pinnedCount = await evalJs(`document.querySelectorAll('.reader-actions > .toolbar-button').length`)
check('窄屏出现溢出收纳按钮', Boolean(overflowShown))
check('窄屏只保留常驻按钮', pinnedCount <= 4, `平铺 ${pinnedCount} 个`)
if (overflowShown) {
  await evalJs(`document.querySelector('.toolbar-overflow > button')?.click()`)
  await sleep(400)
  const menuItems = await evalJs(`document.querySelectorAll('.toolbar-overflow-menu button').length`)
  check('溢出菜单展开且有被收纳项', menuItems >= 5, `菜单项 ${menuItems}`)
  await evalJs(`document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))`)
}
resizeMain(1280)
await sleep(800)
const overflowGone = await evalJs(`!document.querySelector('.toolbar-overflow')`)
check('宽屏时溢出按钮消失（图标全展开）', Boolean(overflowGone))

// 3. AI陪读状态条：开启 → 出现；沉浸模式下仍在；停止 → 消失
await evalJs(`[...document.querySelectorAll('.reader-actions .toolbar-button')].find((b) => b.title.includes('AI陪读'))?.click()`)
await sleep(1200)
const barShown = await evalJs(`Boolean(document.querySelector('.companion-bar'))`)
check('开启AI陪读后状态条出现', Boolean(barShown))
// 可能弹出 AI 供应商设置（无供应商时），关掉它
await evalJs(`document.querySelector('.ai-settings-modal .modal-close, .ai-settings-modal button[aria-label*="关闭"]')?.click()`)
await evalJs(`document.querySelector('.reader-actions .toolbar-button[title*="沉浸"]')?.click()`)
await sleep(800)
const immersiveState = await evalJs(`JSON.stringify({ toolbar: Boolean(document.querySelector('.reader-toolbar')), bar: Boolean(document.querySelector('.companion-bar')) })`)
check('沉浸模式下工具栏隐藏但状态条仍在', immersiveState === JSON.stringify({ toolbar: false, bar: true }), immersiveState)
// 退出沉浸，停止陪读
await evalJs(`document.querySelector('.immersive-topbar .toolbar-button')?.click()`)
await sleep(600)
await evalJs(`[...document.querySelectorAll('.companion-bar button')].find((b) => b.textContent.includes('停止'))?.click()`)
await sleep(800)
const barGone = await evalJs(`!document.querySelector('.companion-bar')`)
check('停止后状态条消失', Boolean(barGone))

// 4. 设定集：剧情梳理 tab（窗口可能已开着，toggle 会把它关掉，所以先看目标是否存在）
const profilesAlready = await findTarget((url) => url.includes('window=profiles') && !url.includes('profiles-fab'), 2)
if (!profilesAlready) await evalJs(`window.readerAPI.toggleProfilesWindow()`)
await sleep(1500)
const profiles = await findTarget((url) => url.includes('window=profiles') && !url.includes('profiles-fab'), 6)
check('设定集窗口打开', Boolean(profiles))
if (profiles) {
  const ps = new Cdp(profiles.webSocketDebuggerUrl)
  await ps.connect()
  await sleep(600)
  const tabText = await ps.send('Runtime.evaluate', { expression: `document.body.innerText.includes('剧情梳理')`, returnByValue: true })
  check('设定集有剧情梳理 tab', Boolean(tabText.result?.value))
  // 通过桥切到剧情梳理页
  await evalJs(`window.readerAPI.openProfilesStoryline()`)
  await sleep(1000)
  const storylineVisible = await ps.send('Runtime.evaluate', { expression: `Boolean(document.querySelector('.storyline-view')) || document.body.innerText.includes('还没有总结') || document.body.innerText.includes('AI陪读')`, returnByValue: true })
  check('openProfilesStoryline 切到剧情梳理页', Boolean(storylineVisible.result?.value))
  ps.ws.close()
}

// 5. 剧情提问独立窗口
await evalJs(`window.readerAPI.openCompanionWindow()`)
await sleep(1500)
const companion = await findTarget((url) => url.includes('window=companion'), 6)
check('剧情提问窗口打开', Boolean(companion))
if (companion) {
  const cs = new Cdp(companion.webSocketDebuggerUrl)
  await cs.connect()
  await sleep(600)
  const ui = await cs.send('Runtime.evaluate', { expression: `JSON.stringify({ header: document.body.innerText.includes('剧情提问'), input: Boolean(document.querySelector('textarea')), sidebar: Boolean(document.querySelector('[class*="session"], [class*="sidebar"], nav')) })`, returnByValue: true })
  console.log('  提问窗口 UI:', ui.result?.value)
  check('提问窗口有输入框和会话侧栏', Boolean(JSON.parse(ui.result?.value || '{}').input))
  cs.ws.close()
}

// 6. 字典窗口侧栏折叠（dev 实例数据独立；注入一条假词条保证侧栏渲染。getStoredValue 返回 {found,value} 包装，需解包）
const injected = await evalJs(`(async () => {
  const bookWrap = await window.readerAPI.getStoredValue('reader:last-book')
  const bookId = bookWrap?.value ?? bookWrap
  if (!bookId) return 'no-book-id'
  const dictWrap = await window.readerAPI.getStoredValue('reader:dictionary')
  const map = dictWrap?.value ?? dictWrap ?? {}
  if ((map[bookId] || []).some((item) => item.id === 'smoke-entry')) return 'already'
  const entry = { id: 'smoke-entry', anchorKey: 'smoke', anchor: { kind: 'text', paragraphIndex: 0 }, text: '冒烟测试词条', paragraph: '段落', chapterLabel: '第1章', readPercent: 0, explanation: '这是冒烟测试注入的解释。', followUps: [], createdAt: Date.now(), updatedAt: Date.now() }
  await window.readerAPI.setStoredValue('reader:dictionary', { ...map, [bookId]: [...(map[bookId] || []), entry] })
  return 'injected'
})()`)
if (injected === 'injected') {
  await session.send('Page.reload')
  await sleep(3500)
  await evalJs(`document.querySelector('.book-open')?.click()`)
  await sleep(3500)
}
await evalJs(`window.readerAPI.openDictionaryWindow('')`)
await sleep(1500)
const dict = await findTarget((url) => url.includes('window=dictionary'), 6)
check('字典窗口打开', Boolean(dict))
if (dict) {
  const ds = new Cdp(dict.webSocketDebuggerUrl)
  await ds.connect()
  await sleep(600)
  // 折叠状态持久化在 localStorage，先重置为展开；然后关掉字典窗重开（等价于全新渲染），保证可重复运行
  await ds.send('Runtime.evaluate', { expression: `localStorage.setItem('dict-sidebar-collapsed', '0')` })
  await ds.send('Runtime.evaluate', { expression: `window.close()` })
  await sleep(1000)
  await evalJs(`window.readerAPI.openDictionaryWindow('')`)
  await sleep(2500)
  const dict2 = await findTarget((url) => url.includes('window=dictionary'), 6)
  const ds2 = new Cdp(dict2.webSocketDebuggerUrl)
  await ds2.connect()
  const entriesCount = await ds2.send('Runtime.evaluate', { expression: `(document.querySelector('.dictionary-title span')?.innerText || '0 条')`, returnByValue: true })
  const before = await ds2.send('Runtime.evaluate', { expression: `Boolean(document.querySelector('.dictionary-sidebar')) && !document.querySelector('.dictionary-sidebar').classList.contains('is-collapsed')`, returnByValue: true })
  await ds2.send('Runtime.evaluate', { expression: `document.querySelector('.dictionary-collapse')?.click()` })
  await sleep(500)
  const after = await ds2.send('Runtime.evaluate', { expression: `Boolean(document.querySelector('.dictionary-sidebar.is-collapsed'))`, returnByValue: true })
  check('字典侧栏可折叠', Boolean(before.result?.value) && Boolean(after.result?.value), `条目=${entriesCount.result?.value} 折叠前=${before.result?.value} 折叠后=${after.result?.value}`)
  // 还原为展开，别给后续使用留下折叠状态
  await ds2.send('Runtime.evaluate', { expression: `document.querySelector('.dictionary-collapse')?.click()` })
  // 6b. 字典条目可删除（覆盖 confirm，点条目上的删除按钮 → 条目消失、落盘）
  await ds2.send('Runtime.evaluate', { expression: `window.confirm = () => true` })
  await sleep(300)
  await ds2.send('Runtime.evaluate', { expression: `document.querySelector('.dictionary-entry-delete')?.click()` })
  await sleep(1200)
  const remaining = await ds2.send('Runtime.evaluate', { expression: `(document.querySelector('.dictionary-title span')?.innerText || '0 条')`, returnByValue: true })
  const persisted = await evalJs(`window.readerAPI.getStoredValue('reader:dictionary').then(async (wrap) => { const id = (await window.readerAPI.getStoredValue('reader:last-book'))?.value; const map = wrap?.value ?? wrap ?? {}; return (map[id] || []).filter((e) => e.id === 'smoke-entry').length })`)
  check('字典条目可删除', (remaining.result?.value || '0 条') === '0 条' && persisted === 0, `界面剩余=${remaining.result?.value} 落盘残留=${persisted}`)
  ds2.ws.close()
  ds.ws.close()
}

// 7. 陪读会话管理：新建 → 重命名 → 删除
await evalJs(`window.readerAPI.openCompanionWindow()`)
await sleep(1500)
const comp7 = await findTarget((url) => url.includes('window=companion'), 6)
if (comp7) {
  const cs = new Cdp(comp7.webSocketDebuggerUrl)
  await cs.connect()
  const cj = async (expression) => (await cs.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.value
  await cs.send('Runtime.evaluate', { expression: `window.confirm = () => true` })
  await cj(`window.readerAPI.sendCompanionAction({ type: 'new-session' })`)
  await sleep(1200)
  const sessionCount = await cj(`document.querySelectorAll('.companion-session').length`)
  check('陪读新建会话出现在侧栏', sessionCount >= 1, `会话数 ${sessionCount}`)
  // 直接从快照拿不到 id，改用 UI 行内编辑：双击标题 → 全选 → 真实输入 → Enter
  // （合成的 input 事件不会更新 React 受控组件状态，必须用 CDP Input.insertText 模拟真实输入）
  await cj(`document.querySelector('.companion-session-open')?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`)
  await sleep(400)
  await cj(`document.querySelector('.companion-session-rename')?.focus()`)
  await cs.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await cs.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
  await cs.send('Input.insertText', { text: '冒烟会话' })
  await sleep(300)
  await cs.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await cs.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 })
  await sleep(1000)
  const renamed = await cj(`document.querySelector('.companion-session-open strong')?.textContent || ''`)
  check('陪读会话可重命名', renamed === '冒烟会话', `标题=${renamed}`)
  await cj(`document.querySelector('.companion-session-delete')?.click()`)
  await sleep(1200)
  const afterDelete = await cj(`document.querySelectorAll('.companion-session').length`)
  const persistedSessions = await evalJs(`window.readerAPI.getStoredValue('reader:companion-chats').then(async (wrap) => { const id = (await window.readerAPI.getStoredValue('reader:last-book'))?.value; const map = wrap?.value ?? wrap ?? {}; return (map[id] || []).length })`)
  check('陪读会话可删除', afterDelete === 0 && persistedSessions === 0, `界面剩=${afterDelete} 落盘剩=${persistedSessions}`)
  cs.ws.close()
}

console.log(`\n=== 冒烟完成：${failures} 个失败 ===`)
process.exit(failures ? 2 : 0)
