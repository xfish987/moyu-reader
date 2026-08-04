import { useState } from 'react'
import { Bookmark, MessageSquareQuote, X } from 'lucide-react'

// 划选句子后弹出的评论卡片：预览摘录 + 评论输入 + 保存。
// onMouseUp 阻止冒泡，避免触发阅读器的选区捕获导致弹窗被关掉。
export function SelectionPopup({ text, left, top, below, onSave, onCancel }) {
  const [comment, setComment] = useState('')
  const [color, setColor] = useState('amber')
  return (
    <div className={`selection-popup ${below ? 'is-below' : ''}`} style={{ left, top }} onWheel={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <blockquote>{text.length > 90 ? `${text.slice(0, 90)}…` : text}</blockquote>
      <textarea autoFocus rows={3} maxLength={300} placeholder="写点评论…（可留空）" value={comment} onChange={(event) => setComment(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) onSave(comment.trim(), color) }} />
      <div className="highlight-colors" aria-label="高亮颜色">{['amber', 'sage', 'rose'].map((value) => <button key={value} className={`${value} ${color === value ? 'selected' : ''}`} onClick={() => setColor(value)} aria-label={`${value} 高亮`} />)}</div>
      <div className="selection-popup-actions">
        <button className="popup-cancel" onClick={onCancel}>取消</button>
        <button className="popup-save" onClick={() => onSave(comment.trim(), color)}><Bookmark size={13} /> 保存笔记</button>
      </div>
    </div>
  )
}

// 点击正文中的评论标记后弹出：展示该处所有笔记（摘录 + 评论）。
export function NotePopup({ notes, left, top, below, onClose }) {
  return (
    <div className={`note-popup ${below ? 'is-below' : ''}`} style={{ left, top }} onWheel={(event) => event.stopPropagation()} onMouseUp={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <button className="note-popup-close" onClick={onClose} aria-label="关闭评论"><X size={13} /></button>
      {notes.map((note) => (
        <div className="note-popup-item" key={note.id}>
          <blockquote>{note.text.length > 120 ? `${note.text.slice(0, 120)}…` : note.text}</blockquote>
          {note.comment
            ? <p className="note-popup-comment"><MessageSquareQuote size={12} /> {note.comment}</p>
            : <p className="note-popup-comment is-empty">未留评论</p>}
          <span>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</span>
        </div>
      ))}
    </div>
  )
}
