import { BookmarkPlus, BookOpen } from 'lucide-react'

export default function SourceEditor({ value = '', availableSources = [], onChange, onSavePreset, maxLength = 80, placeholder = '如：《书名》 · 第三章' }) {
  const presets = [...new Set(availableSources.map((source) => source?.trim()).filter(Boolean))]
    .filter((source) => source !== value.trim())
  const canSave = Boolean(value.trim()) && !availableSources.includes(value.trim())

  return (
    <div className="source-editor">
      <div className="source-input-row">
        <input value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
        {onSavePreset ? <button type="button" disabled={!canSave} onClick={() => onSavePreset(value.trim())}><BookmarkPlus size={12} />存为预设</button> : null}
      </div>
      {presets.length ? (
        <div className="source-presets" aria-label="本分类出处预设">
          <span>本分类预设</span>
          <div>{presets.map((source) => <button type="button" key={source} title={source} onClick={() => onChange(source)}><BookOpen size={11} />{source}</button>)}</div>
        </div>
      ) : null}
    </div>
  )
}
