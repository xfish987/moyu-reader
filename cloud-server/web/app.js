/* 墨读书城 —— 纯静态 SPA，无构建、无外部依赖。
   API 与站点同域，请求经 /moyu-reader-cloud 前缀由 Caddy 转发到后端。 */
'use strict'

const API_BASE = '/moyu-reader-cloud'
const TOKEN_KEY = 'moyu-web-token'
const FRAME = 264
const OUTPUT = 256

/* ---------------- 基础工具 ---------------- */

const $ = (selector, root) => (root || document).querySelector(selector)
const $$ = (selector, root) => Array.from((root || document).querySelectorAll(selector))

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fmtSize(bytes) {
  const n = Number(bytes) || 0
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(2) + ' GB'
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(1) + ' MB'
  if (n >= 1024) return (n / 1024).toFixed(0) + ' KB'
  return n + ' B'
}

function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

function stars(rating) {
  const n = Math.round(Number(rating) || 0)
  return '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n)
}

function toast(message, isError) {
  const root = $('#toast-root')
  const el = document.createElement('div')
  el.className = 'toast' + (isError ? ' error' : '')
  el.textContent = message
  root.appendChild(el)
  setTimeout(() => el.remove(), isError ? 5000 : 3000)
}

function b64url(text) {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function getToken() { return localStorage.getItem(TOKEN_KEY) || '' }
function setToken(token) { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY) }

/* ---------------- API ---------------- */

async function api(path, options = {}) {
  const headers = Object.assign({}, options.headers)
  const token = getToken()
  if (token) headers.authorization = 'Bearer ' + token
  let body = options.body
  if (body && !(body instanceof Blob) && !(body instanceof FormData) && typeof body === 'object') {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(body)
  }
  let response
  try {
    response = await fetch(API_BASE + path, { method: options.method || 'GET', headers, body })
  } catch (error) {
    throw new Error('网络连接失败，请稍后再试')
  }
  if (response.status === 401 && token) {
    setToken('')
    state.user = null
    stopPolling()
    location.hash = '#/'
    render()
    throw new Error('登录已失效，请重新登录')
  }
  if (options.raw) {
    if (!response.ok) {
      let message = '请求失败（' + response.status + '）'
      try { message = (await response.json()).error || message } catch (e) { /* 忽略 */ }
      throw new Error(message)
    }
    return response
  }
  let data = null
  try { data = await response.json() } catch (e) { /* 忽略 */ }
  if (!response.ok) throw new Error((data && data.error) || '请求失败（' + response.status + '）')
  return data
}

/* ---------------- 全局状态 ---------------- */

const state = {
  user: null,
  books: [],
  categories: [],
  query: '',
  category: '',
  unread: 0,
  notifications: [],
  notifOpen: false,
  booted: false,
  mineTab: 'uploads',
  mineUploadFilter: 'all',
  novel: {
    keyword: '',
    results: null,      // null = 还没搜过
    searching: false,
    selected: new Set(), // 以 url 为键
    jobs: [],
    jobsSelected: new Set(), // job ids
    storeFor: null,     // 正在填写书城信息的 job id
    jobsPolled: false,
  },
  epubMaker: {
    files: [],          // { id, file, title, author, coverFile, coverUrl, options, guessed }
    jobs: [],
    selected: new Set(), // job ids
    storeFor: null,
    bulkStore: false,
    jobsPolled: false,
  },
}

/* ---------------- 繁简切换 ---------------- */

const LANG_KEY = 'moyu-web-lang'
const SUPPORTED_LANGS = { cn: '简', tw: '繁' }
state.lang = localStorage.getItem(LANG_KEY) || 'cn'

let cn2tw = null
let tw2cn = null
function initConverters() {
  if (typeof OpenCC === 'undefined') return false
  if (!cn2tw) {
    try { cn2tw = OpenCC.Converter({ from: 'cn', to: 'tw' }) } catch (e) { }
  }
  if (!tw2cn) {
    try { tw2cn = OpenCC.Converter({ from: 'tw', to: 'cn' }) } catch (e) { }
  }
  return Boolean(cn2tw && tw2cn)
}

function t(text) {
  if (!text || state.lang === 'cn') return String(text)
  if (!initConverters()) return String(text)
  try { return cn2tw(String(text)) } catch (e) { return String(text) }
}

// 对页面中已有的文本节点做繁简转换；新增节点由 MutationObserver 自动处理
const TRANSLATE_SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'OPTION'])
const TRANSLATE_SKIP_ATTRS = new Set(['value', 'data-cover', 'data-av-fallback', 'data-nav', 'data-id', 'data-job', 'data-select', 'data-dl', 'data-lib', 'data-store', 'data-store-ok', 'data-store-cancel', 'data-idx', 'data-cover-idx', 'data-remove', 'data-title', 'data-author', 'data-opt', 'data-book'])

function translateNode(node) {
  if (state.lang === 'cn') return
  if (!initConverters()) return
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.textContent.trim()) return
    node.textContent = cn2tw(node.textContent)
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return
  const tag = node.tagName
  if (TRANSLATE_SKIP_TAGS.has(tag)) return
  // 翻译可见属性
  for (const attr of ['placeholder', 'title', 'aria-label', 'alt']) {
    if (node.hasAttribute(attr) && !TRANSLATE_SKIP_ATTRS.has(attr)) {
      node.setAttribute(attr, cn2tw(node.getAttribute(attr)))
    }
  }
  // 翻译子文本节点
  for (const child of node.childNodes) translateNode(child)
}

function translatePage() {
  if (state.lang === 'cn') return
  if (!initConverters()) return
  translateNode(document.body)
}

function setLang(next) {
  if (!SUPPORTED_LANGS[next] || state.lang === next) return
  const prev = state.lang
  state.lang = next
  localStorage.setItem(LANG_KEY, next)
  // 从当前语言切回简体，需要刷新页面重新渲染；否则只能做逆向转换，容易累积错误
  if (next === 'cn') {
    location.reload()
    return
  }
  // 切到繁体：对当前 DOM 做一次正向转换
  translatePage()
  render()
}

let translateObserver = null
function startTranslateObserver() {
  if (translateObserver) return
  translateObserver = new MutationObserver((mutations) => {
    if (state.lang === 'cn') return
    if (!initConverters()) return
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) translateNode(node)
    }
  })
  translateObserver.observe(document.body, { childList: true, subtree: true })
}

let jobPollTimer = null
let historyPollTimer = null
function startJobPolling(onTick) {
  stopJobPolling()
  jobPollTimer = setInterval(onTick, 3000)
}
function stopJobPolling() {
  if (jobPollTimer) { clearInterval(jobPollTimer); jobPollTimer = null }
}

function stopHistoryPolling() {
  if (historyPollTimer) { clearInterval(historyPollTimer); historyPollTimer = null }
}

function startHistoryPolling() {
  stopHistoryPolling()
  historyPollTimer = setInterval(async () => {
    if (!state.jobsOpen || !state.user) return stopHistoryPolling()
    await Promise.all([refreshNovelJobs(document), refreshEpubMakerJobs(document)]).catch(() => {})
    renderJobsPanel()
  }, 3000)
}

let pollTimer = null
function startPolling() {
  stopPolling()
  pollTimer = setInterval(() => { refreshNotifications(true).catch(() => {}) }, 60000)
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
}

/* ---------------- 封面缓存（带 Bearer fetch 转 blob URL） ---------------- */

const coverCache = new Map() // bookId -> Promise<url|null>

function coverUrl(bookId) {
  if (!coverCache.has(bookId)) {
    coverCache.set(bookId, api('/v1/store/books/' + bookId + '/cover', { raw: true })
      .then((res) => res.blob())
      .then((blob) => URL.createObjectURL(blob))
      .catch(() => null))
  }
  return coverCache.get(bookId)
}

// 渲染后为 img[data-cover] 填充封面；失败回退占位书形。
// 懒加载：只有进入视口附近才发起请求，避免首屏一次拉全部封面。
const coverObserver = typeof IntersectionObserver !== 'undefined'
  ? new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      coverObserver.unobserve(entry.target)
      loadCover(entry.target)
    }
  }, { rootMargin: '300px' })
  : null

function loadCover(img) {
  if (img.dataset.coverLoaded) return
  img.dataset.coverLoaded = '1'
  coverUrl(img.dataset.cover).then((url) => {
    if (url) { img.src = url } else { swapToPlaceholder(img) }
  })
  img.addEventListener('error', () => swapToPlaceholder(img), { once: true })
}

function hydrateCovers(root) {
  $$('img[data-cover]', root).forEach((img) => {
    if (coverObserver) coverObserver.observe(img)
    else loadCover(img)
  })
}

function swapToPlaceholder(img) {
  const box = img.closest('.book-cover')
  if (box) {
    box.innerHTML = placeholderHtml(img.dataset.format || '', img.dataset.letter || '书')
  } else {
    img.style.display = 'none'
  }
}

function placeholderHtml(format, letter) {
  return '<div class="cover-placeholder"><span class="spine">' + esc(letter || '书') + '</span>' +
    (format ? '<span class="fmt">' + esc(format) + '</span>' : '') + '</div>'
}

function coverBoxHtml(book, extraAttrs) {
  if (book.hasCover) {
    return '<img data-cover="' + esc(book.id) + '" data-format="' + esc(book.format) + '" data-letter="' + esc((book.title || '书').charAt(0)) + '" alt="' + esc(book.title) + ' 封面"' + (extraAttrs || '') + '>'
  }
  return placeholderHtml(book.format, (book.title || '书').charAt(0))
}

function avatarHtml(user, sizeClass) {
  const name = (user && (user.nickname || user.username)) || '?'
  const cls = sizeClass ? ' ' + sizeClass : ''
  if (user && user.avatar) {
    return '<img class="avatar' + cls + '" src="' + esc(user.avatar) + '" alt="' + esc(name) + '" data-av-fallback="' + esc(name.charAt(0)) + '">'
  }
  return '<span class="avatar-placeholder' + cls + '">' + esc(name.charAt(0)) + '</span>'
}

// 头像图片加载失败（error 事件不冒泡，用捕获阶段统一处理）时回退为首字占位
document.addEventListener('error', (event) => {
  const target = event.target
  if (!target || target.tagName !== 'IMG' || target.dataset.avFallback === undefined) return
  const span = document.createElement('span')
  span.className = target.className.replace(/\bavatar\b/, 'avatar-placeholder')
  span.textContent = target.dataset.avFallback || '?'
  target.replaceWith(span)
}, true)

/* ---------------- 顶栏与通知 ---------------- */

function topbarHtml(route) {
  const u = state.user
  const nav = [
    ['#/', '书城', 'home'],
    ['#/novel', '搜书制作', 'novel'],
    ['#/epub-maker', 'EPUB 制作', 'epub-maker'],
    ['#/upload', '上传书籍', 'upload'],
    ['#/account', '账户', 'account'],
  ].map(([href, label, key]) => {
    const icon = key === 'novel' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4M8 9h6M8 12h4"/></svg>' : key === 'epub-maker' ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h10l4 4v14H5zM15 3v5h5M8 13h8M8 17h6"/></svg>' : ''
    return '<a href="' + href + '" class="' + (route === key ? 'active' : '') + '">' + icon + label + '</a>'
  }).join('')
  const langLabel = SUPPORTED_LANGS[state.lang] || '简'
  const nextLang = state.lang === 'cn' ? 'tw' : 'cn'
  return '<header class="topbar">' +
    '<div class="brand" data-nav="#/">墨读书城<small>共享书城</small></div>' +
    '<nav class="topnav">' + nav + '</nav>' +
    '<div class="topbar-right">' +
      '<button class="icon-button" id="lang-btn" aria-label="切换繁简" title="切换简/繁">' + langLabel + '</button>' +
      '<button class="icon-button" id="notif-btn" aria-label="通知">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>' +
        (state.unread > 0 ? '<span class="badge" id="notif-badge">' + (state.unread > 99 ? '99+' : state.unread) + '</span>' : '') +
      '</button>' +
      '<button class="icon-button" id="jobs-btn" aria-label="制作记录" title="搜书与 EPUB 制作记录">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v5l3 2"/><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6 3.8 3.8"/></svg>' +
        ((state.novel.jobs || []).some((j) => ['queued','running'].includes(j.status)) || (state.epubMaker.jobs || []).some((j) => ['queued','running'].includes(j.status)) ? '<span class="job-live-dot"></span>' : '') +
      '</button>' +
      '<button class="avatar-chip" id="me-btn" title="我的上传">' + avatarHtml(u) +
        '<span>' + esc(u.nickname || u.username) + '</span></button>' +
      '<button class="icon-button" id="logout-btn" aria-label="退出登录" title="退出登录">' +
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>' +
      '</button>' +
      '<div id="notif-slot"></div>' +
      '<div id="jobs-slot"></div>' +
    '</div>' +
  '</header>'
}

function bindTopbar() {
  $$('.topbar [data-nav]').forEach((el) => el.addEventListener('click', () => { location.hash = el.dataset.nav }))
  $('#lang-btn')?.addEventListener('click', () => { setLang(state.lang === 'cn' ? 'tw' : 'cn') })
  $('#logout-btn').addEventListener('click', async () => {
    try { await api('/v1/auth/logout', { method: 'POST', body: {} }) } catch (e) { /* 忽略 */ }
    setToken('')
    state.user = null
    stopPolling()
    stopHistoryPolling()
    location.hash = '#/'
    render()
  })
  $('#me-btn').addEventListener('click', () => {
    state.mineTab = 'uploads'
    if (location.hash === '#/mine') render()
    else location.hash = '#/mine'
  })
  $('#notif-btn').addEventListener('click', (event) => {
    event.stopPropagation()
    state.notifOpen = !state.notifOpen
    renderNotifPanel()
    if (state.notifOpen) refreshNotifications(false).catch(() => {})
  })
  $('#jobs-btn')?.addEventListener('click', async (event) => {
    event.stopPropagation()
    state.jobsOpen = !state.jobsOpen
    if (state.jobsOpen) {
      state.notifOpen = false
      renderNotifPanel()
      await Promise.all([refreshNovelJobs(document), refreshEpubMakerJobs(document)])
      startHistoryPolling()
    } else {
      stopHistoryPolling()
    }
    renderJobsPanel()
  })
}

