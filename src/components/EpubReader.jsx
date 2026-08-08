import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import ePub from 'epubjs'
import { NotePopup, SelectionPopup } from './NotePopups'
import { truncateCompanionText } from './TextReader'
import { convertChinese, searchVariants } from '../chineseConversion'
import { getReaderFontStack, installReaderFonts } from '../readerFonts'

const boundViewDocuments = new WeakSet()

function makeEpubPageTransparent(document, theme) {
  if (!document) return
  const colorScheme = theme === 'night' ? 'dark' : 'light'
  for (const element of [document.documentElement, document.body]) {
    element?.style?.setProperty('background-color', 'transparent', 'important')
    element?.style?.setProperty('color-scheme', colorScheme, 'important')
  }
  const frame = document.defaultView?.frameElement
  if (!frame) return
  frame.setAttribute('allowtransparency', 'true')
  frame.style?.setProperty('color-scheme', colorScheme)
  let surface = frame
  for (let depth = 0; surface && depth < 3; depth += 1, surface = surface.parentElement) {
    surface.style?.setProperty('background-color', 'transparent', 'important')
  }
}

function applyRenditionSettings(rendition, settings) {
  if (!rendition) return
  const fontFamily = getReaderFontStack(settings.fontFamily)
  const textColor = settings.theme === 'night'
    ? `rgba(232, 236, 239, ${settings.opacity})`
    : `rgba(1, 22, 43, ${settings.opacity})`
  rendition.themes.register('reader-settings', {
    html: { 'background-color': 'transparent !important' },
    body: {
      'font-family': `${fontFamily} !important`,
      'font-size': `${settings.fontSize}px !important`,
      'line-height': `${settings.lineHeight} !important`,
      'letter-spacing': `${settings.letterSpacing}px !important`,
      color: `${textColor} !important`,
      'background-color': 'transparent !important',
    },
    p: {
      'font-weight': '400 !important',
      'margin-top': '0 !important',
      'margin-bottom': `${settings.paragraphGap}px !important`,
      'text-align': 'justify !important',
    },
    'h1, h2, h3, h4, h5, h6': {
      'font-family': `${fontFamily} !important`,
      'font-weight': '700 !important',
      'line-height': '1.45 !important',
    },
    'strong, b': { 'font-weight': '700 !important' },
  })
  rendition.themes.select('reader-settings')
  for (const contents of rendition.getContents?.() || []) makeEpubPageTransparent(contents.document, settings.theme)
}

function decodeBase64(value) {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes.buffer
}

function flattenNavigation(items, depth = 0, result = []) {
  for (const item of items || []) {
    const label = String(item.label || '').replace(/\s+/g, ' ').trim() || '未命名章节'
    result.push({ label, href: String(item.href || ''), depth })
    flattenNavigation(item.subitems, depth + 1, result)
  }
  return result
}

function splitHref(value = '') {
  const [rawPath, ...fragmentParts] = String(value).split('#')
  let hrefPath = rawPath.replace(/^\.\//, '')
  let fragment = fragmentParts.join('#')
  try { hrefPath = decodeURIComponent(hrefPath) } catch {}
  try { fragment = decodeURIComponent(fragment) } catch {}
  return { hrefPath, fragment }
}

function resolveTocHref(location, rendition, book, toc) {
  const currentPath = splitHref(location.start.href).hrefPath
  const candidates = toc.filter((item) => splitHref(item.href).hrefPath === currentPath)
  if (!candidates.length) return location.start.href
  if (candidates.length === 1) return candidates[0].href
  const contents = rendition.getContents?.() || []
  const content = contents.find((item) => Number(item.section?.index) === Number(location.start.index)) || contents[0]
  const section = book.spine?.get(Number(location.start.index))
  if (!content?.document || !section?.cfiBase) return candidates[0].href
  let active = candidates.find((item) => !splitHref(item.href).fragment)?.href || candidates[0].href
  for (const candidate of candidates) {
    const fragment = splitHref(candidate.href).fragment
    if (!fragment) continue
    const element = content.document.getElementById(fragment)
      || content.document.querySelector(`[name="${CSS.escape(fragment)}"]`)
    if (!element) continue
    const anchorCfi = rendition.epubcfi.fromNode(element, section.cfiBase)
    if (rendition.epubcfi.compare(anchorCfi, location.start.cfi) <= 0) active = candidate.href
  }
  return active
}

function visibleBodyText(body) {
  const clone = body.cloneNode(true)
  clone.querySelectorAll('script, style, title, [hidden], [aria-hidden="true"]').forEach((element) => element.remove())
  clone.querySelectorAll('[style]').forEach((element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test(element.getAttribute('style') || '')) element.remove()
  })
  return clone.textContent?.replace(/[\s\u00a0\u200b\ufeff]+/g, '') || ''
}

