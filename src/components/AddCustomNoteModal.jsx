import { useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import TagEditor from './TagEditor'

// 手动新增摘录：不依赖本地书籍，正文可自由分段，出处预填当前分类名（可改为《钓王》等）。
export default function AddCustomNoteModal({ book, onSave, onCancel }) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [source, setSource] = useState(`《${book.title}》`)
  const [tags, setTags] = useState([])

  const save = () => {
    const content = text.trim()
    if (!content) return
    onSave({ text: content, title: title.trim(), source: source.trim(), tags })
  }

  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="note-editor add-custom-note" role="dialog" aria-modal="true" aria-label="新增摘录">
        <header><strong>新增摘录 · {book.title}</strong><button onClick={onCancel} aria-label="关闭"><X size={16} /></button></header>
        <div className="add-custom-fields">
          <label>摘录正文<textarea autoFocus rows={7} placeholder="粘贴或写下你想留存的段落，可自由分段" value={text} onChange={(event) => setText(event.target.value)} /></label>
          <label>标题（可留空）<input value={title} maxLength={60} placeholder="如：小哥初见" onChange={(event) => setTitle(event.target.value)} /></label>
          <label>出处<input value={source} maxLength={60} placeholder="如：《钓王》" onChange={(event) => setSource(event.target.value)} /></label>
          <label>标签<TagEditor tags={tags} onChange={setTags} /></label>
        </div>
        <footer>
          <button onClick={onCancel}>取消</button>
          <button className="primary-command" disabled={!text.trim()} onClick={save}><Bookmark size={13} /> 收藏</button>
        </footer>
      </section>
    </div>
  )
}
