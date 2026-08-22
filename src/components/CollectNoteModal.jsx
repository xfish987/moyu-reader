import { useEffect, useState } from 'react'
import { Bookmark, X } from 'lucide-react'
import { normalizeHighlights } from '../noteHighlights'
import HighlightTextEditor from './HighlightTextEditor'
import TagEditor from './TagEditor'

// 收藏/编辑摘录弹窗：排版面内划选右键「高亮」标记核心句子（可撤销）；
// 底部写备注（卡片标题）与标签。onSave({ title, tags, highlights })，由调用方合并锚点字段。
export default function CollectNoteModal({ text, initialTitle = '', initialSource = '', initialTags = [], availableTags = [], initialHighlights = [], heading = '收藏摘录', onSave, onCancel }) {
  const [title, setTitle] = useState(initialTitle)
  const [source, setSource] = useState(initialSource)
  const [tags, setTags] = useState(initialTags)
  const [highlights, setHighlights] = useState(() => normalizeHighlights(initialHighlights, text.length))

  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="collect-modal" role="dialog" aria-modal="true" aria-label={heading}>
        <header>
          <div><Bookmark size={15} /><strong>{heading}</strong><span>备注会成为卡片标题</span></div>
          <button onClick={onCancel} aria-label="关闭"><X size={16} /></button>
        </header>
        <HighlightTextEditor text={text} highlights={highlights} onChange={setHighlights} />
        <div className="collect-fields">
          <label>备注<input value={title} maxLength={60} placeholder="可留空，将成为卡片标题，如：小哥初见" onChange={(event) => setTitle(event.target.value)} /></label>
          <label>出处<input value={source} maxLength={80} placeholder="如：《书名》 · 第三章" onChange={(event) => setSource(event.target.value)} /></label>
          <label>标签<TagEditor tags={tags} availableTags={availableTags} onChange={setTags} /></label>
        </div>
        <footer>
          <span />
          <div>
            <button onClick={onCancel}>取消</button>
            <button className="primary-command" onClick={() => onSave({ title: title.trim(), source: source.trim(), tags, highlights })}><Bookmark size={13} /> 保存</button>
          </div>
        </footer>
      </section>
    </div>
  )
}
