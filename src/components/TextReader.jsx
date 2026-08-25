import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { NotePopup } from './NotePopups'
import { convertChinese } from '../chineseConversion'
import { getNearestReaderFontWeight, getReaderFontStack, normalizeReaderFontFamily } from '../readerFonts'

const CHAPTER_PATTERN = /^(?:(?:正文\s*)?第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节卷部篇回集幕]\s*.{0,50}|(?:卷|部|篇|章)\s*[0-9０-９零〇一二三四五六七八九十百千万两]+(?:[\s:：.-]+.{0,45})?|(?:序章|序言|前言|楔子|引子|后记|尾声|终章|大结局)(?:[\s:：.-]+.{0,45})?|(?:番外|外传|附录)\s*[0-9０-９零〇一二三四五六七八九十百千万两]*(?:[\s:：.-]+.{0,45})?|(?:chapter|part|volume|book)\s+[0-9ivxlcdm]+(?:[\s:：.-]+.{0,50})?)$/i

// AI 陪读单次总结的文本上限：超过则保留首尾、省略中间。
const COMPANION_TEXT_LIMIT = 24000
export function truncateCompanionText(text) {
  const value = String(text || '')
  if (value.length <= COMPANION_TEXT_LIMIT) return value
  return `${value.slice(0, 14400)}\n……（中间内容省略）……\n${value.slice(-9600)}`
}

