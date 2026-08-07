import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, GripVertical, Library, NotebookPen, Plus, Search, Settings2 } from 'lucide-react'
import { layoutShelfBooks, orderBooksByIds, shortSpineTitle } from './shelfLayout'

function getStatus(book, progressMap, statusMap) {
  const explicit = statusMap[book.id]
  if (explicit === 'finished') return '已读完'
  if (explicit === 'reading' || progressMap[book.id]?.percent > 0) return '阅读中'
  return '未读'
}

function useBookCover(book, customCover, defaultCover) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  const [cover, setCover] = useState(customCover || '')

  useEffect(() => {
    const node = ref.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      setVisible(true)
      return undefined
    }
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setVisible(true), { rootMargin: '220px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (customCover) {
      setCover(customCover)
      return undefined
    }
    if (!visible || book.format !== 'EPUB' || !book.hasCover || !window.readerAPI?.getEpubCover) {
      setCover('')
      return undefined
    }
    let cancelled = false
    window.readerAPI.getEpubCover(book.path).then((value) => {
      if (!cancelled) setCover(value || '')
    }).catch(() => { if (!cancelled) setCover('') })
    return () => { cancelled = true }
  }, [book.format, book.hasCover, book.path, customCover, visible])

  return { ref, cover: cover || defaultCover, isDefault: !cover }
}

function FaceBook({ book, customCover, defaultCover, progress, onOpen, onActivate }) {
  const { ref, cover, isDefault } = useBookCover(book, customCover, defaultCover)
  const percent = Math.round((progress || 0) * 100)
  return (
    <button
      ref={ref}
      className="v-face-book"
      onClick={() => onOpen(book)}
      onMouseEnter={() => onActivate(book)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(book)}
      onBlur={() => onActivate(null)}
      title={`${book.title}${book.author ? ` · ${book.author}` : ''}`}
      aria-label={`${book.title}${percent ? `，阅读进度 ${percent}%` : ''}`}
    >
      <img src={cover} alt="" />
      {isDefault ? <span className="v-face-default-title">{book.title}</span> : null}
      {percent ? <span className="v-face-progress" style={{ '--progress': `${percent}%` }} aria-hidden="true" /> : null}
    </button>
  )
}

function SpineBook({ book, metrics, coverHeight, progress, onOpen, onActivate }) {
  const percent = Math.round((progress || 0) * 100)
  return (
    <button
      className={`v-spine ${metrics.darkText ? 'has-dark-text' : ''}`}
      style={{ '--spine-width': `${metrics.width}px`, '--book-height': `${Math.round(coverHeight * metrics.heightRatio)}px`, '--spine-color': metrics.color }}
      onClick={() => onOpen(book)}
      onMouseEnter={() => onActivate(book)}
      onMouseLeave={() => onActivate(null)}
      onFocus={() => onActivate(book)}
      onBlur={() => onActivate(null)}
      title={`${book.title}${book.author ? ` · ${book.author}` : ''}`}
      aria-label={`${book.title}${percent ? `，阅读进度 ${percent}%` : ''}`}
    >
      <span className="v-spine-face" aria-hidden="true">
        <span className="v-spine-title">{shortSpineTitle(book.title)}</span>
      </span>
    </button>
  )
}