function jobProgressHtml(job) {
  if (!['queued', 'running'].includes(job.status)) return ''
  const progress = Math.max(0, Math.min(99, Number(job.progress) || 0))
  const eta = job.estimatedAt ? new Date(job.estimatedAt) : null
  const etaText = eta && eta.getTime() > Date.now() ? '预计 ' + eta.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ' 完成' : '正在计算完成时间'
  return '<div class="job-progress"><div class="job-progress-meta"><span>' + esc(job.phase || '处理中') + '</span><b>' + progress + '%</b></div><div class="job-progress-track"><i style="width:' + progress + '%"></i></div><small>' + etaText + '</small></div>'
}

function historyJobHtml(job, kind) {
  const [label, tone] = JOB_STATUS[job.status] || [job.status, 'wait']
  const done = job.status === 'done'
  return '<article class="history-job"><div class="history-job-copy"><strong>' + esc(job.title) + '</strong><span>' + esc(kind === 'novel' ? '搜书制作' : 'EPUB 制作') + ' · ' + esc(job.author || '佚名') + '</span>' + jobProgressHtml(job) + (job.error ? '<em>' + esc(job.error) + '</em>' : '') + '</div><div class="history-job-action"><span class="status ' + tone + '">' + label + '</span>' + (job.status === 'error' ? '<button class="btn small" data-history-retry="' + kind + ':' + job.id + '">重试</button>' : '') + (done ? '<div class="split-action"><button data-history-dl="' + kind + ':' + job.id + '">下载</button><button data-history-menu="' + kind + ':' + job.id + '" aria-label="更多下载选项">▾</button><div class="split-menu"><button data-history-lib="' + kind + ':' + job.id + '">' + (job.addedToLibraryAt ? '已放到阅读器' : '放到阅读器') + '</button></div></div>' : '') + '</div></article>'
}

function renderJobsPanel() {
  const slot = $('#jobs-slot')
  if (!slot) return
  if (!state.jobsOpen) { stopHistoryPolling(); slot.innerHTML = ''; return }
  const jobs = [...(state.novel.jobs || []).map((j) => ({ ...j, kind: 'novel' })), ...(state.epubMaker.jobs || []).map((j) => ({ ...j, kind: 'epub' }))].sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  slot.innerHTML = '<div class="jobs-popover" role="dialog" aria-label="制作记录"><header><div><strong>制作记录</strong><small>任务由服务器继续执行，关闭网页不会中断</small></div><button id="jobs-close" aria-label="关闭">×</button></header><div class="jobs-history">' + (jobs.length ? jobs.map((j) => historyJobHtml(j, j.kind)).join('') : '<div class="empty-state">暂无制作记录</div>') + '</div></div>'
  $('#jobs-close', slot)?.addEventListener('click', () => { state.jobsOpen = false; stopHistoryPolling(); renderJobsPanel(); $('#jobs-btn')?.focus() })
  $$('[data-history-menu]', slot).forEach((btn) => btn.addEventListener('click', () => btn.parentElement.classList.toggle('open')))
  $$('[data-history-retry]', slot).forEach((btn) => btn.addEventListener('click', async () => { const [kind,id] = btn.dataset.historyRetry.split(':'); btn.disabled = true; try { await api('/v1/' + (kind === 'novel' ? 'novel' : 'epub-maker') + '/jobs/' + id + '/retry', { method: 'POST', body: {} }); toast('任务已重新加入队列'); await Promise.all([refreshNovelJobs(document), refreshEpubMakerJobs(document)]); renderJobsPanel() } catch (error) { toast(error.message, true); btn.disabled = false } }))
  $$('[data-history-dl]', slot).forEach((btn) => btn.addEventListener('click', async () => { const [kind,id] = btn.dataset.historyDl.split(':'); const job = (kind === 'novel' ? state.novel.jobs : state.epubMaker.jobs).find((j) => j.id === id); if (job) await (kind === 'novel' ? downloadNovelJob(job) : downloadEpubMakerJob(job)) }))
  $$('[data-history-lib]', slot).forEach((btn) => btn.addEventListener('click', async () => { const [kind,id] = btn.dataset.historyLib.split(':'); const job = (kind === 'novel' ? state.novel.jobs : state.epubMaker.jobs).find((j) => j.id === id); if (!job || job.addedToLibraryAt) return; btn.disabled = true; try { await api('/v1/' + (kind === 'novel' ? 'novel' : 'epub-maker') + '/jobs/' + id + '/to-library', { method: 'POST', body: { title: job.title, author: job.author } }); job.addedToLibraryAt = new Date().toISOString(); toast('《' + job.title + '》已放到阅读器'); renderJobsPanel() } catch (error) { toast(error.message, true); btn.disabled = false } }))
}

function renderNotifPanel() {
  const slot = $('#notif-slot')
  if (!slot) return
  if (!state.notifOpen) { slot.innerHTML = ''; return }
  // 面板只显示未读；已读消息全部归入「我的 → 历史消息」
  const unreadItems = state.notifications.filter((n) => !n.read)
  const items = unreadItems.map((n) => {
    const text = n.type === 'review'
      ? esc(n.actor) + ' 评价了《' + esc(n.bookTitle) + '》' + (n.rating ? ' <span class="rating-stars">' + stars(n.rating).slice(0, n.rating) + '</span>' : '')
      : esc(n.actor) + ' 下载了《' + esc(n.bookTitle) + '》'
    return '<div class="notif-item unread" data-book="' + esc(n.bookId || '') + '">' +
      '<div>' + text + '</div><div class="time">' + fmtTime(n.createdAt) + '</div></div>'
  }).join('')
  slot.innerHTML = '<div class="notif-panel" id="notif-panel">' +
    '<div class="notif-head"><strong>未读通知</strong><button class="btn small" id="notif-read-all"' + (unreadItems.length ? '' : ' disabled') + '>全部标为已读</button></div>' +
    '<div class="notif-list">' + (items || '<div class="notif-empty">没有未读通知</div>') + '</div>' +
    '<div class="notif-foot"><a href="#/mine" id="notif-history">查看历史消息 &rarr;</a></div></div>'
  $('#notif-read-all').addEventListener('click', async () => {
    try {
      await api('/v1/notifications/read', { method: 'POST', body: {} })
      state.unread = 0
      state.notifications.forEach((n) => { n.read = true })
      updateBadge()
      renderNotifPanel() // 已读即从面板消失
    } catch (error) { toast(error.message, true) }
  })
  $('#notif-history').addEventListener('click', (event) => {
    event.preventDefault()
    state.mineTab = 'messages'
    state.notifOpen = false
    if (location.hash === '#/mine') render()
    else location.hash = '#/mine'
  })
  $$('.notif-item[data-book]', slot).forEach((el) => el.addEventListener('click', () => {
    if (el.dataset.book) { state.notifOpen = false; location.hash = '#/book/' + el.dataset.book }
  }))
  setTimeout(() => {
    document.addEventListener('click', function close(event) {
      const panel = $('#notif-panel')
      if (panel && !panel.contains(event.target)) {
        state.notifOpen = false
        renderNotifPanel()
        document.removeEventListener('click', close)
      }
    })
  }, 0)
}

async function refreshNotifications(silent) {
  if (!state.user) return
  const data = await api('/v1/notifications')
  state.notifications = data.notifications || []
  state.unread = data.unreadCount || 0
  updateBadge()
  if (!silent && state.notifOpen) renderNotifPanel()
}

function updateBadge() {
  const btn = $('#notif-btn')
  if (!btn) return
  const old = $('#notif-badge')
  if (old) old.remove()
  if (state.unread > 0) {
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.id = 'notif-badge'
    badge.textContent = state.unread > 99 ? '99+' : String(state.unread)
    btn.appendChild(badge)
  }
}

/* ---------------- 数据加载 ---------------- */

async function loadBooks() {
  const params = new URLSearchParams()
  if (state.query) params.set('q', state.query)
  if (state.category) params.set('category', state.category)
  const data = await api('/v1/store/books' + (params.toString() ? '?' + params : ''))
  state.books = data.books || []
  state.categories = data.categories || []
}

async function loadAllBooks() {
  const data = await api('/v1/store/books')
  state.books = data.books || []
  state.categories = data.categories || []
}

/* ---------------- 视图：登录 / 注册 ---------------- */

let authMode = 'login'

function renderAuth() {
  const isLogin = authMode === 'login'
  const langLabel = SUPPORTED_LANGS[state.lang] || '简'
  $('#app').innerHTML = '<div class="auth-wrap"><div class="auth-card">' +
    '<button class="auth-lang-btn" id="auth-lang-btn" aria-label="切换繁简" title="切换简/繁">' + langLabel + '</button>' +
    '<h1>墨读书城</h1><p class="motto">一座安静的私人图书馆</p>' +
    '<div class="auth-tabs">' +
      '<button class="' + (isLogin ? 'active' : '') + '" data-mode="login">登 录</button>' +
      '<button class="' + (!isLogin ? 'active' : '') + '" data-mode="register">注 册</button>' +
    '</div>' +
    '<form id="auth-form" novalidate>' +
      '<div class="field"><label>用户名</label>' +
        '<input type="text" id="auth-username" autocomplete="username" required' + (isLogin ? '' : ' placeholder="3–32 位小写字母、数字、._-"') + '></div>' +
      '<div class="field"><label>密码</label>' +
        '<input type="password" id="auth-password" autocomplete="' + (isLogin ? 'current-password' : 'new-password') + '" required' + (isLogin ? '' : ' placeholder="10–128 位"') + '></div>' +
      (isLogin ? '' : '<div class="field"><label>邀请码</label><input type="text" id="auth-invite" required placeholder="注册需要有效邀请码"></div>') +
      '<div class="form-error" id="auth-error"></div>' +
      '<button class="btn primary block" id="auth-submit" type="submit">' + (isLogin ? '登 录' : '注 册') + '</button>' +
    '</form></div></div>'

  $('#auth-lang-btn')?.addEventListener('click', () => { setLang(state.lang === 'cn' ? 'tw' : 'cn') })
  $$('.auth-tabs button').forEach((btn) => btn.addEventListener('click', () => { authMode = btn.dataset.mode; renderAuth() }))
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const errorEl = $('#auth-error')
    errorEl.textContent = ''
    const username = $('#auth-username').value.trim()
    const password = $('#auth-password').value
    const submit = $('#auth-submit')
    submit.disabled = true
    submit.textContent = isLogin ? '登录中…' : '注册中…'
    try {
      let data
      if (isLogin) {
        data = await api('/v1/auth/login', { method: 'POST', body: { username, password } })
      } else {
        if (!/^[a-z0-9_\-.]{3,32}$/.test(username)) throw new Error('用户名需为 3–32 位小写字母、数字、点、横线或下划线')
        if (password.length < 10 || password.length > 128) throw new Error('密码长度需为 10–128 位')
        const inviteCode = $('#auth-invite').value.trim()
        if (!inviteCode) throw new Error('请填写邀请码')
        data = await api('/v1/auth/register', { method: 'POST', body: { username, password, inviteCode } })
      }
      setToken(data.token)
      state.user = data.user
      startPolling()
      location.hash = '#/'
      render()
    } catch (error) {
      errorEl.textContent = error.message
      submit.disabled = false
      submit.textContent = isLogin ? '登 录' : '注 册'
    }
  })
  translatePage()
}

/* ---------------- 视图：书城首页 ---------------- */

