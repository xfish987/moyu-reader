import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import TextReader from './TextReader'

const LargeTextReader = forwardRef(function LargeTextReader({ book, source, settings, savedProgress, onProgress, onChapters, onCollect, notes = [], onLookupEntity, onCheckEntityProfile, hasAnyProfile }, ref) {
  const readerRefs = useRef(new Map())
  const pageHintsRef = useRef(new Map([[source.start, savedProgress?.page || 0]]))
  const currentChunkRef = useRef(source)
  const previousChunkRef = useRef(null)
  const nextChunkRef = useRef(null)
  const navigationRef = useRef(false)
  const resumeAppliedRef = useRef(false)
  const pendingParagraphRef = useRef(null)
  const pendingAnchorRef = useRef(null)
  // Until the saved position is restored, progress events from the initial
  // chunk (which starts at the book's beginning) must not overwrite it.
  const readyRef = useRef(!(savedProgress?.offset && savedProgress.offset !== source.start))
  const [chunk, setChunk] = useState(source)
  const [previousChunk, setPreviousChunk] = useState(null)
  const [nextChunk, setNextChunk] = useState(null)

  currentChunkRef.current = chunk
  previousChunkRef.current = previousChunk
  nextChunkRef.current = nextChunk

  const setCurrentChunk = useCallback((target, pageHint = 0) => {
    pageHintsRef.current.set(target.start, pageHint)
    setChunk(target)
  }, [])

  useEffect(() => {
    if (resumeAppliedRef.current) return undefined
    resumeAppliedRef.current = true
    if (!savedProgress?.offset || savedProgress.offset === source.start) return undefined
    let cancelled = false
    window.readerAPI.readTextChunk(book.path, savedProgress.offset, 'forward').then((target) => {
      if (cancelled) return
      setPreviousChunk(null)
      setNextChunk(null)
      readyRef.current = true
      setCurrentChunk(target, savedProgress.page || 0)
    })
    return () => { cancelled = true }
  }, [book.path, savedProgress?.offset, savedProgress?.page, setCurrentChunk, source.start])

  useEffect(() => {
    window.readerAPI.getTextToc(book.path).then(onChapters).catch(() => onChapters([]))
  }, [book.path, onChapters])

  useEffect(() => {
    let cancelled = false
    const prefetchPrevious = async () => {
      if (chunk.start <= 0) {
        setPreviousChunk(null)
        return
      }
      if (previousChunkRef.current?.end === chunk.start) return
      const target = await window.readerAPI.readTextChunk(book.path, chunk.start, 'backward')
      if (cancelled || currentChunkRef.current.start !== chunk.start) return
      pageHintsRef.current.set(target.start, Number.MAX_SAFE_INTEGER)
      setPreviousChunk(target)
    }
    const prefetchNext = async () => {
      if (chunk.end >= chunk.total) {
        setNextChunk(null)
        return
      }
      if (nextChunkRef.current?.start === chunk.end) return
      const target = await window.readerAPI.readTextChunk(book.path, chunk.end, 'forward')
      if (cancelled || currentChunkRef.current.start !== chunk.start) return
      pageHintsRef.current.set(target.start, 0)
      setNextChunk(target)
    }
    prefetchPrevious().catch(() => {})
    prefetchNext().catch(() => {})
    return () => { cancelled = true }
  }, [book.path, chunk.end, chunk.start, chunk.total])

  useEffect(() => {
    if (pendingParagraphRef.current === null && pendingAnchorRef.current === null) return undefined
    const paragraph = pendingParagraphRef.current
    const anchor = pendingAnchorRef.current
    pendingParagraphRef.current = null
    pendingAnchorRef.current = null
    const frame = requestAnimationFrame(() => {
      const reader = readerRefs.current.get(chunk.start)
      if (anchor !== null) reader?.goToAnchor(anchor)
      else if (paragraph !== null) reader?.goToParagraph(paragraph)
    })
    return () => cancelAnimationFrame(frame)
  }, [chunk.start])

  const activateNext = useCallback(async () => {
    const current = currentChunkRef.current
    if (navigationRef.current || current.end >= current.total) return
    navigationRef.current = true
    try {
      const target = nextChunkRef.current?.start === current.end
        ? nextChunkRef.current
        : await window.readerAPI.readTextChunk(book.path, current.end, 'forward')
      setPreviousChunk(current)
      setNextChunk(null)
      setCurrentChunk(target, 0)
    } finally { navigationRef.current = false }
  }, [book.path, setCurrentChunk])

  const activatePrevious = useCallback(async () => {
    const current = currentChunkRef.current
    if (navigationRef.current || current.start <= 0) return
    navigationRef.current = true
    try {
      const target = previousChunkRef.current?.end === current.start
        ? previousChunkRef.current
        : await window.readerAPI.readTextChunk(book.path, current.start, 'backward')
      setNextChunk(current)
      setPreviousChunk(null)
      setCurrentChunk(target, Number.MAX_SAFE_INTEGER)
    } finally { navigationRef.current = false }
  }, [book.path, setCurrentChunk])

  const updateProgress = useCallback((layerChunk, local) => {
    if (!readyRef.current || layerChunk.start !== currentChunkRef.current.start) return
    const fraction = Number.isFinite(local.textFraction) ? local.textFraction : local.percent
    const position = layerChunk.start + fraction * Math.max(1, layerChunk.end - layerChunk.start)
    onProgress({
      ...local,
      offset: layerChunk.start,
      percent: position / layerChunk.total,
      absolutePosition: Math.round(position),
      total: layerChunk.total,
    })
  }, [onProgress])

  const jumpToChunk = useCallback((target, pageHint = 0) => {
    setPreviousChunk(null)
    setNextChunk(null)
    setCurrentChunk(target, pageHint)
  }, [setCurrentChunk])

  // 目录/进度/搜索跳转：分块起点可能早于目标（固定栅格），靠 anchor 落到
  // 目标所在页。目标就在当前块时直接原地跳转，不重建分块。
  const jumpToAnchor = useCallback(async (offset, direction) => {
    const target = await window.readerAPI.readTextChunk(book.path, offset, direction)
    if (target.start === currentChunkRef.current.start) {
      readerRefs.current.get(target.start)?.goToAnchor(target.anchor ?? 0)
      return
    }
    pendingAnchorRef.current = target.anchor ?? 0
    jumpToChunk(target)
  }, [book.path, jumpToChunk])

  useImperativeHandle(ref, () => ({
    next: () => readerRefs.current.get(currentChunkRef.current.start)?.next(),
    prev: () => readerRefs.current.get(currentChunkRef.current.start)?.prev(),
    goToParagraph: (index) => readerRefs.current.get(currentChunkRef.current.start)?.goToParagraph(index),
    goToChapter: async (chapter) => {
      if (chapter?.offset === undefined) {
        readerRefs.current.get(currentChunkRef.current.start)?.goToChapter(chapter?.index ?? chapter)
        return
      }
      await jumpToAnchor(chapter.offset, 'exact')
    },
    goToNote: async (note) => {
      if (note.chunkOffset === undefined || note.chunkOffset === currentChunkRef.current.start) {
        readerRefs.current.get(currentChunkRef.current.start)?.goToParagraph(note.paragraphIndex)
        return
      }
      pendingParagraphRef.current = note.paragraphIndex
      jumpToChunk(await window.readerAPI.readTextChunk(book.path, note.chunkOffset, 'forward'))
    },
    seek: async (ratio) => {
      if (navigationRef.current) return
      navigationRef.current = true
      try {
        const current = currentChunkRef.current
        const offset = Math.max(0, Math.min(current.total - 1, Math.round(current.total * ratio)))
        await jumpToAnchor(offset, 'seek')
      } finally { navigationRef.current = false }
    },
    goToSearch: async (result) => {
      await jumpToAnchor(result.offset, 'exact')
    },
    getLocation: () => ({ ...(readerRefs.current.get(currentChunkRef.current.start)?.getLocation?.() || {}), chunkOffset: currentChunkRef.current.start }),
    goToBookmark: async (bookmark) => {
      if (bookmark.chunkOffset === currentChunkRef.current.start) return readerRefs.current.get(currentChunkRef.current.start)?.goToBookmark(bookmark)
      pendingParagraphRef.current = bookmark.paragraphIndex
      jumpToChunk(await window.readerAPI.readTextChunk(book.path, bookmark.chunkOffset, 'forward'))
    },
  }), [book.path, jumpToAnchor, jumpToChunk])

  const layers = [previousChunk, chunk, nextChunk]
    .filter(Boolean)
    .filter((item, index, items) => items.findIndex((candidate) => candidate.start === item.start) === index)

  return (
    <div className="large-text-stack">
      {layers.map((layer) => {
        const active = layer.start === chunk.start
        return (
          <div className={`large-text-layer ${active ? 'is-active' : 'is-buffered'}`} key={`${book.path}-${layer.start}`} aria-hidden={!active}>
            <TextReader
              ref={(node) => {
                if (node) readerRefs.current.set(layer.start, node)
                else readerRefs.current.delete(layer.start)
              }}
              content={layer.content}
              settings={settings}
              initialPage={pageHintsRef.current.get(layer.start) || 0}
              onProgress={(local) => updateProgress(layer, local)}
              onChapters={() => {}}
              onCollect={(note) => active && onCollect?.({ ...note, chunkOffset: layer.start })}
              notes={notes.filter((note) => note.chunkOffset === layer.start)}
              onLookupEntity={(selection, mode) => active && onLookupEntity?.({ ...selection, chunkOffset: layer.start, chunkEnd: layer.end, readPosition: Math.max(layer.start, Math.round(layer.start + selection.localTextFraction * (layer.end - layer.start))) }, mode)}
              onCheckEntityProfile={onCheckEntityProfile}
              hasAnyProfile={hasAnyProfile}
              onBoundaryNext={active ? activateNext : undefined}
              onBoundaryPrev={active ? activatePrevious : undefined}
            />
          </div>
        )
      })}
    </div>
  )
})

export default LargeTextReader
