import { useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import HighlightTextEditor from './HighlightTextEditor'
import TagEditor from './TagEditor'

// 手动新增摘录：不依赖本地书籍。第一步写正文（可自由分段）/标题/出处/标签，
// 第二步在排版面上划选右键「高亮」核心句子。
export default function AddCustomNoteModal({ book, availableTags = [], onSave, onCancel }) {
  const [step, setStep] = useState(1)
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [source, setSource] = useState(`《${book.title}》`)
  const [tags, setTags] = useState([])
  const [highlights, setHighlights] = useState([])

  // 正文变了，既有高亮偏移就失效，直接清空避免错位。
  const changeText = (value) => { setText(value); setHighlights([]) }

  const save = () => {
    const content = text.trim()
    if (!content) return
    onSave({ text: content, title: title.trim(), source: source.trim(), tags, highlights })
  }

  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className={`note-editor add-custom-note ${step === 2 ? 'is-highlight-step' : ''}`} role="dialog" aria-modal="true" aria-label="新增摘录">
        <header><strong>新增摘录 · {book.title}{step === 2 ? '（选择高亮）' : ''}</strong><button onClick={onCancel} aria-label="关闭"><X size={16} /></button></header>
        {step === 1 ? (
          <div className="add-custom-fields">
            <label>摘录正文<textarea autoFocus rows={7} placeholder="粘贴或写下你想留存的段落，可自由分段" value={text} onChange={(event) => changeText(event.target.value)} /></label>
            <label>标题（可留空）<input value={title} maxLength={60} placeholder="如：小哥初见" onChange={(event) => setTitle(event.target.value)} /></label>
            <label>出处<input value={source} maxLength={60} placeholder="如：《钓王》" onChange={(event) => setSource(event.target.value)} /></label>
            <label>标签<TagEditor tags={tags} availableTags={availableTags} onChange={setTags} /></label>
          </div>
        ) : (
          <HighlightTextEditor text={text.trim()} highlights={highlights} onChange={setHighlights} />
        )}
        <footer>
          {step === 1 ? (
            <>
              <button onClick={onCancel}>取消</button>
              <button className="primary-command" disabled={!text.trim()} onClick={() => setStep(2)}>下一步：选择高亮</button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)}>上一步</button>
              <button className="primary-command" onClick={save}><Bookmark size={13} /> 收藏</button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
