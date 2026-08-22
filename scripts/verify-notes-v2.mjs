// 笔记库 v2 冒烟：种子数据（高亮/标题/标签/手动摘录/旧评论字段）→ 打包应用 → CDP 驱动验证。
// 用法：先 pnpm run dist，再 node scripts/verify-notes-v2.mjs
// 注意：会临时替换真实 reader-data.json（先备份，结束后恢复），运行前请关闭墨读阅读器。
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const CDP_HTTP = 'http://127.0.0.1:9222'
const realStoreFile = path.join(process.env.APPDATA, 'MoyuReaderUIB', 'data', 'reader-data.json')
const backupFile = path.resolve('tmp/verify-notes-v2/reader-data.backup.json')
const output = 'output/playwright'
fs.rmSync(path.resolve('tmp/verify-notes-v2'), { recursive: true, force: true })
fs.mkdirSync(path.dirname(backupFile), { recursive: true })
fs.mkdirSync(output, { recursive: true })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
if (!fs.existsSync(realStoreFile)) { console.error(`找不到真实数据文件：${realStoreFile}`); process.exit(1) }
fs.copyFileSync(realStoreFile, backupFile)
const restoreStore = () => { try { fs.copyFileSync(backupFile, realStoreFile) } catch (error) { console.error('恢复数据失败，请手动用', backupFile, '覆盖', realStoreFile, error?.message) } }

const longText = '夜色像一块浸透水的布，沉沉地压在村子上方。\n他把手电咬在嘴里，腾出两只手去解背包上的绳结，动作很轻，像怕惊醒什么。\n身后忽然传来一声极轻的响动，他回过头，看见那个人站在斗笠的阴影里，一言不发。'
const seed = {
  version: 1,
  updatedAt: new Date().toISOString(),
  data: {
    'reader:notes': {
      bookA: [
        { id: 'n1', text: longText, paragraphIndex: 3, title: '小哥初见', tags: ['名场面'], highlights: [{ start: longText.indexOf('他把手电'), end: longText.indexOf('他把手电') + 24 }], createdAt: Date.now() - 86400000 },
        { id: 'n2', text: '旧时代的收藏，带着评论和颜色。', paragraphIndex: 8, comment: '这是一条应该被迁移清掉的旧评论', color: 'amber', createdAt: Date.now() - 43200000 },
        { id: 'n3', text: longText, paragraphIndex: 12, createdAt: Date.now() - 3600000 },
      ],
      'custom-x1': [
        { id: 'c1', text: '青铜门后什么都没有，只有漫长的、不被记得的时间。', custom: true, source: '《钓王》', title: '十年之后', tags: ['番外', '名场面'], createdAt: Date.now() - 7200000 },
      ],
    },
    'reader:book-metadata': {
      bookA: { id: 'bookA', title: '盗墓笔记', author: '南派三叔', format: 'txt', path: 'D:/nowhere/bookA.txt' },
      'custom-x1': { id: 'custom-x1', title: '随笔摘录', customGroup: true },
    },
  },
}
fs.writeFileSync(realStoreFile, JSON.stringify(seed, null, 2))

class Cdp {
  constructor(wsUrl) { this.wsUrl = wsUrl; this.id = 0; this.pending = new Map() }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl)
      this.ws.onopen = resolve
      this.ws.onerror = reject
      this.ws.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        const pending = this.pending.get(msg.id)
        if (!pending) return
        this.pending.delete(msg.id)
        msg.error ? pending.reject(new Error(msg.error.message)) : pending.resolve(msg.result)
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
  async evaluate(expression, awaitPromise = true) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true })
    if (result?.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
    return result?.result?.value
  }
  async screenshot(file) {
    const result = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(result.data, 'base64'))
  }
}

const exe = fs.readdirSync('release/win-unpacked').find((name) => name.endsWith('.exe'))
if (!exe) { console.error('release/win-unpacked 里没有 exe，请先 pnpm run dist'); process.exit(1) }
const child = spawn(path.resolve('release/win-unpacked', exe), ['--remote-debugging-port=9222'], { stdio: 'ignore' })
const cleanup = () => { try { child.kill() } catch {} }
process.on('exit', () => { cleanup(); restoreStore() })

