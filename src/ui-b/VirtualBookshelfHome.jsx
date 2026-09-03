import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CalendarDays, Clock3, MoonStar } from 'lucide-react'
import AISettingsModal from '../components/AISettingsModal'
import Bookstore, { BookstorePreview } from '../components/Bookstore'
import { ALL_BOOKS_ORDER_KEY, countSpinesHiddenForExpansion, layoutFaceOnlyBooks, layoutShelfBooks, orderBooksByIds, orderBooksWithNewFirst, hashSeed, shortCategoryLabel } from './shelfLayout'
import { formatReadingDuration } from '../readingStats'
import libraryIcon from './assets/dark-shelf/library.svg'
import importIcon from './assets/dark-shelf/import.svg'
import notesIcon from './assets/dark-shelf/notes.svg'
import appearanceIcon from './assets/dark-shelf/appearance.svg'
import searchButterfly from './assets/dark-shelf/theme-moon.svg'
import searchIcon from './assets/dark-shelf/search.svg'
import managerDirectoryIcon from './assets/dark-shelf/manager-directory.svg'
import managerAiIcon from './assets/dark-shelf/manager-ai.svg'
import managerTrashIcon from './assets/dark-shelf/manager-trash.svg'
import openBook from './assets/dark-shelf/open-book.svg'
import spineNavy from './assets/dark-shelf/spine-navy-tall.svg'
import spineBlueShort from './assets/dark-shelf/spine-blue-short.svg'
import spineBlueTall from './assets/dark-shelf/spine-blue-tall.svg'
import spineIce from './assets/dark-shelf/spine-ice.svg'

const SPINES = [spineNavy, spineBlueShort, spineBlueTall, spineIce]

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

  return { ref, cover: cover || defaultCover }
}

function FaceBook({ book, customCover, defaultCover, progress, onOpen, expanded, onActivate, dragProps }) {
  const { ref, cover } = useBookCover(book, customCover, defaultCover)
  const percent = Math.round((progress || 0) * 100)
  return (
    <button
      ref={ref}
      className={`v-face-book ${expanded ? 'is-expanded' : ''}`}
      onClick={() => onOpen(book)}
      onMouseEnter={() => onActivate(book.id)}
      onMouseLeave={() => onActivate('')}
      onFocus={() => onActivate(book.id)}
      onBlur={() => onActivate('')}
      title={book.title}
      aria-label={`${book.title}${percent ? `，阅读进度 ${percent}%` : ''}`}
      {...dragProps}
    >
      <span className="v-face-closed"><img src={cover} alt="" /></span>
      <span className="v-face-open" aria-hidden="true">
        <span className="v-face-open-meta">
          <strong>{book.title}</strong>
          <small><i><span className="v-face-progress-label">阅读进度</span><span className="v-face-progress-value">{percent}%</span></i></small>
        </span>
        <img src={openBook} alt="" />
      </span>
      {percent ? <span className="v-face-progress" style={{ '--progress': `${percent}%` }} aria-hidden="true" /> : null}
      {book.cloudOnly ? <span className="v-cloud-only" title="仅云端，点击下载">云</span> : null}
    </button>
  )
}

function SpineBook({ book, customCover, defaultCover, progress, onOpen, hidden, revealLeft, dragProps }) {
  const { ref, cover } = useBookCover(book, customCover, defaultCover)
  const seed = hashSeed(book.id || book.path || book.title)
  const percent = Math.round((progress || 0) * 100)
  return (
    <button ref={ref} className={`v-spine v-spine-${seed % SPINES.length} ${hidden ? 'is-expansion-hidden' : ''} ${revealLeft ? 'is-reveal-left' : ''}`} onClick={() => onOpen(book)} title={book.title} aria-label={`${book.title}${percent ? `，阅读进度 ${percent}%` : ''}`} {...dragProps}>
      <img className="v-spine-art" src={SPINES[seed % SPINES.length]} alt="" />
      <span className="v-spine-reveal" aria-hidden="true">
        <img src={cover} alt="" />
      </span>
      {book.cloudOnly ? <span className="v-cloud-only" title="仅云端，点击下载">云</span> : null}
    </button>
  )
}

