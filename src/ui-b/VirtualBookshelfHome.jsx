import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { MoonStar } from 'lucide-react'
import AISettingsModal from '../components/AISettingsModal'
import { countSpinesHiddenForExpansion, layoutShelfBooks, orderBooksByIds, hashSeed } from './shelfLayout'
import libraryIcon from './assets/dark-shelf/library.svg'
import importIcon from './assets/dark-shelf/import.svg'
import notesIcon from './assets/dark-shelf/notes.svg'
import appearanceIcon from './assets/dark-shelf/appearance.svg'
import searchButterfly from './assets/dark-shelf/theme-moon.svg'
import searchIcon from './assets/dark-shelf/search.svg'
import managerDirectoryIcon from './assets/dark-shelf/manager-directory.svg'
import managerAiIcon from './assets/dark-shelf/manager-ai.svg'
import managerTrashIcon from './assets/dark-shelf/manager-trash.svg'
import shelfMoon from './assets/dark-shelf/shelf-moon.png'
import openBook from './assets/dark-shelf/open-book.svg'
import spineNavy from './assets/dark-shelf/spine-navy-tall.svg'
import spineBlueShort from './assets/dark-shelf/spine-blue-short.svg'
import spineBlueTall from './assets/dark-shelf/spine-blue-tall.svg'
import spineIce from './assets/dark-shelf/spine-ice.svg'

const SPINES = [spineNavy, spineBlueShort, spineBlueTall, spineIce]

function getStatus(book, progressMap, statusMap) {
  const explicit = statusMap[book.id]
  if (explicit === 'finished') return 'finished'
  if (explicit === 'reading' || progressMap[book.id]?.percent > 0) return 'reading'
  return 'unread'
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

  return { ref, cover: cover || defaultCover }
}

function FaceBook({ book, customCover, defaultCover, progress, onOpen, expanded, onActivate }) {
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
    </button>
  )
}

function SpineBook({ book, customCover, defaultCover, progress, onOpen, hidden, revealLeft }) {
  const { ref, cover } = useBookCover(book, customCover, defaultCover)
  const seed = hashSeed(book.id || book.path || book.title)
  const percent = Math.round((progress || 0) * 100)
  return (
    <button ref={ref} className={`v-spine v-spine-${seed % SPINES.length} ${hidden ? 'is-expansion-hidden' : ''} ${revealLeft ? 'is-reveal-left' : ''}`} onClick={() => onOpen(book)} title={book.title} aria-label={`${book.title}${percent ? `，阅读进度 ${percent}%` : ''}`}>
      <img className="v-spine-art" src={SPINES[seed % SPINES.length]} alt="" />
      <span className="v-spine-reveal" aria-hidden="true">
        <img src={cover} alt="" />
      </span>
    </button>
  )
}

