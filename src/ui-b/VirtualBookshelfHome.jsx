import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Library, MoreHorizontal, NotebookPen, Plus, Search, Settings2 } from 'lucide-react'

const LIGHT_SPINES = ['#587c83', '#6e7f91', '#7e8c80', '#8b7f88', '#6f8298', '#8a8774', '#5f7d78', '#807b8d']
const DARK_SPINES = ['#263e53', '#31516a', '#3e5660', '#3d4d5c', '#4c4c62', '#2e504c', '#4c4d58', '#3c5660']

const shelfCapacity = (width) => width < 520 ? 8 : width < 820 ? 11 : width < 1180 ? 14 : 18

function hashSeed(value) {
  let hash = 2166136261
  for (const character of String(value || 'book')) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash >>> 0)
}

function spineMetrics(book, dark) {
  const seed = hashSeed(book.id || book.path || book.title)
  return {
    width: 25 + (seed % 15),
    height: 142 + ((seed >>> 5) % 35),
    color: (dark ? DARK_SPINES : LIGHT_SPINES)[seed % (dark ? DARK_SPINES : LIGHT_SPINES).length],
    stripe: (seed >>> 15) % 3,
  }
}

function getStatus(book, progressMap, statusMap) {
  const explicit = statusMap[book.id]
  if (explicit === 'finished') return '已读完'
  if (explicit === 'reading' || progressMap[book.id]?.percent > 0) return '阅读中'
  return '未读'
}

function SpineBook({ book, metrics, progress, active, onActivate, onOpen, onKeyDown, buttonRef, cover }) {
  const percent = Math.round((progress || 0) * 100)
  const openWidth = Math.round(metrics.height * 2 / 3)
  return (
    <button
      ref={buttonRef}
      className={`v-spine ${active ? 'is-active' : ''}`}
      style={{ '--spine-width': `${metrics.width}px`, '--book-height': `${metrics.height}px`, '--open-width': `${openWidth}px`, '--spine-color': metrics.color }}
      aria-label={`${book.title}${book.author ? `，作者 ${book.author}` : ''}${percent ? `，阅读进度 ${percent}%` : ''}`}
      title={`${book.title}${book.author ? ` · ${book.author}` : ''}`}
      onMouseEnter={() => onActivate(book)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(book)}
      onBlur={() => onActivate(null)}
      onClick={() => active ? onOpen(book) : onActivate(book, true)}
      onDoubleClick={() => onOpen(book)}
      onKeyDown={onKeyDown}
    >
      <span className="v-book-volume" aria-hidden="true"><img src={cover} alt="" /></span>
      <span className="v-spine-face">
        <span className={`v-spine-stripe stripe-${metrics.stripe}`} />
        <span className="v-spine-title">{book.title}</span>
        {book.author ? <span className="v-spine-author">{book.author}</span> : null}
        <span className="v-spine-cover-hint" aria-hidden="true" />
        <span className="v-spine-progress" style={{ '--progress': `${percent}%` }} />
      </span>
    </button>
  )
}

function ActiveBookDetails({ book, progress, status, onOpen, onKeepOpen, onClose }) {
  const percent = Math.round((progress || 0) * 100)
  return <aside className="v-active-details" onMouseEnter={onKeepOpen} onMouseLeave={onClose} aria-live="polite"><span>{status}</span><strong title={book.title}>{book.title}</strong>{book.author ? <small>{book.author}</small> : null}<div className="v-active-detail-actions"><button className="v-primary-action" onClick={() => onOpen(book)}>{percent ? `继续阅读 ${percent}%` : '开始阅读'}</button><button className="v-icon-action" title="更多操作" aria-label="更多操作"><MoreHorizontal size={16} /></button></div></aside>
}

/* Dock 只保留五个主入口：管理视图（与书脊视图互切，不是另一个页面）、
   搜索、导入、笔记、外观。最近阅读/收藏等无独立功能的入口不再占位。 */
function BottomDock({ onLibrary, onSearch, onImport, onNotes, onSettings }) {
  const actions = [
    { id: 'library', label: '管理视图', icon: Library, onClick: onLibrary },
    { id: 'search', label: '搜索书籍', icon: Search, onClick: onSearch },
    { id: 'import', label: '导入书籍', icon: Plus, onClick: onImport },
    { id: 'notes', label: '阅读笔记', icon: NotebookPen, onClick: onNotes },
    { id: 'settings', label: '外观设置', icon: Settings2, onClick: onSettings },
  ]
  return <nav className="v-bottom-dock" aria-label="书房功能"><div className="v-bottom-dock-inner">{actions.map(({ id, label, icon: Icon, onClick }) => <button key={id} onClick={onClick} title={label} aria-label={label}><Icon size={17} /><span>{label}</span></button>)}</div></nav>
}