function renderHome(app) {
  const chips = ['<button class="chip' + (state.category === '' ? ' active' : '') + '" data-cat="">全部</button>']
    .concat(state.categories.map((c) =>
      '<button class="chip' + (state.category === c ? ' active' : '') + '" data-cat="' + esc(c) + '">' + esc(c) + '</button>')).join('')

  const cards = state.books.map((book) => {
    const rating = book.ratingCount
      ? '<span class="rating-stars">' + stars(book.averageRating).slice(0, Math.round(book.averageRating)) + '</span> ' +
        (book.averageRating ? Number(book.averageRating).toFixed(1) : '') + '（' + book.ratingCount + ' 人）'
      : '<span class="rating-none">暂无评分</span>'
    const badges = []
    if (book.status === 'ongoing') badges.push('<span class="card-badge ongoing">连载中</span>')
    badges.push('<span class="card-badge">' + (book.fileCount || 1) + ' 卷</span>')
    return '<article class="book-card" data-id="' + esc(book.id) + '">' +
      '<div class="book-cover">' + coverBoxHtml(book) + (badges.length ? '<div class="card-badges">' + badges.join('') + '</div>' : '') + '</div>' +
      '<div class="book-meta">' +
        '<div class="title">' + esc(book.title) + '</div>' +
        '<div class="author">' + esc(book.author || '佚名') + '</div>' +
        '<div class="sub">' + avatarHtml({ nickname: book.uploaderDisplay, avatar: book.uploaderAvatar }) +
          '<span>' + esc(book.uploaderDisplay || book.uploader) + '</span></div>' +
        '<div class="sub">' + rating + '</div>' +
      '</div></article>'
  }).join('')

  app.innerHTML = '<main class="page">' +
    '<section class="reader-download">' +
      '<div class="rd-text"><h2>下载墨读阅读器</h2>' +
      '<p>在 Windows 上安静地读完这座书城里的每一本书。书城账号与阅读器云同步互通。</p></div>' +
      '<div class="rd-links">' +
        '<a href="https://github.com/xfish987/moyu-reader/releases" target="_blank" rel="noopener">GitHub Releases（全部版本）&nearr;</a>' +
        '<a href="https://modu.cxnnn.cn/MoyuReader-2.5.0.exe">本站直链 · 便携版 MoyuReader-2.5.0.exe</a>' +
        '<a href="https://modu.cxnnn.cn/MoyuReader-2.5.0-Setup.msi">本站直链 · 安装包 MoyuReader-2.5.0-Setup.msi</a>' +
      '</div></section>' +
    '<section class="section">' +
      '<div class="store-tools">' +
        '<input class="search-input" id="search" type="text" placeholder="搜索书名、作者或上传者…" value="' + esc(state.query) + '">' +
        '<div class="chips">' + chips + '</div>' +
      '</div>' +
      (state.books.length
        ? '<div class="book-grid">' + cards + '</div>'
        : '<div class="empty-state">书架还空着，等第一本书到来。</div>') +
    '</section></main>'

  let debounce = null
  $('#search').addEventListener('input', (event) => {
    state.query = event.target.value.trim()
    const caret = event.target.selectionStart
    clearTimeout(debounce)
    debounce = setTimeout(async () => {
      try {
        await loadBooks()
        renderHome(app)
        // 重渲染后恢复搜索框焦点与光标位置，避免打字被打断
        const input = $('#search')
        input.focus()
        input.setSelectionRange(caret, caret)
      } catch (error) { toast(error.message, true) }
    }, 300)
  })
  $$('.chip', app).forEach((chip) => chip.addEventListener('click', async () => {
    state.category = chip.dataset.cat
    try { await loadBooks(); renderHome(app) } catch (error) { toast(error.message, true) }
  }))
  $$('.book-card', app).forEach((card) => card.addEventListener('click', () => {
    location.hash = '#/book/' + card.dataset.id
  }))
  hydrateCovers(app)
}

/* ---------------- 视图：书籍详情 ---------------- */

function groupBookFiles(files) {
  const groups = new Map()
  for (const f of files) {
    const key = f.group || ''
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(f)
  }
  return groups
}

async function renderBookDetail(app, bookId) {
  app.innerHTML = '<main class="page"><div class="loading-line">翻 页 中 …</div></main>'
  let book
  try {
    await loadAllBooks()
    book = state.books.find((entry) => entry.id === bookId)
  } catch (error) {
    toast(error.message, true)
  }
  if (!book) {
    app.innerHTML = '<main class="page"><a class="back-link" href="#/">&larr; 返回书城</a><div class="empty-state">这本书不存在或已被移除。</div></main>'
    return
  }

  const files = book.files || []
  const fileCount = files.length
  const avg = book.averageRating ? Number(book.averageRating).toFixed(1) : null
  const myReview = (book.reviews || []).find((r) => r.mine)
  const isOngoing = book.status === 'ongoing'

  const reviewsHtml = (book.reviews || []).length
    ? book.reviews.map((r) =>
        '<div class="review">' + avatarHtml(r) +
        '<div class="review-body"><div class="review-head">' +
          '<span class="name">' + esc(r.nickname || r.username) + '</span>' +
          (r.rating ? '<span class="rating-stars">' + stars(r.rating).slice(0, r.rating) + '</span>' : '') +
          '<span class="time">' + fmtTime(r.createdAt) + '</span>' +
          (r.mine ? '<button class="btn small danger" data-del-review>删除</button>' : '') +
        '</div>' +
        (r.comment ? '<div class="review-comment">' + esc(r.comment) + '</div>' : '') +
        '</div></div>').join('')
    : '<div class="empty-state">还没有评价，来写下第一条。</div>'

  const groups = groupBookFiles(files)
  let filesHtml = ''
  for (const [group, groupFiles] of groups) {
    filesHtml += '<div class="file-group">' +
      (group ? '<div class="file-group-title">' + esc(group) + '</div>' : '') +
      '<div class="file-list">' +
      groupFiles.map((f) =>
        '<div class="file-row">' +
          '<span class="file-name">' + esc(f.label || '未命名') + '</span>' +
          '<span class="file-meta">' + f.format + ' · ' + fmtSize(f.size) + '</span>' +
          '<button class="btn small" data-dl-file="' + esc(f.id) + '">下载</button>' +
        '</div>').join('') +
      '</div></div>'
  }

  const manageHtml = book.canManage
    ? '<section class="section"><h2>管理这本书</h2>' +
      '<div class="field"><label>书名</label><input type="text" id="edit-title" value="' + esc(book.title) + '"></div>' +
      '<div class="field"><label>作者</label><input type="text" id="edit-author" value="' + esc(book.author || '') + '"></div>' +
      '<div class="field"><label>分类（可选择或输入新分类）</label>' +
        '<input type="text" id="edit-category" list="category-list" value="' + esc(book.category) + '">' +
        '<datalist id="category-list">' + state.categories.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
      '<div class="field inline"><label class="checkbox-label"><input type="checkbox" id="edit-ongoing"' + (isOngoing ? ' checked' : '') + '> 连载中（后续还会追加新卷）</label></div>' +
      '<div class="btn-row">' +
        '<button class="btn primary" id="save-meta">保存修改</button>' +
        '<label class="btn" for="cover-input">上传 / 更换封面</label>' +
        '<input type="file" id="cover-input" accept="image/jpeg,image/png,image/webp" hidden>' +
      '</div>' +
      '<div id="files-editor" class="files-editor"></div>' +
      '<div id="append-files-box" class="append-files-box" style="display:none"></div>' +
      '</section>'
    : ''

  const statusBadge = isOngoing
    ? '<span class="status-badge ongoing">连载中</span>'
    : '<span class="status-badge completed">已完结</span>'

  app.innerHTML = '<main class="page">' +
    '<a class="back-link" href="#/">&larr; 返回书城</a>' +
    '<div class="detail-head">' +
      '<div class="detail-cover"><div class="book-cover">' + coverBoxHtml(book) + '</div></div>' +
      '<div class="detail-info">' +
        '<h1>' + esc(book.title) + ' ' + statusBadge + '</h1>' +
        '<p class="author-line">' + esc(book.author || '佚名') + '</p>' +
        '<div class="rating-big">' +
          (avg ? '<span class="num">' + avg + '</span><span class="rating-stars">' + stars(book.averageRating) + '</span><span class="rating-none">' + book.ratingCount + ' 人评分</span>'
               : '<span class="rating-none">暂无评分</span>') +
        '</div>' +
        '<div class="fact-grid">' +
          '<div class="fact"><div class="k">分类</div><div class="v">' + esc(book.category) + '</div></div>' +
          '<div class="fact"><div class="k">格式</div><div class="v">' + esc(book.format) + '</div></div>' +
          '<div class="fact"><div class="k">卷数</div><div class="v">' + fileCount + ' 卷</div></div>' +
          '<div class="fact"><div class="k">大小</div><div class="v">' + fmtSize(book.size) + '</div></div>' +
          '<div class="fact"><div class="k">上传者</div><div class="v">' + esc(book.uploaderDisplay || book.uploader) + '</div></div>' +
          '<div class="fact"><div class="k">上传时间</div><div class="v">' + fmtDay(book.uploadedAt) + '</div></div>' +
        '</div>' +
        '<div class="btn-row">' +
          '<button class="btn primary" id="download-all-btn">下载全部</button>' +
          (book.canManage ? '<button class="btn" id="append-btn">追加新卷</button>' : '') +
          '<button class="btn danger" id="delete-book">删除书籍</button>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<section class="section"><h2>文件列表</h2>' + filesHtml + '</section>' +
    '<section class="section"><h2>我的评价</h2>' +
      '<form id="review-form">' +
        '<div class="field"><label>评分</label><div class="star-picker" id="star-picker">' +
          [1, 2, 3, 4, 5].map((n) => '<button type="button" data-star="' + n + '"' + (myReview && myReview.rating >= n ? ' class="on"' : '') + '>★</button>').join('') +
        '</div></div>' +
        '<div class="field"><label>评论（可选）</label><textarea id="review-comment" maxlength="1200" placeholder="这本书给你留下了什么？">' + esc(myReview ? myReview.comment || '' : '') + '</textarea></div>' +
        '<button class="btn primary" id="review-submit" type="submit">' + (myReview ? '更新评价' : '发表评价') + '</button>' +
      '</form></section>' +
    '<section class="section"><h2>全部评价（' + (book.reviews || []).length + '）</h2>' + reviewsHtml + '</section>' +
    manageHtml +
  '</main>'

  hydrateCovers(app)

  // 下载全部
  $('#download-all-btn').addEventListener('click', async (event) => {
    const btn = event.currentTarget
    btn.disabled = true
    btn.textContent = '打包中…'
    try {
      const res = await api('/v1/store/books/' + book.id + '/download-all', { raw: true })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = book.title + '.zip'
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
      toast('已开始下载《' + book.title + '》全卷')
    } catch (error) {
      toast(error.message, true)
    } finally {
      btn.disabled = false
      btn.textContent = '下载全部'
    }
  })

  // 单独下载
  $$('[data-dl-file]', app).forEach((btn) => btn.addEventListener('click', async () => {
    btn.disabled = true
    try {
      const res = await api('/v1/store/books/' + book.id + '/files/' + btn.dataset.dlFile, { raw: true })
      const blob = await res.blob()
      const disposition = res.headers.get('content-disposition') || ''
      const match = disposition.match(/filename\*=UTF-8''([^;]+)/i)
      const filename = match ? decodeURIComponent(match[1]) : (book.title + '.' + (book.format === 'EPUB' ? 'epub' : 'txt'))
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 10000)
    } catch (error) {
      toast(error.message, true)
    } finally {
      btn.disabled = false
    }
  }))

  // 评分选择
  let picked = myReview ? myReview.rating : 0
  const paintStars = () => $$('#star-picker button').forEach((b) => b.classList.toggle('on', Number(b.dataset.star) <= picked))
  $$('#star-picker button').forEach((btn) => btn.addEventListener('click', () => { picked = Number(btn.dataset.star); paintStars() }))

  // 发表 / 更新评价
  $('#review-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!picked) { toast('请先选择评分', true); return }
    const submit = $('#review-submit')
    submit.disabled = true
    try {
      await api('/v1/store/books/' + book.id + '/review', {
        method: 'PUT',
        body: { rating: picked, comment: $('#review-comment').value.trim() },
      })
      toast('评价已发表')
      renderBookDetail(app, book.id)
    } catch (error) {
      toast(error.message, true)
      submit.disabled = false
    }
  })

  // 删除自己的评价
  $$('[data-del-review]', app).forEach((btn) => btn.addEventListener('click', async () => {
    if (!window.confirm('确定删除你的评价吗？')) return
    try {
      await api('/v1/store/books/' + book.id + '/review', { method: 'DELETE' })
      toast('评价已删除')
      renderBookDetail(app, book.id)
    } catch (error) { toast(error.message, true) }
  }))

  if (book.canManage) {
    const paintFilesEditor = () => {
      const editor = $('#files-editor')
      if (!editor) return
      editor.innerHTML = '<h3>整理分卷</h3><p class="hint">可修改系列/分组、卷标；删除按钮会移除该卷文件。</p>' +
        files.map((f, idx) =>
          '<div class="file-edit-row" data-idx="' + idx + '">' +
            '<input type="text" data-field="group" value="' + esc(f.group) + '" placeholder="系列/分组">' +
            '<input type="text" data-field="label" value="' + esc(f.label) + '" placeholder="卷标">' +
            '<span class="hint">' + f.format + ' · ' + fmtSize(f.size) + '</span>' +
            '<button type="button" class="btn small danger" data-del-file="' + esc(f.id) + '">删除</button>' +
          '</div>').join('') +
        '<button class="btn primary small" id="save-files">保存分卷整理</button>'

      $$('.file-edit-row input[data-field]', editor).forEach((input) => {
        input.addEventListener('input', () => {
          const idx = Number(input.closest('.file-edit-row').dataset.idx)
          files[idx][input.dataset.field] = input.value
        })
      })
      $$('[data-del-file]', editor).forEach((btn) => btn.addEventListener('click', async () => {
        if (files.length <= 1) { toast('至少保留一个文件', true); return }
        if (!window.confirm('确定删除这一卷吗？')) return
        try {
          await api('/v1/store/books/' + book.id + '/files/' + btn.dataset.delFile, { method: 'DELETE' })
          toast('已删除该卷')
          renderBookDetail(app, book.id)
        } catch (error) { toast(error.message, true) }
      }))
      $('#save-files').addEventListener('click', async () => {
        try {
          await api('/v1/store/books/' + book.id, { method: 'PATCH', body: { files: files.map((f) => ({ id: f.id, group: f.group, label: f.label })) } })
          toast('分卷整理已保存')
          renderBookDetail(app, book.id)
        } catch (error) { toast(error.message, true) }
      })
    }
    paintFilesEditor()

    $('#save-meta').addEventListener('click', async () => {
      const title = $('#edit-title').value.trim()
      const author = $('#edit-author').value.trim()
      const category = $('#edit-category').value.trim()
      if (!title) { toast('书名不能为空', true); return }
      if (!category) { toast('分类不能为空', true); return }
      try {
        await api('/v1/store/books/' + book.id, { method: 'PATCH', body: { title, author, category, status: $('#edit-ongoing').checked ? 'ongoing' : 'completed' } })
        toast('已保存修改')
        renderBookDetail(app, book.id)
      } catch (error) { toast(error.message, true) }
    })

    $('#cover-input').addEventListener('change', async (event) => {
      const file = event.target.files[0]
      if (!file) return
      if (file.size > 3 * 1024 * 1024) { toast('封面不能超过 3 MB', true); return }
      try {
        await api('/v1/store/books/' + book.id + '/cover', { method: 'PUT', body: file, headers: { 'content-type': file.type } })
        coverCache.delete(book.id)
        toast('封面已更新')
        renderBookDetail(app, book.id)
      } catch (error) { toast(error.message, true) }
    })

    // 追加新卷
    $('#append-btn').addEventListener('click', () => {
      const box = $('#append-files-box')
      box.style.display = box.style.display === 'none' ? 'block' : 'none'
      if (box.style.display === 'block' && !box.dataset.inited) {
        box.dataset.inited = '1'
        box.innerHTML = '<h3>追加新卷</h3>' +
          '<label class="btn" for="append-file-input">选择要追加的文件</label>' +
          '<input type="file" id="append-file-input" accept=".txt,.epub" multiple hidden>' +
          '<div id="append-files-list" class="up-files-list"></div>' +
          '<div class="btn-row"><button class="btn primary" id="append-submit">确认追加</button></div>' +
          '<div id="append-error" class="form-error"></div>'

        let appendFiles = []
        const paintAppendList = () => {
          const list = $('#append-files-list')
          if (!list) return
          list.innerHTML = appendFiles.map((f, idx) =>
            '<div class="up-file-row" data-idx="' + idx + '">' +
              '<div class="up-file-num">' + (idx + 1) + '</div>' +
              '<div class="up-file-fields">' +
                '<input type="text" class="up-file-group" data-field="group" value="' + esc(f.group) + '" placeholder="系列/分组（可选）">' +
                '<input type="text" class="up-file-label" data-field="label" value="' + esc(f.label) + '" placeholder="卷标">' +
              '</div>' +
              '<div class="up-file-info">' + esc(f.file.name) + ' <span class="hint">' + fmtSize(f.file.size) + '</span></div>' +
              '<button type="button" class="btn small danger" data-remove="' + idx + '">移除</button>' +
            '</div>').join('')
          $$('#append-files-list input[data-field]').forEach((input) => {
            input.addEventListener('input', () => {
              const idx = Number(input.closest('.up-file-row').dataset.idx)
              appendFiles[idx][input.dataset.field] = input.value
            })
          })
          $$('#append-files-list button[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
            appendFiles.splice(Number(btn.dataset.remove), 1)
            paintAppendList()
          }))
        }

        $('#append-file-input').addEventListener('change', (event) => {
          const selected = Array.from(event.target.files || [])
          const startIdx = appendFiles.length
          appendFiles = appendFiles.concat(selected.map((file, i) => {
            const ext = /\.(txt|epub)$/i.exec(file.name)
            return {
              file,
              extension: ext ? ext[0].toLowerCase() : '',
              group: '',
              label: `第 ${startIdx + i + 1} 卷`,
            }
          }).filter((f) => f.extension))
          paintAppendList()
        })

        $('#append-submit').addEventListener('click', async () => {
          const errorEl = $('#append-error')
          errorEl.textContent = ''
          if (!appendFiles.length) { errorEl.textContent = '请先选择文件'; return }
          const submit = $('#append-submit')
          submit.disabled = true
          try {
            const metadata = {
              title: book.title,
              author: book.author,
              category: book.category,
              files: appendFiles.map((f) => ({ group: f.group, label: f.label, extension: f.extension })),
            }
            const form = new FormData()
            form.append('metadata', b64url(JSON.stringify(metadata)))
            appendFiles.forEach((f) => form.append('file-' + Math.random().toString(36).slice(2), f.file))
            await api('/v1/store/books/' + book.id + '/files', { method: 'POST', body: form })
            toast('新卷已追加')
            renderBookDetail(app, book.id)
          } catch (error) {
            errorEl.textContent = error.message
            submit.disabled = false
          }
        })
      }
    })
  }

  $('#delete-book')?.addEventListener('click', async () => {
    if (!window.confirm('确定从书城删除《' + book.title + '》吗？所有用户都将无法再下载，此操作不可恢复。')) return
    if (!window.confirm('再次确认：书籍全部分卷与封面将永久移除。')) return
    const button = $('#delete-book')
    button.disabled = true
    button.textContent = '删除中…'
    try {
      await api('/v1/store/books/' + book.id, { method: 'DELETE' })
      state.books = state.books.filter((item) => item.id !== book.id)
      toast('书籍已从书城删除')
      location.hash = '#/'
    } catch (error) { toast(error.message, true); button.disabled = false; button.textContent = '删除书籍' }
  })
}