function ShelfRow({ row, progressMap, coversMap, defaultCover, onOpen, draggingCategory, dropState, onDragStart, onDragOver, onDrop, onDragEnd, onMoveByKeyboard, onOpenCategory }) {
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
      const decoration = node.querySelector('.v-shelf-moon')
      const decorationStyles = decoration ? window.getComputedStyle(decoration) : null
      const decorationWidth = decoration
        ? decoration.getBoundingClientRect().width + parseFloat(decorationStyles.marginLeft) + parseFloat(decorationStyles.marginRight)
        : 0
      setWidth(Math.max(160, node.clientWidth - padding - decorationWidth))
    }
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    return () => observer.disconnect()
  }, [row.decorated])

  const layout = useMemo(() => layoutShelfBooks(row.books, width), [row.books, width])

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
    <section className={`v-shelf-row ${row.decorated ? 'is-decorated' : ''} ${expandedFaceId ? 'has-expanded-face' : ''} ${draggingCategory === row.key ? 'is-dragging' : ''} ${dropClass}`} style={shelfStyle} onDragOver={canDrag ? (event) => onDragOver(event, row.key) : undefined} onDrop={canDrag ? (event) => onDrop(event, row.key) : undefined}>
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
          title={canDrag ? '拖动调整书架顺序' : undefined}
        >{row.label}</strong>
        <button onClick={() => onOpenCategory(row)}>{`全部 ${row.totalCount ?? row.books.length} 本`}<span aria-hidden="true">›</span></button>
      </header>
      <div ref={booksRef} className="v-shelf-books">
        {row.decorated ? <img className="v-shelf-moon" src={shelfMoon} alt="" /> : null}
        <div className="v-face-group">
          {layout.covers.map((book) => <FaceBook key={book.id} book={book} customCover={coversMap[book.id]} defaultCover={defaultCover} progress={progressMap[book.id]?.percent} onOpen={onOpen} expanded={expandedFaceId === book.id} onActivate={setExpandedFaceId} />)}
        </div>
        {layout.spines.length ? <div className="v-spine-group">{layout.spines.map(({ book }, index) => <SpineBook key={book.id} book={book} customCover={coversMap[book.id]} defaultCover={defaultCover} progress={progressMap[book.id]?.percent} onOpen={onOpen} hidden={index < hiddenSpineCount} revealLeft={index >= layout.spines.length - 3} />)}</div> : null}
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
        { id: 'settings', label: '主题与背景', icon: appearanceIcon, onClick: onSettings },
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

export default function VirtualBookshelfHome({ books, progressMap, statusMap, coversMap, defaultCover, categories, tagsMap, categoryBookOrder, recentBookIds, onOpen, onAddBooks, onOpenLibrary, onOpenNotes, onOpenAppearance, onChooseDirectory, onClearAllData, onReorderCategories, onToggleTheme, scrollMemory }) {
  const [query, setQuery] = useState('')
  const [draggingCategory, setDraggingCategory] = useState('')
  const [dropState, setDropState] = useState(null)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
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
    const result = []
    const recent = recentBookIds.map((id) => byId.get(id)).filter(Boolean).filter(matches)
    if (recent.length) result.push({ key: 'recent', label: '最近在读', managementKey: 'recent', books: recent, totalCount: recent.length, decorated: true })
    const all = books.filter(matches)
    if (all.length) result.push({ key: 'all', label: '全部', managementKey: 'all', books: all, totalCount: books.length })
    const unreadAll = books.filter((book) => getStatus(book, progressMap, statusMap) === 'unread')
    const unread = unreadAll.filter(matches)
    if (unread.length) result.push({ key: 'unread', label: '未读', managementKey: 'unread', books: unread, totalCount: unreadAll.length })
    for (const category of categories) {
      const members = books.filter((book) => tagsMap[book.id]?.[0] === category)
      const visible = orderBooksByIds(members, categoryBookOrder[category]).filter(matches)
      if (visible.length || !needle) result.push({ key: category, label: category, managementKey: 'category', books: visible, totalCount: members.length, reorderable: true })
    }
    return result
  }, [books, categories, categoryBookOrder, progressMap, query, recentBookIds, statusMap, tagsMap])

  const visibleCategoryKeys = rows.filter((row) => row.reorderable).map((row) => row.key)
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
        {rows.length ? <div className="v-shelf-stack">{rows.map((row) => <ShelfRow key={row.key} row={row} progressMap={progressMap} coversMap={coversMap} defaultCover={defaultCover} onOpen={onOpen} draggingCategory={draggingCategory} dropState={dropState} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onDragEnd={() => { setDraggingCategory(''); setDropState(null) }} onMoveByKeyboard={moveByKeyboard} onOpenCategory={onOpenLibrary} />)}</div> : query ? <div className="v-empty-shelf"><strong>没有找到相关书籍</strong></div> : <div className="v-empty-shelf"><strong>书架还是空的</strong><button onClick={onAddBooks}>导入书籍</button></div>}
      </div>
      <BottomDock onLibrary={() => onOpenLibrary(null)} onImport={onAddBooks} onToggleTheme={onToggleTheme} onNotes={onOpenNotes} onSettings={onOpenAppearance} />
      <AISettingsModal open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
    </main>
  )
}