const TextReader = forwardRef(function TextReader({ content, settings, initialPage, initialFraction = null, wheelMode = 'page', onProgress, onChapters, onCollectIntent, onShareIntent, onBoundaryNext, onBoundaryPrev, notes = [], onLookupEntity, onCheckEntityProfile, hasAnyProfile, dictEntries = [], onLookupDict, onOpenDictEntry, rewrites = [], onRewrite, onOpenRewrite }, ref) {
  const scrollMode = wheelMode === 'scroll'
  const scrollModeRef = useRef(scrollMode)
  scrollModeRef.current = scrollMode
  const initialFractionRef = useRef(initialFraction)
  const viewportRef = useRef(null)
  const shellRef = useRef(null)
  const contentRef = useRef(null)
  const resizeTimerRef = useRef(null)
  const scrollSettleTimerRef = useRef(null)
  const chapterFlashTimerRef = useRef(null)
  const jumpTimersRef = useRef([])
  const resizingRef = useRef(false)
  const positionFractionRef = useRef(null)
  const measuredLayoutRef = useRef(false)
  const progressCallbackRef = useRef(onProgress)
  const chaptersCallbackRef = useRef(onChapters)
  const [page, setPage] = useState(initialPage || 0)
  const [pageCount, setPageCount] = useState(1)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(0)
  const [paintReady, setPaintReady] = useState(false)
  const [selection, setSelection] = useState(null)
  const [marker, setMarker] = useState(null)
  const [chapterFlash, setChapterFlash] = useState(-1)
  progressCallbackRef.current = onProgress
  chaptersCallbackRef.current = onChapters
  const pagePadding = viewportWidth
    ? Math.max(22, Math.min(settings.pageMargin, viewportWidth * 0.08))
    : 22

  // 段落下标 → 该段的笔记列表，用于在段末渲染评论标记。
  const notesByParagraph = useMemo(() => {
    const map = new Map()
    for (const note of notes || []) {
      if (!Number.isFinite(note.paragraphIndex)) continue
      map.set(note.paragraphIndex, [...(map.get(note.paragraphIndex) || []), note])
    }
    return map
  }, [notes])

  const displayContent = useMemo(() => convertChinese(content, settings.scriptConversion), [content, settings.scriptConversion])
  const paragraphs = useMemo(() => displayContent
    .replace(/^\uFEFF/, '')
    .split(/\r?\n+/)
    .map((text) => text.trim())
    .filter(Boolean), [displayContent])

  // 每个渲染段落（trim 后）在 content 中的字符区间，用于把主进程给的字符
  // anchor 映射成段落下标。与上面 split/trim/filter 的结果一一对应。
  const paragraphSpans = useMemo(() => {
    const text = displayContent.replace(/^\uFEFF/, '')
    const spans = []
    const pattern = /[^\r\n]+/g
    let match = pattern.exec(text)
    while (match) {
      const trimmed = match[0].trim()
      if (trimmed) {
        const lead = match[0].length - match[0].trimStart().length
        spans.push({ index: spans.length, start: match.index + lead, end: match.index + lead + trimmed.length })
      }
      match = pattern.exec(text)
    }
    return spans
  }, [displayContent])

  const chapters = useMemo(() => paragraphs.reduce((items, text, index) => {
    const line = text.replace(/[\u3000\t]+/g, ' ').trim()
    if (line.length <= 80 && CHAPTER_PATTERN.test(line)) items.push({ label: line, index })
    return items
  }, []), [paragraphs])

  useEffect(() => chaptersCallbackRef.current(chapters), [chapters])

  useEffect(() => {
    // 测量可视文字区（.text-viewport）而不是外壳：UI B 把文字区限制在
    // min(820px, 100%-56px) 并居中，列宽必须与可视宽度一致，翻页步长才对。
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const markResizing = () => {
      resizingRef.current = true
      setPaintReady(false)
      clearTimeout(resizeTimerRef.current)
      resizeTimerRef.current = setTimeout(() => {
        resizingRef.current = false
        setPaintReady(true)
      }, 90)
    }
    let windowWidth = window.innerWidth
    let windowHeight = window.innerHeight
    const handleWindowResize = () => {
      const nextWidth = window.innerWidth
      const nextHeight = window.innerHeight
      if (nextWidth === windowWidth && nextHeight === windowHeight) return
      windowWidth = nextWidth
      windowHeight = nextHeight
      markResizing()
    }
    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = Math.round(entry.contentRect.width)
      const nextHeight = Math.round(entry.contentRect.height)
      setViewportWidth((current) => current === nextWidth ? current : nextWidth)
      setViewportHeight((current) => current === nextHeight ? current : nextHeight)
    })
    observer.observe(viewport)
    window.addEventListener('resize', handleWindowResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleWindowResize)
      clearTimeout(resizeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (scrollMode) return undefined
    const timer = requestAnimationFrame(() => {
      const node = contentRef.current
      if (!node || !viewportWidth) return
      // Column count changes when either width or height changes. Immersive mode
      // often keeps the same width but gains vertical space, so measuring only
      // on width changes leaves a stale pageCount and makes the last arrow turns
      // clamp to the same scroll position. scrollWidth already includes the
      // article's inline padding; dividing by the actual viewport pitch is enough.
      const count = Math.max(1, Math.round(viewportRef.current.scrollWidth / viewportWidth))
      setPageCount(count)
      setPage((current) => {
        if (!measuredLayoutRef.current) {
          measuredLayoutRef.current = true
          return Math.min(current, count - 1)
        }
        const ratio = positionFractionRef.current ?? (pageCount <= 1 ? 0 : current / (pageCount - 1))
        return Math.max(0, Math.min(count - 1, Math.round(ratio * (count - 1))))
      })
    })
    return () => cancelAnimationFrame(timer)
  }, [content, pagePadding, settings, viewportWidth, viewportHeight, scrollMode])

  // 滚动文字模式：单栏垂直排版，进度按 scrollTop 比例上报，首次按已存百分比恢复位置。
  useEffect(() => {
    if (!scrollMode) return undefined
    const timer = requestAnimationFrame(() => {
      const viewport = viewportRef.current
      if (!viewport || !viewportWidth) return
      setPageCount(Math.max(1, Math.ceil(viewport.scrollHeight / viewport.clientHeight)))
      if (!measuredLayoutRef.current) {
        measuredLayoutRef.current = true
        const fraction = initialFractionRef.current
        if (fraction > 0) viewport.scrollTop = fraction * (viewport.scrollHeight - viewport.clientHeight)
      }
      setPaintReady(true)
    })
    return () => cancelAnimationFrame(timer)
  }, [content, pagePadding, settings, viewportWidth, viewportHeight, scrollMode])

  // Native scrolling can stop at any sub-pixel and leave the first line cut in half.
  // Once scrolling settles, move the clipped line back into full view. This keeps
  // wheel scrolling natural while page turns and restored positions remain readable.
  useEffect(() => {
    if (!scrollMode) return undefined
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const visibleLineRects = () => {
      const viewportRect = viewport.getBoundingClientRect()
      const nodes = contentRef.current?.querySelectorAll('[data-paragraph]') || []
      const rects = []
      for (const element of nodes) {
        const box = element.getBoundingClientRect()
        if (box.bottom < viewportRect.top - 2) continue
        if (box.top > viewportRect.bottom + 2) break
        const range = document.createRange()
        range.selectNodeContents(element)
        for (const rect of range.getClientRects()) {
          if (rect.width > 0 && rect.height > 0) rects.push(rect)
        }
      }
      return rects
    }
    const alignFirstLine = () => {
      if (viewport.scrollTop <= 1) return
      const viewportTop = viewport.getBoundingClientRect().top
      const clipped = visibleLineRects().find((rect) => rect.top < viewportTop - .5 && rect.bottom > viewportTop + .5)
      if (clipped) viewport.scrollTop += clipped.top - viewportTop
    }
    const fitLastLine = () => {
      // Start from the full shell on every settled position, then place its
      // lower edge immediately before the glyph row that would be clipped.
      viewport.style.setProperty('--scroll-bottom-guard', '0px')
      requestAnimationFrame(() => {
        const viewportBottom = viewport.getBoundingClientRect().bottom
        if (!viewportBottom) return
        let guard = 0
        for (const rect of visibleLineRects()) {
          if (rect.top < viewportBottom && rect.bottom > viewportBottom + .5) {
            guard = Math.max(guard, viewportBottom - rect.top + 1)
          }
        }
        viewport.style.setProperty('--scroll-bottom-guard', `${Math.ceil(guard)}px`)
      })
    }
    const settle = () => {
      clearTimeout(scrollSettleTimerRef.current)
      scrollSettleTimerRef.current = setTimeout(() => {
        alignFirstLine()
        requestAnimationFrame(fitLastLine)
      }, 90)
    }
    viewport.addEventListener('scroll', settle, { passive: true })
    const shellObserver = new ResizeObserver(settle)
    if (shellRef.current) shellObserver.observe(shellRef.current)
    settle()
    return () => {
      clearTimeout(scrollSettleTimerRef.current)
      shellObserver.disconnect()
      viewport.removeEventListener('scroll', settle)
    }
  }, [scrollMode, viewportWidth])

  useEffect(() => {
    if (!scrollMode) return undefined
    const viewport = viewportRef.current
    if (!viewport) return undefined
    const report = () => {
      const max = viewport.scrollHeight - viewport.clientHeight
      const fraction = max > 4 ? Math.min(1, viewport.scrollTop / max) : 0
      const count = Math.max(1, Math.ceil(viewport.scrollHeight / viewport.clientHeight))
      const currentPage = Math.min(count - 1, Math.floor(viewport.scrollTop / viewport.clientHeight))
      setPageCount(count)
      setPage(currentPage)
      let chapterIndex = -1
      for (let index = 0; index < chapters.length; index += 1) {
        const element = contentRef.current?.querySelector(`[data-paragraph="${chapters[index].index}"]`)
        if (!element || element.offsetTop > viewport.scrollTop + 60) break
        chapterIndex = index
      }
      let textFraction = fraction
      const nodes = contentRef.current?.querySelectorAll('[data-paragraph]')
      if (nodes?.length) {
        let low = 0
        let high = nodes.length
        while (low < high) {
          const middle = (low + high) >> 1
          if (nodes[middle].offsetTop < viewport.scrollTop - 1) low = middle + 1
          else high = middle
        }
        textFraction = Math.min(1, low / nodes.length)
      }
      progressCallbackRef.current({ page: currentPage, pageCount: count, chapterIndex, textFraction, percent: fraction })
      positionFractionRef.current = textFraction
    }
    viewport.addEventListener('scroll', report, { passive: true })
    report()
    return () => viewport.removeEventListener('scroll', report)
  }, [chapters, scrollMode, viewportWidth])

  useEffect(() => {
    if (!scrollMode) return undefined
    const viewport = viewportRef.current
    if (!viewport) return undefined
    // 滚到顶/底后继续滚 → 通知外层切换分块（大文件）或保持不动（小文件无 boundary 回调）。
    const handle = (event) => {
      if (!onBoundaryNext && !onBoundaryPrev) return
      const max = viewport.scrollHeight - viewport.clientHeight
      if (event.deltaY > 0 && viewport.scrollTop >= max - 2) onBoundaryNext?.()
      else if (event.deltaY < 0 && viewport.scrollTop <= 2) onBoundaryPrev?.()
    }
    viewport.addEventListener('wheel', handle, { passive: true })
    return () => viewport.removeEventListener('wheel', handle)
  }, [scrollMode, onBoundaryNext, onBoundaryPrev])

  useLayoutEffect(() => {
    if (scrollMode) return
    if (!viewportRef.current || !viewportWidth) return
    viewportRef.current.scrollLeft = page * viewportWidth
    if (resizingRef.current) return
    setPaintReady(true)
  }, [page, settings, viewportWidth, scrollMode])

  useEffect(() => {
    if (scrollMode) return
    const pageLeft = page * viewportWidth
    let chapterIndex = -1
    for (let index = 0; index < chapters.length; index += 1) {
      const element = contentRef.current?.querySelector(`[data-paragraph="${chapters[index].index}"]`)
      if (!element || element.offsetLeft > pageLeft + 1) break
      chapterIndex = index
    }
    // Fraction of the text that sits before the current page, based on the
    // first paragraph visible on it. LargeTextReader uses this to derive an
    // accurate byte position (page ratio × chunk bytes is too coarse).
    let textFraction = pageCount <= 1 ? 0 : page / (pageCount - 1)
    const nodes = contentRef.current?.querySelectorAll('[data-paragraph]')
    if (nodes?.length && viewportWidth) {
      let low = 0
      let high = nodes.length
      while (low < high) {
        const middle = (low + high) >> 1
        if (nodes[middle].offsetLeft < pageLeft - 1) low = middle + 1
        else high = middle
      }
      textFraction = Math.min(1, low / nodes.length)
    }
    progressCallbackRef.current({ page, pageCount, chapterIndex, textFraction, percent: pageCount <= 1 ? 0 : page / (pageCount - 1) })
    positionFractionRef.current = textFraction
  }, [chapters, page, pageCount, viewportWidth, scrollMode])

  // 跳转到指定段落。布局尚未就绪（新挂载的分块 viewportWidth 仍为 0）时
  // 先挂起，由下面的 effect 在测量完成后补跳，避免跳转被静默丢弃。
  const pendingJumpRef = useRef(null)
  const jumpToParagraph = useCallback((index) => {
    const element = contentRef.current?.querySelector(`[data-paragraph="${index}"]`)
    if (!element || !viewportWidth) {
      pendingJumpRef.current = index
      return
    }
    pendingJumpRef.current = null
    if (scrollMode) {
      const paddingTop = parseFloat(getComputedStyle(contentRef.current).paddingTop) || 0
      const viewport = viewportRef.current
      const align = () => {
        const delta = element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - paddingTop
        if (Math.abs(delta) > .5) viewport.scrollTop = Math.max(0, viewport.scrollTop + delta)
      }
      viewport.scrollTop = Math.max(0, element.offsetTop - paddingTop)
      // Fonts, chapter margins and a different immersive viewport can all alter
      // the first estimate. Correct against the actual painted rectangles more
      // than once because a newly activated large-text chunk also mounts buffers.
      jumpTimersRef.current.forEach(clearTimeout)
      jumpTimersRef.current = [0, 80, 240, 700].map((delay) => setTimeout(align, delay))
      return
    }
    setPage(Math.max(0, Math.round(element.offsetLeft / viewportWidth)))
  }, [viewportWidth, scrollMode])

  const jumpToChapterLabel = useCallback((label) => {
    const normalized = String(label || '').replace(/[\u3000\t]+/g, ' ').trim()
    const chapter = chapters.find((item) => item.label === normalized)
      || chapters.find((item) => item.label.includes(normalized) || normalized.includes(item.label))
    const heading = [...(contentRef.current?.querySelectorAll('h2[data-paragraph]') || [])].find((item) => {
      const text = item.textContent.replace(/[\u3000\t]+/g, ' ').trim()
      return text === normalized || text.includes(normalized) || normalized.includes(text)
    })
    const index = chapter?.index ?? Number(heading?.dataset.paragraph)
    if (!Number.isFinite(index)) return false
    jumpToParagraph(index)
    setChapterFlash(index)
    clearTimeout(chapterFlashTimerRef.current)
    chapterFlashTimerRef.current = setTimeout(() => setChapterFlash(-1), 1400)
    return true
  }, [chapters, jumpToParagraph])

  useEffect(() => () => {
    clearTimeout(chapterFlashTimerRef.current)
    jumpTimersRef.current.forEach(clearTimeout)
  }, [])

  useEffect(() => {
    if (pendingJumpRef.current !== null) jumpToParagraph(pendingJumpRef.current)
  }, [jumpToParagraph, pageCount, viewportWidth])

  useImperativeHandle(ref, () => ({
    next: () => {
      if (scrollModeRef.current) {
        const viewport = viewportRef.current
        if (!viewport) return
        if (viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 4) onBoundaryNext?.()
        else viewport.scrollBy({ top: viewport.clientHeight * 0.94 })
        return
      }
      setPage((current) => {
        if (current < pageCount - 1) return current + 1
        onBoundaryNext?.()
        return current
      })
    },
    prev: () => {
      if (scrollModeRef.current) {
        const viewport = viewportRef.current
        if (!viewport) return
        if (viewport.scrollTop <= 4) onBoundaryPrev?.()
        else viewport.scrollBy({ top: -viewport.clientHeight * 0.94 })
        return
      }
      setPage((current) => {
        if (current > 0) return current - 1
        onBoundaryPrev?.()
        return current
      })
    },
    seek: (ratio) => {
      if (scrollModeRef.current) {
        const viewport = viewportRef.current
        if (viewport) viewport.scrollTop = ratio * (viewport.scrollHeight - viewport.clientHeight)
        return
      }
      setPage(Math.max(0, Math.min(pageCount - 1, Math.round((pageCount - 1) * ratio))))
    },
    goToChapter: (index) => {
      jumpToParagraph(index)
      setChapterFlash(index)
      clearTimeout(chapterFlashTimerRef.current)
      chapterFlashTimerRef.current = setTimeout(() => setChapterFlash(-1), 1400)
    },
    goToChapterLabel: (label) => jumpToChapterLabel(label),
    goToParagraph: (index) => jumpToParagraph(index),
    // 主进程返回的字符 anchor（目标在块内容中的字符下标）→ 段落 → 所在页。
    goToAnchor: (charIndex) => {
      if (!Number.isFinite(charIndex)) return
      const span = paragraphSpans.find((item) => charIndex < item.end)
        || paragraphSpans[paragraphSpans.length - 1]
      jumpToParagraph(span ? span.index : 0)
    },
    goToSearch: ({ query, occurrence = 0, paragraphIndex }) => {
      if (Number.isFinite(paragraphIndex)) { jumpToParagraph(paragraphIndex); return }
      let seen = 0
      const index = paragraphs.findIndex((paragraph) => {
        if (!paragraph.includes(query)) return false
        if (seen === occurrence) return true
        seen += 1
        return false
      })
      jumpToParagraph(Math.max(0, index))
    },
    getLocation: () => ({ page, paragraphIndex: Math.round((positionFractionRef.current || 0) * Math.max(0, paragraphs.length - 1)), textFraction: positionFractionRef.current || 0 }),
    // 字典百科素材：选中段落、前后文，以及所在章节全文（超 2 万字符时以选中段为中心截取）。
    getDictContext: (anchor) => {
      const index = Number(anchor?.paragraphIndex)
      if (!Number.isFinite(index) || index < 0 || index >= paragraphs.length) return null
      const paragraph = paragraphs[index] || ''
      const contextBefore = paragraphs.slice(Math.max(0, index - 12), index).join('\n').slice(-3000)
      const contextAfter = paragraphs.slice(index + 1, index + 13).join('\n').slice(0, 3000)
      const chapterIndex = chapters.reduce((match, chapter, i) => (chapter.index <= index ? i : match), -1)
      const chapterStart = chapterIndex >= 0 ? chapters[chapterIndex].index : 0
      const chapterEnd = chapterIndex >= 0 && chapterIndex + 1 < chapters.length ? chapters[chapterIndex + 1].index : paragraphs.length
      let chapterText = paragraphs.slice(chapterStart, chapterEnd).join('\n')
      if (chapterText.length > 20000) {
        const headLength = paragraphs.slice(chapterStart, index).join('\n').length
        const from = Math.max(0, Math.min(headLength - 10000, chapterText.length - 20000))
        chapterText = chapterText.slice(from, from + 20000)
      }
      return { paragraph, contextBefore, contextAfter, chapterText }
    },
    // AI 陪读素材：整章文本（chapter.index 为段落下标，切到下一章或末尾）；
    // 无章节书按字符区间在段落拼接的全文里切片。超上限保留首尾。
    getChapterText: (unit) => {
      let text = ''
      if (unit?.chapter && Number.isFinite(unit.chapter.index)) {
        const position = chapters.findIndex((item) => item.index === unit.chapter.index)
        if (position < 0) return ''
        const end = position + 1 < chapters.length ? chapters[position + 1].index : paragraphs.length
        text = paragraphs.slice(unit.chapter.index, end).join('\n')
      } else if (Array.isArray(unit?.range)) {
        const full = paragraphs.join('\n')
        text = full.slice(Math.max(0, unit.range[0] || 0), Math.min(full.length, unit.range[1] ?? full.length))
      }
      return truncateCompanionText(text)
    },
    goToBookmark: (bookmark) => Number.isFinite(bookmark?.paragraphIndex) ? jumpToParagraph(bookmark.paragraphIndex) : setPage(bookmark?.page || 0),
    lookupEntity: async (names, target) => {
      const terms = (Array.isArray(names) ? names : [names]).map((value) => String(value || '').trim()).filter(Boolean)
      const cutoffParagraph = Number.isFinite(target?.paragraphIndex) ? target.paragraphIndex : paragraphs.length - 1
      const fromPercent = Number(target?.fromReadPercent) || 0
      const fromParagraph = fromPercent > 0 ? Math.max(0, Math.min(cutoffParagraph, Math.floor(fromPercent * cutoffParagraph) - 20)) : 0
      const valueAt = (index) => {
        const full = paragraphs[index] || ''
        return index === cutoffParagraph && Number.isFinite(target?.endOffset) ? full.slice(0, target.endOffset) : full
      }
      // 第一趟只数总量；第二趟按步长均匀采样。数百万字的书命中数万次时，
      // 5000 条上限也能覆盖全程，而不是只堆在开头章节。
      // 长扫描周期性让出事件循环，避免卡顿设定集窗口等其他视图。
      let total = 0
      for (let index = fromParagraph; index <= cutoffParagraph; index += 1) {
        if ((index - fromParagraph) % 600 === 599) await new Promise((resolve) => setTimeout(resolve, 0))
        const value = valueAt(index)
        for (const term of terms) {
          let found = value.indexOf(term)
          while (found >= 0) { total += 1; found = value.indexOf(term, found + Math.max(1, term.length)) }
        }
      }
      const limit = 5000
      const stride = Math.max(1, Math.ceil(total / limit))
      const excerpts = []
      let hit = 0
      for (let paragraphIndex = fromParagraph; paragraphIndex <= cutoffParagraph && excerpts.length < limit; paragraphIndex += 1) {
        if ((paragraphIndex - fromParagraph) % 600 === 599) await new Promise((resolve) => setTimeout(resolve, 0))
        const value = valueAt(paragraphIndex)
        const chapterIndex = chapters.reduce((match, chapter, index) => chapter.index <= paragraphIndex ? index : match, -1)
        for (const term of terms) {
          let found = value.indexOf(term)
          while (found >= 0 && excerpts.length < limit) {
            hit += 1
            if ((hit - 1) % stride === 0) excerpts.push({ order: excerpts.length + 1, chapter: chapterIndex >= 0 ? chapters[chapterIndex].label : `段落 ${paragraphIndex + 1}`, text: value.slice(Math.max(0, found - 150), Math.min(value.length, found + term.length + 220)) })
            found = value.indexOf(term, found + Math.max(1, term.length))
          }
        }
      }
      return { excerpts, totalMatches: total, truncated: total > excerpts.length }
    },
  }), [chapters, onBoundaryNext, onBoundaryPrev, page, pageCount, paragraphs, paragraphSpans, jumpToParagraph, jumpToChapterLabel])

  const buildSelection = (selected) => {
    if (!selected?.rangeCount) return null
    const range = selected.getRangeAt(0)
    // 支持跨段落划选：起点/终点分别定位各自的 [data-paragraph]，锚点记在起始段。
    const startElement = (range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer : range.startContainer.parentElement)?.closest?.('[data-paragraph]')
    const endElement = (range.endContainer.nodeType === Node.ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement)?.closest?.('[data-paragraph]')
    const startTextElement = startElement?.querySelector?.('.paragraph-text')
    const endTextElement = endElement?.querySelector?.('.paragraph-text')
    if (!startTextElement || !endTextElement || !startTextElement.contains(range.startContainer) || !endTextElement.contains(range.endContainer)) return null
    const rawText = range.toString()
    const text = rawText.trim()
    if (!text || text.length < 2) return null
    const prefixRange = range.cloneRange()
    prefixRange.selectNodeContents(startTextElement)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    const leading = rawText.length - rawText.trimStart().length
    const paragraphIndex = Number(startElement.dataset.paragraph)
    const startOffset = prefixRange.toString().length + leading
    const endOffset = startOffset + text.length
    const currentParagraph = paragraphs[paragraphIndex] || startTextElement.textContent || ''
    const chapterIndex = chapters.reduce((match, chapter, index) => chapter.index <= paragraphIndex ? index : match, -1)
    const chapterStart = chapterIndex >= 0 ? chapters[chapterIndex].index : 0
    const rect = range.getBoundingClientRect()
    const viewportRect = viewportRef.current.getBoundingClientRect()
    const above = rect.top - viewportRect.top
    return {
      text: text.slice(0, 50000),
      paragraphIndex,
      startOffset,
      endOffset,
      currentParagraph,
      originalParagraph: paragraphs[paragraphIndex] || currentParagraph,
      chapterLabel: chapterIndex >= 0 ? chapters[chapterIndex].label : '',
      currentExcerpt: currentParagraph.slice(Math.max(0, startOffset - 180), endOffset),
      localTextFraction: Math.max(0, Math.min(1, ((paragraphSpans[paragraphIndex]?.start || 0) + startOffset) / Math.max(1, displayContent.length))),
      left: Math.max(150, Math.min(viewportRect.width - 150, rect.left - viewportRect.left + rect.width / 2)),
      below: above < 230,
      top: above < 230 ? rect.bottom - viewportRect.top + 10 : Math.max(10, above - 12),
      editing: false,
    }
  }

  const captureSelection = () => {
    const selected = window.getSelection()
    const nextSelection = buildSelection(selected)
    if (!nextSelection) {
      setSelection(null)
      setMarker(null)
      return
    }
    setMarker(null)
    setSelection(nextSelection)
  }

  const openSelectionMenu = async (event) => {
    const selected = window.getSelection()
    const nextSelection = buildSelection(selected)
    if (!nextSelection) return
    event.preventDefault()
    setSelection(nextSelection)
    const canLookupEntity = nextSelection.text.length <= 24 && !/[\r\n。！？!?，,；;：:]/.test(nextSelection.text)
    const hasEntityProfile = canLookupEntity && Boolean(onCheckEntityProfile?.(nextSelection.text))
    const action = await window.readerAPI.openSelectionMenu({ hasSelection: true, canLookupEntity, hasEntityProfile, hasAnyProfile: Boolean(hasAnyProfile) })
    if (action === 'note') {
      // 收藏改为由 ReaderView 弹出 CollectNoteModal（高亮编辑 + 备注 + 标签）。
      onCollectIntent?.(nextSelection)
      window.getSelection()?.removeAllRanges()
      setSelection(null)
    } else if (action === 'share') {
      // 直接分享：生成分享图，不写入笔记。
      onShareIntent?.(nextSelection)
      window.getSelection()?.removeAllRanges()
      setSelection(null)
    }
    else if (action === 'dictionary') onLookupDict?.(nextSelection)
    else if (action === 'rewrite') onRewrite?.(nextSelection)
    else if (action === 'lookup-entity') onLookupEntity?.(nextSelection, 'generate')
    else if (action === 'view-entity') onLookupEntity?.(nextSelection, 'view')
    else if (action === 'link-entity') onLookupEntity?.(nextSelection, 'link')
  }

  const openMarker = (event, index) => {
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const viewportRect = viewportRef.current.getBoundingClientRect()
    const above = rect.top - viewportRect.top
    setSelection(null)
    window.getSelection()?.removeAllRanges()
    setMarker({
      index,
      left: Math.max(150, Math.min(viewportRect.width - 150, rect.left - viewportRect.left + rect.width / 2)),
      below: above < 230,
      top: above < 230 ? rect.bottom - viewportRect.top + 10 : Math.max(10, above - 12),
    })
  }

  const bodyFont = normalizeReaderFontFamily(settings.fontFamily)
  const titleFont = normalizeReaderFontFamily(settings.titleFontFamily, bodyFont)
  const bodyFontFamily = getReaderFontStack(bodyFont)
  const titleFontFamily = getReaderFontStack(titleFont)
  const bodyFontWeight = getNearestReaderFontWeight(bodyFont, settings.fontWeight, 400)
  const titleFontWeight = getNearestReaderFontWeight(titleFont, settings.titleFontWeight, 700)

  return (
    <div className="text-reader-shell" ref={shellRef} style={{ '--page-padding': `${pagePadding}px` }}>
      <div className={`text-viewport ${paintReady ? 'is-ready' : 'is-reflowing'} ${scrollMode ? 'is-scroll' : ''}`} ref={viewportRef} onMouseUp={captureSelection} onContextMenu={openSelectionMenu}>
        <article
          ref={contentRef}
          className={`text-columns ${paintReady ? 'is-ready' : 'is-reflowing'}`}
          aria-busy={!paintReady}
          style={{
            '--column-width': `${Math.max(1, viewportWidth - pagePadding * 2)}px`,
            '--column-gap': `${pagePadding * 2}px`,
            '--font-size': `${settings.fontSize}px`,
            '--line-height': settings.lineHeight,
            '--paragraph-gap': `${settings.paragraphGap}px`,
            '--letter-spacing': `${settings.letterSpacing}px`,
            '--text-opacity': settings.opacity,
            '--reader-font': bodyFontFamily,
            '--reader-font-weight': bodyFontWeight,
            '--reader-title-font': titleFontFamily,
            '--reader-title-font-weight': titleFontWeight,
          }}
        >
          {paragraphs.map((paragraph, index) => {
            const line = paragraph.replace(/[\u3000\t]+/g, ' ').trim()
            const isChapter = line.length <= 80 && CHAPTER_PATTERN.test(line)
            const paragraphNotes = notesByParagraph.get(index)
            const noteRanges = (paragraphNotes || []).map((note) => {
              const start = Number.isFinite(note.startOffset) ? note.startOffset : paragraph.indexOf(note.text || '')
              const end = Number.isFinite(note.endOffset) ? note.endOffset : start + (note.text?.length || 0)
              return start < 0 ? null : { start: Math.max(0, start), end: Math.min(paragraph.length, end) }
            }).filter((range) => range && range.end > range.start)
            const renderSlice = (start, end, key) => {
              const boundaries = [...new Set([start, end, ...noteRanges.flatMap((range) => [Math.max(start, range.start), Math.min(end, range.end)])])].filter((value) => value >= start && value <= end).sort((a, b) => a - b)
              return boundaries.slice(0, -1).map((from, partIndex) => {
                const to = boundaries[partIndex + 1]
                const collected = noteRanges.some((range) => range.start < to && range.end > from)
                return <span className={collected ? 'reader-collected-text' : undefined} key={`${key}-${partIndex}`}>{paragraph.slice(from, to)}</span>
              })
            }
            const paragraphRewrites = rewrites.filter((item) => item.anchor?.paragraphIndex === index)
            const applied = paragraphRewrites.filter((item) => item.applied && item.generatedText).sort((a, b) => a.anchor.startOffset - b.anchor.startOffset)
            const parts = []
            let cursor = 0
            applied.forEach((item) => {
              if (item.anchor.startOffset < cursor) return
              parts.push(...renderSlice(cursor, item.anchor.startOffset, `before-${item.id}`), <span className="rewrite-applied-text" key={item.id}>{item.generatedText}</span>)
              cursor = item.anchor.endOffset
            })
            parts.push(...renderSlice(cursor, paragraph.length, 'tail'))
            const rewriteMarker = paragraphRewrites.length ? <button className="rewrite-star-marker" title="查看改写" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpenRewrite?.(paragraphRewrites[paragraphRewrites.length - 1]) }}>✦</button> : null
            const paragraphContent = <span className="paragraph-text">{parts}</span>
            return isChapter
              ? <h2 className={chapterFlash === index ? 'is-jump-target' : undefined} key={index} data-paragraph={index}>{paragraphContent}{rewriteMarker}</h2>
              : <p key={index} data-paragraph={index}>{paragraphContent}{rewriteMarker}</p>
          })}
        </article>
      </div>
    </div>
  )
})

export default TextReader
