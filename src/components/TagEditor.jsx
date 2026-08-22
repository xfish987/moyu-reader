import { useState } from 'react'
import { Tag, X } from 'lucide-react'

// 标签 chip 编辑器：回车/失焦提交新标签，点击 × 移除。
export default function TagEditor({ tags = [], availableTags = [], onChange, placeholder = '添加标签，回车确认' }) {
  const [draft, setDraft] = useState('')
  const commit = () => {
    const value = draft.trim()
    if (value && !tags.includes(value)) onChange([...tags, value])
    setDraft('')
  }
  const suggestions = availableTags.filter((tag) => !tags.includes(tag))
  return (
    <div className="tag-editor">
      {tags.map((tag) => (
        <span className="tag-chip" key={tag}>
          <Tag size={11} />{tag}
          <button onClick={() => onChange(tags.filter((item) => item !== tag))} aria-label={`移除标签 ${tag}`}><X size={11} /></button>
        </span>
      ))}
      <input
        value={draft}
        maxLength={20}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } }}
        onBlur={commit}
      />
      {suggestions.length ? (
        <div className="tag-suggestions" aria-label="已有标签">
          {suggestions.map((tag) => <button type="button" key={tag} onMouseDown={(event) => event.preventDefault()} onClick={() => onChange([...tags, tag])}><Tag size={10} />{tag}</button>)}
        </div>
      ) : null}
    </div>
  )
}