/* ---------------- 视图：上传 ---------------- */

// 浏览器端极简 ZIP/EPUB 解析：用于上传前自动读取书名、作者与封面。
// 仅支持 store/deflate 两种压缩方式，足以应付常规 EPUB。
async function zipEntries(arrayBuffer) {
  const view = new DataView(arrayBuffer)
  let eocd = -1
  for (let i = view.byteLength - 22; i >= Math.max(0, view.byteLength - 22 - 65536); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) return []
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries = []
  for (let i = 0; i < count && offset + 46 <= view.byteLength; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(new Uint8Array(arrayBuffer, offset + 46, nameLength))
    entries.push({ name, method, compressedSize, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

async function zipRead(arrayBuffer, entry) {
  const view = new DataView(arrayBuffer)
  if (view.getUint32(entry.localOffset, true) !== 0x04034b50) return null
  const nameLength = view.getUint16(entry.localOffset + 26, true)
  const extraLength = view.getUint16(entry.localOffset + 28, true)
  const start = entry.localOffset + 30 + nameLength + extraLength
  const raw = new Uint8Array(arrayBuffer, start, entry.compressedSize)
  if (entry.method === 0) return raw
  if (entry.method === 8) {
    try {
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
      return new Uint8Array(await new Response(stream).arrayBuffer())
    } catch (e) { return null }
  }
  return null
}

async function parseEpubFile(file) {
  const buffer = await file.arrayBuffer()
  const entries = await zipEntries(buffer)
  if (!entries.length) return null
  const read = async (name) => {
    const entry = entries.find((item) => item.name.toLowerCase() === name.toLowerCase())
    return entry ? zipRead(buffer, entry) : null
  }
  const containerBytes = await read('META-INF/container.xml')
  if (!containerBytes) return null
  const opfPath = new TextDecoder().decode(containerBytes).match(/full-path=["']([^"']+)["']/)?.[1]
  const opfBytes = opfPath && await read(opfPath)
  if (!opfBytes) return null
  const opf = new TextDecoder().decode(opfBytes)
  const decodeXml = (s) => String(s || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  const tag = (name) => {
    const m = opf.match(new RegExp('<' + name + '[^>]*>([\\s\\S]*?)</' + name + '>', 'i'))
    return m ? decodeXml(m[1].replace(/<[^>]+>/g, '').trim()) : ''
  }
  const coverId = opf.match(/<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)["']/)?.[1]
  const coverItem = opf.match(/<item[^>]+properties=["'][^"']*cover-image[^"']*["'][^>]*>/i)?.[0]
  const href = (coverItem && coverItem.match(/href=["']([^"']+)["']/)?.[1])
    || (coverId && opf.match(new RegExp(`<item[^>]+id=["']${coverId}["'][^>]*>`))?.[0]?.match(/href=["']([^"']+)["']/)?.[1])
    || null
  let cover = null
  const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const candidates = []
  if (href) candidates.push(decodeURIComponent(dir + href).replace(/^\//, ''))
  entries.filter((e) => /cover[^/]*\.(jpe?g|png|webp)$/i.test(e.name)).forEach((e) => candidates.push(e.name))
  for (const name of candidates) {
    const data = await read(name)
    if (data && data.length) {
      const mime = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'
      cover = { blob: new Blob([data], { type: mime }), mime }
      break
    }
  }
  return { title: tag('dc:title') || tag('title'), author: tag('dc:creator') || tag('dc:author'), cover }
}

// TXT：从文件名猜「书名 - 作者」「作者《书名》」
function guessFromFilename(name) {
  const base = name.replace(/\.(txt|epub)$/i, '').trim()
  let m = base.match(/^(.+?)[\-_—–\s]+([^\-_—–\s（(【\[]+?)(?:\s*[（(【\[].*)?$/)
  if (m && m[2].length <= 24) return { title: m[1].trim(), author: m[2].trim() }
  m = base.match(/^([^《》]{1,24})《(.+?)》/)
  if (m) return { title: m[2].trim(), author: m[1].trim() }
  m = base.match(/^《(.+?)》(?:\s*([^《》]{1,24}))?$/)
  if (m) return { title: m[1].trim(), author: (m[2] || '').trim() }
  return { title: base, author: '' }
}

function renderUpload(app) {
  app.innerHTML = '<main class="page">' +
    '<h1 class="page-title">上传书籍</h1><p class="page-sub">支持 TXT / EPUB，可多选分卷；总大小不超过 1 GB · 选中文件后会自动读取书名、作者和封面</p>' +
    '<div class="upload-layout">' +
      '<form id="upload-form">' +
        '<label class="file-drop" id="file-drop" for="up-file">' +
          '<input type="file" id="up-file" accept=".txt,.epub" multiple hidden>' +
          '<strong id="file-drop-title">点击选择书籍文件</strong>' +
          '<span id="file-drop-sub">可一次选择多卷 TXT / EPUB</span>' +
        '</label>' +
        '<div id="up-files-list" class="up-files-list"></div>' +
        '<div class="field"><label>书名 <span class="hint-chip" id="chip-title"></span></label>' +
          '<input type="text" id="up-title" required maxlength="160" placeholder="选择文件后自动填入，可修改"></div>' +
        '<div class="field"><label>作者 <span class="hint-chip" id="chip-author"></span></label>' +
          '<input type="text" id="up-author" maxlength="100" placeholder="未读取到时请手动填写，可留空为佚名"></div>' +
        '<div class="field"><label>分类（可选择或输入新分类）</label>' +
          '<input type="text" id="up-category" list="category-list" required maxlength="40" placeholder="如：起点 / 晋江 / 日轻…">' +
          '<datalist id="category-list">' + state.categories.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist></div>' +
        '<div class="field inline"><label class="checkbox-label"><input type="checkbox" id="up-ongoing"> 这本书仍在连载，后续还会追加新卷</label></div>' +
        '<div class="form-error" id="up-error"></div>' +
        '<button class="btn primary block" id="up-submit" type="submit">上传到书城</button>' +
        '<div id="up-progress" class="hint" style="margin-top:10px;color:var(--ink-faint)"></div>' +
      '</form>' +
      '<aside class="upload-preview" id="upload-preview">' +
        '<div class="up-empty">选中书籍文件后，这里会显示它上架后的样子</div>' +
      '</aside>' +
    '</div></main>'

  let pickedFiles = [] // { file, extension, format, guessedTitle, guessedAuthor, group, label, coverBlob, coverUrl }
  let autoCoverBlob = null
  let customCover = null
  let customCoverUrl = ''

  const filesList = $('#up-files-list')
  const preview = $('#upload-preview')

  function chip(el, ok, autoText, missText) {
    el.textContent = ok ? autoText : missText
    el.className = 'hint-chip ' + (ok ? 'ok' : 'miss')
  }

  function defaultLabel(index) {
    return index === 0 ? '' : `第 ${index + 1} 卷`
  }

  function groupFilesForPreview() {
    const groups = new Map()
    for (const f of pickedFiles) {
      const key = f.group || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(f)
    }
    return groups
  }

  function paintPreview() {
    const title = $('#up-title').value.trim() || '未命名'
    const author = $('#up-author').value.trim() || '佚名'
    const coverUrl = customCoverUrl || (autoCoverBlob ? URL.createObjectURL(autoCoverBlob) : '')
    const totalSize = pickedFiles.reduce((s, f) => s + f.file.size, 0)
    const groups = groupFilesForPreview()
    let filesHtml = ''
    for (const [group, files] of groups) {
      filesHtml += '<div class="up-group">' +
        (group ? '<div class="up-group-title">' + esc(group) + '</div>' : '') +
        '<ul class="up-group-files">' +
        files.map((f) => '<li>' + esc(f.label || f.file.name) + ' <span class="hint">' + f.format + ' · ' + fmtSize(f.file.size) + '</span></li>').join('') +
        '</ul></div>'
    }
    preview.innerHTML = '<div class="up-label">上架预览</div>' +
      '<div class="up-card">' +
        '<div class="book-cover">' +
          (coverUrl ? '<img src="' + esc(coverUrl) + '" alt="封面预览">' : placeholderHtml('EPUB', title.charAt(0))) +
        '</div>' +
        '<div class="book-meta"><div class="title">' + esc(title) + '</div>' +
        '<div class="author">' + esc(author) + '</div>' +
        '<div class="sub">' + pickedFiles.length + ' 个文件 · ' + fmtSize(totalSize) + '</div></div>' +
      '</div>' +
      (pickedFiles.length ? '<div class="up-files-preview">' + filesHtml + '</div>' : '') +
      '<div class="up-cover-row">' +
        '<label class="btn small" for="up-cover">' + (coverUrl ? '更换封面' : '上传封面') + '</label>' +
        '<input type="file" id="up-cover" accept="image/jpeg,image/png,image/webp" hidden>' +
        '<span class="hint">' + (customCover ? '已选择自定义封面' : autoCoverBlob ? '封面自动读取自书籍文件' : '未读取到封面，建议上传一张') + '</span>' +
      '</div>'
    $('#up-cover').addEventListener('change', (event) => {
      const f = event.target.files[0]
      if (!f) return
      if (f.size > 3 * 1024 * 1024) { toast('封面不能超过 3 MB', true); return }
      customCover = f
      if (customCoverUrl) URL.revokeObjectURL(customCoverUrl)
      customCoverUrl = URL.createObjectURL(f)
      paintPreview()
    })
  }

  function paintFilesList() {
    if (!pickedFiles.length) {
      filesList.innerHTML = ''
      return
    }
    filesList.innerHTML = '<div class="up-files-head"><span>已选文件</span><span class="hint">可填写系列/分组与卷标</span></div>' +
      pickedFiles.map((f, idx) =>
        '<div class="up-file-row" data-idx="' + idx + '">' +
          '<div class="up-file-num">' + (idx + 1) + '</div>' +
          '<div class="up-file-fields">' +
            '<input type="text" class="up-file-group" data-field="group" value="' + esc(f.group) + '" placeholder="系列/分组（可选）">' +
            '<input type="text" class="up-file-label" data-field="label" value="' + esc(f.label) + '" placeholder="卷标">' +
          '</div>' +
          '<div class="up-file-info">' + esc(f.file.name) + ' <span class="hint">' + fmtSize(f.file.size) + '</span></div>' +
          '<button type="button" class="btn small danger" data-remove="' + idx + '">移除</button>' +
        '</div>').join('')

    $$('.up-file-row input[data-field]', filesList).forEach((input) => {
      input.addEventListener('input', (event) => {
        const idx = Number(input.closest('.up-file-row').dataset.idx)
        const field = input.dataset.field
        pickedFiles[idx][field] = input.value
        paintPreview()
      })
    })
    $$('.up-file-row button[data-remove]', filesList).forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.remove)
        pickedFiles.splice(idx, 1)
        paintFilesList()
        paintPreview()
      })
    })
  }

  $('#up-title').addEventListener('input', paintPreview)
  $('#up-author').addEventListener('input', paintPreview)

  $('#up-file').addEventListener('change', async (event) => {
    const files = Array.from(event.target.files || [])
    if (!files.length) return
    pickedFiles = files.map((file, idx) => {
      const ext = /\.(txt|epub)$/i.exec(file.name)
      const guessed = ext ? guessFromFilename(file.name) : { title: '', author: '' }
      return {
        file,
        extension: ext ? ext[0].toLowerCase() : '',
        format: ext && ext[1].toLowerCase() === 'epub' ? 'EPUB' : 'TXT',
        guessedTitle: guessed.title,
        guessedAuthor: guessed.author,
        group: '',
        label: defaultLabel(idx),
        coverBlob: null,
        coverUrl: '',
      }
    }).filter((f) => f.extension)

    autoCoverBlob = null
    customCover = null
    if (customCoverUrl) { URL.revokeObjectURL(customCoverUrl); customCoverUrl = '' }

    $('#file-drop-title').textContent = pickedFiles.length + ' 个文件已选择'
    $('#file-drop-sub').textContent = '点击可重新选择'

    // 自动读取第一个 EPUB 的元数据与封面
    const firstEpub = pickedFiles.find((f) => f.format === 'EPUB')
    if (firstEpub) {
      chip($('#chip-title'), false, '', '来自文件名')
      chip($('#chip-author'), false, '', firstEpub.guessedAuthor ? '来自文件名' : '未读取到')
      try {
        const meta = await parseEpubFile(firstEpub.file)
        if (meta) {
          if (meta.title) { $('#up-title').value = meta.title; chip($('#chip-title'), true, '已自动读取', '') }
          if (meta.author) { $('#up-author').value = meta.author; chip($('#chip-author'), true, '已自动读取', '') }
          if (meta.cover) { autoCoverBlob = meta.cover.blob; firstEpub.coverBlob = meta.cover.blob }
        }
      } catch (e) { /* 解析失败就保留文件名猜测 */ }
    }
    // 若没读到书名，使用第一个文件的书名猜测
    if (!$('#up-title').value.trim() && pickedFiles[0].guessedTitle) {
      $('#up-title').value = pickedFiles[0].guessedTitle
      chip($('#chip-title'), false, '', '来自文件名')
    }
    if (!$('#up-author').value.trim() && pickedFiles[0].guessedAuthor) {
      $('#up-author').value = pickedFiles[0].guessedAuthor
      chip($('#chip-author'), false, '', '来自文件名')
    }

    paintFilesList()
    paintPreview()
  })

  $('#upload-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const errorEl = $('#up-error')
    errorEl.textContent = ''
    const title = $('#up-title').value.trim()
    const author = $('#up-author').value.trim()
    const category = $('#up-category').value.trim()
    const ongoing = $('#up-ongoing').checked
    if (!pickedFiles.length) { errorEl.textContent = '请先选择书籍文件'; return }
    if (!title || !category) { errorEl.textContent = '书名和分类不能为空'; return }

    const submit = $('#up-submit')
    const progress = $('#up-progress')
    submit.disabled = true
    progress.textContent = '上传中… 大文件请耐心等待，请勿关闭页面。'

    try {
      const extension = pickedFiles[0].extension
      const metadata = {
        title,
        author,
        category,
        status: ongoing ? 'ongoing' : 'completed',
        files: pickedFiles.map((f) => ({ group: f.group, label: f.label, extension: f.extension })),
      }

      let book
      if (pickedFiles.length === 1) {
        // 单文件保持旧路径，兼容且简单
        const data = await api('/v1/store/books', {
          method: 'POST',
          headers: { 'x-moyu-book': b64url(JSON.stringify({ ...metadata, extension })), 'content-type': 'application/octet-stream' },
          body: pickedFiles[0].file,
        })
        book = data.book
      } else {
        // 多文件使用 multipart/form-data
        const form = new FormData()
        form.append('metadata', b64url(JSON.stringify(metadata)))
        pickedFiles.forEach((f) => form.append('file-' + Math.random().toString(36).slice(2), f.file))
        const data = await api('/v1/store/books', { method: 'POST', body: form })
        book = data.book
      }

      if (customCover) {
        progress.textContent = '上传封面…'
        try {
          await api('/v1/store/books/' + book.id + '/cover', { method: 'PUT', body: customCover, headers: { 'content-type': customCover.type } })
        } catch (error) {
          toast('书籍已上传，但封面上传失败：' + error.message, true)
        }
      }
      coverCache.delete(book.id)
      toast('《' + title + '》已上架')
      location.hash = '#/book/' + book.id
    } catch (error) {
      errorEl.textContent = error.message
      submit.disabled = false
      progress.textContent = ''
    }
  })
}

/* ---------------- 视图：搜书制作（so-novel 引擎） ---------------- */

const JOB_STATUS = {
  queued: ['排队中', 'wait'],
  running: ['下载中…', 'wait'],
  done: ['已完成', 'ok'],
  error: ['失败', 'bad'],
}

async function refreshNovelJobs(app) {
  try {
    const data = await api('/v1/novel/jobs')
    state.novel.jobs = data.jobs || []
    if ($('#novel-jobs', app)) paintNovelJobs(app)
    if (state.jobsOpen) renderJobsPanel()
  } catch (e) { /* 引擎未配置时静默 */ }
}

function paintNovelJobs(app) {
  const box = $('#novel-jobs', app)
  if (!box) return
  const jobs = state.novel.jobs
  if (!jobs.length) {
    box.innerHTML = '<div class="empty-state">还没有制作任务。搜索后勾选书籍，点击「制作选中的书」。</div>'
    return
  }
  const selected = state.novel.jobsSelected
  const bulkStore = state.novel.bulkStore
  box.innerHTML = '<div class="novel-toolbar">' +
      '<label class="novel-select-all"><input type="checkbox" id="nj-all"' + (selected.size === jobs.length ? ' checked' : '') + '> 全选</label>' +
      '<span class="hint">共 ' + jobs.length + ' 个任务，已选 <b id="nj-count">' + selected.size + '</b> 本</span>' +
      '<button class="btn primary small" id="nj-bulk-dl"' + (selected.size ? '' : ' disabled') + '>下载所选</button>' +
      '<button class="btn small" id="nj-bulk-lib"' + (selected.size ? '' : ' disabled') + '>加入书架</button>' +
      '<button class="btn small" id="nj-bulk-store"' + (selected.size ? '' : ' disabled') + '>上架书城</button>' +
    '</div>' +
    (bulkStore ? '<div class="job-store-form bulk-store-form">' +
      '<input type="text" id="njs-category" list="category-list" maxlength="40" placeholder="为这些书选择分类（必选）">' +
      '<div class="btn-row">' +
        '<button class="btn primary small" id="njs-bulk-ok">确认上架</button>' +
        '<button class="btn small" id="njs-bulk-cancel">取消</button>' +
      '</div>' +
      '<div class="hint">EPUB 封面会在上架时自动提取匹配</div>' +
    '</div>' : '') +
    jobs.map((job) => {
      const [label, tone] = JOB_STATUS[job.status] || [job.status, 'wait']
      const done = job.status === 'done'
      const checked = selected.has(job.id) ? ' checked' : ''
      const storeForm = !bulkStore && state.novel.storeFor === job.id
        ? '<div class="job-store-form">' +
            '<input type="text" id="js-title-' + job.id + '" value="' + esc(job.title) + '" maxlength="160" placeholder="书名">' +
            '<input type="text" id="js-author-' + job.id + '" value="' + esc(job.author || '') + '" maxlength="100" placeholder="作者">' +
            '<input type="text" id="js-category-' + job.id + '" list="category-list" maxlength="40" placeholder="分类（必选）">' +
            '<div class="btn-row">' +
              '<button class="btn primary small" data-store-ok="' + job.id + '">确认上架</button>' +
              '<button class="btn small" data-store-cancel>取消</button>' +
            '</div>' +
            '<div class="hint">EPUB 封面会在上架时自动提取匹配</div>' +
          '</div>'
        : ''
      return '<div class="job-card" data-job="' + job.id + '">' +
        '<input type="checkbox" data-select="' + job.id + '"' + checked + '>' +
        '<div class="job-main" style="flex:1;min-width:200px">' +
          '<div class="title">' + esc(job.title) + '</div>' +
          '<div class="author">' + esc(job.author || '佚名') + '</div>' +
          jobProgressHtml(job) +
          (job.status === 'error' ? '<div class="job-error">' + esc(job.error || '下载失败') + '</div>' : '') +
        '</div>' +
        '<div class="job-side">' +
          '<span class="status ' + tone + '">' + label + '</span>' +
          (done ? '<div class="btn-row">' +
            '<button class="btn small" data-dl="' + job.id + '">下载</button>' +
            '<button class="btn small" data-lib="' + job.id + '"' + (job.addedToLibraryAt ? ' disabled' : '') + '>' + (job.addedToLibraryAt ? '已在书架' : '加入书架') + '</button>' +
            '<button class="btn small" data-store="' + job.id + '"' + (job.toStore ? ' disabled' : '') + '>' + (job.toStore ? '已上架' : '上传到书城') + '</button>' +
          '</div>' : '') +
        '</div>' +
        storeForm +
      '</div>'
    }).join('')

  const syncCount = () => {
    $('#nj-count').textContent = String(selected.size)
    $('#nj-bulk-dl').disabled = !selected.size
    $('#nj-bulk-lib').disabled = !selected.size
    $('#nj-bulk-store').disabled = !selected.size
    $('#nj-all').checked = selected.size === jobs.length && jobs.length > 0
  }

  // 单个选择
  $$('input[data-select]', box).forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) selected.add(cb.dataset.select)
    else selected.delete(cb.dataset.select)
    syncCount()
  }))

  // 全选
  $('#nj-all').addEventListener('change', (event) => {
    state.novel.jobsSelected = event.target.checked ? new Set(jobs.map((j) => j.id)) : new Set()
    paintNovelJobs(app)
  })

  // 批量下载
  $('#nj-bulk-dl').addEventListener('click', async () => {
    for (const id of selected) {
      const job = jobs.find((j) => j.id === id)
      if (job && job.status === 'done') await downloadNovelJob(job)
    }
  })

  // 批量加入书架
  $('#nj-bulk-lib').addEventListener('click', async () => {
    let ok = 0
    for (const id of selected) {
      const job = jobs.find((j) => j.id === id)
      if (!job || job.status === 'done' && job.toLibrary) continue
      try {
        await api('/v1/novel/jobs/' + job.id + '/to-library', { method: 'POST', body: { title: job.title, author: job.author } })
        job.addedToLibraryAt = new Date().toISOString()
        ok++
      } catch (e) { toast(e.message, true) }
    }
    if (ok) toast(ok + ' 本书已加入书架')
    paintNovelJobs(app)
  })

  // 批量上架：展开分类表单
  $('#nj-bulk-store').addEventListener('click', () => {
    state.novel.bulkStore = true
    paintNovelJobs(app)
  })
  $('#njs-bulk-cancel')?.addEventListener('click', () => {
    state.novel.bulkStore = false
    paintNovelJobs(app)
  })
  $('#njs-bulk-ok')?.addEventListener('click', async () => {
    const category = $('#njs-category').value.trim()
    if (!category) { toast('请填写分类', true); return }
    let ok = 0
    for (const id of selected) {
      const job = jobs.find((j) => j.id === id)
      if (!job || job.status !== 'done' || job.toStore) continue
      try {
        await api('/v1/novel/jobs/' + job.id + '/to-store', { method: 'POST', body: { title: job.title, author: job.author, category } })
        job.toStore = true
        ok++
      } catch (e) { toast(e.message, true) }
    }
    state.novel.bulkStore = false
    if (ok) toast(ok + ' 本书已上架到共享书城')
    paintNovelJobs(app)
  })

  // 下载到本地
  $$('[data-dl]', box).forEach((btn) => btn.addEventListener('click', async () => {
    const job = state.novel.jobs.find((j) => j.id === btn.dataset.dl)
    if (job) await downloadNovelJob(job)
  }))

  // 加入个人书架（阅读器云同步可见）
  $$('[data-lib]', box).forEach((btn) => btn.addEventListener('click', async () => {
    const job = state.novel.jobs.find((j) => j.id === btn.dataset.lib)
    btn.disabled = true
    btn.textContent = '加入中…'
    try {
      await api('/v1/novel/jobs/' + job.id + '/to-library', { method: 'POST', body: { title: job.title, author: job.author } })
      job.addedToLibraryAt = new Date().toISOString()
      toast('《' + job.title + '》已加入你的书架，阅读器同步后可见')
    } catch (error) { toast(error.message, true) }
    paintNovelJobs(app)
  }))

  // 上传到书城：展开信息表单
  $$('[data-store]', box).forEach((btn) => btn.addEventListener('click', () => {
    state.novel.storeFor = state.novel.storeFor === btn.dataset.store ? null : btn.dataset.store
    state.novel.bulkStore = false
    paintNovelJobs(app)
  }))
  $$('[data-store-cancel]', box).forEach((btn) => btn.addEventListener('click', () => {
    state.novel.storeFor = null
    paintNovelJobs(app)
  }))
  $$('[data-store-ok]', box).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.storeOk
    const job = state.novel.jobs.find((j) => j.id === id)
    const title = $('#js-title-' + id).value.trim()
    const author = $('#js-author-' + id).value.trim()
    const category = $('#js-category-' + id).value.trim()
    if (!title) { toast('书名不能为空', true); return }
    if (!category) { toast('请填写分类', true); return }
    btn.disabled = true
    btn.textContent = '上架中…'
    try {
      await api('/v1/novel/jobs/' + id + '/to-store', { method: 'POST', body: { title, author, category } })
      job.toStore = true
      state.novel.storeFor = null
      toast('《' + title + '》已上架到共享书城')
    } catch (error) { toast(error.message, true) }
    paintNovelJobs(app)
  }))
}

async function downloadNovelJob(job) {
  try {
    const res = await api('/v1/novel/jobs/' + job.id + '/file', { raw: true })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (job.title || 'book') + (blob.type.includes('epub') ? '.epub' : '.txt')
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    toast('已开始下载《' + job.title + '》')
  } catch (error) { toast(error.message, true) }
}

function paintNovelResults(app) {
  const box = $('#novel-results', app)
  if (!box) return
  const n = state.novel
  if (n.searching) {
    box.innerHTML = '<div class="loading-line">正 在 全 网 搜 索 …</div>'
    return
  }
  if (!n.results) {
    box.innerHTML = '<div class="empty-state">输入书名或作者开始搜索，结果来自多个书源。</div>'
    return
  }
  if (!n.results.length) {
    box.innerHTML = '<div class="empty-state">没有找到「' + esc(n.keyword) + '」相关的书，换个关键词试试。</div>'
    return
  }
  const rows = n.results.map((item, i) => {
    const checked = n.selected.has(item.url) ? ' checked' : ''
    return '<label class="novel-row">' +
      '<input type="checkbox" data-idx="' + i + '"' + checked + '>' +
      '<div class="novel-info">' +
        '<div class="title">' + esc(item.title) + '</div>' +
        '<div class="meta">' + esc(item.author || '佚名') +
          (item.category ? ' · ' + esc(item.category) : '') +
          (item.status ? ' · ' + esc(item.status) : '') +
          (item.wordCount ? ' · ' + esc(item.wordCount) : '') + '</div>' +
        (item.latestChapter ? '<div class="meta dim">最新：' + esc(item.latestChapter) + '</div>' : '') +
      '</div>' +
      '<span class="source-tag">' + esc(item.source || '书源') + '</span>' +
    '</label>'
  }).join('')
  box.innerHTML = '<div class="novel-toolbar">' +
      '<label class="novel-select-all"><input type="checkbox" id="novel-all"' + (n.selected.size === n.results.length ? ' checked' : '') + '> 全选</label>' +
      '<span class="hint">共 ' + n.results.length + ' 个结果，已选 <b id="novel-count">' + n.selected.size + '</b> 本</span>' +
      '<button class="btn primary small" id="novel-make"' + (n.selected.size ? '' : ' disabled') + '>制作选中的书</button>' +
    '</div>' + rows

  const syncCount = () => {
    $('#novel-count').textContent = String(n.selected.size)
    $('#novel-make').disabled = !n.selected.size
    $('#novel-all').checked = n.selected.size === n.results.length
  }
  $$('input[data-idx]', box).forEach((cb) => cb.addEventListener('change', () => {
    const item = n.results[Number(cb.dataset.idx)]
    if (cb.checked) n.selected.add(item.url)
    else n.selected.delete(item.url)
    syncCount()
  }))
  $('#novel-all').addEventListener('change', (event) => {
    n.selected = event.target.checked ? new Set(n.results.map((r) => r.url)) : new Set()
    paintNovelResults(app)
  })
  $('#novel-make').addEventListener('click', async () => {
    const items = n.results.filter((r) => n.selected.has(r.url))
      .map((r) => ({ url: r.url, title: r.title, author: r.author }))
    if (!items.length) return
    const btn = $('#novel-make')
    btn.disabled = true
    btn.textContent = '创建任务中…'
    try {
      await api('/v1/novel/jobs', { method: 'POST', body: { items } })
      toast('已创建 ' + items.length + ' 个制作任务，引擎开始下载')
      n.selected = new Set()
      await refreshNovelJobs(app)
      paintNovelResults(app)
    } catch (error) {
      toast(error.message, true)
      btn.disabled = false
      btn.textContent = '制作选中的书'
    }
  })
}

function renderNovel(app) {
  const n = state.novel
  app.innerHTML = '<main class="page">' +
    '<h1 class="page-title">搜书制作</h1>' +
    '<p class="page-sub">聚合多个书源搜索网络小说，制作成 EPUB 后可以：直接下载 · 加入个人书架 · 分享到共享书城</p>' +
    '<div class="novel-search">' +
      '<input class="search-input" id="novel-kw" type="text" placeholder="输入书名或作者，回车搜索…" value="' + esc(n.keyword) + '">' +
      '<button class="btn primary" id="novel-go">搜 索</button>' +
    '</div>' +
    '<section class="section" style="margin-top:24px"><div id="novel-results"></div></section>' +
    '<section class="section"><h2>制作任务</h2>' +
      '<datalist id="category-list">' + state.categories.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<div id="novel-jobs"></div>' +
    '</section></main>'

  paintNovelResults(app)
  paintNovelJobs(app)
  refreshNovelJobs(app)

  const doSearch = async () => {
    const keyword = $('#novel-kw').value.trim()
    if (!keyword) { toast('请输入搜索关键词', true); return }
    n.keyword = keyword
    n.searching = true
    n.selected = new Set()
    paintNovelResults(app)
    try {
      const data = await api('/v1/novel/search?q=' + encodeURIComponent(keyword))
      n.results = data.results || []
    } catch (error) {
      n.results = null
      toast(error.message, true)
    }
    n.searching = false
    paintNovelResults(app)
  }
  $('#novel-go').addEventListener('click', doSearch)
  $('#novel-kw').addEventListener('keydown', (event) => { if (event.key === 'Enter') doSearch() })

  // 有任务在跑时 3 秒轮询一次，离开页面即停止
  startJobPolling(() => {
    const active = state.novel.jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (active || !state.novel.jobsPolled) refreshNovelJobs(app)
    state.novel.jobsPolled = true
  })
}

/* ---------------- 视图：EPUB 制作（cn-epub-maker） ---------------- */

async function refreshEpubMakerJobs(app) {
  try {
    const data = await api('/v1/epub-maker/jobs')
    state.epubMaker.jobs = data.jobs || []
    if ($('#em-jobs', app)) paintEpubMakerJobs(app)
    if (state.jobsOpen) renderJobsPanel()
  } catch (e) { /* 服务未配置时静默 */ }
}

function paintEpubMakerJobs(app) {
  const box = $('#em-jobs', app)
  if (!box) return
  const jobs = state.epubMaker.jobs
  if (!jobs.length) {
    box.innerHTML = '<div class="empty-state">还没有制作任务。上传 TXT 文件并点击「开始制作」。</div>'
    return
  }
  const selected = state.epubMaker.selected
  const bulkStore = state.epubMaker.bulkStore
  box.innerHTML = '<div class="novel-toolbar">' +
      '<label class="novel-select-all"><input type="checkbox" id="em-all"' + (selected.size === jobs.length && jobs.length ? ' checked' : '') + '> 全选</label>' +
      '<span class="hint">共 ' + jobs.length + ' 个任务，已选 <b id="em-count">' + selected.size + '</b> 本</span>' +
      '<button class="btn primary small" id="em-bulk-dl"' + (selected.size ? '' : ' disabled') + '>下载所选</button>' +
      '<button class="btn small" id="em-bulk-lib"' + (selected.size ? '' : ' disabled') + '>加入书架</button>' +
      '<button class="btn small" id="em-bulk-store"' + (selected.size ? '' : ' disabled') + '>上架书城</button>' +
    '</div>' +
    (bulkStore ? '<div class="job-store-form bulk-store-form">' +
      '<input type="text" id="ems-bulk-category" list="category-list" maxlength="40" placeholder="为这些书选择分类（必选）">' +
      '<div class="btn-row">' +
        '<button class="btn primary small" id="ems-bulk-ok">确认上架</button>' +
        '<button class="btn small" id="ems-bulk-cancel">取消</button>' +
      '</div>' +
      '<div class="hint">EPUB 封面会在上架时自动提取匹配</div>' +
    '</div>' : '') +
    jobs.map((job) => {
      const [label, tone] = JOB_STATUS[job.status] || [job.status, 'wait']
      const done = job.status === 'done'
      const checked = selected.has(job.id) ? ' checked' : ''
      const storeForm = !bulkStore && state.epubMaker.storeFor === job.id
        ? '<div class="job-store-form">' +
            '<input type="text" id="ems-title-' + job.id + '" value="' + esc(job.title) + '" maxlength="160" placeholder="书名">' +
            '<input type="text" id="ems-author-' + job.id + '" value="' + esc(job.author || '') + '" maxlength="100" placeholder="作者">' +
            '<input type="text" id="ems-category-' + job.id + '" list="category-list" maxlength="40" placeholder="分类（必选）">' +
            '<div class="btn-row">' +
              '<button class="btn primary small" data-store-ok="' + job.id + '">确认上架</button>' +
              '<button class="btn small" data-store-cancel>取消</button>' +
            '</div>' +
          '</div>'
        : ''
      return '<div class="job-card" data-job="' + job.id + '">' +
        '<input type="checkbox" data-select="' + job.id + '"' + checked + '>' +
        '<div class="job-main" style="flex:1;min-width:200px">' +
          '<div class="title">' + esc(job.title) + '</div>' +
          '<div class="author">' + esc(job.author || '佚名') + '</div>' +
          jobProgressHtml(job) +
          (job.status === 'error' ? '<div class="job-error">' + esc(job.error || '制作失败') + '</div>' : '') +
        '</div>' +
        '<div class="job-side">' +
          '<span class="status ' + tone + '">' + label + '</span>' +
          (done ? '<div class="btn-row">' +
            '<button class="btn small" data-dl="' + job.id + '">下载</button>' +
            '<button class="btn small" data-lib="' + job.id + '"' + (job.addedToLibraryAt ? ' disabled' : '') + '>' + (job.addedToLibraryAt ? '已在书架' : '加入书架') + '</button>' +
            '<button class="btn small" data-store="' + job.id + '">上传书城</button>' +
          '</div>' : '') +
        '</div>' +
        storeForm +
      '</div>'
    }).join('')

  const syncCount = () => {
    $('#em-count').textContent = String(selected.size)
    $('#em-bulk-dl').disabled = !selected.size
    $('#em-bulk-lib').disabled = !selected.size
    $('#em-bulk-store').disabled = !selected.size
    $('#em-all').checked = selected.size === jobs.length && jobs.length > 0
  }

  // 单个选择
  $$('input[data-select]', box).forEach((cb) => cb.addEventListener('change', () => {
    if (cb.checked) selected.add(cb.dataset.select)
    else selected.delete(cb.dataset.select)
    syncCount()
  }))

  // 全选
  $('#em-all').addEventListener('change', (event) => {
    state.epubMaker.selected = event.target.checked ? new Set(jobs.map((j) => j.id)) : new Set()
    paintEpubMakerJobs(app)
  })

  // 批量下载
  $('#em-bulk-dl').addEventListener('click', async () => {
    for (const id of selected) {
      const job = jobs.find((j) => j.id === id)
      if (job && job.status === 'done') await downloadEpubMakerJob(job)
    }
  })

  // 批量加入书架
  $('#em-bulk-lib').addEventListener('click', async () => {
    let ok = 0
    for (const id of selected) {
      const job = jobs.find((j) => j.id === id)
      if (!job || job.status !== 'done') continue
      try {
        await api('/v1/epub-maker/jobs/' + job.id + '/to-library', { method: 'POST', body: { title: job.title, author: job.author } })
        ok++
      } catch (e) { toast(e.message, true) }
    }
    if (ok) toast(ok + ' 本书已加入书架')
  })

  // 批量上架：展开分类表单
  $('#em-bulk-store').addEventListener('click', () => {
    state.epubMaker.bulkStore = true
    paintEpubMakerJobs(app)
  })
  $('#ems-bulk-cancel')?.addEventListener('click', () => {
    state.epubMaker.bulkStore = false
    paintEpubMakerJobs(app)
  })
  $('#ems-bulk-ok')?.addEventListener('click', async () => {
    const category = $('#ems-bulk-category').value.trim()
    if (!category) { toast('请填写分类', true); return }
    let ok = 0
    for (const id of selected) {
      const job = jobs.find((j) => j.id === id)
      if (!job || job.status !== 'done') continue
      try {
        await api('/v1/epub-maker/jobs/' + job.id + '/to-store', { method: 'POST', body: { title: job.title, author: job.author, category } })
        ok++
      } catch (e) { toast(e.message, true) }
    }
    state.epubMaker.bulkStore = false
    if (ok) toast(ok + ' 本书已上架到共享书城')
    paintEpubMakerJobs(app)
  })

  // 单个下载
  $$('[data-dl]', box).forEach((btn) => btn.addEventListener('click', async () => {
    const job = jobs.find((j) => j.id === btn.dataset.dl)
    if (job) await downloadEpubMakerJob(job)
  }))

  // 单个加入书架
  $$('[data-lib]', box).forEach((btn) => btn.addEventListener('click', async () => {
    const job = jobs.find((j) => j.id === btn.dataset.lib)
    btn.disabled = true
    btn.textContent = '加入中…'
    try {
      await api('/v1/epub-maker/jobs/' + job.id + '/to-library', { method: 'POST', body: { title: job.title, author: job.author } })
      toast('《' + job.title + '》已加入你的书架')
    } catch (error) { toast(error.message, true) }
    btn.disabled = false
    btn.textContent = '加入书架'
  }))

  // 单个上架书城：展开表单
  $$('[data-store]', box).forEach((btn) => btn.addEventListener('click', () => {
    state.epubMaker.storeFor = state.epubMaker.storeFor === btn.dataset.store ? null : btn.dataset.store
    state.epubMaker.bulkStore = false
    paintEpubMakerJobs(app)
  }))
  $$('[data-store-cancel]', box).forEach((btn) => btn.addEventListener('click', () => {
    state.epubMaker.storeFor = null
    paintEpubMakerJobs(app)
  }))
  $$('[data-store-ok]', box).forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.storeOk
    const job = jobs.find((j) => j.id === id)
    const title = $('#ems-title-' + id).value.trim()
    const author = $('#ems-author-' + id).value.trim()
    const category = $('#ems-category-' + id).value.trim()
    if (!title) { toast('书名不能为空', true); return }
    if (!category) { toast('请填写分类', true); return }
    btn.disabled = true
    btn.textContent = '上架中…'
    try {
      await api('/v1/epub-maker/jobs/' + id + '/to-store', { method: 'POST', body: { title, author, category } })
      state.epubMaker.storeFor = null
      toast('《' + title + '》已上架到共享书城')
    } catch (error) { toast(error.message, true) }
    paintEpubMakerJobs(app)
  }))
}

