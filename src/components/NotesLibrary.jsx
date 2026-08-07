import { useMemo, useState } from 'react'
import { ArrowUpRight, Bookmark, Download, Pencil, Share2, X } from 'lucide-react'
import ShareNoteModal from './ShareNoteModal'

export default function NotesLibrary({ books, bookMetadata, notesMap, appearanceTheme, onOpenNote, onUpdateNote, onExportNotes }) {
  const [selectedBook, setSelectedBook] = useState('all')
  const [shareTarget, setShareTarget] = useState(null)
  const [editTarget, setEditTarget] = useState(null)
  const groups = useMemo(() => {
    const liveBooks = new Map(books.map((book) => [book.id, book]))
    return Object.entries(notesMap).filter(([, notes]) => notes?.length).map(([id, notes]) => ({
      book: liveBooks.get(id) || { ...(bookMetadata[id] || {}), id, title: bookMetadata[id]?.title || '已移除的书籍', missing: true },
      notes,
    }))
  }, [bookMetadata, books, notesMap])
  const visibleGroups = selectedBook === 'all' ? groups : groups.filter((group) => group.book.id === selectedBook)
  const total = groups.reduce((sum, group) => sum + group.notes.length, 0)

  if (!total) {
    return <div className="notes-library-empty"><Bookmark size={32} strokeWidth={1.4} /><strong>还没有收藏句子</strong><span>打开书籍，划选句子后收藏并评论</span></div>
  }

  return (
    <div className="notes-library-layout">
      <aside className="notes-source-sidebar">
        <span>笔记分类</span>
        <button className={selectedBook === 'all' ? 'active' : ''} onClick={() => setSelectedBook('all')}><strong>全部笔记</strong><small>{total}</small></button>
        {groups.map(({ book, notes }) => <button key={book.id} className={selectedBook === book.id ? 'active' : ''} onClick={() => setSelectedBook(book.id)}><strong>{book.title}</strong><small>{notes.length}</small></button>)}
      </aside>
      <div className="notes-groups">
        {visibleGroups.map(({ book, notes }, groupIndex) => (
          <section className="note-book-group" key={book.id}>
            <header><span className="mini-cover" style={{ '--cover': COVER_COLORS[groupIndex % COVER_COLORS.length] }}>{book.title.slice(0, 1)}</span><div><strong>{book.title}</strong><span>{notes.length} 条摘录{book.missing ? ' · 原书已不在书架' : ''}</span></div><button className="export-notes" onClick={() => onExportNotes(book, notes)} title="导出 Markdown"><Download size={15} /> 导出</button></header>
            <div className="quote-grid">
              {[...notes].sort((a, b) => b.createdAt - a.createdAt).map((note) => (
                <article className="quote-card" key={note.id}>
                  <Bookmark size={15} className="quote-mark" />
                  <blockquote>{note.text}</blockquote>
                  {note.comment ? <p className="quote-comment">{note.comment}</p> : null}
                  <footer><span>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</span><div><button onClick={() => setEditTarget({ note, book, comment: note.comment || '' })} title="编辑评论"><Pencil size={14} /></button>{!book.missing ? <><button onClick={() => setShareTarget({ note, book })} title="生成分享图"><Share2 size={15} /></button><button onClick={() => onOpenNote(book, note)} title="跳转到原文"><ArrowUpRight size={16} /></button></> : null}</div></footer>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {shareTarget ? <ShareNoteModal note={shareTarget.note} book={shareTarget.book} appearanceTheme={appearanceTheme} onClose={() => setShareTarget(null)} /> : null}
      {editTarget ? <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setEditTarget(null)}><section className="note-editor" role="dialog" aria-modal="true"><header><strong>编辑笔记评论</strong><button onClick={() => setEditTarget(null)} aria-label="关闭"><X size={16} /></button></header><blockquote>{editTarget.note.text}</blockquote><textarea autoFocus rows={6} maxLength={1000} value={editTarget.comment} onChange={(event) => setEditTarget({ ...editTarget, comment: event.target.value })} /><footer><button onClick={() => setEditTarget(null)}>取消</button><button className="primary-command" onClick={() => { onUpdateNote(editTarget.book.id, editTarget.note.id, editTarget.comment.trim()); setEditTarget(null) }}>保存修改</button></footer></section></div> : null}
    </div>
  )
}

const COVER_COLORS = ['#1c2b48', '#396081', '#6a90b4', '#94a2bf', '#16304a', '#5c7fa2']
