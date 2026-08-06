import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { BookOpenText, Check, DatabaseBackup, Eraser, FileInput, FolderOpen, Grid2X2, ImagePlus, Keyboard, Library, List, ListChecks, MapPin, NotebookPen, Plus, RefreshCw, Rows3, Search, ServerCog, Tags, Trash2, X } from 'lucide-react'
import { formatBytes } from '../hooks'
import CoverEditor from './CoverEditor'
import NotesLibrary from './NotesLibrary'
import AISettingsModal from './AISettingsModal'
import ShortcutsModal from './ShortcutsModal'

const COVER_COLORS = ['#315c57', '#935746', '#354d6b', '#786844', '#624c63', '#41616d']

function BookCover({ book, index, progress, category, customCover, defaultCover, coversReady, onOpen, onManage, onEditCover, selecting, selected, onToggle }) {
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

  return (
    <div className="book-item" onContextMenu={(event) => { event.preventDefault(); onManage(book) }}>
      {selecting ? <button className={`book-select ${selected ? 'selected' : ''}`} onClick={() => onToggle(book.id)} aria-label={selected ? `取消选择 ${book.title}` : `选择 ${book.title}`}><Check size={13} /></button> : null}
      <button className="book-open" onClick={() => onOpen(book)}>
        <span className={`book-cover ${coverSource ? 'has-image' : ''} ${!displayCover && defaultCover ? 'is-default' : ''}`} style={{ '--cover': COVER_COLORS[index % COVER_COLORS.length] }}>
          {coverSource ? <><img src={coverSource} alt="" />{!displayCover && defaultCover ? <span className="default-cover-copy"><strong>{book.title}</strong><small>{book.format}</small></span> : null}</> : <><span className="cover-rule" /><strong>{book.title}</strong><small>{book.format}</small></>}
        </span>
        <span className="book-info">
          <strong title={book.title}>{book.title}</strong>
          <span>{progress ? `已读 ${Math.round(progress * 100)}%` : formatBytes(book.size)}</span>
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

function CategorySidebar({ categories, active, counts, onSelect, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const submit = () => {
    const value = name.trim().slice(0, 12)
    if (!value) return
    onCreate(value)
    setName('')
    setCreating(false)
  }

  return (
    <aside className="category-sidebar">
      <div className="category-sidebar-title"><span>书架分类</span><button onClick={() => setCreating(true)} title="新建分类"><Plus size={14} /></button></div>
      <nav>
        <button className={active === '全部书籍' ? 'active' : ''} onClick={() => onSelect('全部书籍')}><span>全部书籍</span><small>{counts.all}</small></button>
        <button className={active === '正在阅读' ? 'active' : ''} onClick={() => onSelect('正在阅读')}><span>正在阅读</span><small>{counts.reading}</small></button>
        <button className={active === '已读完' ? 'active' : ''} onClick={() => onSelect('已读完')}><span>已读完</span><small>{counts.finished}</small></button>
        <button className={active === '未分类' ? 'active' : ''} onClick={() => onSelect('未分类')}><span>未分类</span><small>{counts.uncategorized}</small></button>
        {categories.map((category) => (
          <div className={`category-row ${active === category ? 'active' : ''}`} key={category}>
            <button onClick={() => onSelect(category)}><span>{category}</span><small>{counts[category] || 0}</small></button>
            <button className="delete-category" onClick={() => onDelete(category)} title={`删除分类 ${category}`}><X size={12} /></button>
          </div>
        ))}
        {/* 窄窗下侧栏标题（含新建按钮）被隐藏，在筛选行末尾补一个内联新建入口 */}
        <button className="category-add-inline" onClick={() => setCreating(true)} title="新建分类" aria-label="新建分类"><Plus size={14} /></button>
      </nav>
      {creating ? (
        <div className="category-create">
          <input autoFocus value={name} maxLength={12} placeholder="如：女频" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); if (event.key === 'Escape') setCreating(false) }} />
          <button onClick={submit} aria-label="确认新建分类"><Check size={14} /></button>
        </div>
      ) : null}
    </aside>
  )
}