function fitFullPageBackground(document) {
  const body = document?.body
  const view = document?.defaultView
  if (!body || !view || visibleBodyText(body)) return false
  if (body.querySelector('img, svg, canvas, video, object, embed')) return false
  const background = view.getComputedStyle(body).backgroundImage
  if (!background || background === 'none') return false
  body.classList.add('reader-fullpage-artwork')
  body.style.setProperty('background-size', 'contain', 'important')
  body.style.setProperty('background-position', 'center center', 'important')
  body.style.setProperty('background-repeat', 'no-repeat', 'important')
  body.style.setProperty('background-attachment', 'scroll', 'important')
  body.style.setProperty('width', '100%', 'important')
  body.style.setProperty('height', '100vh', 'important')
  body.style.setProperty('min-height', '100vh', 'important')
  body.style.setProperty('margin', '0', 'important')
  return true
}

function hasReadableContent(document) {
  const body = document?.body
  if (!body) return false
  const view = document.defaultView
  const bodyBackground = view?.getComputedStyle(body).backgroundImage || 'none'
  const htmlBackground = view?.getComputedStyle(document.documentElement).backgroundImage || 'none'
  if (bodyBackground !== 'none' || htmlBackground !== 'none') return true
  if (body.querySelector('img, svg, canvas, video, audio, object, embed, math, table')) return true
  return Boolean(visibleBodyText(body))
}

function getPageDirection(document) {
  const view = document?.defaultView
  const bodyStyle = document?.body && view?.getComputedStyle(document.body)
  const rootStyle = document?.documentElement && view?.getComputedStyle(document.documentElement)
  const writingMode = bodyStyle?.writingMode || rootStyle?.writingMode || ''
  const cssDirection = bodyStyle?.direction || rootStyle?.direction || ''
  const verticalRl = writingMode === 'vertical-rl' || writingMode === 'sideways-rl'
  const verticalLr = writingMode === 'vertical-lr' || writingMode === 'sideways-lr'
  const rtl = verticalRl
    || cssDirection === 'rtl'
    || document?.body?.dir === 'rtl'
    || document?.documentElement?.dir === 'rtl'
  return {
    rtl,
    forcedDirection: verticalRl ? 'rtl' : verticalLr ? 'ltr' : null,
  }
}

