import { useEffect, useState } from 'react'
import { BookOpenText, Check, DatabaseBackup, FileInput, FolderOpen, ImagePlus, Library, ListChecks, MapPin, NotebookPen, Plus, RefreshCw, Search, Tags, Trash2, X } from 'lucide-react'
import { formatBytes } from '../hooks'
import CoverEditor from './CoverEditor'
import NotesLibrary from './NotesLibrary'

const COVER_COLORS = ['#315c57', '#935746', '#354d6b', '#786844', '#624c63', '#41616d']

function BookCover({ book, index, progress, category, customCover, coversReady, onOpen, onManage, onEditCover, selecting, selected, onToggle }) {
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

  return (
    <div className="book-item">
      {selecting ? <button className={`book-select ${selected ? 'selected' : ''}`} onClick={() => onToggle(book.id)} aria-label={selected ? `取消选择 ${book.title}` : `选择 ${book.title}`}><Check size={13} /></button> : null}
      <button className="book-open" onClick={() => onOpen(book)}>
        <span className={`book-cover ${displayCover ? 'has-image' : ''}`} style={{ '--cover': COVER_COLORS[index % COVER_COLORS.length] }}>
          {displayCover ? <img src={displayCover} alt="" /> : <><span className="cover-rule" /><strong>{book.title}</strong><small>{book.format}</small></>}
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
        <button className={active === '未分类' ? 'active' : ''} onClick={() => onSelect('未分类')}><span>未分类</span><small>{counts.uncategorized}</small></button>
        {categories.map((category) => (
          <div className={`category-row ${active === category ? 'active' : ''}`} key={category}>
            <button onClick={() => onSelect(category)}><span>{category}</span><small>{counts[category] || 0}</small></button>
            <button className="delete-category" onClick={() => onDelete(category)} title={`删除分类 ${category}`}><X size={12} /></button>
          </div>
        ))}
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

export default function Bookshelf({ books, directory, progressMap, loading, tagsMap, setTagsMap, categories, setCategories, notesMap, lastBookId, onOpenNote, onChooseDirectory, onAddBooks, onRefresh, onOpen, onRemove, onDeleteSource, onRelocate, coversMap, setCoversMap, coversReady, onExportData, onImportData, statusMap, setStatusMap, onUpdateNote, onExportNotes, bookMetadata }) {
  const [view, setView] = useState('shelf')
  const [activeCategory, setActiveCategory] = useState('全部书籍')
  const [managedBook, setManagedBook] = useState(null)
  const [coverBook, setCoverBook] = useState(null)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = useState('recent')
  const [statusFilter, setStatusFilter] = useState('all')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState([])
  const lastBook = books.find((book) => book.id === lastBookId)

  const counts = books.reduce((result, book) => {
    const category = tagsMap[book.id]?.[0]
    result.all += 1
    if (category) result[category] = (result[category] || 0) + 1
    else result.uncategorized += 1
    return result
  }, { all: 0, uncategorized: 0 })

  const visibleBooks = books.filter((book) => {
    const category = tagsMap[book.id]?.[0]
    const status = statusMap[book.id] || (progressMap[book.id]?.percent > 0 ? 'reading' : 'unread')
    const matchesCategory = activeCategory === '全部书籍' || (activeCategory === '未分类' ? !category : category === activeCategory)
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
    <main className="shelf-view">
      <div className="shelf-heading">
        <div>
          <div className="section-mark"><Library size={16} /> 本地书架</div>
          <h1>{view === 'notes' ? `${Object.values(notesMap).flat().length} 条句子，值得留下` : books.length ? `${books.length} 本书，慢慢读` : '把书放进来'}</h1>
          <p>{directory || '选择一个包含 TXT 或 EPUB 的文件夹，也可以单独添加书籍'}</p>
        </div>
        <div className="shelf-actions">
          <button className="icon-command" onClick={onImportData} title="导入阅读数据" aria-label="导入阅读数据"><FileInput size={16} /></button>
          <button className="icon-command" onClick={onExportData} title="导出阅读数据" aria-label="导出阅读数据"><DatabaseBackup size={16} /></button>
          {directory ? <button className="icon-command" onClick={onRefresh} disabled={loading} title="刷新书架"><RefreshCw size={17} className={loading ? 'spinning' : ''} /></button> : null}
          <button className="secondary-command" onClick={onAddBooks}><Plus size={17} /> 添加书籍</button>
          <button className="primary-command" onClick={onChooseDirectory}><FolderOpen size={17} /> {directory ? '更换目录' : '选择目录'}</button>
        </div>
      </div>

      <nav className="library-tabs" aria-label="书架页面">
        <button className={view === 'shelf' ? 'active' : ''} onClick={() => setView('shelf')}><Library size={15} /> 书架</button>
        <button className={view === 'notes' ? 'active' : ''} onClick={() => setView('notes')}><NotebookPen size={15} /> 笔记</button>
      </nav>

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
              <button className={selecting ? 'active' : ''} onClick={() => { setSelecting((current) => !current); setSelectedIds([]) }}><ListChecks size={15} /> 批量</button>
            </div>
            {selecting ? <div className="batch-bar"><span>已选 {selectedIds.length} 本</span><button onClick={() => setSelectedIds(visibleBooks.map((book) => book.id))}>全选当前结果</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('unread')}>设为未读</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('reading')}>设为阅读中</button><button disabled={!selectedIds.length} onClick={() => setSelectedStatus('finished')}>设为已读完</button><button className="danger" disabled={!selectedIds.length} onClick={removeSelected}>移出书架</button></div> : null}
            {visibleBooks.length ? (
              <div className="book-grid">
                {visibleBooks.map((book, index) => <BookCover key={book.id} book={book} index={index} category={tagsMap[book.id]?.[0]} progress={progressMap[book.id]?.percent} customCover={coversMap[book.id]} coversReady={coversReady} onOpen={selecting ? () => toggleSelected(book.id) : onOpen} onManage={setManagedBook} onEditCover={setCoverBook} selecting={selecting} selected={selectedIds.includes(book.id)} onToggle={toggleSelected} />)}
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
