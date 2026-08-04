import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MessageSquareQuote } from 'lucide-react'
import { NotePopup, SelectionPopup } from './NotePopups'
import { convertChinese } from '../chineseConversion'

const CHAPTER_PATTERN = /^(?:(?:正文\s*)?第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节卷部篇回集幕]\s*.{0,50}|(?:卷|部|篇|章)\s*[0-9０-９零〇一二三四五六七八九十百千万两]+(?:[\s:：.-]+.{0,45})?|(?:序章|序言|前言|楔子|引子|后记|尾声|终章|大结局)(?:[\s:：.-]+.{0,45})?|(?:番外|外传|附录)\s*[0-9０-９零〇一二三四五六七八九十百千万两]*(?:[\s:：.-]+.{0,45})?|(?:chapter|part|volume|book)\s+[0-9ivxlcdm]+(?:[\s:：.-]+.{0,50})?)$/i

function highlightedParagraph(text, notes) {
  if (!notes?.length) return text
  const ranges = notes.map((note) => ({ note, start: text.indexOf(note.text) }))
    .filter((item) => item.start >= 0 && item.note.text)
    .sort((a, b) => a.start - b.start)
  if (!ranges.length) return text
  const parts = []
  let cursor = 0
  ranges.forEach(({ note, start }) => {
    if (start < cursor) return
    if (start > cursor) parts.push(text.slice(cursor, start))
    const end = start + note.text.length
    parts.push(<mark className={`text-highlight is-${note.color || 'amber'}`} key={note.id}>{text.slice(start, end)}</mark>)
    cursor = end
  })
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts
}