async function downloadEpubMakerJob(job) {
  try {
    const res = await api('/v1/epub-maker/jobs/' + job.id + '/file', { raw: true })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = (job.title || 'book') + '.epub'
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 10000)
    toast('已开始下载《' + job.title + '》')
  } catch (error) { toast(error.message, true) }
}

function renderEpubMaker(app) {
  const em = state.epubMaker
  app.innerHTML = '<main class="page">' +
    '<h1 class="page-title">EPUB 制作</h1>' +
    '<p class="page-sub">上传中文小说 TXT，自动解析章节、转换为专业 EPUB，然后下载或加入书架 / 共享书城</p>' +
    '<div class="upload-layout">' +
      '<form id="em-form">' +
        '<label class="file-drop" id="em-drop" for="em-file">' +
          '<input type="file" id="em-file" accept=".txt" multiple hidden>' +
          '<strong>点击选择 TXT 文件</strong>' +
          '<span>可一次选择多本小说</span>' +
        '</label>' +
        '<div id="em-files"></div>' +
        '<div class="form-error" id="em-error"></div>' +
        '<button class="btn primary block" id="em-submit" type="submit" disabled>开始制作</button>' +
        '<div id="em-progress" class="hint" style="margin-top:10px;color:var(--ink-faint)"></div>' +
      '</form>' +
      '<aside class="upload-preview" id="em-preview">' +
        '<div class="up-empty">选中 TXT 文件后，这里会显示每本书的制作预览</div>' +
      '</aside>' +
    '</div>' +
    '<section class="section"><h2>制作任务</h2>' +
      '<datalist id="category-list">' + state.categories.map((c) => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<div id="em-jobs"></div>' +
    '</section></main>'

  paintEpubMakerFiles()
  paintEpubMakerJobs(app)
  refreshEpubMakerJobs(app)

  $('#em-file').addEventListener('change', (event) => {
    const files = Array.from(event.target.files || [])
    for (const file of files) {
      const guessed = guessFromFilename(file.name)
      const id = 'f_' + Math.random().toString(36).slice(2, 9)
      em.files.push({ id, file, title: guessed.title, author: guessed.author, coverFile: null, coverUrl: '', options: {} })
    }
    paintEpubMakerFiles()
  })

  $('#em-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    const errorEl = $('#em-error')
    errorEl.textContent = ''
    const valid = em.files.filter((f) => f.title.trim())
    if (!valid.length) { errorEl.textContent = '请至少填写一本书名'; return }

    const submit = $('#em-submit')
    const progress = $('#em-progress')
    submit.disabled = true
    progress.textContent = '上传 ' + valid.length + ' 个文件并创建制作任务…'

    try {
      const form = new FormData()
      const meta = valid.map((f) => ({ id: f.id, title: f.title.trim(), author: f.author.trim(), options: f.options }))
      form.append('meta', JSON.stringify(meta))
      for (const f of valid) {
        form.append('txt_' + f.id, f.file, f.file.name)
        if (f.coverFile) form.append('cover_' + f.id, f.coverFile, f.coverFile.name)
      }
      const data = await api('/v1/epub-maker/jobs', { method: 'POST', body: form })
      em.files = []
      paintEpubMakerFiles()
      em.jobs = data.jobs || []
      paintEpubMakerJobs(app)
      toast('已创建 ' + (data.jobs || []).length + ' 个制作任务')
    } catch (error) {
      errorEl.textContent = error.message
      submit.disabled = false
    }
    progress.textContent = ''
  })

  // 轮询任务状态
  startJobPolling(() => {
    const active = em.jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (active || !em.jobsPolled) refreshEpubMakerJobs(app)
    em.jobsPolled = true
  })
}

