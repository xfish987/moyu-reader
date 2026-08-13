import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, Home, LibraryBig, List, RotateCw, Trophy, Undo2 } from 'lucide-react'

// 起点模式：主窗口内嵌起点官方网页（persist:qidian 分区持久化登录态）。
// 墨读只提供工具条与章节页翻页排版；登录、付费、章评、书架收藏全部发生在起点页面内。

const HOME_URL = 'https://www.qidian.com/'
const RANK_URL = 'https://www.qidian.com/rank/'
const BOOKCASE_URL = 'https://my.qidian.com/bookcase/'
const STORE_KEY = 'reader:qidian-state'
const QIDIAN_HOST = /^https:\/\/([^/]+\.)?qidian\.com\//
const BOOK_ID_RE = /qidian\.com\/(?:book|chapter)\/(\d{4,12})/

// 章节页净化：只留正文与段评面板（#right-container 是段评面板宿主，不能藏，藏 #r-menu 即可）。
// 选择器 2026-08 实测于起点新版阅读页；起点改版失效时最坏只是看到原版页面，不影响功能。
const CLEANUP_CSS = `
html.moyu-clean, html.moyu-clean body { overflow: hidden !important; height: 100% !important; }
html.moyu-clean #navbar, html.moyu-clean #left-container,
html.moyu-clean #r-breadcrumbs, html.moyu-clean #r-titlePage,
html.moyu-clean #r-menu { display: none !important; }
html.moyu-clean .min-h-100vh > *:not(.chapter-wrapper) { display: none !important; }
html.moyu-clean .chapter-wrapper > *:not(.relative) { display: none !important; }
html.moyu-clean #reader, html.moyu-clean #reader-content { width: 100vw !important; max-width: none !important; min-height: 100vh !important; padding: 0 !important; margin: 0 !important; }
html.moyu-clean .chapter-wrapper { border: 0 !important; }
html.moyu-clean main.content { font-size: clamp(15px, 0.72vw + 11px, 24px) !important; line-height: 2 !important; }
html.moyu-clean main.content p { margin: 0 0 0.9em !important; }
html.moyu-clean .chapter-wrapper .print { padding: 0 !important; margin: 0 !important; }
html.moyu-clean h1.title { display: block !important; margin: 0 0 0.2em !important; }
`

// 章节页翻页脚本：正文容器改多栏水平分页，每步一屏；末页右翻点“下一章”，首页左翻点“上一章”。
// 幂等：重复注入只重新激活。返回 'paged'（已激活）/ 'plain'（非章节页）。
const READER_SCRIPT = `(function () {
  if (window.__moyuBooted) return window.__moyuActivate() ? 'paged' : 'plain'
  window.__moyuBooted = true
  var stage = null
  var pageStep = 0

  function chapterLink(text) {
    var links = document.querySelectorAll('a')
    for (var i = 0; i < links.length; i++) {
      var label = (links[i].textContent || '').trim()
      if (label === text && /\\/chapter\\/\\d+\\/\\d+/.test(links[i].href || '')) return links[i].href
    }
    return ''
  }

  function layout() {
    if (!stage) return
    var padX = Math.round(Math.min(Math.max(window.innerWidth * 0.06, 14), 96))
    pageStep = window.innerWidth
    var st = stage.style
    st.boxSizing = 'border-box'
    st.width = '100vw'
    st.height = '100vh'
    st.padding = '5vh ' + padX + 'px'
    st.columnFill = 'auto'
    st.columnGap = padX * 2 + 'px'
    st.columnWidth = Math.max(240, window.innerWidth - padX * 2) + 'px'
    st.overflow = 'hidden'
  }

  function activate() {
    var content = document.querySelector('main.content')
    var wrapper = document.querySelector('.chapter-wrapper')
    if (!content || !wrapper) {
      document.documentElement.classList.remove('moyu-clean')
      stage = null
      return false
    }
    stage = wrapper.querySelector(':scope > .relative') || wrapper
    document.documentElement.classList.add('moyu-clean')
    layout()
    window.scrollTo(0, 0)
    stage.scrollLeft = 0
    return true
  }

  window.__moyuActivate = activate
  window.__moyuPage = function (dir) {
    if (!stage && !activate()) return 'noop'
    var max = stage.scrollWidth - stage.clientWidth
    if (dir > 0) {
      if (stage.scrollLeft >= max - 4) {
        var next = chapterLink('下一章')
        if (next) { location.href = next; return 'next' }
        return 'end'
      }
      stage.scrollLeft = Math.min(max, stage.scrollLeft + pageStep)
      return 'page'
    }
    if (stage.scrollLeft <= 4) {
      var prev = chapterLink('上一章')
      if (prev) { location.href = prev; return 'prev' }
      return 'start'
    }
    stage.scrollLeft = Math.max(0, stage.scrollLeft - pageStep)
    return 'page'
  }

  var resizeTimer = 0
  window.addEventListener('resize', function () {
    if (!stage) return
    var page = pageStep ? Math.round(stage.scrollLeft / pageStep) : 0
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(function () {
      layout()
      stage.scrollLeft = Math.min(stage.scrollWidth - stage.clientWidth, page * pageStep)
    }, 120)
  })

  document.addEventListener('keydown', function (event) {
    if (!stage) return
    var target = event.target
    if (target && target.closest && target.closest('input, textarea, [contenteditable]')) return
    if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ' || event.key === 'd' || event.key === 'D') { event.preventDefault(); window.__moyuPage(1) }
    else if (event.key === 'ArrowLeft' || event.key === 'PageUp' || event.key === 'a' || event.key === 'A') { event.preventDefault(); window.__moyuPage(-1) }
  })

  var lastWheel = 0
  document.addEventListener('wheel', function (event) {
    if (!stage) return
    var el = event.target
    while (el && el !== document.body) {
      if (getComputedStyle(el).position === 'fixed') return
      el = el.parentElement
    }
    var now = Date.now()
    if (now - lastWheel < 260 || Math.abs(event.deltaY) < 12) return
    lastWheel = now
    event.preventDefault()
    window.__moyuPage(event.deltaY > 0 ? 1 : -1)
  }, { passive: false })

  return activate() ? 'paged' : 'plain'
})()`

