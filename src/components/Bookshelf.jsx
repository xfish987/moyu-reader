import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpenText, Check, DatabaseBackup, Eraser, FileInput, FolderOpen, GripVertical, Grid2X2, ImagePlus, Keyboard, Library, List, ListChecks, MapPin, MoonStar, NotebookPen, Plus, RefreshCw, Rows3, ServerCog, Tags, Trash2, X } from 'lucide-react'
import { formatBytes } from '../hooks'
import { ALL_BOOKS_ORDER_KEY, moveBeforeOrAfter, orderBooksByIds, orderBooksWithNewFirst } from '../ui-b/shelfLayout'
import CoverEditor from './CoverEditor'
import NotesLibrary from './NotesLibrary'
import AISettingsModal from './AISettingsModal'
import ShortcutsModal from './ShortcutsModal'
import libraryDockIcon from '../ui-b/assets/dark-shelf/library.svg'
import importDockIcon from '../ui-b/assets/dark-shelf/import.svg'
import notesDockIcon from '../ui-b/assets/dark-shelf/notes.svg'
import appearanceDockIcon from '../ui-b/assets/dark-shelf/appearance.svg'
import managerDirectoryIcon from '../ui-b/assets/dark-shelf/manager-directory.svg'
import managerAiIcon from '../ui-b/assets/dark-shelf/manager-ai.svg'
import managerTrashIcon from '../ui-b/assets/dark-shelf/manager-trash.svg'
import managerChevronsIcon from '../ui-b/assets/dark-shelf/manager-chevrons.svg'
import searchIcon from '../ui-b/assets/dark-shelf/search.svg'

const COVER_COLORS = ['#315c57', '#935746', '#354d6b', '#786844', '#624c63', '#41616d']
const RECENT_CATEGORY = '__recent__'