function paintEpubMakerFiles() {
  const box = $('#em-files')
  if (!box) return
  const em = state.epubMaker
  if (!em.files.length) {
    box.innerHTML = '<div class="hint" style="text-align:center;padding:20px 0">还没有选择文件</div>'
    $('#em-preview').innerHTML = '<div class="up-empty">选中 TXT 文件后，这里会显示每本书的制作预览</div>'
    $('#em-submit').disabled = true
    return
  }
  box.innerHTML = em.files.map((f, idx) =>
    '<div class="em-file" data-idx="' + idx + '">' +
      '<div class="em-file-head">' +
        '<strong>' + esc(f.file.name) + '</strong>' +
        '<span class="hint">' + fmtSize(f.file.size) + '</span>' +
        '<button type="button" class="btn small danger" data-remove="' + idx + '">移除</button>' +
      '</div>' +
      '<div class="field"><label>书名 <span class="hint-chip ' + (f.title ? 'ok' : 'miss') + '">' + (f.title ? '已填写' : '必填') + '</span></label>' +
        '<input type="text" data-title="' + idx + '" value="' + esc(f.title) + '" maxlength="160" placeholder="书名"></div>' +
      '<div class="field"><label>作者</label>' +
        '<input type="text" data-author="' + idx + '" value="' + esc(f.author) + '" maxlength="100" placeholder="作者"></div>' +
      '<div class="em-cover-row">' +
        '<label class="btn small" for="em-cover-' + idx + '">' + (f.coverUrl ? '更换封面' : '上传封面（可选）') + '</label>' +
        '<input type="file" id="em-cover-' + idx + '" accept="image/jpeg,image/png,image/webp" data-cover-idx="' + idx + '" hidden>' +
        (f.coverUrl ? '<img src="' + esc(f.coverUrl) + '" class="em-cover-thumb" alt="封面预览">' : '<span class="hint">未选择封面，转换后仍可单独上传</span>') +
      '</div>' +
      '<div class="em-options">' +
        '<label><input type="checkbox" data-opt="horizontal" data-idx="' + idx + '"' + (f.options.horizontal ? ' checked' : '') + '> 横排</label>' +
        '<label><input type="checkbox" data-opt="noConvert" data-idx="' + idx + '"' + (f.options.noConvert ? ' checked' : '') + '> 不转繁体</label>' +
        '<label><input type="checkbox" data-opt="noRenumber" data-idx="' + idx + '"' + (f.options.noRenumber ? ' checked' : '') + '> 不重编章节号</label>' +
      '</div>' +
    '</div>'
  ).join('')

  // 标题/作者输入
  $$('[data-title]', box).forEach((input) => input.addEventListener('input', () => {
    const f = em.files[Number(input.dataset.title)]
    if (f) { f.title = input.value; paintEpubMakerFiles(); paintEpubMakerPreview() }
  }))
  $$('[data-author]', box).forEach((input) => input.addEventListener('input', () => {
    const f = em.files[Number(input.dataset.author)]
    if (f) { f.author = input.value; paintEpubMakerPreview() }
  }))

  // 封面选择
  $$('input[data-cover-idx]', box).forEach((input) => input.addEventListener('change', () => {
    const f = em.files[Number(input.dataset.coverIdx)]
    const file = input.files[0]
    if (!f || !file) return
    if (file.size > 3 * 1024 * 1024) { toast('封面不能超过 3 MB', true); return }
    f.coverFile = file
    f.coverUrl = URL.createObjectURL(file)
    paintEpubMakerFiles()
    paintEpubMakerPreview()
  }))

  // 选项
  $$('input[data-opt]', box).forEach((cb) => cb.addEventListener('change', () => {
    const f = em.files[Number(cb.dataset.idx)]
    if (f) { f.options[cb.dataset.opt] = cb.checked }
  }))

  // 移除
  $$('[data-remove]', box).forEach((btn) => btn.addEventListener('click', () => {
    const idx = Number(btn.dataset.remove)
    const f = em.files[idx]
    if (f && f.coverUrl) URL.revokeObjectURL(f.coverUrl)
    em.files.splice(idx, 1)
    paintEpubMakerFiles()
    paintEpubMakerPreview()
  }))

  $('#em-submit').disabled = !em.files.some((f) => f.title.trim())
  paintEpubMakerPreview()
}