let failures = 0
const check = (name, ok, detail = '') => { console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`); if (!ok) failures++ }

try {
  let target = null
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(400)
    const targets = await (await fetch(`${CDP_HTTP}/json`)).json().catch(() => [])
    target = targets.find((item) => item.type === 'page' && item.url.startsWith('file://') && item.url.includes('index.html') && !item.url.includes('window='))
  }
  if (!target) throw new Error('找不到主窗口 CDP 页面')
  const page = new Cdp(target.webSocketDebuggerUrl)
  await page.connect()
  await sleep(1500)

  // 进入笔记摘录视图
  await page.evaluate(`document.querySelector('.v-bottom-dock button[aria-label="笔记摘录"]')?.click()`)
  await sleep(900)

  const overview = await page.evaluate(`(() => {
    const textOf = (sel) => [...document.querySelectorAll(sel)].map((el) => el.textContent.trim())
    return {
      groups: textOf('.note-book-group header strong'),
      cards: document.querySelectorAll('.quote-card').length,
      titles: textOf('.quote-title'),
      tags: textOf('.quote-tag'),
      sources: textOf('.quote-source'),
      dimSpans: document.querySelectorAll('.quote-card .quote-dim').length,
      hlSpans: document.querySelectorAll('.quote-card .quote-hl').length,
      jumpButtons: document.querySelectorAll('.quote-card footer button[title="跳转到原文"]').length,
      sidebarTags: textOf('.notes-tag-filter button'),
      legacyCommentVisible: document.body.textContent.includes('应该被迁移清掉'),
    }
  })()`)
  check('分组齐全（盗墓笔记 + 随笔摘录）', overview.groups.includes('盗墓笔记') && overview.groups.includes('随笔摘录'), overview.groups.join(','))
  check('卡片数量=4', overview.cards === 4, `实际 ${overview.cards}`)
  check('备注标题显示', overview.titles.includes('小哥初见') && overview.titles.includes('十年之后'), overview.titles.join(','))
  check('标签 chip 显示', overview.tags.includes('名场面') && overview.tags.includes('番外'), overview.tags.join(','))
  check('自定义出处显示《钓王》', overview.sources.some((s) => s.includes('《钓王》')), overview.sources.join(' | '))
  check('高亮节选：淡显上下文 + 正显高亮', overview.dimSpans > 0 && overview.hlSpans > 0, `dim=${overview.dimSpans} hl=${overview.hlSpans}`)
  check('旧评论已被迁移清除', !overview.legacyCommentVisible)
  check('自定义卡片无跳转原文按钮', overview.jumpButtons === 0, `jump=${overview.jumpButtons}（bookA 为 missing 全部不显示跳转）`)
  check('侧栏标签过滤出现', overview.sidebarTags.some((t) => t.includes('名场面')))
  await page.screenshot(`${output}/notes-v2-library.png`)

  // 详情弹窗：全文同浓淡 + 操作按钮（点「小哥初见」那张带高亮的卡片）
  await page.evaluate(`[...document.querySelectorAll('.quote-card')].find((c) => c.textContent.includes('小哥初见'))?.click()`)
  await sleep(500)
  const detail = await page.evaluate(`(() => ({
    open: Boolean(document.querySelector('.note-detail')),
    paragraphs: document.querySelectorAll('.note-detail-text p').length,
    buttons: [...document.querySelectorAll('.note-detail footer button')].map((b) => b.textContent.trim()),
  }))()`)
  check('详情弹窗打开', detail.open)
  check('详情保留分段', detail.paragraphs >= 2, `段落=${detail.paragraphs}`)
  check('详情按钮（编辑/分享/复制）', detail.buttons.some((b) => b.includes('编辑')) && detail.buttons.some((b) => b.includes('分享')), detail.buttons.join(','))
  await page.screenshot(`${output}/notes-v2-detail.png`)

  // 编辑笔 → CollectNoteModal（高亮编辑界面）
  await page.evaluate(`[...document.querySelectorAll('.note-detail footer button')].find((b) => b.textContent.includes('编辑'))?.click()`)
  await sleep(500)
  const editor = await page.evaluate(`(() => ({
    open: Boolean(document.querySelector('.collect-modal')),
    indentParas: document.querySelectorAll('.collect-text p').length,
    hasHl: document.querySelectorAll('.collect-text .hl').length,
    remark: document.querySelector('.collect-fields input')?.value || '',
  }))()`)
  check('高亮编辑弹窗打开且排版分段', editor.open && editor.indentParas >= 2, `段落=${editor.indentParas}`)
  check('既有高亮在编辑器中呈现', editor.hasHl > 0)
  check('备注预填', editor.remark === '小哥初见', editor.remark)
  await page.screenshot(`${output}/notes-v2-collect.png`)
  await page.evaluate(`document.querySelector('.collect-modal > header > button')?.click()`)
  await sleep(300)

  // 手动新增摘录
  await page.evaluate(`[...document.querySelectorAll('.note-group-actions .add-note')][0]?.click()`)
  await sleep(400)
  const addModal = await page.evaluate(`(() => ({
    open: Boolean(document.querySelector('.add-custom-note')),
    source: document.querySelector('.add-custom-note input[value]')?.value,
  }))()`)
  check('新增摘录弹窗打开', addModal.open)
  await page.screenshot(`${output}/notes-v2-add.png`)
  await page.evaluate(`(() => {
    const modal = document.querySelector('.add-custom-note')
    const textarea = modal.querySelector('textarea')
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set
    setter.call(textarea, '这是一段手动新增的测试摘录。')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await sleep(200)
  await page.evaluate(`[...document.querySelectorAll('.add-custom-note footer button')].find((b) => b.textContent.includes('收藏'))?.click()`)
  await sleep(500)
  const afterAdd = await page.evaluate(`document.body.textContent.includes('手动新增的测试摘录') && document.querySelectorAll('.quote-card').length`)
  check('新增摘录保存成功（卡片=5）', afterAdd === 5, `实际 ${afterAdd}`)

  // 标签 icon：卡片上直接编辑标签
  await page.evaluate(`[...document.querySelectorAll('.quote-card')].find((c) => c.textContent.includes('旧时代的收藏'))?.querySelector('button[title="编辑标签"]')?.click()`)
  await sleep(400)
  const tagModalOpen = await page.evaluate(`Boolean(document.querySelector('.tag-edit-modal'))`)
  check('卡片标签 icon 打开标签编辑', tagModalOpen)
  await page.evaluate(`(() => {
    const input = document.querySelector('.tag-edit-modal .tag-editor input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '考古')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  })()`)
  await sleep(200)
  await page.evaluate(`[...document.querySelectorAll('.tag-edit-modal footer button')].find((b) => b.textContent.includes('保存标签'))?.click()`)
  await sleep(400)
  const tagAdded = await page.evaluate(`Boolean([...document.querySelectorAll('.quote-card')].find((c) => c.textContent.includes('旧时代的收藏'))?.textContent.includes('考古'))`)
  check('标签保存并显示在卡片上', tagAdded)

  // 分享图：书房卡片 + 手机长图
  await page.evaluate(`[...document.querySelectorAll('.quote-card')].find((c) => c.textContent.includes('小哥初见'))?.querySelector('button[title="生成分享图"]')?.click()`)
  let shareReady = false
  for (let i = 0; i < 25 && !shareReady; i++) {
    await sleep(400)
    shareReady = await page.evaluate(`Boolean(document.querySelector('.share-preview img')?.naturalWidth)`)
  }
  const cardImage = await page.evaluate(`(() => { const img = document.querySelector('.share-preview img'); return img ? { w: img.naturalWidth, h: img.naturalHeight } : null })()`)
  check('书房卡片分享图生成（1200 宽）', cardImage?.w === 1200, JSON.stringify(cardImage))
  await page.screenshot(`${output}/notes-v2-share-card.png`)
  await page.evaluate(`[...document.querySelectorAll('.format-picker button')].find((b) => b.textContent.includes('手机长图'))?.click()`)
  shareReady = false
  for (let i = 0; i < 25 && !shareReady; i++) {
    await sleep(400)
    shareReady = await page.evaluate(`(() => { const img = document.querySelector('.share-preview img'); return Boolean(img && img.naturalWidth === 750) })()`)
  }
  const mobileImage = await page.evaluate(`(() => { const img = document.querySelector('.share-preview img'); return img ? { w: img.naturalWidth, h: img.naturalHeight } : null })()`)
  check('手机长图生成（750 宽，高度随内容伸长）', mobileImage?.w === 750 && mobileImage?.h > 750, JSON.stringify(mobileImage))
  await page.screenshot(`${output}/notes-v2-share-mobile.png`)
  await page.evaluate(`document.querySelector('.share-modal > header > button')?.click()`)
  await sleep(300)

  // 视图切换
  await page.evaluate(`document.querySelector('.notes-view-toggle button[aria-label="横向显示"]')?.click()`)
  await sleep(400)
  const listMode = await page.evaluate(`Boolean(document.querySelector('.quote-grid.is-list')) && localStorage.getItem('moyu:notes-view')`)
  check('横向视图切换并持久化', listMode === 'list', String(listMode))
  await page.screenshot(`${output}/notes-v2-list.png`)

  // 新增分类
  await page.evaluate(`document.querySelector('.add-note-group')?.click()`)
  await sleep(300)
  await page.evaluate(`(() => {
    const input = document.querySelector('.note-group-create input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '新电脑分类')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })()`)
  await page.evaluate(`document.querySelector('.note-group-create button')?.click()`)
  await sleep(500)
  const groupCreated = await page.evaluate(`[...document.querySelectorAll('.notes-source-sidebar > button strong')].some((el) => el.textContent === '新电脑分类')`)
  check('自定义分类创建成功', groupCreated)

  // 迁移落盘确认：reader-data.json 不再含 comment/color
  await sleep(1200)
  const persisted = JSON.parse(fs.readFileSync(realStoreFile, 'utf8'))
  const persistedNotes = persisted.data['reader:notes']
  const allNotes = Object.values(persistedNotes).flat()
  check('迁移已写盘（无 comment/color）', allNotes.every((note) => !('comment' in note) && !('color' in note)))
  check('自定义分类已写盘', Boolean(persisted.data['reader:book-metadata'] && Object.values(persisted.data['reader:book-metadata']).some((meta) => meta.title === '新电脑分类' && meta.customGroup)))

  console.log(failures ? `\n${failures} 项失败` : '\n全部通过')
} finally {
  cleanup()
  await sleep(600)
  restoreStore()
}
process.exit(failures ? 1 : 0)