const EpubReader = forwardRef(function EpubReader({ data, settings, initialCfi, onProgress, onChapters, onShortcut, onWheel, onCollect, notes = [], onLookupEntity, onCheckEntityProfile, hasAnyProfile, dictEntries = [], onLookupDict, onOpenDictEntry, onDismissPanel }, ref) {
  const hostRef = useRef(null)
  const renditionRef = useRef(null)
  const bookRef = useRef(null)
  const [selPopup, setSelPopup] = useState(null)
  const [notePopup, setNotePopup] = useState(null)
  const selectedContentsRef = useRef(null)
  const selectionPayloadRef = useRef(null)
  const annotationsRef = useRef([])
  const locationsPromiseRef = useRef(null)
  const progressFrameRef = useRef(null)
  const pendingLocationRef = useRef(null)
  const progressCallbackRef = useRef(onProgress)
  const chaptersCallbackRef = useRef(onChapters)
  const tocRef = useRef([])
  const searchTokenRef = useRef(0)
  const navigationDirectionRef = useRef(1)
  const emptySkipCountRef = useRef(0)
  const readingRtlRef = useRef(false)
  const appliedDirectionRef = useRef(null)
  const locationsReadyRef = useRef(false)
  const lastPercentRef = useRef(0)
  const navLockRef = useRef(0)
  const pagingRef = useRef(false)
  const initialDataRef = useRef(data)
  const initialCfiRef = useRef(initialCfi)
  const shortcutRef = useRef(onShortcut)
  const wheelCallbackRef = useRef(onWheel)
  const dismissPanelRef = useRef(onDismissPanel)
  const settingsRef = useRef(settings)
  if (initialDataRef.current !== data) {
    initialDataRef.current = data
    initialCfiRef.current = initialCfi
  }
  progressCallbackRef.current = onProgress
  chaptersCallbackRef.current = onChapters
  shortcutRef.current = onShortcut
  wheelCallbackRef.current = onWheel
  dismissPanelRef.current = onDismissPanel
  settingsRef.current = settings

  useEffect(() => {
    if (!hostRef.current) return undefined
    const book = ePub(decodeBase64(data))
    const rendition = book.renderTo(hostRef.current, {
      width: '100%',
      height: '100%',
      flow: 'paginated',
      spread: 'none',
      manager: 'default',
    })
    rendition.hooks.content.register((contents) => {
      installReaderFonts(contents.document)
      const currentSettings = settingsRef.current
      makeEpubPageTransparent(contents.document, currentSettings.theme)
      if (!currentSettings.scriptConversion || currentSettings.scriptConversion === 'none') return
      const document = contents.document
      const walker = document.createTreeWalker(document.body, document.defaultView.NodeFilter.SHOW_TEXT)
      let node = walker.nextNode()
      while (node) {
        if (!['SCRIPT', 'STYLE'].includes(node.parentElement?.tagName)) node.nodeValue = convertChinese(node.nodeValue, currentSettings.scriptConversion)
        node = walker.nextNode()
      }
    })
    bookRef.current = book
    renditionRef.current = rendition
    applyRenditionSettings(rendition, settings)
    locationsPromiseRef.current = null
    locationsReadyRef.current = false
    pagingRef.current = false
    readingRtlRef.current = false
    appliedDirectionRef.current = null
    let disposed = false
    let resizeFrame = null
    let measuredWidth = 0
    let measuredHeight = 0

    const emitProgress = (location) => {
      const spineCount = Math.max(1, book.spine?.spineItems?.length || 1)
      const spineIndex = Number(location.start.index) || 0
      const displayedPage = location.start.displayed?.page || 1
      const displayedTotal = Math.max(1, location.start.displayed?.total || 1)
      const approximate = (spineIndex + (displayedPage - 1) / displayedTotal) / spineCount
      let percent = Number.isFinite(location.start.percentage) ? location.start.percentage : approximate
      if (locationsReadyRef.current) {
        const precise = book.locations?.percentageFromCfi?.(location.start.cfi)
        if (Number.isFinite(precise)) percent = precise
      }
      lastPercentRef.current = percent
      progressCallbackRef.current({
        cfi: location.start.cfi,
        href: resolveTocHref(location, rendition, book, tocRef.current),
        percent,
        page: displayedPage,
        pageCount: displayedTotal,
      })
    }
    const resizeObserver = new ResizeObserver(() => {
      if (disposed) return
      const width = Math.round(hostRef.current?.clientWidth || 0)
      const height = Math.round(hostRef.current?.clientHeight || 0)
      if (!width || !height || (width === measuredWidth && height === measuredHeight)) return
      measuredWidth = width
      measuredHeight = height
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null
        if (disposed || renditionRef.current !== rendition || !rendition.manager?.stage) return
        rendition.resize(width, height)
      })
    })
    resizeObserver.observe(hostRef.current)

    book.loaded.navigation.then((navigation) => {
      const toc = flattenNavigation(navigation.toc)
      tocRef.current = toc
      chaptersCallbackRef.current(toc)
    }).catch(() => chaptersCallbackRef.current([]))

    // 打开书籍时恢复上次位置。
    // 两个保护措施：
    // 1. 等 book.ready 后再 display，避免过早调用导致恢复失败并回退到卷首；
    // 2. 恢复未结束前不上报进度（restoreSettled），防止“回退到 0%”覆盖已保存进度。
    //    display 挂起时用超时兜底：放弃恢复但同样不回写错误进度。
    let restoreSettled = !initialCfiRef.current
    const settleRestore = () => { restoreSettled = true }
    const guardedRelocated = (location) => {
      if (!restoreSettled) return
      pendingLocationRef.current = location
      if (progressFrameRef.current !== null) return
      progressFrameRef.current = requestAnimationFrame(() => {
        progressFrameRef.current = null
        const latest = pendingLocationRef.current
        pendingLocationRef.current = null
        if (!latest) return
        emitProgress(latest)
      })
    }

    rendition.on('relocated', guardedRelocated)

    // 划选句子 → 弹出评论卡片。翻页/跳转时关掉所有弹窗。
    rendition.on('selected', async (cfiRange, contents) => {
      try {
        const range = await book.getRange(cfiRange)
        const text = range?.toString().replace(/\s+/g, ' ').trim()
        if (!text || text.length < 2) return
        const iframe = hostRef.current?.querySelector('iframe')
        if (!iframe) return
        const frameRect = iframe.getBoundingClientRect()
        const hostRect = hostRef.current.getBoundingClientRect()
        const rect = range.getBoundingClientRect()
        const above = frameRect.top - hostRect.top + rect.top
        let chapterBefore = ''
        let paragraph = ''
        try {
          const prefixRange = contents.document.createRange()
          prefixRange.selectNodeContents(contents.document.body)
          prefixRange.setEnd(range.startContainer, range.startOffset)
          chapterBefore = prefixRange.toString().replace(/\s+/g, ' ').trim().slice(-120000)
        } catch {}
        // 选中文字所在的完整段落（块级元素文本），供字典百科作为语境锚点。
        try {
          const container = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement
          const block = container?.closest?.('p, li, blockquote, h1, h2, h3, h4, h5, div, section')
          paragraph = (block?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 4000)
        } catch {}
        // 字典百科条目的精确定位信息：章节名按选中处所在节匹配目录；
        // 百分比优先用 cfi 精确换算，定位表未生成时退回当前阅读进度（选中处就在可视页上，足够准）。
        const selectionHref = rendition.currentLocation()?.start?.href || ''
        let chapterLabel = ''
        try {
          chapterLabel = [...(tocRef.current || [])].reverse().find((item) => splitHref(item.href).hrefPath === splitHref(selectionHref).hrefPath)?.label || ''
        } catch {}
        let readPercent = lastPercentRef.current || 0
        try {
          const precise = book.locations?.percentageFromCfi?.(cfiRange)
          if (Number.isFinite(precise)) readPercent = precise
        } catch {}
        if (!readPercent) {
          // 定位表未生成且尚无进度事件（刚打开书）：用节号+页号折算近似百分比。
          const start = rendition.currentLocation()?.start
          const spineCount = Math.max(1, book.spine?.spineItems?.length || 1)
          readPercent = ((Number(start?.index) || 0) + ((start?.displayed?.page || 1) - 1) / Math.max(1, start?.displayed?.total || 1)) / spineCount
        }
        selectedContentsRef.current = contents
        setNotePopup(null)
        const payload = {
          text: text.slice(0, 500),
          cfi: cfiRange,
          href: selectionHref,
          spineIndex: Number(rendition.currentLocation()?.start?.index) || 0,
          chapterBefore,
          paragraph,
          chapterLabel,
          readPercent,
          left: Math.max(150, Math.min(hostRect.width - 150, frameRect.left - hostRect.left + rect.left + rect.width / 2)),
          below: above < 230,
          top: above < 230 ? frameRect.top - hostRect.top + rect.bottom + 10 : Math.max(10, above - 12),
          editing: false,
        }
        selectionPayloadRef.current = payload
        setSelPopup(null)
      } catch {}
    })
    rendition.on('relocated', () => { selectionPayloadRef.current = null; setSelPopup(null); setNotePopup(null) })

    rendition.on('rendered', (section, view) => {
      makeEpubPageTransparent(view.document, settingsRef.current.theme)
      // 'rendered' can fire again on the same document (resize, theme change,
      // direction switch) — bind listeners only once or every key/wheel event
      // would trigger multiple page turns.
      if (!boundViewDocuments.has(view.document)) {
        boundViewDocuments.add(view.document)
        view.document.addEventListener('keydown', (event) => shortcutRef.current(event))
        view.document.addEventListener('wheel', (event) => wheelCallbackRef.current?.(event), { passive: false })
        // iframe 内点击不冒泡到外层，面板“点击外部关闭”需要这里兜底。
        view.document.addEventListener('click', () => dismissPanelRef.current?.())
        view.document.addEventListener('contextmenu', async (event) => {
          const selectedText = view.document.defaultView?.getSelection()?.toString().trim()
          const payload = selectionPayloadRef.current
          if (!selectedText || !payload) return
          event.preventDefault()
          const canLookupEntity = payload.text.length <= 24 && !/[\r\n。！？!?，,；;：:]/.test(payload.text)
          const hasEntityProfile = canLookupEntity && Boolean(onCheckEntityProfile?.(payload.text))
          const action = await window.readerAPI.openSelectionMenu({ hasSelection: true, canLookupEntity, hasEntityProfile, hasAnyProfile: Boolean(hasAnyProfile) })
          if (action === 'note') setSelPopup({ ...payload, editing: true })
          else if (action === 'dictionary') onLookupDict?.(payload)
          else if (action === 'lookup-entity') onLookupEntity?.({ ...payload, readPosition: payload.cfi }, 'generate')
          else if (action === 'view-entity') onLookupEntity?.({ ...payload, readPosition: payload.cfi }, 'view')
          else if (action === 'link-entity') onLookupEntity?.({ ...payload, readPosition: payload.cfi }, 'link')
        })
      }
      fitFullPageBackground(view.document)
      const pageDirection = getPageDirection(view.document)
      const effectiveDirection = pageDirection.forcedDirection || rendition.settings.direction
      readingRtlRef.current = effectiveDirection === 'rtl' || (!pageDirection.forcedDirection && pageDirection.rtl)
      if (pageDirection.forcedDirection
        && rendition.settings.direction !== pageDirection.forcedDirection
        && appliedDirectionRef.current !== pageDirection.forcedDirection) {
        appliedDirectionRef.current = pageDirection.forcedDirection
        rendition.direction(pageDirection.forcedDirection)
        return
      }
      if (hasReadableContent(view.document)) {
        emptySkipCountRef.current = 0
        return
      }
      // Only chain-skip empty sections while the user is actively paging.
      // After an explicit jump (chapter/seek/search/initial open), landing on
      // a sparse section must stay put instead of bouncing to another chapter.
      if (!pagingRef.current) return
      if (emptySkipCountRef.current >= 24) return
      let adjacentIndex = section.index + navigationDirectionRef.current
      let adjacent = book.spine?.get(adjacentIndex)
      while (adjacent && !adjacent.linear) {
        adjacentIndex += navigationDirectionRef.current
        adjacent = book.spine?.get(adjacentIndex)
      }
      if (!adjacent) return
      emptySkipCountRef.current += 1
      rendition.display(adjacent.href)
    })

    if (initialCfiRef.current) {
      const restoreCfi = initialCfiRef.current
      let timedOut = false
      book.ready
        .then(() => Promise.race([
          rendition.display(restoreCfi).then(() => true, () => false),
          new Promise((resolve) => setTimeout(() => {
            timedOut = true
            resolve(false)
          }, 8000)),
        ]))
        .then((restored) => {
          if (disposed) return
          if (!restored || timedOut) {
            console.warn('[墨读阅读器] 阅读位置恢复失败，保留已保存进度不回写', restoreCfi)
          }
          settleRestore()
          // 恢复成功后同步一次当前位置（relocated 可能已在 settle 前触发并被闸门忽略）
          if (restored && !timedOut) {
            const current = rendition.currentLocation?.()
            if (current?.start?.cfi) emitProgress(current)
          }
        })
        .catch(() => settleRestore())
    } else {
      rendition.display()
    }

    // Generate locations in the background so progress percentage becomes
    // exact (instead of the rough per-spine-item estimate) shortly after open.
    const locationsTimer = setTimeout(() => {
      if (disposed) return
      if (!locationsPromiseRef.current) {
        locationsPromiseRef.current = book.ready
          .then(() => book.locations.generate(1600))
          .then(() => {
            locationsReadyRef.current = true
            if (!restoreSettled) return
            const current = rendition.currentLocation?.()
            if (!disposed && current?.start?.cfi) emitProgress(current)
          })
          .catch(() => null)
      }
    }, 1200)

    return () => {
      disposed = true
      searchTokenRef.current += 1
      clearTimeout(locationsTimer)
      resizeObserver.disconnect()
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame)
      if (progressFrameRef.current !== null) cancelAnimationFrame(progressFrameRef.current)
      progressFrameRef.current = null
      pendingLocationRef.current = null
      book.destroy()
      renditionRef.current = null
      bookRef.current = null
      locationsPromiseRef.current = null
      locationsReadyRef.current = false
      readingRtlRef.current = false
      appliedDirectionRef.current = null
    }
  }, [data])

  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    applyRenditionSettings(rendition, settings)
  }, [settings])

  // 把带 CFI 的笔记渲染成正文里的评论标记，点击标记弹出评论卡片。
  // 笔记增删时整体重挂，避免遗留已删除笔记的标记。
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    annotationsRef.current.forEach(({ cfi, type }) => { try { rendition.annotations.remove(cfi, type) } catch {} })
    annotationsRef.current = []
    for (const note of notes || []) {
      if (!note.cfi) continue
      try {
        // epubjs 的 mark 是挂在主文档视图容器上的小图标（点击事件坐标即主窗口坐标）
        rendition.annotations.mark(note.cfi, { noteId: note.id }, (event) => {
          const hostRect = hostRef.current?.getBoundingClientRect()
          if (!hostRect) return
          const above = (event.clientY || 0) - hostRect.top
          setSelPopup(null)
          setNotePopup({
            note,
            left: Math.max(150, Math.min(hostRect.width - 150, (event.clientX || 0) - hostRect.left)),
            below: above < 230,
            top: above < 230 ? above + 14 : Math.max(10, above - 14),
          })
        })
        annotationsRef.current.push({ cfi: note.cfi, type: 'mark' })
        if (note.color) {
          const colors = { amber: 'rgba(166, 199, 230, .34)', sage: 'rgba(142, 177, 209, .3)', rose: 'rgba(148, 162, 191, .3)' }
          rendition.annotations.highlight(note.cfi, { noteId: note.id }, null, `reader-highlight-${note.color}`, { fill: colors[note.color] || colors.amber, 'fill-opacity': '1', 'mix-blend-mode': 'multiply' })
          annotationsRef.current.push({ cfi: note.cfi, type: 'highlight' })
        }
      } catch {}
    }
    // 字典百科条目：不同颜色的高亮，点击重新打开上次的 AI 解说。
    for (const entry of dictEntries || []) {
      if (!entry.anchor?.cfi) continue
      try {
        rendition.annotations.highlight(entry.anchor.cfi, { dictId: entry.id }, () => onOpenDictEntry?.(entry), 'reader-dict-highlight', { fill: '#6a90b4', 'fill-opacity': '0.3', 'mix-blend-mode': 'multiply' })
        annotationsRef.current.push({ cfi: entry.anchor.cfi, type: 'highlight' })
      } catch {}
    }
  }, [notes, dictEntries, data])

  const closeSelectionPopup = () => {
    selectedContentsRef.current?.window?.getSelection()?.removeAllRanges()
    selectionPayloadRef.current = null
    setSelPopup(null)
  }

  const saveSelectionPopup = (comment, color) => {
    if (selPopup) {
      onCollect?.({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: selPopup.text,
        comment,
        color,
        cfi: selPopup.cfi,
        href: selPopup.href,
        createdAt: Date.now(),
      })
    }
    closeSelectionPopup()
  }

  useImperativeHandle(ref, () => {
    // Ignore page turns that arrive while a previous one is still settling,
    // so fast key repeats / wheel bursts cannot skip several pages at once.
    const navLocked = () => performance.now() < navLockRef.current
    const lockNav = () => { navLockRef.current = performance.now() + 280 }
    return {
    next: () => {
      navigationDirectionRef.current = 1
      emptySkipCountRef.current = 0
      pagingRef.current = true
      if (navLocked()) return undefined
      lockNav()
      return renditionRef.current?.next()
    },
    prev: () => {
      navigationDirectionRef.current = -1
      emptySkipCountRef.current = 0
      pagingRef.current = true
      if (navLocked()) return undefined
      lockNav()
      return renditionRef.current?.prev()
    },
    goLeft: () => {
      navigationDirectionRef.current = readingRtlRef.current ? 1 : -1
      emptySkipCountRef.current = 0
      pagingRef.current = true
      if (navLocked()) return undefined
      lockNav()
      return readingRtlRef.current ? renditionRef.current?.next() : renditionRef.current?.prev()
    },
    goRight: () => {
      navigationDirectionRef.current = readingRtlRef.current ? -1 : 1
      emptySkipCountRef.current = 0
      pagingRef.current = true
      if (navLocked()) return undefined
      lockNav()
      return readingRtlRef.current ? renditionRef.current?.prev() : renditionRef.current?.next()
    },
    goToChapter: async (href) => {
      navigationDirectionRef.current = 1
      emptySkipCountRef.current = 0
      pagingRef.current = false
      renditionRef.current?.display(href)
    },
    goToNote: (note) => {
      if (!note?.cfi) return undefined
      pagingRef.current = false
      return bookRef.current?.ready
        .then(() => renditionRef.current?.display(note.cfi))
        .catch(() => {})
    },
    goToSearch: ({ cfi }) => {
      pagingRef.current = false
      return cfi && renditionRef.current?.display(cfi)
    },
    search: async (query, onUpdate) => {
      const book = bookRef.current
      if (!book || !query) return []
      const token = ++searchTokenRef.current
      await book.ready
      const sections = book.spine?.spineItems || []
      const results = []
      const seen = new Set()
      const currentIndex = Number(renditionRef.current?.currentLocation?.()?.start?.index)
      const limit = 5000
      let truncated = false
      for (let index = 0; index < sections.length && results.length < limit; index += 1) {
        if (token !== searchTokenRef.current) break
        const section = sections[index]
        try {
          await section.load(book.load.bind(book))
          const matches = searchVariants(query, settings.scriptConversion).flatMap((variant) => [...section.find(variant), ...section.search(variant, 5)])
          const sectionPath = splitHref(section.href).hrefPath
          const chapter = [...tocRef.current].reverse().find((item) => splitHref(item.href).hrefPath === sectionPath)?.label || `第 ${index + 1} 节`
          for (const match of matches) {
            if (seen.has(match.cfi)) continue
            seen.add(match.cfi)
            results.push({ cfi: match.cfi, label: match.excerpt, chapter })
            if (results.length >= limit) { truncated = true; break }
          }
        } catch {
          // Skip malformed spine documents and continue searching the book.
        } finally {
          if (index !== currentIndex) section.unload()
        }
        onUpdate?.([...results], (index + 1) / Math.max(1, sections.length))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return { results, truncated }
    },
    lookupEntity: async (names, selection) => {
      const book = bookRef.current
      const terms = (Array.isArray(names) ? names : [names]).map((value) => String(value || '').trim()).filter(Boolean)
      if (!book || !terms.length) return { excerpts: [], totalMatches: 0 }
      await book.ready
      const excerpts = []
      const sections = book.spine?.spineItems || []
      const currentIndex = Math.max(0, Number(selection?.spineIndex) || 0)
      // 长书按节跨步采样 + 每节限量：5000 条上限覆盖全程，而不是堆在前面的章节。
      // 增量更新时从上份资料卡的进度开始（百分比到节号是近似映射，留 10%+1 节余量宁可多扫）。
      const fromPercent = Number(selection?.fromReadPercent) || 0
      const startIndex = fromPercent > 0 ? Math.max(0, Math.min(currentIndex, Math.floor(fromPercent * currentIndex * 0.9) - 1)) : 0
      const span = Math.max(1, currentIndex - startIndex)
      const sectionStride = Math.max(1, Math.ceil(span / 1200))
      const visitedEstimate = Math.ceil(span / sectionStride)
      const perSectionCap = Math.max(2, Math.floor(4900 / visitedEstimate))
      const visited = new Set()
      const addMatches = (text, chapter) => {
        let sectionHits = 0
        for (const name of terms) {
          let position = text.indexOf(name)
          while (position >= 0 && excerpts.length < 5000 && sectionHits < perSectionCap) {
            excerpts.push({ order: excerpts.length + 1, chapter, text: text.slice(Math.max(0, position - 150), Math.min(text.length, position + name.length + 220)).replace(/\s+/g, ' ').trim() })
            sectionHits += 1
            position = text.indexOf(name, position + Math.max(1, name.length))
          }
        }
      }
      const scanSection = async (index) => {
        if (index < 0 || index >= currentIndex || visited.has(index) || excerpts.length >= 5000) return
        visited.add(index)
        const section = sections[index]
        try {
          await section.load(book.load.bind(book))
          const sectionPath = splitHref(section.href).hrefPath
          const chapter = [...tocRef.current].reverse().find((item) => splitHref(item.href).hrefPath === sectionPath)?.label || `第 ${index + 1} 节`
          addMatches(section.document?.body?.textContent || '', chapter)
        } catch {} finally { section.unload() }
      }
      for (let index = startIndex; index < currentIndex && excerpts.length < 5000; index += sectionStride) await scanSection(index)
      // 最近几节必须扫描（当前状态锚点），不受跨步影响。
      for (let index = Math.max(startIndex, currentIndex - 8); index < currentIndex; index += 1) await scanSection(index)
      const currentChapter = [...tocRef.current].reverse().find((item) => splitHref(item.href).hrefPath === splitHref(selection?.href).hrefPath)?.label || `第 ${currentIndex + 1} 节`
      addMatches(`${selection?.chapterBefore || ''} ${selection?.text || ''}`, currentChapter)
      return { excerpts, totalMatches: excerpts.length, truncated: excerpts.length >= 5000 }
    },
    seek: async (ratio) => {
      pagingRef.current = false
      if (!locationsPromiseRef.current) {
        const book = bookRef.current
        locationsPromiseRef.current = book?.ready
          .then(() => book.locations.generate(1600))
          .then(() => { locationsReadyRef.current = true })
          .catch(() => null)
      }
      await locationsPromiseRef.current
      const cfi = bookRef.current?.locations?.cfiFromPercentage(Math.max(0, Math.min(1, ratio)))
      if (cfi) renditionRef.current?.display(cfi)
    },
    getLocation: () => {
      const start = renditionRef.current?.currentLocation?.()?.start
      return { cfi: start?.cfi, href: start?.href, page: start?.displayed?.page || 1, spineIndex: Number(start?.index) || 0 }
    },
    // 字典百科素材：按条目记录的 href 加载该节，提取上下文与章节全文（超 2 万字符以选中处为中心截取）。
    getDictContext: async (anchor) => {
      const book = bookRef.current
      if (!book || !anchor?.href) return null
      try {
        await book.ready
        const targetPath = splitHref(anchor.href).hrefPath
        const section = (book.spine?.spineItems || []).find((item) => splitHref(item.href).hrefPath === targetPath)
        if (!section) return null
        await section.load(book.load.bind(book))
        const full = (section.document?.body?.textContent || '').replace(/\s+/g, ' ').trim()
        section.unload?.()
        if (!full) return null
        const selected = String(anchor.text || '')
        const needle = selected.slice(0, 40)
        const pos = needle ? full.indexOf(needle) : -1
        let chapterText = full
        if (full.length > 20000) {
          const center = pos >= 0 ? pos : Math.floor(full.length / 2)
          const from = Math.max(0, Math.min(center - 10000, full.length - 20000))
          chapterText = full.slice(from, from + 20000)
        }
        const contextBefore = pos > 0 ? full.slice(Math.max(0, pos - 3000), pos) : ''
        const contextAfter = pos >= 0 ? full.slice(pos + selected.length, pos + selected.length + 3000) : ''
        return { paragraph: anchor.paragraph || '', contextBefore, contextAfter, chapterText }
      } catch { return null }
    },
    // AI 陪读素材：按目录项 href 加载该节，提取整章文本。
    // 优先按块级元素拼接保留基本换行；没有块级结构时退化为整体 textContent。
    getChapterText: async (unit) => {
      const book = bookRef.current
      if (!book || !unit?.chapter?.href) return ''
      try {
        await book.ready
        const targetPath = splitHref(unit.chapter.href).hrefPath
        const section = (book.spine?.spineItems || []).find((item) => splitHref(item.href).hrefPath === targetPath)
        if (!section) return ''
        await section.load(book.load.bind(book))
        const body = section.document?.body
        const blocks = body ? [...body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre')] : []
        const full = blocks.length
          ? blocks.map((element) => element.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
          : (body?.textContent || '').replace(/\s+/g, ' ').trim()
        section.unload?.()
        return truncateCompanionText(full)
      } catch { return '' }
    },
    goToBookmark: (bookmark) => bookmark?.cfi && renditionRef.current?.display(bookmark.cfi),
    }
  }, [settings.scriptConversion])

  return (
    <div className="epub-host" ref={hostRef} style={{ '--page-margin': `${settings.pageMargin}px` }}>
      {selPopup?.editing ? <SelectionPopup text={selPopup.text} left={selPopup.left} top={selPopup.top} below={selPopup.below} onSave={saveSelectionPopup} onCancel={closeSelectionPopup} /> : null}
      {notePopup ? <NotePopup notes={[notePopup.note]} left={notePopup.left} top={notePopup.top} below={notePopup.below} onClose={() => setNotePopup(null)} /> : null}
    </div>
  )
})

export default EpubReader