function paintEpubMakerPreview() {
  const preview = $('#em-preview')
  if (!preview) return
  const em = state.epubMaker
  if (!em.files.length) {
    preview.innerHTML = '<div class="up-empty">选中 TXT 文件后，这里会显示每本书的制作预览</div>'
    return
  }
  preview.innerHTML = '<div class="up-label">制作预览</div>' +
    em.files.map((f) => {
      const title = f.title.trim() || '未命名'
      const author = f.author.trim() || '佚名'
      return '<div class="up-card" style="margin-bottom:14px">' +
        '<div class="book-cover">' + (f.coverUrl ? '<img src="' + esc(f.coverUrl) + '" alt="封面">' : placeholderHtml('EPUB', title.charAt(0))) + '</div>' +
        '<div class="book-meta"><div class="title">' + esc(title) + '</div>' +
        '<div class="author">' + esc(author) + '</div>' +
        '<div class="sub">EPUB · ' + fmtSize(f.file.size) + '</div></div>' +
      '</div>'
    }).join('')
}

/* ---------------- 视图：我的上传 ---------------- */

function renderMine(app) {
  const tab = state.mineTab
  const tabsHtml = '<div class="tabs">' +
    '<button class="' + (tab === 'uploads' ? 'active' : '') + '" data-tab="uploads">我的上传</button>' +
    '<button class="' + (tab === 'messages' ? 'active' : '') + '" data-tab="messages">历史消息' + (state.unread ? ' <span class="tab-badge">' + state.unread + '</span>' : '') + '</button>' +
  '</div>'

  let body = ''
  if (tab === 'uploads') {
    const filterOngoing = state.mineUploadFilter === 'ongoing'
    let mine = state.books.filter((book) => book.canManage)
    if (filterOngoing) mine = mine.filter((book) => book.status === 'ongoing')
    const rows = mine.map((book) => {
      const badges = []
      if (book.status === 'ongoing') badges.push('<span class="card-badge ongoing">连载中</span>')
      badges.push('<span class="card-badge">' + (book.fileCount || 1) + ' 卷</span>')
      return '<article class="book-card" data-id="' + esc(book.id) + '">' +
        '<div class="book-cover">' + coverBoxHtml(book) + (badges.length ? '<div class="card-badges">' + badges.join('') + '</div>' : '') + '</div>' +
        '<div class="book-meta">' +
          '<div class="title">' + esc(book.title) + '</div>' +
          '<div class="author">' + esc(book.author || '佚名') + ' · ' + esc(book.category) + '</div>' +
          '<div class="sub">' + (book.ratingCount
            ? '<span class="rating-stars">' + stars(book.averageRating).slice(0, Math.round(book.averageRating)) + '</span> ' + book.ratingCount + ' 人评价'
            : '<span class="rating-none">暂无评分</span>') + '</div>' +
          '<div class="sub">' + fmtDay(book.uploadedAt) + ' 上传 · ' + (book.fileCount || 1) + ' 卷</div>' +
        '</div></article>'
    }).join('')
    body = '<div class="mine-upload-toolbar">' +
      '<button class="btn small' + (filterOngoing ? ' primary' : '') + '" id="mine-filter-ongoing">连载中</button>' +
      '<button class="btn small' + (!filterOngoing ? ' primary' : '') + '" id="mine-filter-all">全部</button>' +
      '</div>' +
      (mine.length
        ? '<div class="book-grid">' + rows + '</div>'
        : '<div class="empty-state">' + (filterOngoing ? '没有连载中的书籍。' : '你还没有上传书籍。') + '<div style="margin-top:16px"><a class="btn" href="#/upload">去上传第一本</a></div></div>')
  } else {
    const items = state.notifications.map((n) => {
      const text = n.type === 'review'
        ? esc(n.actor) + ' 评价了《' + esc(n.bookTitle) + '》' + (n.rating ? ' <span class="rating-stars">' + stars(n.rating).slice(0, n.rating) + '</span>' : '')
        : esc(n.actor) + ' 下载了《' + esc(n.bookTitle) + '》'
      return '<div class="notif-item' + (n.read ? '' : ' unread') + '" data-book="' + esc(n.bookId || '') + '">' +
        '<div>' + text + '</div><div class="time">' + fmtTime(n.createdAt) + (n.read ? ' · 已读' : ' · 未读') + '</div></div>'
    }).join('')
    body = '<div class="msg-toolbar"><button class="btn small" id="mine-read-all"' + (state.unread ? '' : ' disabled') + '>全部标为已读</button></div>' +
      '<div class="msg-list">' + (items || '<div class="empty-state">还没有任何消息。</div>') + '</div>'
  }

  app.innerHTML = '<main class="page">' +
    '<h1 class="page-title">' + esc(state.user.nickname || state.user.username) + '</h1>' +
    '<p class="page-sub">' + esc(state.user.username) + ' · 我的上传与消息</p>' +
    tabsHtml + body + '</main>'

  $$('.tabs button', app).forEach((btn) => btn.addEventListener('click', () => {
    state.mineTab = btn.dataset.tab
    renderMine(app)
  }))

  if (tab === 'uploads') {
    hydrateCovers(app)
    $$('.book-card', app).forEach((card) => card.addEventListener('click', () => {
      location.hash = '#/book/' + card.dataset.id
    }))
    $('#mine-filter-all')?.addEventListener('click', () => { state.mineUploadFilter = 'all'; renderMine(app) })
    $('#mine-filter-ongoing')?.addEventListener('click', () => { state.mineUploadFilter = 'ongoing'; renderMine(app) })
  } else {
    $$('.notif-item[data-book]', app).forEach((el) => el.addEventListener('click', () => {
      if (el.dataset.book) location.hash = '#/book/' + el.dataset.book
    }))
    const readAll = $('#mine-read-all')
    if (readAll) readAll.addEventListener('click', async () => {
      try {
        await api('/v1/notifications/read', { method: 'POST', body: {} })
        state.unread = 0
        state.notifications.forEach((n) => { n.read = true })
        updateBadge()
        renderMine(app)
      } catch (error) { toast(error.message, true) }
    })
  }
}