function ShelfRow({ row, progressMap, coversMap, defaultCover, onOpen, onActivate, draggingCategory, dropState, onDragStart, onDragOver, onDrop, onDragEnd, onPointerMove, onPointerUp, onMoveByKeyboard, onOpenCategory }) {
  const booksRef = useRef(null)
  const [width, setWidth] = useState(320)

  useLayoutEffect(() => {
    const node = booksRef.current
    if (!node) return undefined
    const update = () => setWidth(Math.max(280, node.clientWidth - 24))
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const layout = useMemo(() => layoutShelfBooks(row.books, width), [row.books, width])
  const coverHeight = Math.round(layout.coverWidth * 1.5)
  const dropClass = dropState?.target === row.key ? `is-drop-${dropState.position}` : ''

  return (
    <section
      className={`v-shelf-row ${row.fixed ? 'is-recent' : 'is-category'} ${draggingCategory === row.key ? 'is-dragging' : ''} ${dropClass}`}
      onDragOverCapture={row.fixed ? undefined : (event) => onDragOver(event, row.key)}
      onDropCapture={row.fixed ? undefined : (event) => onDrop(event, row.key)}
      onPointerMove={row.fixed ? undefined : (event) => onPointerMove(event, row.key)}
      onPointerUp={row.fixed ? undefined : (event) => onPointerUp(event, row.key)}
    >
      <header className="v-shelf-heading">
        <div className="v-shelf-heading-title">
          {!row.fixed ? (
            <span
              className="v-shelf-drag-handle"
              tabIndex={0}
              role="button"
              aria-label={`拖动调整分类 ${row.label} 的顺序`}
              title="拖动调整分类顺序"
              onPointerDown={(event) => { event.preventDefault(); onDragStart(null, row.key) }}
              onKeyDown={(event) => {
                if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
                event.preventDefault()
                onMoveByKeyboard(row.key, event.key === 'ArrowUp' ? -1 : 1)
              }}
            ><GripVertical size={15} /></span>
          ) : null}
          <strong>{row.label}</strong>
        </div>
        <button onClick={() => onOpenCategory(row)}>{`全部 ${row.totalCount ?? row.books.length} 本`}<ChevronRight size={14} /></button>
      </header>
      <div ref={booksRef} className="v-shelf-books" style={{ '--cover-width': `${layout.coverWidth}px`, '--cover-height': `${coverHeight}px` }}>
        <div className="v-face-group">
          {layout.covers.map((book) => <FaceBook key={book.id} book={book} customCover={coversMap[book.id]} defaultCover={defaultCover} progress={progressMap[book.id]?.percent} onOpen={onOpen} onActivate={onActivate} />)}
        </div>
        {layout.spines.length ? <div className="v-spine-group">{layout.spines.map(({ book, metrics }) => <SpineBook key={book.id} book={book} metrics={metrics} coverHeight={coverHeight} progress={progressMap[book.id]?.percent} onOpen={onOpen} onActivate={onActivate} />)}</div> : null}
      </div>
      <div className="v-shelf-board" aria-hidden="true" />
    </section>
  )
}

function ActiveBookDetails({ book, progress, status, onOpen, onKeepOpen, onClose }) {
  const percent = Math.round((progress || 0) * 100)
  return <aside className="v-active-details" onMouseEnter={onKeepOpen} onMouseLeave={onClose} aria-live="polite"><span>{status}</span><strong title={book.title}>{book.title}</strong>{book.author ? <small>{book.author}</small> : null}<div className="v-active-detail-actions"><button className="v-primary-action" onClick={() => onOpen(book)}>{percent ? `继续阅读 ${percent}%` : '开始阅读'}</button></div></aside>
}

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

function LibraryTopBar({ bookCount, filter, onFilterChange, query, onQueryChange, onOpenLibrary }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return undefined
    const close = (event) => { if (!menuRef.current?.contains(event.target)) setMenuOpen(false) }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menuOpen])
  return (
    <header className="v-library-toolbar">
      <div className="v-library-toolbar-top">
        <div className="v-library-switch" ref={menuRef}>
          <button className="v-library-title" onClick={() => setMenuOpen((current) => !current)} aria-haspopup="menu" aria-expanded={menuOpen}>书架<ChevronDown size={13} /></button>
          {menuOpen ? <div className="v-library-menu" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); onOpenLibrary(null) }}><Library size={15} />管理视图</button></div> : null}
        </div>
        <nav className="v-library-filters" aria-label="阅读状态筛选">
          {[['all', '全部'], ['reading', '在读'], ['finished', '读完']].map(([value, label]) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => onFilterChange(value)}>{label}</button>)}
        </nav>
      </div>
      <label className="v-library-search"><Search size={14} /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={`搜索 ${bookCount} 本书`} /></label>
    </header>
  )
}

