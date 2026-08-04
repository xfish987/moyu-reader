import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Bookmark, ChevronLeft, ChevronRight, List, Maximize, Minimize2, Search, Settings2, Trash2 } from 'lucide-react'
import EpubReader from './EpubReader'
import LargeTextReader from './LargeTextReader'
import ReaderSettings from './ReaderSettings'
import TextReader from './TextReader'

export default function ReaderView({ book, source, settings, setSettings, savedProgress, immersive, onBack, onToggleImmersive, onProgress, shortcut, actionRef, notes, onAddNote, onDeleteNote, initialNote, onEncodingChange }) {
  const readerRef = useRef(null)
  const activeChapterRef = useRef(null)
  const wheelStateRef = useRef({ accumulated: 0, direction: 0, lockedUntil: 0 })
  const [panel, setPanel] = useState(null)
  const [chapters, setChapters] = useState([])
  const [progress, setProgress] = useState(savedProgress || { percent: 0, page: 0, pageCount: 1 })
  const [scrubProgress, setScrubProgress] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState(0)
  const [chromeZone, setChromeZone] = useState(null)
  const chromeTimerRef = useRef(null)

  const updateProgress = useCallback((next) => {
    setProgress(next)
    onProgress(next)
  }, [onProgress])

  const updateChapters = useCallback((items) => setChapters(items), [])

  const activeChapterIndex = useMemo(() => {
    if (!chapters.length) return -1
    if (source.kind === 'text-large') {
      const position = progress.absolutePosition ?? progress.offset ?? 0
      let low = 0
      let high = chapters.length - 1
      let match = -1
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        if ((chapters[middle].offset ?? 0) <= position) {
          match = middle
          low = middle + 1
        } else high = middle - 1
      }
      return match
    }
    if (source.kind === 'text') return progress.chapterIndex ?? -1
    const normalizeHref = (href = '', keepFragment = false) => {
      const value = keepFragment ? href : href.split('#')[0]
      try { return decodeURIComponent(value).replace(/^\.\//, '') }
      catch { return value.replace(/^\.\//, '') }
    }
    const exactHref = normalizeHref(progress.href, true)
    const exactMatch = chapters.findIndex((chapter) => normalizeHref(chapter.href, true) === exactHref)
    if (exactMatch >= 0) return exactMatch
    const currentHref = normalizeHref(progress.href)
    if (!currentHref) return -1
    return chapters.findIndex((chapter) => normalizeHref(chapter.href) === currentHref)
  }, [chapters, progress.absolutePosition, progress.chapterIndex, progress.href, progress.offset, source.kind])

  useEffect(() => {
    if (panel !== 'toc' || activeChapterIndex < 0) return undefined
    const frame = requestAnimationFrame(() => {
      activeChapterRef.current?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeChapterIndex, panel])

  const handlePageWheel = useCallback((event) => {
    if (event.ctrlKey || event.metaKey) return
    const absY = Math.abs(event.deltaY)
    const absX = Math.abs(event.deltaX)
    // Ignore diagonal/trackpad noise: only page when one axis clearly dominates.
    const delta = absY >= absX * 2 ? event.deltaY : absX >= absY * 2 ? event.deltaX : 0
    if (!delta) return
    event.preventDefault?.()
    const now = performance.now()
    const state = wheelStateRef.current
    if (now < state.lockedUntil) return
    const direction = delta > 0 ? 1 : -1
    if (state.direction !== direction) {
      state.direction = direction
      state.accumulated = 0
    }
    state.accumulated += Math.abs(delta)
    const threshold = event.deltaMode === 0 ? 40 : 2
    if (state.accumulated < threshold) return
    state.accumulated = 0
    state.lockedUntil = now + 320
    direction > 0 ? readerRef.current?.next() : readerRef.current?.prev()
  }, [])

  const scheduleChromeHide = useCallback(() => {
    clearTimeout(chromeTimerRef.current)
    chromeTimerRef.current = setTimeout(() => setChromeZone(null), 200)
  }, [])

  const handleChromeMouseMove = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const y = event.clientY - rect.top
    const zone = y <= 64 ? 'top' : rect.height - y <= 76 ? 'bottom' : null
    if (zone) {
      clearTimeout(chromeTimerRef.current)
      chromeTimerRef.current = null
      setChromeZone((current) => (current === zone ? current : zone))
    } else {
      scheduleChromeHide()
    }
  }, [scheduleChromeHide])

  useEffect(() => () => clearTimeout(chromeTimerRef.current), [])

  const jumpToChapter = (chapter) => {
    if (source.kind === 'epub') readerRef.current?.goToChapter(chapter.href)
    else if (source.kind === 'text-large') readerRef.current?.goToChapter(chapter)
    else readerRef.current?.goToChapter(chapter.index)
    setPanel(null)
  }

  const percent = Math.max(0, Math.min(100, Math.round((progress.percent || 0) * 100)))
  const displayedPercent = scrubProgress === null ? percent : Math.round(scrubProgress / 10)
  const activeChapter = activeChapterIndex >= 0 ? chapters[activeChapterIndex] : null
  const footerVisible = scrubProgress !== null || chromeZone === 'bottom'

  const commitSeek = (event) => {
    const value = Number(event.currentTarget.value)
    readerRef.current?.seek(value / 1000)
    setScrubProgress(null)
  }

  const commitPercent = (event) => {
    const value = Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0))
    readerRef.current?.seek(value / 100)
    setScrubProgress(null)
  }

  const runSearch = async (event) => {
    event.preventDefault()
    const query = searchQuery.trim()
    if (!query) return
    setSearching(true)
    setSearchProgress(0)
    setSearchResults([])
    try {
      if (source.kind === 'text-large') {
        setSearchResults(await window.readerAPI.searchText(book.path, query))
      } else if (source.kind === 'epub') {
        const results = await readerRef.current?.search(query, (partial, ratio) => {
          setSearchResults(partial)
          setSearchProgress(ratio)
        })
        setSearchResults(results || [])
      } else {
        let occurrence = 0
        const results = source.content.split(/\r?\n+/).flatMap((line) => {
          const label = line.trim()
          if (!label.includes(query)) return []
          return [{ label: label.slice(0, 180), query, occurrence: occurrence++ }]
        }).slice(0, 100)
        setSearchResults(results)
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `搜索失败：${error?.message || '无法读取书籍内容'}` }))
    } finally {
      setSearching(false)
      setSearchProgress(1)
    }
  }

  useEffect(() => {
    if (!initialNote) return undefined
    const frame = requestAnimationFrame(() => readerRef.current?.goToNote ? readerRef.current.goToNote(initialNote) : readerRef.current?.goToParagraph(initialNote.paragraphIndex))
    return () => cancelAnimationFrame(frame)
  }, [initialNote, source.kind])

  if (actionRef) {
    actionRef.current = {
      next: () => readerRef.current?.next(),
      prev: () => readerRef.current?.prev(),
      goLeft: () => readerRef.current?.goLeft ? readerRef.current.goLeft() : readerRef.current?.prev(),
      goRight: () => readerRef.current?.goRight ? readerRef.current.goRight() : readerRef.current?.next(),
    }
  }

  return (
    <main className={`reader-view theme-${settings.theme} ${immersive ? 'is-immersive' : ''} ${!settings.showProgress ? 'without-progress' : ''}`} onMouseMove={handleChromeMouseMove} onMouseLeave={scheduleChromeHide}>
      {!immersive ? (
        <header className="reader-toolbar">
          <button className="toolbar-button back" onClick={onBack} title="返回书架"><ArrowLeft size={18} /></button>
          <div className="book-heading">
            <strong>{book.title}</strong>
            <span title={activeChapter?.label || book.format}>{activeChapter ? activeChapter.label : book.format}</span>
          </div>
          <div className="reader-actions">
            <button className={`toolbar-button ${panel === 'toc' ? 'active' : ''}`} onClick={() => setPanel(panel === 'toc' ? null : 'toc')} title="目录"><List size={18} /></button>
            <button className={`toolbar-button ${panel === 'notes' ? 'active' : ''}`} onClick={() => setPanel(panel === 'notes' ? null : 'notes')} title="收藏笔记"><Bookmark size={17} /></button>
            <button className={`toolbar-button ${panel === 'search' ? 'active' : ''}`} onClick={() => setPanel(panel === 'search' ? null : 'search')} title="全书搜索"><Search size={17} /></button>
            <button className={`toolbar-button ${panel === 'settings' ? 'active' : ''}`} onClick={() => setPanel(panel === 'settings' ? null : 'settings')} title="阅读设置"><Settings2 size={18} /></button>
            <button className="toolbar-button" onClick={onToggleImmersive} title="沉浸阅读 (F11)"><Maximize size={17} /></button>
          </div>
        </header>
      ) : null}

      <section className="reading-stage" onClick={() => panel && setPanel(null)} onWheel={handlePageWheel}>
        {source.kind === 'text' ? (
          <TextReader ref={readerRef} content={source.content} settings={settings} initialPage={savedProgress?.page} onProgress={updateProgress} onChapters={updateChapters} onCollect={onAddNote} notes={notes} />
        ) : source.kind === 'text-large' ? (
          <LargeTextReader ref={readerRef} book={book} source={source} settings={settings} savedProgress={savedProgress} onProgress={updateProgress} onChapters={updateChapters} onCollect={onAddNote} notes={notes} />
        ) : (
          <EpubReader ref={readerRef} data={source.data} settings={settings} initialCfi={savedProgress?.cfi} onProgress={updateProgress} onChapters={updateChapters} onShortcut={shortcut} onWheel={handlePageWheel} onCollect={onAddNote} notes={notes} />
        )}

        <button className="page-zone previous" onClick={() => readerRef.current?.goLeft ? readerRef.current.goLeft() : readerRef.current?.prev()} aria-label="向左翻页"><ChevronLeft size={22} /></button>
        <button className="page-zone next" onClick={() => readerRef.current?.goRight ? readerRef.current.goRight() : readerRef.current?.next()} aria-label="向右翻页"><ChevronRight size={22} /></button>
      </section>

      {settings.showProgress ? (
        <footer className={`reader-footer ${footerVisible ? 'is-visible' : ''}`}>
          <span>{progress.pageCount > 1 ? `${progress.page + (source.kind.startsWith('text') ? 1 : 0)} / ${progress.pageCount}` : ''}</span>
          <input
            className="progress-scrubber"
            type="range"
            min="0"
            max="1000"
            step="1"
            value={scrubProgress === null ? Math.round((progress.percent || 0) * 1000) : scrubProgress}
            aria-label="阅读进度"
            onChange={(event) => setScrubProgress(Number(event.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={(event) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && commitSeek(event)}
          />
          <label className="percent-entry">
            <input
              type="number"
              min="0"
              max="100"
              value={displayedPercent}
              aria-label="输入阅读百分比"
              onChange={(event) => setScrubProgress(Math.max(0, Math.min(100, Number(event.target.value) || 0)) * 10)}
              onBlur={commitPercent}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
            <span>%</span>
          </label>
        </footer>
      ) : null}

      {immersive ? (
        <div className={`immersive-topbar ${chromeZone === 'top' ? 'is-visible' : ''}`}>
          <div className="immersive-heading">
            <strong>{book.title}</strong>
            <span title={activeChapter?.label || ''}>{activeChapter ? activeChapter.label : ' '}</span>
          </div>
          <button className="toolbar-button" onClick={onToggleImmersive} title="退出沉浸阅读 (F11)" aria-label="退出沉浸阅读"><Minimize2 size={17} /></button>
        </div>
      ) : null}
      {panel === 'settings' && !immersive ? <ReaderSettings settings={settings} onChange={setSettings} encoding={source.kind.startsWith('text') ? source.encoding : null} onEncodingChange={onEncodingChange} /> : null}
      {panel === 'toc' && !immersive ? (
        <aside className="toc-panel">
          <div className="toc-title"><List size={16} /><strong>目录</strong><span>{percent}% · {chapters.length} 章</span></div>
          <div className="toc-list">
            {chapters.length ? chapters.map((chapter, index) => (
              <button
                key={`${chapter.href || chapter.offset || chapter.index}-${index}`}
                ref={index === activeChapterIndex ? activeChapterRef : null}
                className={index === activeChapterIndex ? 'is-current' : undefined}
                aria-current={index === activeChapterIndex ? 'location' : undefined}
                style={{ paddingLeft: `${16 + (chapter.depth || 0) * 14}px` }}
                onClick={() => jumpToChapter(chapter)}
              >{chapter.label}</button>
            )) : <p>这本书没有可识别的目录</p>}
          </div>
        </aside>
      ) : null}
      {panel === 'notes' && !immersive ? (
        <aside className="notes-panel">
          <div className="toc-title"><Bookmark size={16} /><strong>收藏笔记</strong><span>{notes.length} 条</span></div>
          <div className="notes-list">
            {notes.length ? notes.map((note) => (
              <div className="note-item" key={note.id}>
                <button onClick={() => { readerRef.current?.goToNote ? readerRef.current.goToNote(note) : readerRef.current?.goToParagraph(note.paragraphIndex); setPanel(null) }}>
                  <p>{note.text}</p>
                  {note.comment ? <em className="note-comment">{note.comment}</em> : null}
                  <span>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</span>
                </button>
                <button className="delete-note" onClick={() => onDeleteNote(note.id)} title="删除笔记"><Trash2 size={13} /></button>
              </div>
            )) : <p className="notes-empty">选中正文中的文字即可收藏并评论</p>}
          </div>
        </aside>
      ) : null}
      {panel === 'search' && !immersive ? (
        <aside className="search-panel">
          <form className="book-search" onSubmit={runSearch}>
            <Search size={15} />
            <input autoFocus value={searchQuery} placeholder="搜索全书" onChange={(event) => setSearchQuery(event.target.value)} />
            <button type="submit">{searching ? `搜索 ${Math.round(searchProgress * 100)}%` : '搜索'}</button>
          </form>
          <div className="search-results">
            {searchResults.length ? searchResults.map((result, index) => (
              <button key={`${result.offset ?? result.occurrence}-${index}`} onClick={() => { readerRef.current?.goToSearch({ ...result, query: searchQuery.trim() }); setPanel(null) }}>
                <span>{result.label}</span>
                <small>{source.kind === 'text-large' ? `${Math.round(result.offset / source.total * 100)}%` : source.kind === 'epub' ? result.chapter : `结果 ${index + 1}`}</small>
              </button>
            )) : <p>{searchQuery && !searching ? '没有找到匹配内容' : `输入关键词搜索当前${source.kind === 'epub' ? ' EPUB' : ' TXT'}`}</p>}
          </div>
        </aside>
      ) : null}
    </main>
  )
}
