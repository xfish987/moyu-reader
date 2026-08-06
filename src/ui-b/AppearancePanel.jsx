import { useEffect, useMemo, useState } from 'react'
import { Check, ImagePlus, RotateCcw, Trash2, X } from 'lucide-react'
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

export default function AppearancePanel({ appearance, onChange, onClose }) {
  const [scope, setScope] = useState('home')
  const [busy, setBusy] = useState(false)
  const preference = appearance[scope]
  const resolvedPreference = resolveBackgroundPreference(preference, scope, appearance.theme)
  const displayAsset = resolvedPreference.asset
  const label = scope === 'home' ? '主页背景' : '阅读背景'
  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])
  const patch = (next) => onChange({ ...appearance, [scope]: { ...preference, ...next } })
  const size = useMemo(() => preference.asset ? `${(preference.asset.sizeBytes / 1024 / 1024).toFixed(1)} MB` : '', [preference.asset])

  const choose = async () => {
    setBusy(true)
    try {
      const asset = await window.readerAPI?.chooseBackground(scope)
      if (asset) patch({ asset, enabled: true, autoAdaptTheme: false })
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `背景导入失败：${error?.message || '无法读取图片'}` }))
    } finally { setBusy(false) }
  }

  const remove = async () => {
    if (preference.asset?.kind !== 'builtin' && preference.asset?.assetPath) await window.readerAPI?.deleteBackground(preference.asset.assetPath).catch(() => {})
    patch({ asset: null, enabled: false })
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
            <div className={`b-background-preview scope-${scope}`} style={{ '--b-preview-image': displayAsset?.url ? `url("${displayAsset.url}")` : 'none' }}><div className="b-preview-paper"><i /><i /><i /><i /></div><span>{displayAsset?.name || displayAsset?.fileName || `${label}未设置`}</span></div>
            <div className="b-preset-strip" aria-label={`${label}预设`}>
              {presets.map((preset) => <button key={preset.id} className={displayAsset?.id === preset.id ? 'active' : ''} onClick={() => patch({ asset: { kind: 'builtin', ...preset }, enabled: true, autoAdaptTheme: false, positionX: preset.focus?.x ?? 50, positionY: preset.focus?.y ?? 50 })}><img src={preset.url} alt="" /><span>{preset.name}</span></button>)}
            </div>
            <div className="b-asset-row"><div><strong>{displayAsset?.name || displayAsset?.fileName || '使用主题默认背景'}</strong><span>{preference.autoAdaptTheme && scope === 'home' ? '跟随当前主题自动匹配' : preference.asset?.kind === 'builtin' ? '项目内置预设' : preference.asset ? `${preference.asset.mime} · ${size}` : 'JPG、PNG 或 WebP，最大 20 MB'}</span></div><button className="b-secondary-button" onClick={choose} disabled={busy}><ImagePlus size={16} />{preference.asset ? '上传替换' : '选择图片'}</button>{preference.asset && !preference.autoAdaptTheme ? <button className="b-icon-button danger" onClick={remove} title="删除背景"><Trash2 size={16} /></button> : null}</div>
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
              {scope === 'reader' ? <SliderRow label="纸页透明度" value={preference.paperOpacity} min="0.82" max="1" step="0.01" unit="%" onChange={(paperOpacity) => patch({ paperOpacity })} /> : null}
            </div>
            <div className="b-iris-note"><span className="b-iris-swatch">{IRIS_ASSETS.map((iris) => <img key={iris.id} src={iris.url} alt="" />)}</span><span>鸢尾花素材已作为书房氛围素材保留，可在后续空状态与品牌插画中使用。</span></div>
          </section>
        </div>
        <footer><button className="b-secondary-button" onClick={() => patch({ ...DEFAULT_APPEARANCE[scope], asset: preference.asset, enabled: Boolean(preference.asset) })}><RotateCcw size={15} />推荐值</button><button className="b-primary-button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}