export default function VirtualBookshelfHome({ books, progressMap, statusMap, coversMap, defaultCover, categories, tagsMap, categoryBookOrder, recentBookIds, onOpen, onAddBooks, onOpenLibrary, onOpenNotes, onSearch, onOpenAppearance, onReorderCategories, scrollMemory }) {
  const [activeBook, setActiveBook] = useState(null)
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [draggingCategory, setDraggingCategory] = useState('')
  const [dropState, setDropState] = useState(null)
  const closeTimerRef = useRef(null)
  const sceneRef = useRef(null)
  useEffect(() => {
    if (!draggingCategory) return undefined
    const clear = () => { setDraggingCategory(''); setDropState(null) }
    window.addEventListener('pointerup', clear)
    window.addEventListener('pointercancel', clear)
    return () => { window.removeEventListener('pointerup', clear); window.removeEventListener('pointercancel', clear) }
  }, [draggingCategory])

  useLayoutEffect(() => {
    const node = sceneRef.current
    if (!node || !scrollMemory) return undefined
    node.scrollTop = scrollMemory.virtual || 0
    const frame = requestAnimationFrame(() => { node.scrollTop = scrollMemory.virtual || 0 })
    const save = () => { scrollMemory.virtual = node.scrollTop }
    node.addEventListener('scroll', save, { passive: true })
    return () => { cancelAnimationFrame(frame); save(); node.removeEventListener('scroll', save) }
  }, [scrollMemory])

  const rows = useMemo(() => {
    const byId = new Map(books.map((book) => [book.id, book]))
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    const matches = (book) => {
      const explicit = statusMap[book.id]
      const status = explicit === 'finished' ? 'finished' : explicit === 'reading' || progressMap[book.id]?.percent > 0 ? 'reading' : 'unread'
      const matchesFilter = filter === 'all' || status === filter
      const matchesQuery = !needle || `${book.title} ${book.author || ''}`.toLocaleLowerCase('zh-CN').includes(needle)
      return matchesFilter && matchesQuery
    }
    const allRecentBooks = recentBookIds.map((id) => byId.get(id)).filter(Boolean)
    const recentBooks = allRecentBooks.filter(matches)
    const result = recentBooks.length ? [{ key: 'recent', label: '最近阅读', fixed: true, books: recentBooks, totalCount: allRecentBooks.length }] : []
    for (const category of categories) {
      const members = books.filter((book) => tagsMap[book.id]?.[0] === category)
      const visible = orderBooksByIds(members, categoryBookOrder[category]).filter(matches)
      if (visible.length) result.push({ key: category, label: category, fixed: false, books: visible, totalCount: members.length })
    }
    return result
  }, [books, categories, categoryBookOrder, filter, progressMap, query, recentBookIds, statusMap, tagsMap])

  const visibleCategoryKeys = rows.filter((row) => !row.fixed).map((row) => row.key)
  const isFiltering = filter !== 'all' || Boolean(query.trim())
  const activate = (book) => {
    clearTimeout(closeTimerRef.current)
    if (book) setActiveBook(book)
    else closeTimerRef.current = setTimeout(() => setActiveBook(null), 160)
  }
  const handleDragStart = (event, category) => {
    if (event?.dataTransfer) {
      event.dataTransfer.setData('text/category-name', category)
      event.dataTransfer.setData('text/plain', `category:${category}`)
      event.dataTransfer.effectAllowed = 'move'
    }
    setDraggingCategory(category)
  }
  const handleDragOver = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setDropState({ target, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
  }
  const handleDrop = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    const source = event.dataTransfer.getData('text/category-name') || event.dataTransfer.getData('text/plain').replace(/^category:/, '') || draggingCategory
    if (source && source !== target) onReorderCategories(source, target, dropState?.target === target ? dropState.position : 'before')
    setDraggingCategory('')
    setDropState(null)
  }
  const moveByKeyboard = (source, delta) => {
    const index = visibleCategoryKeys.indexOf(source)
    const target = visibleCategoryKeys[index + delta]
    if (target) onReorderCategories(source, target, delta < 0 ? 'before' : 'after')
  }
  const pointerPosition = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }
  const handlePointerMove = (event, target) => {
    if (draggingCategory) setDropState({ target, position: pointerPosition(event) })
  }
  const handlePointerUp = (event, target) => {
    if (draggingCategory && draggingCategory !== target) onReorderCategories(draggingCategory, target, pointerPosition(event))
    setDraggingCategory('')
    setDropState(null)
  }

  return (
    <main className="v-home" aria-label="书脊视图">
      <LibraryTopBar bookCount={books.length} filter={filter} onFilterChange={setFilter} query={query} onQueryChange={setQuery} onOpenLibrary={onOpenLibrary} />
      <div className="v-bookshelf-scene" ref={sceneRef}>
        {rows.length ? <div className="v-shelf-stack" data-shelf-count={rows.length}>{rows.map((row) => <ShelfRow key={row.key} row={row} progressMap={progressMap} coversMap={coversMap} defaultCover={defaultCover} onOpen={onOpen} onActivate={activate} draggingCategory={draggingCategory} dropState={dropState} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={() => { setDraggingCategory(''); setDropState(null) }} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onMoveByKeyboard={moveByKeyboard} onOpenCategory={onOpenLibrary} />)}</div> : isFiltering ? <div className="v-empty-shelf"><strong>没有匹配的书</strong></div> : books.length ? <div className="v-empty-shelf"><strong>还没有分类书架</strong><span>前往管理视图，把书籍放入分类。</span><button className="v-primary-action" onClick={() => onOpenLibrary({ key: 'all', label: '全部书籍', fixed: true, books })}><Library size={16} />管理书籍</button></div> : <div className="v-empty-shelf"><strong>书架还是空的</strong><span>导入第一本书，开始建立你的私人书房。</span><button className="v-primary-action" onClick={onAddBooks}><Plus size={16} />导入第一本书</button></div>}
      </div>
      {activeBook ? <ActiveBookDetails book={activeBook} progress={progressMap[activeBook.id]?.percent} status={getStatus(activeBook, progressMap, statusMap)} onOpen={onOpen} onClose={() => activate(null)} onKeepOpen={() => clearTimeout(closeTimerRef.current)} /> : null}
      <BottomDock onLibrary={() => onOpenLibrary(null)} onSearch={onSearch} onImport={onAddBooks} onNotes={onOpenNotes} onSettings={onOpenAppearance} />
    </main>
  )
}