export default function Bookshelf({ books, directory, progressMap, loading, tagsMap, setTagsMap, categories, setCategories, notesMap, lastBookId, onOpenNote, onChooseDirectory, onAddBooks, onRefresh, onOpen, onRemove, onDeleteSource, onRelocate, coversMap, setCoversMap, coversReady, onExportData, onImportData, statusMap, setStatusMap, onUpdateNote, onExportNotes, bookMetadata, shortcuts, setShortcuts, defaultCover, initialView = 'shelf', onViewChange, onOpenVirtualHome, scrollMemory, onClearReadingData }) {
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
  const [sortBy, setSortBy] = useState('recent')
  const [layout, setLayout] = useState('grid')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const lastBook = books.find((book) => book.id === lastBookId)
  const changeView = (next) => { setView(next); onViewChange?.(next) }
  useEffect(() => { setView(initialView) }, [initialView])

  const counts = books.reduce((result, book) => {
    const category = tagsMap[book.id]?.[0]
    const status = statusMap[book.id] || (progressMap[book.id]?.percent > 0 ? 'reading' : 'unread')
    result.all += 1
    if (status === 'reading') result.reading += 1
    if (status === 'finished') result.finished += 1
    if (category) result[category] = (result[category] || 0) + 1
    else result.uncategorized += 1
    return result
  }, { all: 0, reading: 0, finished: 0, uncategorized: 0 })

  const visibleBooks = books.filter((book) => {
    const category = tagsMap[book.id]?.[0]
    const status = statusMap[book.id] || (progressMap[book.id]?.percent > 0 ? 'reading' : 'unread')
    const matchesCategory = activeCategory === '全部书籍' || (activeCategory === '正在阅读' ? status === 'reading' : activeCategory === '已读完' ? status === 'finished' : activeCategory === '未分类' ? !category : category === activeCategory)
    const needle = query.trim().toLocaleLowerCase('zh-CN')
    const matchesQuery = !needle || `${book.title} ${book.author || ''} ${book.path}`.toLocaleLowerCase('zh-CN').includes(needle)
    return matchesCategory && matchesQuery && (statusFilter === 'all' || status === statusFilter)
  }).sort((a, b) => {
    if (sortBy === 'title') return a.title.localeCompare(b.title, 'zh-CN')
    if (sortBy === 'progress') return (progressMap[b.id]?.percent || 0) - (progressMap[a.id]?.percent || 0)
    if (sortBy === 'modified') return b.modifiedAt - a.modifiedAt
    return (progressMap[b.id]?.updatedAt || b.modifiedAt) - (progressMap[a.id]?.updatedAt || a.modifiedAt)
  })

  const createCategory = (category) => {
    setCategories((current) => current.includes(category) ? current : [...current, category])
  }

  const deleteCategory = (category) => {
    setCategories((current) => current.filter((item) => item !== category))
    setTagsMap((current) => Object.fromEntries(Object.entries(current).map(([id, values]) => [id, values.filter((item) => item !== category)])))
    if (activeCategory === category) setActiveCategory('全部书籍')
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

  return (
    <main className="shelf-view" ref={rootRef}>
      <div className="shelf-nav-edge" aria-hidden="true" />
      <aside className="app-navigation" aria-label="主导航">
        <div className="app-navigation-label">工作区</div>
        <button className={view === 'shelf' ? 'active' : ''} onClick={() => changeView('shelf')}><Library size={18} /><span>书架</span><small>{books.length}</small></button>
        <button className={view === 'notes' ? 'active' : ''} onClick={() => changeView('notes')}><NotebookPen size={18} /><span>笔记</span><small>{Object.values(notesMap).flat().length}</small></button>
        <div className="app-navigation-separator" />
        <button onClick={() => setAiSettingsOpen(true)}><ServerCog size={18} /><span>AI 服务</span></button>
        <button onClick={() => setShortcutsOpen(true)}><Keyboard size={18} /><span>快捷键</span></button>
        <div className="app-navigation-foot"><span>本地阅读</span><small>数据仅保存在此电脑</small></div>
      </aside>
      <section className="shelf-workspace">
      <div className="shelf-heading">
        <div>
          <div className="section-mark"><Library size={15} /> {view === 'notes' ? '阅读资料' : `${books.length} 本书 · ${counts.reading} 本正在阅读`}</div>
          <h1>{view === 'notes' ? '阅读笔记' : '本地书架'}</h1>
          <p>{directory || '选择一个包含 TXT 或 EPUB 的文件夹，也可以单独添加书籍'}</p>
        </div>
        <div className="shelf-actions">
          <button className="secondary-command shelf-book-command" onClick={onOpenVirtualHome} title="书脊视图" aria-label="切换到书脊视图"><Rows3 size={16} /><span className="command-label">书脊视图</span></button>
          <button className="icon-command" onClick={() => setAiSettingsOpen(true)} title="AI 设置" aria-label="AI 设置"><ServerCog size={16} /></button>
          <button className="icon-command" onClick={() => setShortcutsOpen(true)} title="快捷键" aria-label="快捷键"><Keyboard size={16} /></button>
          <button className="icon-command" onClick={onImportData} title="导入阅读数据" aria-label="导入阅读数据"><FileInput size={16} /></button>
          <button className="icon-command" onClick={onExportData} title="导出阅读数据" aria-label="导出阅读数据"><DatabaseBackup size={16} /></button>
          {directory ? <button className="icon-command" onClick={onRefresh} disabled={loading} title="刷新书架"><RefreshCw size={17} className={loading ? 'spinning' : ''} /></button> : null}
          <button className="secondary-command shelf-book-command" onClick={onChooseDirectory} title={directory ? '更换目录' : '选择目录'} aria-label={directory ? '更换目录' : '选择目录'}><FolderOpen size={17} /><span className="command-label">{directory ? '更换目录' : '选择目录'}</span></button>
          <button className="primary-command shelf-book-command" onClick={onAddBooks} title="导入书籍" aria-label="导入书籍"><Plus size={17} /><span className="command-label">导入书籍</span></button>
          <button className="secondary-command shelf-book-command shelf-danger-command" onClick={onClearReadingData} title="清空阅读进度、笔记与书签（书籍保留）" aria-label="清理阅读数据"><Eraser size={16} /><span className="command-label">清理数据</span></button>
        </div>
      </div>
      <AISettingsModal open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} />
      {shortcutsOpen ? <ShortcutsModal shortcuts={shortcuts} setShortcuts={setShortcuts} onClose={() => setShortcutsOpen(false)} /> : null}

      {view === 'shelf' && lastBook ? (
        <button className="continue-reading" onClick={() => onOpen(lastBook)}>
          <span>继续阅读</span>
          <strong>{lastBook.title}</strong>
          <span className="continue-bar" aria-hidden="true"><i style={{ width: `${Math.round((progressMap[lastBook.id]?.percent || 0) * 100)}%` }} /></span>
          <em>{Math.round((progressMap[lastBook.id]?.percent || 0) * 100)}%</em>
        </button>
      ) : null}

      {view === 'notes' ? <NotesLibrary books={books} bookMetadata={bookMetadata} notesMap={notesMap} onOpenNote={onOpenNote} onUpdateNote={onUpdateNote} onExportNotes={onExportNotes} /> : books.length ? (
        <div className="shelf-layout">
          <CategorySidebar categories={categories} active={activeCategory} counts={counts} onSelect={setActiveCategory} onCreate={createCategory} onDelete={deleteCategory} />
          <section className="category-books">
            <div className="category-heading"><strong>{activeCategory}</strong><span>{visibleBooks.length} 本</span></div>
            <div className="shelf-tools">
              <label className="shelf-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索书名、作者或路径" /></label>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="阅读状态"><option value="all">全部状态</option><option value="unread">未读</option><option value="reading">阅读中</option><option value="finished">已读完</option></select>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)} aria-label="排序方式"><option value="recent">最近阅读</option><option value="title">书名</option><option value="progress">阅读进度</option><option value="modified">文件时间</option></select>
              <div className="layout-segment" aria-label="书籍布局"><button className={layout === 'grid' ? 'active' : ''} onClick={() => setLayout('grid')} title="网格视图" aria-label="网格视图"><Grid2X2 size={14} /></button><button className={layout === 'list' ? 'active' : ''} onClick={() => setLayout('list')} title="列表视图" aria-label="列表视图"><List size={15} /></button></div>
              <button className={selecting ? 'active' : ''} onClick={() => { setSelecting((current) => !current); setSelectedIds([]) }}><ListChecks size={15} /> 批量</button>
            </div>
            {selecting ? <div className="batch-bar"><span>已选 {selectedIds.length} 本</span><button onClick={() => setSelectedIds(visibleBooks.map((book) => book.id))}>全选当前结果</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('unread')}>设为未读</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('reading')}>设为阅读中</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('finished')}>设为已读完</button><button className="danger" disabled={!selectedIds.length} onClick={removeSelected}>移出书架</button></div> : null}
            {visibleBooks.length ? (
              <div className={`book-grid is-${layout}`}>
                {visibleBooks.map((book, index) => <BookCover key={book.id} book={book} index={index} category={tagsMap[book.id]?.[0]} progress={progressMap[book.id]?.percent} customCover={coversMap[book.id]} defaultCover={defaultCover} coversReady={coversReady} onOpen={selecting ? () => toggleSelected(book.id) : onOpen} onManage={setManagedBook} onEditCover={setCoverBook} selecting={selecting} selected={selectedIds.includes(book.id)} onToggle={toggleSelected} />)}
              </div>
            ) : <div className="empty-filter">这个分类里还没有书</div>}
          </section>
        </div>
      ) : (
        <button className="empty-shelf" onClick={onAddBooks}>
          <span className="empty-icon"><BookOpenText size={31} strokeWidth={1.4} /></span>
          <strong>{loading ? '正在整理书架...' : '添加你的第一本书'}</strong>
          <span>支持 TXT 与 EPUB，也可以直接选择整个文件夹</span>
        </button>
      )}
      </section>

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