function ShelfRow({ row, progressMap, coversMap, defaultCover, onOpen, draggingCategory, dropState, onDragStart, onDragOver, onDrop, onDragEnd, onMoveByKeyboard, onOpenCategory, onReorderBook }) {
  const booksRef = useRef(null)
  const [width, setWidth] = useState(320)
  const [expandedFaceId, setExpandedFaceId] = useState('')
  const [hiddenSpineCount, setHiddenSpineCount] = useState(0)

  useLayoutEffect(() => {
    const node = booksRef.current
    if (!node) return undefined
    const update = () => {
      const styles = window.getComputedStyle(node)
      const padding = parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
      setWidth(Math.max(160, node.clientWidth - padding))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // 首页"最近在读"行全部用正面封面：可见数量随容器宽度自适应（最少 3 本），不渲染书脊。
  const faceOnly = row.key === 'recent'
  const layout = useMemo(() => (faceOnly ? layoutFaceOnlyBooks(row.books, width) : layoutShelfBooks(row.books, width)), [faceOnly, row.books, width])

  useLayoutEffect(() => {
    const node = booksRef.current
    if (!node || !expandedFaceId || !layout.spines.length) {
      setHiddenSpineCount(0)
      return
    }
    const faceGroup = node.querySelector('.v-face-group')
    const spines = [...node.querySelectorAll('.v-spine')]
    if (!faceGroup || !spines.length) {
      setHiddenSpineCount(0)
      return
    }
    const faceRight = faceGroup.getBoundingClientRect().right
    const spineLefts = spines.map((spine) => spine.getBoundingClientRect().left)
    setHiddenSpineCount(countSpinesHiddenForExpansion(faceRight, spineLefts))
  }, [expandedFaceId, layout.spines.length, width])

  const dropClass = dropState?.target === row.key ? `is-drop-${dropState.position}` : ''
  const canDrag = row.reorderable
  const canReorderBooks = row.key === 'all' || row.reorderable
  const [bookDrag, setBookDrag] = useState(null)
  const bookDragProps = (book) => canReorderBooks ? {
    draggable: true,
    'data-drop-position': bookDrag?.target === book.id ? bookDrag.position : undefined,
    onDragStart: (event) => {
      event.stopPropagation()
      event.dataTransfer.setData('text/book-id', book.id)
      event.dataTransfer.effectAllowed = 'move'
      setBookDrag({ source: book.id, target: '', position: 'before' })
    },
    onDragOver: (event) => {
      const source = event.dataTransfer.getData('text/book-id') || bookDrag?.source
      if (!source || source === book.id) return
      event.preventDefault()
      event.stopPropagation()
      const rect = event.currentTarget.getBoundingClientRect()
      const position = event.clientX < rect.left + rect.width / 2 ? 'before' : 'after'
      event.dataTransfer.dropEffect = 'move'
      setBookDrag((current) => ({ source: current?.source || source, target: book.id, position }))
    },
    onDrop: (event) => {
      event.preventDefault()
      event.stopPropagation()
      const source = event.dataTransfer.getData('text/book-id') || bookDrag?.source
      if (source && source !== book.id) onReorderBook(row, source, book.id, bookDrag?.target === book.id ? bookDrag.position : 'before')
      setBookDrag(null)
    },
    onDragEnd: () => setBookDrag(null),
  } : {}
  const shelfStyle = {
    '--cover-width': `${layout.coverWidth}px`,
    '--cover-height': `${Math.round(layout.coverWidth * 1.333)}px`,
    '--cover-gap': `${layout.coverGap}px`,
    '--spine-wide-width': `${17 * layout.spineScale}px`,
    '--spine-narrow-width': `${13 * layout.spineScale}px`,
    '--spine-height-0': `${88 * layout.spineScale}px`,
    '--spine-height-1': `${72 * layout.spineScale}px`,
    '--spine-height-2': `${93 * layout.spineScale}px`,
    '--spine-height-3': `${79 * layout.spineScale}px`,
    '--open-book-gap': `${2.9 * layout.spineScale}px`,
    '--open-meta-gap': `${3.96 * layout.spineScale}px`,
    '--open-title-size': `${12 * layout.spineScale}pt`,
    '--open-progress-width': `${72.313 * layout.spineScale}px`,
    '--open-progress-height': `${7.7605 * layout.spineScale}px`,
    '--open-progress-font': `${5.045 * layout.spineScale}pt`,
    '--open-progress-left': `${2.63 * layout.spineScale}px`,
    '--open-progress-right': `${2.25 * layout.spineScale}px`,
    '--open-stack-extra': `${37.7205 * (layout.spineScale - 1)}px`,
    '--section-gap': `${layout.sectionGap}px`,
  }

  return (
    <section className={`v-shelf-row ${expandedFaceId ? 'has-expanded-face' : ''} ${draggingCategory === row.key ? 'is-dragging' : ''} ${dropClass}`} style={shelfStyle} onDragOver={canDrag ? (event) => onDragOver(event, row.key) : undefined} onDrop={canDrag ? (event) => onDrop(event, row.key) : undefined}>
      <header className="v-shelf-heading">
        <strong
          className={canDrag ? 'is-draggable' : ''}
          draggable={canDrag}
          tabIndex={canDrag ? 0 : undefined}
          onDragStart={canDrag ? (event) => onDragStart(event, row.key) : undefined}
          onDragEnd={canDrag ? onDragEnd : undefined}
          onKeyDown={canDrag ? (event) => {
            if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return
            event.preventDefault()
            onMoveByKeyboard(row.key, event.key === 'ArrowUp' ? -1 : 1)
          } : undefined}
          title={row.label !== shortCategoryLabel(row.label) ? row.label : (canDrag ? '拖动调整书架顺序' : undefined)}
        >{shortCategoryLabel(row.label)}</strong>
        <button onClick={() => onOpenCategory(row)}>{`全部 ${row.totalCount ?? row.books.length} 本`}<span aria-hidden="true">›</span></button>
      </header>
      <div ref={booksRef} className="v-shelf-books">
        <div className="v-face-group">
          {layout.covers.map((book) => <FaceBook key={book.id} book={book} customCover={coversMap[book.id]} defaultCover={defaultCover} progress={progressMap[book.id]?.percent} onOpen={onOpen} expanded={expandedFaceId === book.id} onActivate={setExpandedFaceId} dragProps={bookDragProps(book)} />)}
        </div>
        {layout.spines.length ? <div className="v-spine-group">{layout.spines.map(({ book }, index) => <SpineBook key={book.id} book={book} customCover={coversMap[book.id]} defaultCover={defaultCover} progress={progressMap[book.id]?.percent} onOpen={onOpen} hidden={index < hiddenSpineCount} revealLeft={index >= layout.spines.length - 3} dragProps={bookDragProps(book)} />)}</div> : null}
      </div>
      <div className="v-shelf-board" aria-hidden="true" />
    </section>
  )
}

function BottomDock({ onLibrary, onImport, onToggleTheme, onNotes, onSettings }) {
  const action = ({ id, label, icon, onClick }) => <button key={id} onClick={onClick} title={label} aria-label={label}><span className="v-dock-icon" style={{ '--dock-icon': `url("${icon}")` }} aria-hidden="true" /></button>
  return (
    <nav className="v-bottom-dock" aria-label="书房功能">
      <div className="v-dock-side is-left">{[
        { id: 'library', label: '管理视图', icon: libraryIcon, onClick: onLibrary },
        { id: 'import', label: '导入书籍', icon: importIcon, onClick: onImport },
      ].map(action)}</div>
      <button className="is-theme-toggle" onClick={onToggleTheme} title="切换深浅主题" aria-label="切换深浅主题"><span className="v-theme-moon-mark"><MoonStar /></span></button>
      <div className="v-dock-side is-right">{[
        { id: 'notes', label: '笔记摘录', icon: notesIcon, onClick: onNotes },
        { id: 'settings', label: '用户数据', icon: appearanceIcon, onClick: onSettings },
      ].map(action)}</div>
    </nav>
  )
}

function LibraryTopBar({ bookCount, query, onQueryChange, onClearAllData, onOpenAiSettings, onChooseDirectory }) {
  return (
    <header className="v-library-toolbar">
      <h1>书架</h1>
      <div className="v-home-actions">
        <button className="is-trash" onClick={onClearAllData} title="删除全部本地数据（保留源文件）" aria-label="删除全部本地数据，保留源文件"><img src={managerTrashIcon} alt="" /></button>
        <button className="is-ai" onClick={onOpenAiSettings} title="AI 供应商设置" aria-label="AI 供应商设置"><img src={managerAiIcon} alt="" /></button>
        <button className="is-directory" onClick={onChooseDirectory} title="导入阅读目录" aria-label="导入阅读目录"><img src={managerDirectoryIcon} alt="" /></button>
      </div>
      <label className="v-library-search"><img src={searchIcon} alt="" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={bookCount ? `搜索 ${bookCount} 本书` : '搜索书籍'} aria-label="搜索书籍" /></label>
      <img className="v-search-butterfly" src={searchButterfly} alt="" />
    </header>
  )
}

export default function VirtualBookshelfHome({ books, progressMap, statusMap, readingStats, coversMap, defaultCover, categories, tagsMap, categoryBookOrder, recentBookIds, onOpen, onAddBooks, onDownloadedBook, onOpenLibrary, onOpenNotes, onOpenAppearance, onChooseDirectory, onClearAllData, onReorderCategories, onReorderBook, onToggleTheme, scrollMemory }) {
  const [query, setQuery] = useState('')
  const [draggingCategory, setDraggingCategory] = useState('')
  const [dropState, setDropState] = useState(null)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [storeOpen, setStoreOpen] = useState(false)
  const sceneRef = useRef(null)

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
    const matches = (book) => !needle || `${book.title} ${book.author || ''}`.toLocaleLowerCase('zh-CN').includes(needle)
    const recent = recentBookIds.map((id) => byId.get(id)).filter(Boolean).filter(matches)
    return recent.length ? [{ key: 'recent', label: '最近在读', managementKey: 'recent', books: recent, totalCount: recent.length }] : []
  }, [books, query, recentBookIds])

  const visibleCategoryKeys = rows.filter((row) => row.reorderable).map((row) => row.key)
  const totalSeconds = Number(readingStats?.totalSeconds) || 0
  const readingDuration = formatReadingDuration(totalSeconds)
  const stats = [
    ['阅读天数', `${Object.keys(readingStats?.days || {}).length}`, '天', CalendarDays],
    ['阅读时长', readingDuration.value, readingDuration.unit, Clock3],
    ['已读书籍', `${books.filter((book) => Number(progressMap[book.id]?.percent) >= .99).length}`, '本', BookOpen],
  ]
  const handleDragStart = (event, category) => {
    event.dataTransfer.setData('text/category-name', category)
    event.dataTransfer.effectAllowed = 'move'
    setDraggingCategory(category)
  }
  const handleDragOver = (event, target) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    setDropState({ target, position: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after' })
  }
  const handleDrop = (event, target) => {
    event.preventDefault()
    const source = event.dataTransfer.getData('text/category-name') || draggingCategory
    if (source && source !== target) onReorderCategories(source, target, dropState?.position || 'before')
    setDraggingCategory('')
    setDropState(null)
  }
  const moveByKeyboard = (source, delta) => {
    const index = visibleCategoryKeys.indexOf(source)
    const target = visibleCategoryKeys[index + delta]
    if (target) onReorderCategories(source, target, delta < 0 ? 'before' : 'after')
  }

  return (
    <main className="v-home" aria-label="书脊视图">
      <div className="v-bookshelf-scene" ref={sceneRef}>
        <LibraryTopBar bookCount={books.length} query={query} onQueryChange={setQuery} onClearAllData={onClearAllData} onOpenAiSettings={() => setAiSettingsOpen(true)} onChooseDirectory={onChooseDirectory} />
        <div className="v-home-sections">
          <BookstorePreview onOpen={() => setStoreOpen(true)} />
          {rows[0] ? <ShelfRow row={rows[0]} progressMap={progressMap} coversMap={coversMap} defaultCover={defaultCover} onOpen={onOpen} draggingCategory={draggingCategory} dropState={dropState} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={() => { setDraggingCategory(''); setDropState(null) }} onMoveByKeyboard={moveByKeyboard} onOpenCategory={onOpenLibrary} onReorderBook={onReorderBook} /> : <section className="v-recent-empty"><header><strong>最近在读</strong><button onClick={() => onOpenLibrary(null)}>打开完整书架 ›</button></header><p>{query ? '最近阅读中没有匹配的书' : '打开一本书后，它会留在这里方便继续阅读。'}</p></section>}
          <section className="v-reading-overview" aria-label="阅读数据">
            <header><span>READING RECORD</span><strong>阅读数据</strong></header>
            <div className="v-reading-metrics">{stats.map(([label, value, unit, Icon]) => <div key={label}><span className="v-reading-label"><Icon aria-hidden="true" />{label}</span><strong><b>{value}</b><small>{unit}</small></strong></div>)}</div>
          </section>
        </div>
      </div>
      <BottomDock onLibrary={() => onOpenLibrary(null)} onImport={onAddBooks} onToggleTheme={onToggleTheme} onNotes={onOpenNotes} onSettings={onOpenAppearance} />
      <AISettingsModal open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      {storeOpen ? <Bookstore onClose={() => setStoreOpen(false)} onDownloaded={onDownloadedBook} /> : null}
    </main>
  )
}