/* ---------------- 视图：账户 ---------------- */

function renderAccount(app) {
  const u = state.user
  app.innerHTML = '<main class="page">' +
    '<h1 class="page-title">账户</h1><p class="page-sub">' + esc(u.username) + ' · 注册于 ' + fmtDay(u.createdAt) + ' · 个人书库 ' + (u.libraryCount || 0) + ' 本</p>' +
    '<div class="account-grid">' +
      '<section><h2 class="serif" style="font-size:17px;margin:0 0 16px">个人资料</h2>' +
        '<div class="account-avatar-row"><span id="account-avatar">' + avatarHtml(u, 'large') + '</span>' +
          '<div><label class="btn small" for="avatar-input">更换头像</label>' +
          '<input type="file" id="avatar-input" accept="image/jpeg,image/png,image/webp" hidden>' +
          '<div class="hint">方形取景，可拖动与缩放</div></div></div>' +
        '<form id="profile-form">' +
          '<div class="field"><label>昵称</label><input type="text" id="pf-nickname" maxlength="32" value="' + esc(u.nickname || u.username) + '" required></div>' +
          '<div class="form-error" id="pf-error"></div><div class="form-ok" id="pf-ok"></div>' +
          '<button class="btn primary" type="submit" id="pf-submit">保存资料</button>' +
        '</form></section>' +
      '<section><h2 class="serif" style="font-size:17px;margin:0 0 16px">修改密码</h2>' +
        '<form id="password-form">' +
          '<div class="field"><label>当前密码</label><input type="password" id="pw-current" autocomplete="current-password" required></div>' +
          '<div class="field"><label>新密码</label><input type="password" id="pw-new" autocomplete="new-password" required placeholder="10–128 位"></div>' +
          '<div class="field"><label>再输一遍新密码</label><input type="password" id="pw-confirm" autocomplete="new-password" required></div>' +
          '<div class="form-error" id="pw-error"></div><div class="form-ok" id="pw-ok"></div>' +
          '<button class="btn primary" type="submit" id="pw-submit">修改密码</button>' +
          '<div class="hint" style="margin-top:8px">修改后其他设备的登录将全部失效。</div>' +
        '</form></section>' +
    '</div></main>'

  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    $('#pf-error').textContent = ''; $('#pf-ok').textContent = ''
    const nickname = $('#pf-nickname').value.trim()
    if (!nickname) { $('#pf-error').textContent = '昵称不能为空'; return }
    $('#pf-submit').disabled = true
    try {
      const data = await api('/v1/account/profile', { method: 'PATCH', body: { nickname, avatar: state.user.avatar || '' } })
      state.user = data.user
      $('#pf-ok').textContent = '资料已保存'
      render()
    } catch (error) { $('#pf-error').textContent = error.message }
    $('#pf-submit').disabled = false
  })

  $('#password-form').addEventListener('submit', async (event) => {
    event.preventDefault()
    $('#pw-error').textContent = ''; $('#pw-ok').textContent = ''
    const currentPassword = $('#pw-current').value
    const newPassword = $('#pw-new').value
    if (newPassword !== $('#pw-confirm').value) { $('#pw-error').textContent = '两次输入的新密码不一致'; return }
    if (newPassword.length < 10 || newPassword.length > 128) { $('#pw-error').textContent = '新密码长度需为 10–128 位'; return }
    $('#pw-submit').disabled = true
    try {
      const data = await api('/v1/account/password', { method: 'POST', body: { currentPassword, newPassword } })
      setToken(data.token) // 旧会话全部失效，换成新 token
      state.user = data.user
      $('#pw-ok').textContent = '密码已修改'
      $('#password-form').reset()
    } catch (error) { $('#pw-error').textContent = error.message }
    $('#pw-submit').disabled = false
  })

  $('#avatar-input').addEventListener('change', (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => openCropDialog(String(reader.result), async (dataUrl) => {
      try {
        const data = await api('/v1/account/profile', {
          method: 'PATCH',
          body: { nickname: state.user.nickname || state.user.username, avatar: dataUrl },
        })
        state.user = data.user
        toast('头像已更新')
        render()
      } catch (error) { toast(error.message, true) }
    })
    reader.onerror = () => toast('读取图片失败', true)
    reader.readAsDataURL(file)
  })
}

/* ---------------- 头像裁切（参考 src/ui-b/AvatarCropDialog.jsx 的原生实现） ---------------- */

function openCropDialog(imageSrc, onConfirm) {
  const root = $('#overlay-root')
  root.innerHTML = '<div class="crop-overlay" role="dialog" aria-modal="true" aria-label="裁切头像">' +
    '<section class="crop-dialog">' +
      '<header><strong>裁切头像</strong><button class="icon-button" id="crop-cancel" aria-label="取消">&times;</button></header>' +
      '<div class="crop-frame" id="crop-frame" style="width:' + FRAME + 'px;height:' + FRAME + 'px">' +
        '<img id="crop-img" alt="待裁切头像" draggable="false"><i class="mask" aria-hidden="true"></i>' +
      '</div>' +
      '<label class="crop-zoom">缩放<input type="range" id="crop-zoom" min="1" max="3" step="0.01" value="1"></label>' +
      '<div class="crop-actions">' +
        '<button class="btn" id="crop-cancel2">取消</button>' +
        '<button class="btn primary" id="crop-ok" disabled>使用这个头像</button>' +
      '</div>' +
    '</section></div>'

  const frame = $('#crop-frame')
  const img = $('#crop-img')
  const zoomInput = $('#crop-zoom')
  const okBtn = $('#crop-ok')

  let meta = null
  let zoom = 1
  let offset = { x: 0, y: 0 }
  let drag = null

  const scale = () => (meta ? meta.base * zoom : 1)
  const clampAxis = (value, size, scaleValue) => {
    const limit = Math.max(0, (size * scaleValue - FRAME) / 2)
    return Math.min(limit, Math.max(-limit, value))
  }
  const clampOffset = (next, scaleValue) => meta
    ? { x: clampAxis(next.x, meta.width, scaleValue == null ? scale() : scaleValue), y: clampAxis(next.y, meta.height, scaleValue == null ? scale() : scaleValue) }
    : next

  function paint() {
    if (!meta) return
    img.style.width = meta.width * scale() + 'px'
    img.style.height = meta.height * scale() + 'px'
    img.style.transform = 'translate(calc(-50% + ' + offset.x + 'px), calc(-50% + ' + offset.y + 'px))'
  }

  img.onload = () => {
    meta = { width: img.naturalWidth, height: img.naturalHeight, base: FRAME / Math.min(img.naturalWidth, img.naturalHeight) }
    okBtn.disabled = false
    paint()
  }
  img.onerror = () => { toast('图片加载失败，请换一张试试', true); close() }
  img.src = imageSrc

  frame.addEventListener('pointerdown', (event) => {
    frame.setPointerCapture(event.pointerId)
    drag = { startX: event.clientX, startY: event.clientY, origin: offset }
  })
  frame.addEventListener('pointermove', (event) => {
    if (!drag) return
    offset = clampOffset({ x: drag.origin.x + event.clientX - drag.startX, y: drag.origin.y + event.clientY - drag.startY })
    paint()
  })
  const endDrag = () => { drag = null }
  frame.addEventListener('pointerup', endDrag)
  frame.addEventListener('pointercancel', endDrag)

  zoomInput.addEventListener('input', () => {
    zoom = Number(zoomInput.value)
    if (meta) offset = clampOffset(offset, meta.base * zoom)
    paint()
  })

  function close() { root.innerHTML = '' }
  $('#crop-cancel').addEventListener('click', close)
  $('#crop-cancel2').addEventListener('click', close)

  okBtn.addEventListener('click', () => {
    if (!meta) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    const visible = FRAME / scale()
    const centerX = meta.width / 2 - offset.x / scale()
    const centerY = meta.height / 2 - offset.y / scale()
    ctx.drawImage(img, centerX - visible / 2, centerY - visible / 2, visible, visible, 0, 0, OUTPUT, OUTPUT)
    let url = canvas.toDataURL('image/webp', 0.88)
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.88)
    close()
    onConfirm(url)
  })
}

/* ---------------- 路由与启动 ---------------- */

function currentRoute() {
  const hash = location.hash || '#/'
  const bookMatch = hash.match(/^#\/book\/([0-9a-f-]+)$/)
  if (bookMatch) return { name: 'book', id: bookMatch[1] }
  if (hash === '#/upload') return { name: 'upload' }
  if (hash === '#/novel') return { name: 'novel' }
  if (hash === '#/epub-maker') return { name: 'epub-maker' }
  if (hash === '#/account') return { name: 'account' }
  if (hash === '#/mine') return { name: 'mine' }
  return { name: 'home' }
}

async function render() {
  const app = $('#app')
  stopJobPolling()
  if (!state.user) {
    renderAuth()
    translatePage()
    return
  }
  const route = currentRoute()
  const shell = document.createElement('div')
  app.innerHTML = ''
  app.appendChild(shell)
  const navKey = route.name === 'book' || route.name === 'mine' ? '' : route.name
  shell.innerHTML = topbarHtml(navKey)
  bindTopbar()
  const view = document.createElement('div')
  app.appendChild(view)

  if (route.name === 'book') {
    renderBookDetail(view, route.id)
  } else if (route.name === 'upload') {
    renderUpload(view)
  } else if (route.name === 'account') {
    renderAccount(view)
  } else if (route.name === 'novel') {
    renderNovel(view)
  } else if (route.name === 'epub-maker') {
    renderEpubMaker(view)
  } else {
    // home / mine 需要书籍列表
    view.innerHTML = '<main class="page"><div class="loading-line">整 理 书 架 …</div></main>'
    try {
      if (route.name === 'mine') {
        await Promise.all([loadAllBooks(), refreshNotifications(true)])
      } else {
        await loadBooks()
      }
    } catch (error) {
      toast(error.message, true)
    }
    if (route.name === 'mine') renderMine(view)
    else renderHome(view)
  }
  translatePage()
}

window.addEventListener('hashchange', render)

async function boot() {
  if (state.booted) return
  state.booted = true
  const token = getToken()
  if (token) {
    try {
      const data = await api('/v1/account')
      state.user = data.user
      startPolling()
      refreshNotifications(true).catch(() => {})
    } catch (error) {
      // 401 已在 api() 内处理为回登录页；其他错误也回登录页
      if (state.user) { setToken(''); state.user = null }
    }
  }
  render()
  startTranslateObserver()
  if (state.lang === 'tw') translatePage()
}

boot()