function BookCover({ book, index, progress, category, customCover, defaultCover, coversReady, onOpen, onManage, onEditCover, selecting, selected, onToggle, reordering, dragging, dropPosition, onDragStart, onDragOver, onDrop, onDragEnd, onPointerStart, onPointerMove, onPointerUp, onKeyboardMove }) {
  const [cover, setCover] = useState(null)
  useEffect(() => {
    if (!coversReady || customCover || !book.hasCover || book.format !== 'EPUB') {
      setCover(null)
      return undefined
    }
    let cancelled = false
    window.readerAPI.getEpubCover(book.path).then((value) => {
      if (!cancelled) setCover(value)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [book.format, book.hasCover, book.path, coversReady, customCover])

  const displayCover = customCover || cover
  const coverSource = displayCover || defaultCover
  const sizeLabel = Number.isFinite(book.size) && book.size > 0 ? formatBytes(book.size) : book.format

  return (
    <div className={`book-item ${dragging ? 'is-dragging' : ''} ${dropPosition ? `is-drop-${dropPosition}` : ''}`} onContextMenu={(event) => { event.preventDefault(); onManage(book) }} onDragOverCapture={reordering ? (event) => onDragOver(event, book.id) : undefined} onDropCapture={reordering ? (event) => onDrop(event, book.id) : undefined} onPointerMove={reordering ? (event) => onPointerMove(event, book.id) : undefined} onPointerUp={reordering ? (event) => onPointerUp(event, book.id) : undefined}>
      {reordering ? <span className="book-reorder-handle" draggable tabIndex={0} role="button" aria-label={`拖动调整 ${book.title} 的顺序`} title="拖动调整主页陈列顺序" onDragStart={(event) => onDragStart(event, book.id)} onDragEnd={onDragEnd} onPointerDown={(event) => { if (event.pointerType === 'mouse') return; event.preventDefault(); onPointerStart(book.id) }} onKeyDown={(event) => { if (event.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); onKeyboardMove(book.id, ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) } }}><GripVertical size={14} /></span> : null}
      {selecting ? <button className={`book-select ${selected ? 'selected' : ''}`} onClick={() => onToggle(book.id)} aria-label={selected ? `取消选择 ${book.title}` : `选择 ${book.title}`}><Check size={13} /></button> : null}
      <button className="book-open" onClick={() => onOpen(book)}>
        <span className={`book-cover ${coverSource ? 'has-image' : ''} ${!displayCover && defaultCover ? 'is-default' : ''}`} style={{ '--cover': COVER_COLORS[index % COVER_COLORS.length] }}>
          {coverSource ? <img src={coverSource} alt="" /> : <><span className="cover-rule" /><strong>{book.title}</strong><small>{book.format}</small></>}
        </span>
        <span className="book-info">
          <strong title={book.title}>{book.title}</strong>
          <i className="book-info-divider" aria-hidden="true" />
          <small>{book.author || '作者未知'}</small>
          <span>{sizeLabel}</span>
          {progress ? <i className="manager-book-progress" style={{ '--progress': `${Math.round(progress * 100)}%` }}><b>阅读进度</b><em>{Math.round(progress * 100)}%</em></i> : null}
        </span>
      </button>
      <button className="cover-edit" onClick={() => onEditCover(book)} title="设置封面"><ImagePlus size={14} /></button>
      <button className="book-manage" onClick={() => onManage(book)} title="整理书籍"><Tags size={14} /></button>
      {category ? <span className="book-tag">{category}</span> : null}
    </div>
  )
}

function BookManager({ book, categories, selectedCategory, onAssign, onRemove, onDeleteSource, onRelocate, onClose }) {
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="book-manager" role="dialog" aria-modal="true" aria-label="整理书籍">
        <header>
          <div><Tags size={17} /><strong>整理《{book.title}》</strong></div>
          <button onClick={onClose} aria-label="关闭整理窗口"><X size={17} /></button>
        </header>
        <div className="manager-content">
          <label>放入分类</label>
          <div className="category-checklist">
            <button className={!selectedCategory ? 'selected' : ''} onClick={() => onAssign('')}><span>未分类</span>{!selectedCategory ? <Check size={14} /> : null}</button>
            {categories.map((category) => (
              <button key={category} className={selectedCategory === category ? 'selected' : ''} onClick={() => onAssign(category)}>
                <span>{category}</span>{selectedCategory === category ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
          {!categories.length ? <p className="category-tip">请先在书架左侧创建分类，再把这本书放进去。</p> : null}
        </div>
        <footer className={confirmingDelete ? 'confirming-delete' : ''}>
          {confirmingDelete ? (
            <div className="delete-choice">
              <div><strong>要如何删除这本书？</strong><span>删除源文件会将它移入 Windows 回收站。</span></div>
              <div>
                <button onClick={() => { onRemove(); onClose() }}>仅移出书架</button>
                <button className="delete-source" onClick={async () => { if (await onDeleteSource() !== false) onClose() }}>删除源文件</button>
                <button className="cancel-delete" onClick={() => setConfirmingDelete(false)}>取消</button>
              </div>
            </div>
          ) : (
            <>
              <div className="manager-footer-actions"><button onClick={onRelocate}><MapPin size={15} /> 重新定位</button><button className="remove-command" onClick={() => setConfirmingDelete(true)}><Trash2 size={15} /> 删除书籍</button></div>
              <span>删除前会询问是否保留源文件</span>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}

function CategorySidebar({ categories, active, counts, onSelect, onCreate, onDelete, onReorder }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [dragging, setDragging] = useState('')
  const [dropState, setDropState] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  useEffect(() => {
    if (!dragging) return undefined
    const clear = () => { setDragging(''); setDropState(null) }
    window.addEventListener('pointerup', clear)
    window.addEventListener('pointercancel', clear)
    return () => { window.removeEventListener('pointerup', clear); window.removeEventListener('pointercancel', clear) }
  }, [dragging])
  useEffect(() => {
    if (!contextMenu) return undefined
    const close = (event) => { if (!event.target.closest?.('.category-context-menu')) setContextMenu(null) }
    const closeOnEscape = (event) => { if (event.key === 'Escape') setContextMenu(null) }
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [contextMenu])
  const cancelCreate = () => { setName(''); setCreating(false) }
  const submit = () => {
    const value = name.trim().slice(0, 12)
    if (!value) return
    onCreate(value)
    setName('')
    setCreating(false)
  }

  const dragOver = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const horizontal = getComputedStyle(event.currentTarget.parentElement).display === 'flex'
    const before = horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2
    setDropState({ target, position: before ? 'before' : 'after' })
  }

  const drop = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    const source = event.dataTransfer.getData('text/category-name') || event.dataTransfer.getData('text/plain').replace(/^category:/, '') || dragging
    if (source && source !== target) onReorder(source, target, dropState?.target === target ? dropState.position : 'before')
    setDragging('')
    setDropState(null)
  }

  const pointerPosition = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const horizontal = getComputedStyle(event.currentTarget.parentElement).display === 'flex'
    const before = horizontal ? event.clientX < rect.left + rect.width / 2 : event.clientY < rect.top + rect.height / 2
    return before ? 'before' : 'after'
  }

  return (
    <aside className="category-sidebar">
      <div className="category-sidebar-title"><span>书架分类</span><button onClick={() => setCreating(true)} title="新建分类" aria-label="新建分类"><Plus size={14} /></button></div>
      <nav>
        <button className={active === '全部书籍' ? 'active' : ''} onClick={() => onSelect('全部书籍')}><span>全部书籍</span><small>{counts.all}</small></button>
        <button className={active === RECENT_CATEGORY ? 'active' : ''} onClick={() => onSelect(RECENT_CATEGORY)}><span>最近在读</span><small>{counts.recent}</small></button>
        <button className={active === '未读' ? 'active' : ''} onClick={() => onSelect('未读')}><span>未读</span><small>{counts.unread}</small></button>
        {categories.map((category) => (
          <div className={`category-row ${active === category ? 'active' : ''} ${dragging === category ? 'is-dragging' : ''} ${dropState?.target === category ? `is-drop-${dropState.position}` : ''}`} key={category} onContextMenu={(event) => { event.preventDefault(); setContextMenu({ category, x: event.clientX, y: event.clientY }) }} onDragOverCapture={(event) => dragOver(event, category)} onDropCapture={(event) => drop(event, category)} onPointerMove={(event) => { if (dragging) setDropState({ target: category, position: pointerPosition(event) }) }} onPointerUp={(event) => { if (dragging) onReorder(dragging, category, pointerPosition(event)); setDragging(''); setDropState(null) }}>
            <span className="category-drag-handle" tabIndex={0} role="button" aria-label={`拖动调整分类 ${category} 的顺序`} title="拖动调整书架顺序" onPointerDown={(event) => { event.preventDefault(); setDragging(category) }} onKeyDown={(event) => { if (!event.altKey || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); const index = categories.indexOf(category); const delta = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1; const target = categories[index + delta]; if (target) onReorder(category, target, delta < 0 ? 'before' : 'after') }}><GripVertical size={12} /></span>
            <button onClick={() => onSelect(category)}><span>{category}</span><small>{counts[category] || 0}</small></button>
          </div>
        ))}
        {creating ? (
          <div className="category-create-inline">
            <input autoFocus value={name} maxLength={12} aria-label="新分类名称" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); if (event.key === 'Escape') cancelCreate() }} />
            <button onClick={cancelCreate} title="取消" aria-label="取消新建分类"><X size={14} /></button>
            <button onClick={submit} disabled={!name.trim()} title="确认" aria-label="确认新建分类"><Check size={14} /></button>
          </div>
        ) : null}
      </nav>
      {contextMenu ? <div className="category-context-menu" role="menu" style={{ left: contextMenu.x, top: contextMenu.y }}><button role="menuitem" onClick={() => { onDelete(contextMenu.category); setContextMenu(null) }}><Trash2 size={13} />删除分类</button></div> : null}
    </aside>
  )
}

function LibraryBottomDock({ onOpenVirtualHome, onAddBooks, onToggleTheme, onNotes, onOpenAppearance }) {
  const action = ({ id, label, icon, onClick }) => <button key={id} onClick={onClick} title={label} aria-label={label}><span className="v-dock-icon" style={{ '--dock-icon': `url("${icon}")` }} aria-hidden="true" /></button>
  return (
    <nav className="v-bottom-dock library-bottom-dock" aria-label="管理视图功能">
      <div className="v-dock-side is-left">{[
        { id: 'spines', label: '书脊视图', icon: libraryDockIcon, onClick: onOpenVirtualHome },
        { id: 'import', label: '导入书籍', icon: importDockIcon, onClick: onAddBooks },
      ].map(action)}</div>
      <button className="is-theme-toggle" onClick={onToggleTheme} title="切换深浅主题" aria-label="切换深浅主题"><span className="v-theme-moon-mark"><MoonStar /></span></button>
      <div className="v-dock-side is-right">{[
        { id: 'notes', label: '阅读笔记', icon: notesDockIcon, onClick: onNotes },
        { id: 'appearance', label: '主题与背景', icon: appearanceDockIcon, onClick: onOpenAppearance },
      ].map(action)}</div>
    </nav>
  )
}

export default function Bookshelf({ books, directory, progressMap, loading, tagsMap, setTagsMap, categories, setCategories, notesMap, lastBookId, onOpenNote, onChooseDirectory, onAddBooks, onRefresh, onOpen, onRemove, onDeleteSource, onRelocate, coversMap, setCoversMap, coversReady, onExportData, onImportData, statusMap, setStatusMap, onUpdateNote, onExportNotes, bookMetadata, shortcuts, setShortcuts, defaultCover, initialView = 'shelf', onViewChange, onOpenVirtualHome, onOpenAppearance, onToggleTheme, appearanceTheme, scrollMemory, onClearReadingData, recentBookIds = [], categoryBookOrder = {}, setCategoryBookOrder, navigationTarget, onReorderCategories }) {
  const [view, setView] = useState(initialView)
  const rootRef = useRef(null)

  // 管理视图与书脊视图是同一主页的两种形态，来回切换时恢复各自滚动位置。
  // 桌面宽窗滚动容器是 .shelf-workspace，窄窗（≤680px）是 .shelf-view 根节点。
  // 用 useLayoutEffect：清理函数在节点被移除前执行，能读到真实 scrollTop；
  // 被动 useEffect 的清理在移除后异步执行，读回恒为 0。
  useLayoutEffect(() => {
    const root = rootRef.current
    if (!root || !scrollMemory) return undefined
    const workspace = root.querySelector('.shelf-workspace')
    const node = workspace && getComputedStyle(workspace).overflowY !== 'visible' ? workspace : root
    node.scrollTop = scrollMemory.library || 0
    const frame = requestAnimationFrame(() => { node.scrollTop = scrollMemory.library || 0 })
    const save = () => { scrollMemory.library = node.scrollTop }
    node.addEventListener('scroll', save, { passive: true })
    return () => { cancelAnimationFrame(frame); save(); node.removeEventListener('scroll', save) }
  }, [scrollMemory])
  const [activeCategory, setActiveCategory] = useState('全部书籍')
  const [managedBook, setManagedBook] = useState(null)
  const [coverBook, setCoverBook] = useState(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('custom')
  const [layout, setLayout] = useState('grid')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [draggingBook, setDraggingBook] = useState('')
  const [bookDropState, setBookDropState] = useState(null)
  useEffect(() => {
    if (!draggingBook) return undefined
    const clear = () => { setDraggingBook(''); setBookDropState(null) }
    window.addEventListener('pointerup', clear)
    window.addEventListener('pointercancel', clear)
    return () => { window.removeEventListener('pointerup', clear); window.removeEventListener('pointercancel', clear) }
  }, [draggingBook])
  const lastBook = books.find((book) => book.id === lastBookId)
  const changeView = (next) => { setView(next); onViewChange?.(next) }
  useEffect(() => { setView(initialView) }, [initialView])
  useEffect(() => {
    if (!navigationTarget) return
    setView('shelf')
    if (navigationTarget.kind === 'recent') {
      setActiveCategory(RECENT_CATEGORY)
      setSortBy('recent')
      setStatusFilter('all')
    } else if (navigationTarget.kind === 'unread') {
      setActiveCategory('未读')
      setSortBy('recent')
      setStatusFilter('all')
    } else if (navigationTarget.kind === 'category' && categories.includes(navigationTarget.category)) {
      setActiveCategory(navigationTarget.category)
      setSortBy('custom')
      setStatusFilter('all')
    } else {
      setActiveCategory('全部书籍')
      setSortBy('custom')
      setStatusFilter('all')
    }
  }, [navigationTarget])

  const recentSet = new Set(recentBookIds)
  const recentRank = new Map(recentBookIds.map((id, index) => [id, index]))

  const counts = books.reduce((result, book) => {
    const category = tagsMap[book.id]?.[0]
    const status = statusMap[book.id] || (progressMap[book.id]?.percent > 0 ? 'reading' : 'unread')
    result.all += 1
    if (status === 'unread') result.unread += 1
    if (category) result[category] = (result[category] || 0) + 1
    else result.uncategorized += 1
    return result
  }, { all: 0, recent: recentBookIds.filter((id) => books.some((book) => book.id === id)).length, unread: 0, uncategorized: 0 })

  const isCustomCategory = categories.includes(activeCategory)
  const isAllBooks = activeCategory === '全部书籍'
  const isReorderableCategory = isAllBooks || isCustomCategory
  const bookOrderKey = isAllBooks ? ALL_BOOKS_ORDER_KEY : activeCategory
  const filteredBooks = books.filter((book) => {
    const category = tagsMap[book.id]?.[0]
    const status = statusMap[book.id] || (progressMap[book.id]?.percent > 0 ? 'reading' : 'unread')
    const matchesCategory = activeCategory === '全部书籍' || (activeCategory === RECENT_CATEGORY ? recentSet.has(book.id) : activeCategory === '未读' ? status === 'unread' : category === activeCategory)
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    const matchesQuery = !needle || `${book.title} ${book.author || ''} ${book.path}`.toLocaleLowerCase('zh-CN').includes(needle)
    return matchesCategory && matchesQuery && (statusFilter === 'all' || status === statusFilter)
  })
  const visibleBooks = (sortBy === 'custom' && isReorderableCategory
    ? (isAllBooks ? orderBooksWithNewFirst(filteredBooks, categoryBookOrder[bookOrderKey]) : orderBooksByIds(filteredBooks, categoryBookOrder[bookOrderKey]))
    : [...filteredBooks]).sort((a, b) => {
    if (sortBy === 'custom' && isReorderableCategory) return 0
    if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-CN')
    if (sortBy === 'progress') return (progressMap[b.id]?.percent || 0) - (progressMap[a.id]?.percent || 0)
    if (sortBy === 'modified') return b.modifiedAt - a.modifiedAt
    if (activeCategory === RECENT_CATEGORY) return (recentRank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (recentRank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    return (progressMap[b.id]?.updatedAt || b.modifiedAt) - (progressMap[a.id]?.updatedAt || a.modifiedAt)
  })

  const createCategory = (category) => {
    setCategories((current) => current.includes(category) ? current : [...current, category])
  }

  const deleteCategory = (category) => {
    setCategories((current) => current.filter((item) => item !== category))
    setTagsMap((current) => Object.fromEntries(Object.entries(current).map(([id, values]) => [id, values.filter((item) => item !== category)])))
    setCategoryBookOrder?.((current) => { if (!(category in current)) return current; const next = { ...current }; delete next[category]; return next })
    if (activeCategory === category) setActiveCategory('全部书籍')
  }

  const selectCategory = (category) => {
    setActiveCategory(category)
    setSortBy(category === '全部书籍' || categories.includes(category) ? 'custom' : 'recent')
  }

  const refreshDirectory = () => {
    setActiveCategory('全部书籍')
    setSortBy('custom')
    setStatusFilter('all')
    setQuery('')
    onRefresh?.()
  }

  const assignCategory = (category) => setTagsMap((current) => ({ ...current, [managedBook.id]: category ? [category] : [] }))
  const toggleSelected = (id) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const selectedBooks = books.filter((book) => selectedIds.includes(book.id))
  const setSelectedStatus = (status) => setStatusMap((current) => ({ ...current, ...Object.fromEntries(selectedIds.map((id) => [id, status])) }))
  const removeSelected = () => {
    selectedBooks.forEach(onRemove)
    setSelectedIds([])
    setSelecting(false)
  }

  const reorderBook = (source, target, position) => {
    if (!isReorderableCategory || source === target) return
    const members = isAllBooks ? books : books.filter((book) => tagsMap[book.id]?.[0] === activeCategory)
    const completeOrder = (isAllBooks
      ? orderBooksWithNewFirst(members, categoryBookOrder[bookOrderKey])
      : orderBooksByIds(members, categoryBookOrder[bookOrderKey])).map((book) => book.id)
    const next = moveBeforeOrAfter(completeOrder, source, target, position)
    setCategoryBookOrder?.((current) => ({ ...current, [bookOrderKey]: next }))
    setSortBy('custom')
  }

  const handleBookDragOver = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const before = layout === 'list' ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2
    setBookDropState({ target, position: before ? 'before' : 'after' })
  }

  const handleBookPointerMove = (event, target) => {
    if (!draggingBook) return
    const rect = event.currentTarget.getBoundingClientRect()
    const before = layout === 'list' ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2
    setBookDropState({ target, position: before ? 'before' : 'after' })
  }

  const handleBookPointerUp = (event, target) => {
    if (!draggingBook) return
    const rect = event.currentTarget.getBoundingClientRect()
    const before = layout === 'list' ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2
    reorderBook(draggingBook, target, before ? 'before' : 'after')
    setDraggingBook('')
    setBookDropState(null)
  }

  const handleBookDrop = (event, target) => {
    event.preventDefault()
    event.stopPropagation()
    const source = event.dataTransfer.getData('text/book-id') || event.dataTransfer.getData('text/plain').replace(/^book:/, '') || draggingBook
    const rect = event.currentTarget.getBoundingClientRect()
    const before = layout === 'list' ? event.clientY < rect.top + rect.height / 2 : event.clientX < rect.left + rect.width / 2
    if (source) reorderBook(source, target, before ? 'before' : 'after')
    setDraggingBook('')
    setBookDropState(null)
  }

  const moveBookByKeyboard = (source, delta) => {
    const index = visibleBooks.findIndex((book) => book.id === source)
    const target = visibleBooks[index + delta]
    if (target) reorderBook(source, target.id, delta < 0 ? 'before' : 'after')
  }

  return (
    <main className={`shelf-view library-design-view is-${view}`} ref={rootRef}>
      <section className="shelf-workspace">
      <header className="library-design-header">
        <h1>{view === 'notes' ? '阅读笔记' : '管理视图'}</h1>
        <div className="library-head-actions">
          {view === 'shelf' && directory ? <button className={`is-refresh ${loading ? 'is-loading' : ''}`} onClick={refreshDirectory} disabled={loading} title="刷新书籍目录" aria-label={loading ? '正在刷新书籍目录' : '刷新书籍目录'}><RefreshCw size={17} /></button> : null}
          {view === 'shelf' ? <button className={`is-trash ${selecting ? 'active' : ''}`} onClick={() => { setSelecting((current) => !current); setSelectedIds([]) }} title="批量管理书籍" aria-label="批量管理书籍"><img src={managerTrashIcon} alt="" /></button> : null}
          <button className="is-ai" onClick={() => setAiSettingsOpen(true)} title="AI 设置" aria-label="AI 设置"><img src={managerAiIcon} alt="" /></button>
          <button className="is-directory" onClick={onChooseDirectory} title={directory ? '更换书籍目录' : '导入书籍目录'} aria-label={directory ? '更换书籍目录' : '导入书籍目录'}><img src={managerDirectoryIcon} alt="" /></button>
          <label className="library-design-search"><img src={searchIcon} alt="" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={view === 'notes' ? '搜索相关书籍' : '搜索书名、作者或路径'} /></label>
        </div>
      </header>
      <AISettingsModal open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      {shortcutsOpen ? <ShortcutsModal shortcuts={shortcuts} setShortcuts={setShortcuts} onClose={() => setShortcutsOpen(false)} /> : null}

      {view === 'shelf' && lastBook ? (
        <button className="continue-reading" onClick={() => onOpen(lastBook)}>
          <strong>继续阅读　《{lastBook.title}》</strong>
          <span className="continue-bar" aria-hidden="true"><i style={{ width: `${Math.round((progressMap[lastBook.id]?.percent || 0) * 100)}%` }} /></span>
          <em>{Math.round((progressMap[lastBook.id]?.percent || 0) * 100)}%</em>
        </button>
      ) : null}

      {view === 'notes' ? <NotesLibrary books={books} bookMetadata={bookMetadata} notesMap={notesMap} appearanceTheme={appearanceTheme} onOpenNote={onOpenNote} onUpdateNote={onUpdateNote} onExportNotes={onExportNotes} /> : books.length ? (
        <div className="library-catalog">
          <CategorySidebar categories={categories} active={activeCategory} counts={counts} onSelect={selectCategory} onCreate={createCategory} onDelete={deleteCategory} onReorder={onReorderCategories} />
          <section className="category-books">
            <div className="category-heading"><img src={managerChevronsIcon} alt="" /><strong>{visibleBooks.length}</strong><span>本</span></div>
            {selecting ? <div className="batch-bar"><span>已选 {selectedIds.length} 本</span><button onClick={() => setSelectedIds(visibleBooks.map((book) => book.id))}>全选当前结果</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('unread')}>设为未读</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('reading')}>设为阅读中</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('finished')}>设为已读完</button><button className="danger" disabled={!selectedIds.length} onClick={removeSelected}>移出书架</button></div> : null}
            {visibleBooks.length ? (
              <div className="book-grid is-grid">
                {visibleBooks.map((book, index) => <BookCover key={book.id} book={book} index={index} category={tagsMap[book.id]?.[0]} progress={progressMap[book.id]?.percent} customCover={coversMap[book.id]} defaultCover={defaultCover} coversReady={coversReady} onOpen={selecting ? () => toggleSelected(book.id) : onOpen} onManage={setManagedBook} onEditCover={setCoverBook} selecting={selecting} selected={selectedIds.includes(book.id)} onToggle={toggleSelected} reordering={!selecting && sortBy === 'custom' && isReorderableCategory} dragging={draggingBook === book.id} dropPosition={bookDropState?.target === book.id ? bookDropState.position : ''} onDragStart={(event, id) => { event.dataTransfer.setData('text/book-id', id); event.dataTransfer.setData('text/plain', `book:${id}`); event.dataTransfer.effectAllowed = 'move'; setDraggingBook(id) }} onDragOver={handleBookDragOver} onDrop={handleBookDrop} onDragEnd={() => { setDraggingBook(''); setBookDropState(null) }} onPointerStart={setDraggingBook} onPointerMove={handleBookPointerMove} onPointerUp={handleBookPointerUp} onKeyboardMove={moveBookByKeyboard} />)}
              </div>
            ) : <div className="empty-filter">这个分类里还没有书</div>}
          </section>
        </div>
      ) : (
        <div className="empty-shelf"><strong>{loading ? '正在整理书架...' : '书架还是空的'}</strong><button onClick={onAddBooks}>导入书籍</button></div>
      )}
      </section>

      <LibraryBottomDock onOpenVirtualHome={onOpenVirtualHome} onAddBooks={onAddBooks} onToggleTheme={onToggleTheme} onNotes={() => changeView('notes')} onOpenAppearance={onOpenAppearance} />

      {managedBook ? <BookManager book={managedBook} categories={categories} selectedCategory={tagsMap[managedBook.id]?.[0] || ''} onAssign={assignCategory} onRemove={() => onRemove(managedBook)} onDeleteSource={() => onDeleteSource(managedBook)} onRelocate={async () => { if (await onRelocate(managedBook)) setManagedBook(null) }} onClose={() => setManagedBook(null)} /> : null}
      {coverBook ? (
        <CoverEditor
          book={coverBook}
          existing={coversMap[coverBook.id]}
          onSave={(dataUrl) => { setCoversMap((current) => ({ ...current, [coverBook.id]: dataUrl })); setCoverBook(null) }}
          onReset={() => { setCoversMap((current) => { const next = { ...current }; delete next[coverBook.id]; return next }); setCoverBook(null) }}
          onClose={() => setCoverBook(null)}
        />
      ) : null}
    </main>
  )
}