// 书页上代点“免费试读/立即阅读”进入第一章或续读。
const START_READING_SCRIPT = `(function () {
  var links = document.querySelectorAll('a')
  for (var i = 0; i < links.length; i++) {
    var label = (links[i].textContent || '').trim()
    if (/免费试读|立即阅读|开始阅读|继续阅读/.test(label) && /\\/chapter\\/\\d+\\/\\d+/.test(links[i].href || '')) return links[i].href
  }
  return ''
})()`

export default function QidianMode() {
  const webviewRef = useRef(null)
  const persistTimerRef = useRef(null)
  const [initialUrl, setInitialUrl] = useState('')
  const [currentUrl, setCurrentUrl] = useState('')
  const [paged, setPaged] = useState(false)

  // 恢复上次浏览位置；没有记录则进起点主页。
  useEffect(() => {
    let cancelled = false
    const fallback = () => { if (!cancelled) { setInitialUrl(HOME_URL); setCurrentUrl(HOME_URL) } }
    if (!window.readerAPI?.getStoredValue) { fallback(); return undefined }
    window.readerAPI.getStoredValue(STORE_KEY).then((stored) => {
      if (cancelled) return
      const last = stored?.found ? stored.value?.lastUrl : ''
      const url = QIDIAN_HOST.test(last || '') ? last : HOME_URL
      setInitialUrl(url)
      setCurrentUrl(url)
    }).catch(fallback)
    return () => { cancelled = true }
  }, [])

  const page = useCallback((dir) => {
    const webview = webviewRef.current
    if (!webview) return
    webview.executeJavaScript(`window.__moyuPage ? window.__moyuPage(${dir}) : 'noop'`).catch(() => {})
  }, [])

  const load = useCallback((url) => {
    const webview = webviewRef.current
    if (!webview) return
    try { webview.loadURL(url) } catch {}
  }, [])

  // A/D、方向键、空格、PageUp/PageDown 翻页（webview 内聚焦时由注入脚本处理，互不冲突）。
  useEffect(() => {
    const onKey = (event) => {
      if (['ArrowRight', 'PageDown', ' ', 'd', 'D'].includes(event.key)) { event.preventDefault(); page(1) }
      else if (['ArrowLeft', 'PageUp', 'a', 'A'].includes(event.key)) { event.preventDefault(); page(-1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [page])

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview || !initialUrl) return undefined
    const onReady = () => {
      try { webview.insertCSS(CLEANUP_CSS) } catch {}
      webview.executeJavaScript(READER_SCRIPT).then((result) => setPaged(result === 'paged')).catch(() => setPaged(false))
    }
    const onNav = (event) => {
      const url = event.url || ''
      setCurrentUrl(url)
      clearTimeout(persistTimerRef.current)
      persistTimerRef.current = setTimeout(() => {
        if (QIDIAN_HOST.test(url)) window.readerAPI?.setStoredValue?.(STORE_KEY, { lastUrl: url }).catch(() => {})
      }, 800)
    }
    const onNewWindow = (event) => {
      const url = event.url || ''
      if (QIDIAN_HOST.test(url)) load(url)
      else if (/^https:\/\//i.test(url)) window.readerAPI?.openExternalUrl?.(url)
    }
    webview.addEventListener('dom-ready', onReady)
    webview.addEventListener('did-navigate', onNav)
    webview.addEventListener('did-navigate-in-page', onNav)
    webview.addEventListener('new-window', onNewWindow)
    return () => {
      webview.removeEventListener('dom-ready', onReady)
      webview.removeEventListener('did-navigate', onNav)
      webview.removeEventListener('did-navigate-in-page', onNav)
      webview.removeEventListener('new-window', onNewWindow)
    }
  }, [initialUrl, load])

  const bookId = (currentUrl.match(BOOK_ID_RE) || [])[1] || ''
  const onChapterPage = /\/chapter\/\d+\/\d+/.test(currentUrl)

  const startReading = () => {
    const webview = webviewRef.current
    if (!webview) return
    webview.executeJavaScript(START_READING_SCRIPT).then((href) => { if (href) load(href) }).catch(() => {})
  }
  const openCatalog = () => { if (bookId) load(`https://www.qidian.com/book/${bookId}/catalog/`) }
  const reload = () => { try { webviewRef.current?.reload() } catch {} }
  const goBack = () => { try { if (webviewRef.current?.canGoBack()) webviewRef.current.goBack() } catch {} }
  const openExternal = () => { if (QIDIAN_HOST.test(currentUrl)) window.readerAPI?.openExternalUrl?.(currentUrl) }

  return (
    <div className="qidian-shell">
      <nav className="qidian-toolbar" aria-label="起点导航">
        <button onClick={goBack} title="后退" aria-label="后退"><Undo2 size={15} /></button>
        <button onClick={() => load(HOME_URL)} title="起点主页" aria-label="起点主页"><Home size={15} /></button>
        <button onClick={() => load(RANK_URL)} title="排行榜" aria-label="排行榜"><Trophy size={15} /></button>
        <button onClick={() => load(BOOKCASE_URL)} title="我的书架" aria-label="我的书架"><LibraryBig size={15} /></button>
        <span className="qidian-toolbar-sep" aria-hidden="true" />
        <button onClick={startReading} disabled={!bookId || onChapterPage} title="进入阅读" aria-label="进入阅读"><BookOpen size={15} /></button>
        <button onClick={openCatalog} disabled={!bookId} title="本书目录" aria-label="本书目录"><List size={15} /></button>
        {paged ? (
          <>
            <span className="qidian-toolbar-sep" aria-hidden="true" />
            <button onClick={() => page(-1)} title="上一页（A / ←）" aria-label="上一页"><ChevronLeft size={16} /></button>
            <button onClick={() => page(1)} title="下一页（D / →）" aria-label="下一页"><ChevronRight size={16} /></button>
          </>
        ) : null}
        <span className="qidian-toolbar-spacer" />
        <button onClick={reload} title="刷新页面" aria-label="刷新页面"><RotateCw size={15} /></button>
        <button onClick={openExternal} title="在系统浏览器中打开" aria-label="在系统浏览器中打开"><ExternalLink size={15} /></button>
      </nav>
      <div className="qidian-stage">
        {initialUrl ? (
          <webview
            ref={webviewRef}
            src={initialUrl}
            partition="persist:qidian"
          />
        ) : null}
        {paged ? (
          <>
            <button className="qidian-edge is-left" onClick={() => page(-1)} title="上一页" aria-label="上一页"><ChevronLeft size={18} /></button>
            <button className="qidian-edge is-right" onClick={() => page(1)} title="下一页" aria-label="下一页"><ChevronRight size={18} /></button>
          </>
        ) : null}
      </div>
    </div>
  )
}
