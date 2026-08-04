import { useMemo, useState } from 'react'
import { ArrowUpRight, Bookmark, Share2 } from 'lucide-react'
import ShareNoteModal from './ShareNoteModal'

export default function NotesLibrary({ books, notesMap, onOpenNote }) {
  const [selectedBook, setSelectedBook] = useState('all')
  const [shareTarget, setShareTarget] = useState(null)
  const groups = useMemo(() => books.map((book) => ({ book, notes: notesMap[book.id] || [] })).filter((group) => group.notes.length), [books, notesMap])
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
            <header><span className="mini-cover" style={{ '--cover': COVER_COLORS[groupIndex % COVER_COLORS.length] }}>{book.title.slice(0, 1)}</span><div><strong>{book.title}</strong><span>{notes.length} 条摘录</span></div></header>
            <div className="quote-grid">
              {[...notes].sort((a, b) => b.createdAt - a.createdAt).map((note) => (
                <article className="quote-card" key={note.id}>
                  <Bookmark size={15} className="quote-mark" />
                  <blockquote>{note.text}</blockquote>
                  {note.comment ? <p className="quote-comment">{note.comment}</p> : null}
                  <footer><span>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</span><div><button onClick={() => setShareTarget({ note, book })} title="生成分享图"><Share2 size={15} /></button><button onClick={() => onOpenNote(book, note)} title="跳转到原文"><ArrowUpRight size={16} /></button></div></footer>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      {shareTarget ? <ShareNoteModal note={shareTarget.note} book={shareTarget.book} onClose={() => setShareTarget(null)} /> : null}
    </div>
  )
}

const COVER_COLORS = ['#315c57', '#935746', '#354d6b', '#786844', '#624c63', '#41616d']
