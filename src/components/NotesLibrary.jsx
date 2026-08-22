import { useMemo, useState } from 'react'
import { ArrowUpRight, Bookmark, Download, LayoutGrid, List, Plus, Share2, Tag, X } from 'lucide-react'
import ShareNoteModal from './ShareNoteModal'
import CollectNoteModal from './CollectNoteModal'
import AddCustomNoteModal from './AddCustomNoteModal'
import NoteDetailModal from './NoteDetailModal'
import TagEditor from './TagEditor'
import { excerptWindow, normalizeHighlights, segmentByHighlights } from '../noteHighlights'

const VIEW_STORAGE_KEY = 'moyu:notes-view'

const readViewMode = () => {
  try { return localStorage.getItem(VIEW_STORAGE_KEY) === 'list' ? 'list' : 'grid' } catch { return 'grid' }
}

// 卡片摘录：有高亮时三段式呈现——上一行灰文（单行截断）、高亮块（独立成行，截断）、
// 下一行灰文（单行截断）；无高亮时从头显示，交给 CSS line-clamp 截断。
function QuoteExcerpt({ note }) {
  const highlights = normalizeHighlights(note.highlights, note.text.length)
  if (!highlights.length) return <blockquote>{note.text}</blockquote>
  const { start, end } = excerptWindow(note.text, highlights)
  const first = highlights[0]
  const last = highlights[highlights.length - 1]
  const pre = note.text.slice(start, first.start)
  const post = note.text.slice(last.end, end)
  return (
    <blockquote className="has-hl">
      {pre ? <span className="quote-dim quote-context">{pre}</span> : null}
      <span className="quote-hl-body">
        {segmentByHighlights(note.text, highlights, first.start, last.end).map((segment, index) => (
          segment.highlighted ? <span className="quote-hl" key={index}>{segment.text}</span> : <span className="quote-dim" key={index}>{segment.text}</span>
        ))}
      </span>
      {post ? <span className="quote-dim quote-context">{post}</span> : null}
    </blockquote>
  )
}

