import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import ePub from 'epubjs'
import { NotePopup, SelectionPopup } from './NotePopups'

const boundViewDocuments = new WeakSet()

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

const EpubReader = forwardRef(function EpubReader({ data, settings, initialCfi, onProgress, onChapters, onShortcut, onWheel, onCollect, notes = [] }, ref) {
  const hostRef = useRef(null)
  const renditionRef = useRef(null)
  const bookRef = useRef(null)
  const [selPopup, setSelPopup] = useState(null)
  const [notePopup, setNotePopup] = useState(null)
  const selectedContentsRef = useRef(null)
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
  const navLockRef = useRef(0)
  const pagingRef = useRef(false)
  const initialDataRef = useRef(data)
  const initialCfiRef = useRef(initialCfi)
  const shortcutRef = useRef(onShortcut)
  const wheelCallbackRef = useRef(onWheel)
  if (initialDataRef.current !== data) {
    initialDataRef.current = data
    initialCfiRef.current = initialCfi
  }
  progressCallbackRef.current = onProgress
  chaptersCallbackRef.current = onChapters
  shortcutRef.current = onShortcut
  wheelCallbackRef.current = onWheel

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
    bookRef.current = book
    renditionRef.current = rendition
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
        selectedContentsRef.current = contents
        setNotePopup(null)
        setSelPopup({
          text: text.slice(0, 500),
          cfi: cfiRange,
          href: rendition.currentLocation()?.start?.href || '',
          left: Math.max(150, Math.min(hostRect.width - 150, frameRect.left - hostRect.left + rect.left + rect.width / 2)),
          below: above < 230,
          top: above < 230 ? frameRect.top - hostRect.top + rect.bottom + 10 : Math.max(10, above - 12),
        })
      } catch {}
    })
    rendition.on('relocated', () => { setSelPopup(null); setNotePopup(null) })

    rendition.on('rendered', (section, view) => {
      // 'rendered' can fire again on the same document (resize, theme change,
      // direction switch) — bind listeners only once or every key/wheel event
      // would trigger multiple page turns.
      if (!boundViewDocuments.has(view.document)) {
        boundViewDocuments.add(view.document)
        view.document.addEventListener('keydown', (event) => shortcutRef.current(event))
        view.document.addEventListener('wheel', (event) => wheelCallbackRef.current?.(event), { passive: false })
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
    const fontFamily = settings.fontFamily === 'sans'
      ? 'Microsoft YaHei UI, PingFang SC, sans-serif'
      : settings.fontFamily === 'kai' ? 'KaiTi, STKaiti, serif' : 'Songti SC, SimSun, serif'
    const textColor = settings.theme === 'night'
      ? `rgba(224, 226, 220, ${settings.opacity})`
      : `rgba(36, 39, 37, ${settings.opacity})`
    rendition.themes.register('reader-settings', {
      body: {
        'font-family': `${fontFamily} !important`,
        'font-size': `${settings.fontSize}px !important`,
        'line-height': `${settings.lineHeight} !important`,
        'letter-spacing': `${settings.letterSpacing}px !important`,
        color: `${textColor} !important`,
        'background-color': 'transparent !important',
      },
      p: {
        'margin-top': '0 !important',
        'margin-bottom': `${settings.paragraphGap}px !important`,
        'text-align': 'justify !important',
      },
      'h1, h2, h3': { 'line-height': '1.45 !important' },
    })
    rendition.themes.select('reader-settings')
  }, [settings])

  // 把带 CFI 的笔记渲染成正文里的评论标记，点击标记弹出评论卡片。
  // 笔记增删时整体重挂，避免遗留已删除笔记的标记。
  useEffect(() => {
    const rendition = renditionRef.current
    if (!rendition) return
    annotationsRef.current.forEach((cfi) => { try { rendition.annotations.remove(cfi, 'mark') } catch {} })
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
        annotationsRef.current.push(note.cfi)
      } catch {}
    }
  }, [notes, data])

  const closeSelectionPopup = () => {
    selectedContentsRef.current?.window?.getSelection()?.removeAllRanges()
    setSelPopup(null)
  }

  const saveSelectionPopup = (comment) => {
    if (selPopup) {
      onCollect?.({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        text: selPopup.text,
        comment,
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
      for (let index = 0; index < sections.length && results.length < 200; index += 1) {
        if (token !== searchTokenRef.current) break
        const section = sections[index]
        try {
          await section.load(book.load.bind(book))
          const matches = section.search(query, 3)
          const sectionPath = splitHref(section.href).hrefPath
          const chapter = [...tocRef.current].reverse().find((item) => splitHref(item.href).hrefPath === sectionPath)?.label || `第 ${index + 1} 节`
          for (const match of matches) {
            if (seen.has(match.cfi)) continue
            seen.add(match.cfi)
            results.push({ cfi: match.cfi, label: match.excerpt, chapter })
            if (results.length >= 200) break
          }
        } catch {
          // Skip malformed spine documents and continue searching the book.
        } finally {
          if (index !== currentIndex) section.unload()
        }
        onUpdate?.([...results], (index + 1) / Math.max(1, sections.length))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      return results
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
    }
  }, [])

  return (
    <div className="epub-host" ref={hostRef} style={{ '--page-margin': `${settings.pageMargin}px` }}>
      {selPopup ? <SelectionPopup text={selPopup.text} left={selPopup.left} top={selPopup.top} below={selPopup.below} onSave={saveSelectionPopup} onCancel={closeSelectionPopup} /> : null}
      {notePopup ? <NotePopup notes={[notePopup.note]} left={notePopup.left} top={notePopup.top} below={notePopup.below} onClose={() => setNotePopup(null)} /> : null}
    </div>
  )
})

export default EpubReader
