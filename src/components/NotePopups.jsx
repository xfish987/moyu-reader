import { Bookmark, X } from 'lucide-react'

// 点击正文中的收藏标记后弹出：展示该处所有收藏（摘录 + 备注标题）。
export function NotePopup({ notes, left, top, below, onClose }) {
  return (
    <div className={`note-popup ${below ? 'is-below' : ''}`} style={{ left, top }} onWheel={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <button className="note-popup-close" onClick={onClose} aria-label="关闭收藏"><X size={13} /></button>
      {notes.map((note) => (
        <div className="note-popup-item" key={note.id}>
          <blockquote>{note.text.length > 120 ? `${note.text.slice(0, 120)}…` : note.text}</blockquote>
          {note.title ? <p className="note-popup-comment"><Bookmark size={12} /> {note.title}</p> : null}
          <span>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      ))}
    </div>
  )
}
