import { useEffect, useMemo, useState } from 'react'
import { Check, ImagePlus, Pencil, RotateCcw, Trash2, X } from 'lucide-react'
import { DEFAULT_APPEARANCE, IRIS_ASSETS, PRESET_BACKGROUNDS, resolveBackgroundPreference } from './appearance'

const THEMES = [
  { id: 'mist', name: '雾蓝书房', colors: ['#eef2f4', '#d8e1e4', '#2f5e67'] },
  { id: 'night', name: '雪线寒夜', colors: ['#1b2027', '#303941', '#8db1ad'] },
  { id: 'porcelain', name: '青瓷浅云', colors: ['#f5f5f2', '#d8dfdc', '#486e67'] },
]

function SliderRow({ label, value, min, max, step, unit, onChange }) {
  const shown = unit === '%' ? Math.round(value * 100) : unit === '×' ? value.toFixed(2) : Math.round(value)
  return <label className="b-slider-row"><span>{label}<output>{shown}{unit}</output></span><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} /></label>
}

/* 用户上传的背景图进入自定义列表，与内置预设同排展示，可命名、可复选、可删除。 */
export default function AppearancePanel({ appearance, onChange, onClose }) {
  const [scope, setScope] = useState('home')
  const [busy, setBusy] = useState(false)
  const [thumbs, setThumbs] = useState({})
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const preference = appearance[scope]
  const resolvedPreference = resolveBackgroundPreference(preference, scope, appearance.theme)
  const displayAsset = resolvedPreference.asset
  const custom = useMemo(() => (Array.isArray(appearance.custom) ? appearance.custom : []), [appearance.custom])
  const isCustomCurrent = Boolean(displayAsset && displayAsset.kind !== 'builtin' && displayAsset.assetPath)
  const label = scope === 'home' ? '主页背景' : '阅读背景'

  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // 自定义背景的缩略图走 IPC 读盘，按 id 缓存。
  useEffect(() => {
    let cancelled = false
    const missing = custom.filter((entry) => entry.assetPath && !thumbs[entry.id])
    if (!missing.length) return undefined
    Promise.all(missing.map(async (entry) => [entry.id, await window.readerAPI?.readBackground(entry.assetPath).catch(() => '')])).then((loaded) => {
      if (!cancelled) setThumbs((current) => ({ ...current, ...Object.fromEntries(loaded) }))
    })
    return () => { cancelled = true }
  }, [custom, thumbs])

  const patch = (next) => onChange({ ...appearance, [scope]: { ...preference, ...next } })
  const size = useMemo(() => displayAsset?.sizeBytes ? `${(displayAsset.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '', [displayAsset])

  const choose = async () => {
    setBusy(true)
    try {
      const asset = await window.readerAPI?.chooseBackground(scope)
      if (asset) {
        const entry = { ...asset, name: (asset.fileName || '自定义背景').replace(/\.[^.]+$/, '') }
        const rest = custom.filter((item) => item.id !== entry.id)
        onChange({ ...appearance, custom: [...rest, entry], [scope]: { ...preference, asset: entry, enabled: true, autoAdaptTheme: false } })
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `背景导入失败：${error?.message || '无法读取图片'}` }))
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (isCustomCurrent) {
      await window.readerAPI?.deleteBackground(displayAsset.assetPath).catch(() => {})
      onChange({ ...appearance, custom: custom.filter((item) => item.id !== displayAsset.id), [scope]: { ...preference, asset: null, enabled: false } })
      return
    }
    patch({ asset: null, enabled: false })
  }

  const saveRename = () => {
    const name = nameDraft.trim().slice(0, 20)
    setRenaming(false)
    if (!name || !isCustomCurrent) return
    const renamed = { ...preference.asset, name }
    onChange({
      ...appearance,
      custom: custom.map((item) => item.id === displayAsset.id ? { ...item, name } : item),
      [scope]: { ...preference, asset: renamed },
    })
  }

  const presets = PRESET_BACKGROUNDS.filter((item) => item.scopes.includes(scope))

  return (
    <div className="b-panel-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="b-appearance-panel" role="dialog" aria-modal="true" aria-label="外观设置">
        <header><div><span>外观</span><strong>书房氛围</strong></div><button className="b-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="b-appearance-body">
          <section className="b-theme-section">
            <h2>主题</h2>
            <div className="b-theme-grid">{THEMES.map((theme) => <button key={theme.id} className={appearance.theme === theme.id ? 'active' : ''} onClick={() => onChange({ ...appearance, theme: theme.id })}><span className="b-theme-preview" style={{ '--preview-a': theme.colors[0], '--preview-b': theme.colors[1], '--preview-c': theme.colors[2] }}><i /><i /><i /></span><span>{theme.name}</span>{appearance.theme === theme.id ? <Check size={14} /> : null}</button>)}</div>
          </section>
          <section className="b-background-section">
            <div className="b-segmented" aria-label="背景范围"><button className={scope === 'home' ? 'active' : ''} onClick={() => setScope('home')}>主页背景</button><button className={scope === 'reader' ? 'active' : ''} onClick={() => setScope('reader')}>阅读背景</button></div>
            <div className={`b-background-preview scope-${scope}`} style={{ '--b-preview-image': displayAsset?.url ? `url("${displayAsset.url}")` : thumbs[displayAsset?.id] ? `url("${thumbs[displayAsset.id]}")` : 'none' }}><div className="b-preview-paper"><i /><i /><i /><i /></div><span>{displayAsset?.name || displayAsset?.fileName || `${label}未设置`}</span></div>
            <div className="b-preset-strip" aria-label={`${label}预设`}>
              {presets.map((preset) => <button key={preset.id} className={displayAsset?.id === preset.id ? 'active' : ''} onClick={() => patch({ asset: { kind: 'builtin', ...preset }, enabled: true, autoAdaptTheme: false, positionX: preset.focus?.x ?? 50, positionY: preset.focus?.y ?? 50 })}><img src={preset.url} alt="" /><span>{preset.name}</span></button>)}
              {custom.map((entry) => <button key={entry.id} className={displayAsset?.id === entry.id ? 'active' : ''} title={entry.name || entry.fileName} onClick={() => patch({ asset: entry, enabled: true, autoAdaptTheme: false })}>{thumbs[entry.id] ? <img src={thumbs[entry.id]} alt="" /> : <img src={presets[0]?.url} alt="" style={{ visibility: 'hidden' }} />}<span>{entry.name || entry.fileName}</span></button>)}
            </div>
            <div className="b-asset-row"><div>{isCustomCurrent && renaming ? <input className="b-rename-input" autoFocus value={nameDraft} maxLength={20} onChange={(event) => setNameDraft(event.target.value)} onBlur={saveRename} onKeyDown={(event) => { if (event.key === 'Enter') saveRename(); if (event.key === 'Escape') setRenaming(false) }} /> : <strong>{displayAsset?.name || displayAsset?.fileName || '使用主题默认背景'}</strong>}<span>{preference.autoAdaptTheme && scope === 'home' ? '跟随当前主题自动匹配' : displayAsset?.kind === 'builtin' ? '项目内置预设' : displayAsset ? `${displayAsset.mime} · ${size}` : 'JPG、PNG 或 WebP，最大 20 MB'}</span></div>{isCustomCurrent && !renaming ? <button className="b-icon-button" onClick={() => { setNameDraft(displayAsset.name || displayAsset.fileName || ''); setRenaming(true) }} title="重命名背景" aria-label="重命名背景"><Pencil size={14} /></button> : null}<button className="b-secondary-button" onClick={choose} disabled={busy}><ImagePlus size={16} />{preference.asset ? '上传替换' : '选择图片'}</button>{preference.asset && !preference.autoAdaptTheme ? <button className="b-icon-button danger" onClick={remove} title="删除背景"><Trash2 size={16} /></button> : null}</div>
            {scope === 'home' ? <label className="b-toggle-row"><span><strong>背景跟随主题</strong><small>切换配色时自动使用匹配的内置背景</small></span><input type="checkbox" checked={Boolean(preference.autoAdaptTheme)} onChange={(event) => patch({ autoAdaptTheme: event.target.checked, enabled: true })} /></label> : null}
            <label className="b-toggle-row"><span><strong>启用{label}</strong><small>关闭后保留参数与主题设置</small></span><input type="checkbox" checked={preference.enabled} disabled={!preference.asset} onChange={(event) => patch({ enabled: event.target.checked })} /></label>
            <div className="b-tuner-grid">
              <SliderRow label="不透明度" value={preference.opacity} min="0" max="0.9" step="0.01" unit="%" onChange={(opacity) => patch({ opacity })} />
              <SliderRow label="模糊" value={preference.blurPx} min="0" max="30" step="1" unit="px" onChange={(blurPx) => patch({ blurPx })} />
              <SliderRow label="遮罩强度" value={preference.overlayOpacity} min="0" max="0.8" step="0.01" unit="%" onChange={(overlayOpacity) => patch({ overlayOpacity })} />
              <SliderRow label="水平位置" value={preference.positionX ?? 50} min="0" max="100" step="1" unit="" onChange={(positionX) => patch({ positionX })} />
              <SliderRow label="垂直位置" value={preference.positionY ?? 50} min="0" max="100" step="1" unit="" onChange={(positionY) => patch({ positionY })} />
              <SliderRow label="缩放" value={preference.scale ?? 1} min="1" max="1.8" step="0.02" unit="×" onChange={(scale) => patch({ scale })} />
              <SliderRow label="饱和度" value={preference.saturation} min="0.4" max="1.1" step="0.01" unit="%" onChange={(saturation) => patch({ saturation })} />
              <SliderRow label="亮度" value={preference.brightness} min="0.7" max="1.2" step="0.01" unit="%" onChange={(brightness) => patch({ brightness })} />
              <SliderRow label="对比度" value={preference.contrast ?? 1} min="0.7" max="1.15" step="0.01" unit="%" onChange={(contrast) => patch({ contrast })} />
            </div>
            <div className="b-iris-note"><span className="b-iris-swatch">{IRIS_ASSETS.map((iris) => <img key={iris.id} src={iris.url} alt="" />)}</span><span>鸢尾花素材已作为书房氛围素材保留，可在后续空状态与品牌插画中使用。</span></div>
          </section>
        </div>
        <footer><button className="b-secondary-button" onClick={() => patch({ ...DEFAULT_APPEARANCE[scope], asset: preference.asset, enabled: Boolean(preference.asset) })}><RotateCcw size={15} />推荐值</button><button className="b-primary-button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}