export default function VirtualBookshelfHome({ books, progressMap, statusMap, coversMap, defaultCover, dark, onOpen, onAddBooks, onOpenLibrary, onOpenNotes, onSearch, onOpenAppearance, scrollMemory }) {
  const [activeBook, setActiveBook] = useState(null)
  const [coverMap, setCoverMap] = useState({})
  const [capacity, setCapacity] = useState(() => shelfCapacity(window.innerWidth))
  const timerRef = useRef(null)
  const closeTimerRef = useRef(null)
  const bookRefs = useRef(new Map())
  const sceneRef = useRef(null)

  // 切去管理视图再切回时，恢复书脊场景的纵向滚动位置。
  // 用 useLayoutEffect：清理函数在节点被移除前执行，能读到真实 scrollTop。
  useLayoutEffect(() => {
    const node = sceneRef.current
    if (!node || !scrollMemory) return undefined
    node.scrollTop = scrollMemory.virtual || 0
    const frame = requestAnimationFrame(() => { node.scrollTop = scrollMemory.virtual || 0 })
    const save = () => { scrollMemory.virtual = node.scrollTop }
    node.addEventListener('scroll', save, { passive: true })
    return () => { cancelAnimationFrame(frame); save(); node.removeEventListener('scroll', save) }
  }, [scrollMemory])

  const visibleBooks = books
  const rows = useMemo(() => Array.from({ length: Math.ceil(visibleBooks.length / capacity) }, (_, index) => visibleBooks.slice(index * capacity, (index + 1) * capacity)), [capacity, visibleBooks])

  useEffect(() => {
    const update = () => setCapacity(shelfCapacity(window.innerWidth))
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  useEffect(() => {
    if (!activeBook || activeBook.kind === 'none') return undefined
    let cancelled = false
    if (coversMap[activeBook.book.id]) {
      setCoverMap((current) => ({ ...current, [activeBook.book.id]: coversMap[activeBook.book.id] }))
      return undefined
    }
    if (activeBook.book.format !== 'EPUB' || !activeBook.book.hasCover) {
      setCoverMap((current) => ({ ...current, [activeBook.book.id]: defaultCover }))
      return undefined
    }
    window.readerAPI?.getEpubCover(activeBook.book.path).then((cover) => {
      if (!cancelled) setCoverMap((current) => ({ ...current, [activeBook.book.id]: cover || defaultCover }))
    }).catch(() => { if (!cancelled) setCoverMap((current) => ({ ...current, [activeBook.book.id]: defaultCover })) })
    return () => { cancelled = true }
  }, [activeBook, coversMap, defaultCover])

  const activate = useCallback((book, pinned = false) => {
    clearTimeout(closeTimerRef.current)
    if (!book) {
      closeTimerRef.current = setTimeout(() => setActiveBook((current) => current?.pinned ? current : null), 190)
      return
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      setActiveBook((current) => current?.book.id === book.id && current.pinned ? current : { book, pinned })
    }, pinned ? 0 : 120)
  }, [])

  const closePreview = useCallback(() => {
    clearTimeout(closeTimerRef.current)
      closeTimerRef.current = setTimeout(() => setActiveBook((current) => current?.pinned ? current : null), 180)
  }, [])

  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape') setActiveBook(null) }
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [])

  const handleKeyDown = (event, index) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault()
    const delta = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -capacity : capacity
    const next = visibleBooks[(index + delta + visibleBooks.length) % visibleBooks.length]
    bookRefs.current.get(next.id)?.focus()
  }

  return (
    <main className="v-home" aria-label="虚拟书架首页">
      <section className="v-bookshelf-scene" ref={sceneRef}>
        {books.length ? <div className="v-shelf-stack" data-shelf-count={rows.length} style={{ '--shelf-count': rows.length }}>{rows.map((row, rowIndex) => <div className="v-shelf-row" key={`shelf-${rowIndex}`} data-book-count={row.length}><div className="v-shelf-books">{row.map((book) => { const index = visibleBooks.indexOf(book); const metrics = spineMetrics(book, dark); return <SpineBook key={book.id} book={book} metrics={metrics} progress={progressMap[book.id]?.percent} active={activeBook?.book.id === book.id} cover={coverMap[book.id] || coversMap[book.id] || defaultCover} buttonRef={(node) => node && bookRefs.current.set(book.id, node)} onActivate={(value, pinned) => activate(value, pinned)} onOpen={onOpen} onKeyDown={(event) => handleKeyDown(event, index)} /> })}</div><div className="v-shelf-board" aria-hidden="true" /></div>)}</div> : <div className="v-empty-shelf"><span className="v-empty-lines" aria-hidden="true" /><strong>书架还是空的</strong><span>导入第一本书，开始建立你的私人书房。</span><button className="v-primary-action" onClick={onAddBooks}><Plus size={16} />导入第一本书</button><button className="v-text-action" onClick={onOpenLibrary}>更换书籍目录</button></div>}
      </section>
      {activeBook ? <ActiveBookDetails book={activeBook.book} progress={progressMap[activeBook.book.id]?.percent} status={getStatus(activeBook.book, progressMap, statusMap)} onOpen={onOpen} onClose={closePreview} onKeepOpen={() => clearTimeout(closeTimerRef.current)} /> : null}
      <BottomDock onLibrary={() => onOpenLibrary?.('library')} onSearch={() => onSearch?.()} onImport={() => onAddBooks()} onNotes={() => onOpenNotes?.()} onSettings={() => onOpenAppearance?.()} />
    </main>
  )
}