export default function NotesLibrary({ books, bookMetadata, notesMap, appearanceTheme, onOpenNote, onAddNote, onUpdateNote, onDeleteNote, onCreateGroup, onMoveNote, onExportNotes }) {
  const [selectedBook, setSelectedBook] = useState('all')
  const [activeTag, setActiveTag] = useState(null)
  const [viewMode, setViewModeState] = useState(readViewMode)
  const [shareTarget, setShareTarget] = useState(null)
  const [detailTarget, setDetailTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const [addTarget, setAddTarget] = useState(null)
  const [tagTarget, setTagTarget] = useState(null)
  const [cardMenu, setCardMenu] = useState(null)
  const [selectedIds, setSelectedIds] = useState(() => new Set())
  const [groupName, setGroupName] = useState(null)

  const setViewMode = (mode) => {
    setViewModeState(mode)
    try { localStorage.setItem(VIEW_STORAGE_KEY, mode) } catch {}
  }

  const groups = useMemo(() => {
    const liveBooks = new Map(books.map((book) => [book.id, book]))
    return Object.entries(notesMap)
      .filter(([id, notes]) => notes?.length || bookMetadata[id]?.customGroup)
      .map(([id, notes]) => {
        const customGroup = Boolean(bookMetadata[id]?.customGroup)
        const book = liveBooks.get(id) || { ...(bookMetadata[id] || {}), id, title: bookMetadata[id]?.title || '已移除的书籍', missing: !customGroup }
        return { book: { ...book, live: liveBooks.has(id) }, notes: notes || [] }
      })
  }, [bookMetadata, books, notesMap])
  const visibleGroups = selectedBook === 'all' ? groups : groups.filter((group) => group.book.id === selectedBook)
  const total = groups.reduce((sum, group) => sum + group.notes.length, 0)

  // 当前分类范围内的标签统计，用于侧栏标签过滤。
  const tagCounts = useMemo(() => {
    const counts = new Map()
    visibleGroups.forEach((group) => group.notes.forEach((note) => (note.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1))))
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [visibleGroups])
  const filteredNotes = (notes) => activeTag ? notes.filter((note) => note.tags?.includes(activeTag)) : notes

  const selectBook = (id) => { setSelectedBook(id); setActiveTag(null) }

  const createGroup = () => {
    const name = (groupName || '').trim()
    if (name) onCreateGroup(name)
    setGroupName(null)
  }

  if (!groups.length) {
    return (
      <div className="notes-library-layout">
        <aside className="notes-source-sidebar">
          <div className="notes-sidebar-head"><span>笔记分类</span><button className="add-note-group" onClick={() => setGroupName('')} title="新增分类" aria-label="新增分类"><Plus size={13} /></button></div>
          {groupName !== null ? (
            <div className="note-group-create">
              <input autoFocus value={groupName} maxLength={30} placeholder="分类名，如：盗墓笔记" onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createGroup(); if (event.key === 'Escape') setGroupName(null) }} />
              <button onClick={createGroup}>确定</button>
            </div>
          ) : null}
        </aside>
        <div className="notes-library-empty"><Bookmark size={32} strokeWidth={1.4} /><strong>还没有收藏句子</strong><span>打开书籍划选句子后右键收藏，或点击左侧 ＋ 新建分类手动添加摘录</span></div>
      </div>
    )
  }

  return (
    <div className="notes-library-layout">
      <aside className="notes-source-sidebar">
        <div className="notes-sidebar-head"><span>笔记分类</span><button className="add-note-group" onClick={() => setGroupName('')} title="新增分类" aria-label="新增分类"><Plus size={13} /></button></div>
        {groupName !== null ? (
          <div className="note-group-create">
            <input autoFocus value={groupName} maxLength={30} placeholder="分类名，如：盗墓笔记" onChange={(event) => setGroupName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') createGroup(); if (event.key === 'Escape') setGroupName(null) }} />
            <button onClick={createGroup}>确定</button>
          </div>
        ) : null}
        <button className={selectedBook === 'all' ? 'active' : ''} onClick={() => selectBook('all')}><strong>全部笔记</strong><small>{total}</small></button>
        {groups.map(({ book, notes }) => <button key={book.id} className={selectedBook === book.id ? 'active' : ''} onClick={() => selectBook(book.id)}><strong>{book.title}</strong><small>{notes.length}</small></button>)}
        {tagCounts.length ? (
          <div className="notes-tag-filter">
            <span>标签</span>
            <div>
              <button className={activeTag === null ? 'active' : ''} onClick={() => setActiveTag(null)}>全部</button>
              {tagCounts.map(([tag, count]) => <button key={tag} className={activeTag === tag ? 'active' : ''} onClick={() => setActiveTag(activeTag === tag ? null : tag)}><Tag size={10} />{tag}<small>{count}</small></button>)}
            </div>
          </div>
        ) : null}
      </aside>
      <div className="notes-groups">
        {visibleGroups.map(({ book, notes }, groupIndex) => {
          const visible = filteredNotes(notes)
          return (
            <section className="note-book-group" key={book.id}>
              <header>
                <span className="mini-cover" style={{ '--cover': COVER_COLORS[groupIndex % COVER_COLORS.length] }}>{book.title.slice(0, 1)}</span>
                <div><strong>{book.title}</strong><span>{visible.length} 条摘录{book.missing ? ' · 原书已不在书架' : ''}</span></div>
                <div className="note-group-actions">
                  <button className="add-note" onClick={() => setAddTarget(book)} title="手动新增摘录"><Plus size={14} /> 新增摘录</button>
                  <span className="notes-view-toggle" role="group" aria-label="切换视图">
                    <button className={viewMode === 'list' ? 'active' : ''} onClick={() => setViewMode('list')} title="横向显示（一行一张卡片）" aria-label="横向显示"><List size={14} /></button>
                    <button className={viewMode === 'grid' ? 'active' : ''} onClick={() => setViewMode('grid')} title="卡片模式（一行两张卡片）" aria-label="卡片模式"><LayoutGrid size={14} /></button>
                  </span>
                  <button className="export-notes" onClick={() => onExportNotes(book, visible)} title="导出 Markdown"><Download size={15} /> 导出</button>
                </div>
              </header>
              {visible.length ? (
                <div className={`quote-grid ${viewMode === 'list' ? 'is-list' : ''}`}>
                  {[...visible].sort((a, b) => b.createdAt - a.createdAt).map((note) => (
                    <article
                      className={`quote-card ${selectedIds.has(note.id) ? 'is-selected' : ''}`}
                      key={note.id}
                      onClick={(event) => {
                        if (event.ctrlKey || event.metaKey) {
                          setSelectedIds((current) => {
                            const next = new Set(current)
                            next.has(note.id) ? next.delete(note.id) : next.add(note.id)
                            return next
                          })
                          return
                        }
                        setSelectedIds(new Set())
                        setDetailTarget({ note, book })
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault()
                        const multi = selectedIds.has(note.id) && selectedIds.size > 1
                          ? groups.flatMap((group) => group.notes.map((item) => ({ note: item, book: group.book }))).filter((item) => selectedIds.has(item.note.id))
                          : null
                        setCardMenu({ note, book, multi, x: Math.min(event.clientX, window.innerWidth - 200), y: Math.min(event.clientY, window.innerHeight - 260) })
                      }}
                    >
                      <QuoteExcerpt note={note} />
                      {note.title ? <p className="quote-title">{note.title}</p> : null}
                      {note.tags?.length ? (
                        <div className="quote-tags">
                          {note.tags.map((tag) => <button className="quote-tag" key={tag} onClick={(event) => { event.stopPropagation(); setActiveTag(tag) }}><Tag size={10} />{tag}</button>)}
                        </div>
                      ) : null}
                      <footer>
                        <span className="quote-source">{note.source || `《${book.title}》`}{note.chapter ? ` · ${note.chapter}` : ''} · {new Date(note.createdAt).toLocaleDateString('zh-CN')}</span>
                        <div onClick={(event) => event.stopPropagation()}>
                          <button onClick={() => setTagTarget({ note, book })} title="编辑标签"><Tag size={14} /></button>
                          <button onClick={() => setShareTarget({ note, book })} title="生成分享图"><Share2 size={15} /></button>
                          {!note.custom && book.live ? <button onClick={() => onOpenNote(book, note)} title="跳转到原文"><ArrowUpRight size={16} /></button> : null}
                        </div>
                      </footer>
                    </article>
                  ))}
                </div>
              ) : <p className="note-group-empty">{activeTag ? '这个分类下没有该标签的摘录' : '还没有摘录，点击右上角「新增摘录」添加'}</p>}
            </section>
          )
        })}
      </div>
      {shareTarget ? <ShareNoteModal note={shareTarget.note} book={shareTarget.book} items={shareTarget.items} appearanceTheme={appearanceTheme} onClose={() => setShareTarget(null)} /> : null}
      {detailTarget ? (
        <NoteDetailModal
          note={detailTarget.note}
          book={detailTarget.book}
          onClose={() => setDetailTarget(null)}
          onEdit={() => { setEditTarget(detailTarget); setDetailTarget(null) }}
          onEditTags={() => { setTagTarget(detailTarget); setDetailTarget(null) }}
          onShare={() => { setShareTarget(detailTarget); setDetailTarget(null) }}
          onOpenNote={() => { onOpenNote(detailTarget.book, detailTarget.note); setDetailTarget(null) }}
        />
      ) : null}
      {tagTarget ? (
        <TagEditModal
          note={tagTarget.note}
          onCancel={() => setTagTarget(null)}
          onSave={(tags) => {
            onUpdateNote(tagTarget.book.id, { ...tagTarget.note, tags, updatedAt: Date.now() })
            setTagTarget(null)
          }}
        />
      ) : null}
      {editTarget ? (
        <CollectNoteModal
          heading="编辑摘录"
          text={editTarget.note.text}
          initialTitle={editTarget.note.title || ''}
          initialTags={editTarget.note.tags || []}
          initialHighlights={editTarget.note.highlights || []}
          onCancel={() => setEditTarget(null)}
          onSave={({ title, tags, highlights }) => {
            onUpdateNote(editTarget.book.id, { ...editTarget.note, title, tags, highlights, updatedAt: Date.now() })
            setEditTarget(null)
          }}
        />
      ) : null}
      {addTarget ? (
        <AddCustomNoteModal
          book={addTarget}
          onCancel={() => setAddTarget(null)}
          onSave={({ text, title, source, tags, highlights }) => {
            const note = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, text, custom: true, createdAt: Date.now() }
            if (title) note.title = title
            if (source) note.source = source
            if (tags?.length) note.tags = tags
            if (highlights?.length) note.highlights = highlights
            onAddNote(addTarget.id, note)
            setAddTarget(null)
          }}
        />
      ) : null}
      {cardMenu ? (
        <div className="context-menu-layer" onMouseDown={() => setCardMenu(null)} onContextMenu={(event) => event.preventDefault()}>
          <div className="card-context-menu" style={{ left: cardMenu.x, top: cardMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
            {cardMenu.multi ? (
              <button onClick={() => { setShareTarget({ items: cardMenu.multi, note: cardMenu.multi[0].note, book: cardMenu.multi[0].book }); setCardMenu(null) }}><Share2 size={12} /> 分享所选 {cardMenu.multi.length} 条（拼成长图）</button>
            ) : null}
            <span className="menu-heading">移动到分类</span>
            {groups.map(({ book: target }) => (
              <button
                key={target.id}
                disabled={target.id === cardMenu.book.id}
                onClick={() => { onMoveNote(cardMenu.book.id, target.id, cardMenu.note); setCardMenu(null) }}
              >{target.title}{target.id === cardMenu.book.id ? '（当前）' : ''}</button>
            ))}
            <span className="menu-heading">标签</span>
            <button onClick={() => { setTagTarget({ note: cardMenu.note, book: cardMenu.book }); setCardMenu(null) }}><Tag size={12} /> 编辑标签…</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const COVER_COLORS = ['#1c2b48', '#396081', '#6a90b4', '#94a2bf', '#16304a', '#5c7fa2']

// 快速编辑标签的小弹窗：卡片/详情弹窗上的标签 icon 打开。
function TagEditModal({ note, onSave, onCancel }) {
  const [tags, setTags] = useState(note.tags || [])
  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="note-editor tag-edit-modal" role="dialog" aria-modal="true" aria-label="编辑标签">
        <header><strong>编辑标签</strong><button onClick={onCancel} aria-label="关闭"><X size={16} /></button></header>
        <blockquote>{note.text.length > 80 ? `${note.text.slice(0, 80)}…` : note.text}</blockquote>
        <div className="tag-edit-body"><TagEditor tags={tags} onChange={setTags} placeholder="输入标签名，回车添加" /></div>
        <footer>
          <button onClick={onCancel}>取消</button>
          <button className="primary-command" onClick={() => onSave(tags)}>保存标签</button>
        </footer>
      </section>
    </div>
  )
}
