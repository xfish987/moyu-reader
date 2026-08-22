import { useEffect, useState } from 'react'
import { ArrowUpRight, Bookmark, Check, Copy, Pencil, Share2, Tag, X } from 'lucide-react'

// 摘录详情弹窗：全文同浓淡展示（展示态），保留分段，可复制；
// 底部操作：编辑（重新选择高亮）、标签、分享成图、跳转原文（手动摘录无此按钮）。
export default function NoteDetailModal({ note, book, onClose, onEdit, onEditTags, onShare, onOpenNote }) {
  const [copied, setCopied] = useState(false)
  const canJump = !note.custom && !book.missing && (note.paragraphIndex !== undefined || note.cfi)

  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(note.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }

  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="note-detail" role="dialog" aria-modal="true" aria-label="摘录详情">
        <header>
          <div><Bookmark size={15} /><strong>{note.title || '阅读笔记'}</strong></div>
          <button onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="note-detail-text">
          {note.text.split('\n').map((paragraph, index) => <p key={index}>{paragraph || ' '}</p>)}
        </div>
        <div className="note-detail-meta">
          <span>{note.source || `《${book.title}》`} · {new Date(note.createdAt).toLocaleDateString('zh-CN')}</span>
          {note.tags?.length ? <div className="quote-tags">{note.tags.map((tag) => <span className="quote-tag is-static" key={tag}><Tag size={10} />{tag}</span>)}</div> : null}
        </div>
        <footer>
          <button className="note-detail-copy" onClick={copy}>{copied ? <><Check size={14} /> 已复制</> : <><Copy size={14} /> 复制全文</>}</button>
          <div>
            <button onClick={onEdit} title="重新选择高亮、修改备注与标签"><Pencil size={14} /> 编辑</button>
            <button onClick={onEditTags} title="编辑标签"><Tag size={14} /> 标签</button>
            <button onClick={onShare} title="生成分享图"><Share2 size={14} /> 分享</button>
            {canJump ? <button onClick={onOpenNote} title="跳转到原文"><ArrowUpRight size={15} /> 跳转原文</button> : null}
          </div>
        </footer>
      </section>
    </div>
  )
}