const TextReader = forwardRef(function TextReader({ content, settings, initialPage, onProgress, onChapters, onCollect, onBoundaryNext, onBoundaryPrev, notes = [], onLookupEntity }, ref) {
  const viewportRef = useRef(null)
  const shellRef = useRef(null)
  const contentRef = useRef(null)
  const resizeTimerRef = useRef(null)
  const resizingRef = useRef(false)
  const positionFractionRef = useRef(null)
  const measuredLayoutRef = useRef(false)
  const progressCallbackRef = useRef(onProgress)
  const chaptersCallbackRef = useRef(onChapters)
  const [page, setPage] = useState(initialPage || 0)
  const [pageCount, setPageCount] = useState(1)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [paintReady, setPaintReady] = useState(false)
  const [selection, setSelection] = useState(null)
  const [marker, setMarker] = useState(null)
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
    const shell = shellRef.current
    if (!shell) return undefined
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
      setViewportWidth((current) => current === nextWidth ? current : nextWidth)
    })
    observer.observe(shell)
    window.addEventListener('resize', handleWindowResize)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handleWindowResize)
      clearTimeout(resizeTimerRef.current)
    }
  }, [])

  useEffect(() => {
    const timer = requestAnimationFrame(() => {
      const node = contentRef.current
      if (!node || !viewportWidth) return
      const count = Math.max(1, Math.round((viewportRef.current.scrollWidth + pagePadding * 2) / viewportWidth))
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
  }, [content, pagePadding, settings, viewportWidth])

  useLayoutEffect(() => {
    if (!viewportRef.current || !viewportWidth) return
    viewportRef.current.scrollLeft = page * viewportWidth
    if (resizingRef.current) return
    setPaintReady(true)
  }, [page, settings, viewportWidth])

  useEffect(() => {
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
  }, [chapters, page, pageCount, viewportWidth])

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
    setPage(Math.max(0, Math.round(element.offsetLeft / viewportWidth)))
  }, [viewportWidth])

  useEffect(() => {
    if (pendingJumpRef.current !== null) jumpToParagraph(pendingJumpRef.current)
  }, [jumpToParagraph, pageCount, viewportWidth])

  useImperativeHandle(ref, () => ({
    next: () => setPage((current) => {
      if (current < pageCount - 1) return current + 1
      onBoundaryNext?.()
      return current
    }),
    prev: () => setPage((current) => {
      if (current > 0) return current - 1
      onBoundaryPrev?.()
      return current
    }),
    seek: (ratio) => setPage(Math.max(0, Math.min(pageCount - 1, Math.round((pageCount - 1) * ratio)))),
    goToChapter: (index) => jumpToParagraph(index),
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
    goToBookmark: (bookmark) => Number.isFinite(bookmark?.paragraphIndex) ? jumpToParagraph(bookmark.paragraphIndex) : setPage(bookmark?.page || 0),
    lookupEntity: (names, target) => {
      const terms = (Array.isArray(names) ? names : [names]).map((value) => String(value || '').trim()).filter(Boolean)
      const cutoffParagraph = Number.isFinite(target?.paragraphIndex) ? target.paragraphIndex : paragraphs.length - 1
      const excerpts = []
      for (let paragraphIndex = 0; paragraphIndex <= cutoffParagraph; paragraphIndex += 1) {
        const full = paragraphs[paragraphIndex] || ''
        const value = paragraphIndex === cutoffParagraph && Number.isFinite(target?.endOffset) ? full.slice(0, target.endOffset) : full
        for (const term of terms) {
          let found = value.indexOf(term)
          while (found >= 0 && excerpts.length < 5000) {
            const chapterIndex = chapters.reduce((match, chapter, index) => chapter.index <= paragraphIndex ? index : match, -1)
            excerpts.push({ order: excerpts.length + 1, chapter: chapterIndex >= 0 ? chapters[chapterIndex].label : `段落 ${paragraphIndex + 1}`, text: value.slice(Math.max(0, found - 150), Math.min(value.length, found + term.length + 220)) })
            found = value.indexOf(term, found + Math.max(1, term.length))
          }
        }
      }
      return { excerpts, totalMatches: excerpts.length, truncated: excerpts.length >= 5000 }
    },
  }), [chapters, onBoundaryNext, onBoundaryPrev, page, pageCount, paragraphs, paragraphSpans, jumpToParagraph])

  const buildSelection = (selected) => {
    if (!selected?.rangeCount) return null
    const range = selected.getRangeAt(0)
    const element = (range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement)?.closest?.('[data-paragraph]')
    const textElement = element?.querySelector?.('.paragraph-text')
    if (!element || !textElement || !textElement.contains(range.startContainer) || !textElement.contains(range.endContainer)) return null
    const rawText = range.toString()
    const text = rawText.trim()
    if (!text || text.length < 2) return null
    const prefixRange = range.cloneRange()
    prefixRange.selectNodeContents(textElement)
    prefixRange.setEnd(range.startContainer, range.startOffset)
    const leading = rawText.length - rawText.trimStart().length
    const paragraphIndex = Number(element.dataset.paragraph)
    const startOffset = prefixRange.toString().length + leading
    const endOffset = startOffset + text.length
    const currentParagraph = paragraphs[paragraphIndex] || textElement.textContent || ''
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
    const action = await window.readerAPI.openSelectionMenu({ hasSelection: true, canLookupEntity })
    if (action === 'note') setSelection({ ...nextSelection, editing: true })
    else if (action === 'lookup-entity') onLookupEntity?.(nextSelection)
  }

  const collectSelection = (comment, color) => {
    onCollect?.({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text: selection.text.slice(0, 500), paragraphIndex: selection.paragraphIndex, comment, color, createdAt: Date.now() })
    window.getSelection()?.removeAllRanges()
    setSelection(null)
  }

  const cancelSelection = () => {
    window.getSelection()?.removeAllRanges()
    setSelection(null)
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

  const fontFamily = settings.fontFamily === 'sans'
    ? '"Microsoft YaHei UI", "PingFang SC", sans-serif'
    : settings.fontFamily === 'kai'
      ? 'KaiTi, STKaiti, serif'
      : '"Source Han Serif SC", "Songti SC", SimSun, serif'

  return (
    <div className="text-reader-shell" ref={shellRef} style={{ '--page-padding': `${pagePadding}px` }}>
      <div className={`text-viewport ${paintReady ? 'is-ready' : 'is-reflowing'}`} ref={viewportRef} onMouseUp={captureSelection} onContextMenu={openSelectionMenu}>
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
            '--reader-font': fontFamily,
          }}
        >
          {paragraphs.map((paragraph, index) => {
            const line = paragraph.replace(/[\u3000\t]+/g, ' ').trim()
            const isChapter = line.length <= 80 && CHAPTER_PATTERN.test(line)
            const paragraphNotes = notesByParagraph.get(index)
            const noteMarker = paragraphNotes ? (
              <button
                className="text-note-marker"
                title={`查看评论（${paragraphNotes.length}）`}
                onMouseDown={(event) => event.stopPropagation()}
                onMouseUp={(event) => event.stopPropagation()}
                onClick={(event) => openMarker(event, index)}
              ><MessageSquareQuote size={12} />{paragraphNotes.length > 1 ? <em>{paragraphNotes.length}</em> : null}</button>
            ) : null
            const paragraphContent = <span className="paragraph-text">{highlightedParagraph(paragraph, paragraphNotes)}</span>
            return isChapter
              ? <h2 key={index} data-paragraph={index}>{paragraphContent}{noteMarker}</h2>
              : <p key={index} data-paragraph={index}>{paragraphContent}{noteMarker}</p>
          })}
        </article>
        {selection?.editing ? <SelectionPopup text={selection.text} left={selection.left} top={selection.top} below={selection.below} onSave={collectSelection} onCancel={cancelSelection} /> : null}
        {marker ? <NotePopup notes={notesByParagraph.get(marker.index) || []} left={marker.left} top={marker.top} below={marker.below} onClose={() => setMarker(null)} /> : null}
      </div>
    </div>
  )
})

export default TextReader
