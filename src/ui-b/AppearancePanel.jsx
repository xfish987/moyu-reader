import { useEffect, useMemo, useState } from 'react'
import { Check, ImagePlus, Plus, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { DEFAULT_APPEARANCE, normalizeAppearance } from './appearance'

const THEMES = [
  { id: 'mist', name: '浅色', colors: ['#e8ecef', '#c5d8e6', '#396081'] },
  { id: 'night', name: '深色', colors: ['#01162b', '#1c2b48', '#8eb1d1'] },
]

const SCOPE_LABELS = { home: '主页背景', reader: '阅读背景' }

const clone = (value) => JSON.parse(JSON.stringify(value))

const snapshotAppearance = (appearance) => clone({
  theme: appearance.theme,
  home: appearance.home,
  reader: appearance.reader,
  bars: appearance.bars,
})

const BUILTIN_SCHEMES = [
  { id: 'builtin-mist', name: '默认浅色', settings: { ...snapshotAppearance(DEFAULT_APPEARANCE), theme: 'mist' } },
  { id: 'builtin-night', name: '默认深色', settings: { ...snapshotAppearance(DEFAULT_APPEARANCE), theme: 'night' } },
]

function ColorOpacityControl({ label, color, opacity, onColor, onOpacity }) {
  return (
    <div className="b-color-opacity-control">
      <span>{label}</span>
      <label className="b-color-field">
        <input type="color" value={color} onChange={(event) => onColor(event.target.value)} aria-label={`${label}色值`} />
        <code>{color}</code>
      </label>
      <input type="range" min="0" max="100" step="1" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} aria-label={`${label}透明度`} />
      <output>{Math.round(opacity * 100)}%</output>
    </div>
  )
}

function GradientOpacityControl({ label, startColor, endColor, opacity, onStartColor, onEndColor, onOpacity }) {
  return (
    <div className="b-gradient-opacity-control">
      <span>{label}</span>
      <label className="b-color-field"><input type="color" value={startColor} onChange={(event) => onStartColor(event.target.value)} aria-label={`${label}起始色`} /><code>{startColor}</code></label>
      <label className="b-color-field"><input type="color" value={endColor} onChange={(event) => onEndColor(event.target.value)} aria-label={`${label}结束色`} /><code>{endColor}</code></label>
      <input type="range" min="0" max="100" step="1" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} aria-label={`${label}透明度`} />
      <output>{Math.round(opacity * 100)}%</output>
    </div>
  )
}

function OverlayGradientControl({ overlay, onChange }) {
  const midpoint = Math.round(overlay.midpoint * 100)
  const gradient = `linear-gradient(${overlay.angle}deg, color-mix(in srgb, ${overlay.startColor} ${Math.round(overlay.startOpacity * 100)}%, transparent) 0%, ${midpoint}%, color-mix(in srgb, ${overlay.endColor} ${Math.round(overlay.endOpacity * 100)}%, transparent) 100%)`

  return (
    <div className="b-overlay-gradient-control">
      <label className="b-gradient-angle-field">
        <span>方向</span>
        <span className="b-number-field"><input type="number" min="0" max="359" step="1" value={overlay.angle} onChange={(event) => onChange({ angle: ((Number(event.target.value) % 360) + 360) % 360 })} aria-label="渐变方向" /><i>°</i></span>
      </label>
      <div className="b-gradient-midpoint-field">
        <span>过渡中心</span>
        <div className="b-gradient-track" style={{ '--b-overlay-preview': gradient }}>
          <i className="is-start" style={{ background: overlay.startColor, opacity: overlay.startOpacity }} />
          <input type="range" min="1" max="99" step="1" value={midpoint} onChange={(event) => onChange({ midpoint: Number(event.target.value) / 100 })} aria-label="渐变过渡中心" />
          <i className="is-end" style={{ background: overlay.endColor, opacity: overlay.endOpacity }} />
        </div>
        <output>{midpoint}%</output>
      </div>
    </div>
  )
}

export default function AppearancePanel({ appearance, onChange, onClose }) {
  const [busyScope, setBusyScope] = useState('')
  const [scope, setScope] = useState('home')
  const [thumbs, setThumbs] = useState({})
  const [selectedSchemeId, setSelectedSchemeId] = useState(appearance.activeSchemeId || '')
  const [schemeDirty, setSchemeDirty] = useState(!appearance.activeSchemeId)
  const custom = useMemo(() => (Array.isArray(appearance.custom) ? appearance.custom : []), [appearance.custom])
  const schemes = useMemo(() => (Array.isArray(appearance.schemes) ? appearance.schemes : []), [appearance.schemes])
  const scopePreference = appearance[scope]
  const selectedCustomScheme = schemes.find((scheme) => scheme.id === selectedSchemeId)

  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    const missing = custom.filter((entry) => entry.assetPath && !thumbs[entry.id])
    if (!missing.length) return undefined
    Promise.all(missing.map(async (entry) => [entry.id, await window.readerAPI?.readBackground(entry.assetPath).catch(() => '')])).then((loaded) => {
      if (!cancelled) setThumbs((current) => ({ ...current, ...Object.fromEntries(loaded) }))
    })
    return () => { cancelled = true }
  }, [custom, thumbs])

  const updateDraft = (next) => {
    setSchemeDirty(true)
    onChange({ ...next, activeSchemeId: '' })
  }

  const updateScope = (target, patch) => updateDraft({ ...appearance, [target]: { ...appearance[target], ...patch } })

  const updateOverlay = (target, theme, patch) => updateScope(target, {
    overlay: {
      ...appearance[target].overlay,
      [theme]: { ...appearance[target].overlay[theme], ...patch },
    },
  })

  const updateBar = (bar, patch) => updateDraft({
    ...appearance,
    bars: { ...appearance.bars, [bar]: { ...appearance.bars[bar], ...patch } },
  })

  const applyScheme = (scheme) => {
    const next = normalizeAppearance({
      ...appearance,
      ...clone(scheme.settings),
      custom: appearance.custom,
      schemes: appearance.schemes,
      activeSchemeId: scheme.id,
    })
    setSelectedSchemeId(scheme.id)
    setSchemeDirty(false)
    onChange(next)
  }

  const createScheme = () => {
    const id = `custom-${Date.now()}`
    const usedNames = new Set(schemes.map((scheme) => scheme.name))
    let index = schemes.length + 1
    let name = `新外观方案 ${index}`
    while (usedNames.has(name)) name = `新外观方案 ${++index}`
    const scheme = { id, name, settings: snapshotAppearance(appearance) }
    setSelectedSchemeId(id)
    setSchemeDirty(false)
    onChange({ ...appearance, schemes: [...schemes, scheme], activeSchemeId: id })
  }

  const renameScheme = (schemeId, name) => {
    onChange({ ...appearance, schemes: schemes.map((scheme) => scheme.id === schemeId ? { ...scheme, name: name.slice(0, 30) } : scheme) })
  }

  const saveScheme = () => {
    if (!selectedCustomScheme) return
    onChange({
      ...appearance,
      schemes: schemes.map((scheme) => scheme.id === selectedCustomScheme.id ? { ...scheme, name: scheme.name.trim() || '自定义外观', settings: snapshotAppearance(appearance) } : scheme),
      activeSchemeId: selectedCustomScheme.id,
    })
    setSchemeDirty(false)
  }

  const deleteScheme = (schemeId) => {
    const nextSchemes = schemes.filter((scheme) => scheme.id !== schemeId)
    const builtin = BUILTIN_SCHEMES.find((scheme) => scheme.id === `builtin-${appearance.theme}`) || BUILTIN_SCHEMES[0]
    setSelectedSchemeId(builtin.id)
    setSchemeDirty(false)
    onChange(normalizeAppearance({ ...appearance, ...clone(builtin.settings), custom: appearance.custom, schemes: nextSchemes, activeSchemeId: builtin.id }))
  }

  const assign = (asset, target) => {
    const assigned = appearance[target]?.asset?.id === asset.id
    updateScope(target, { asset: assigned ? null : asset, enabled: true })
  }

  const choose = async (target) => {
    setBusyScope(target)
    try {
      const asset = await window.readerAPI?.chooseBackground(target)
      if (!asset) return
      const existing = custom.find((item) => item.id === asset.id)
      const entry = { ...asset, kind: 'custom', name: existing?.name || (asset.fileName || '自定义背景').replace(/\.[^.]+$/, '') }
      const nextCustom = [...custom.filter((item) => item.id !== entry.id), entry]
      updateDraft({ ...appearance, custom: nextCustom, [target]: { ...appearance[target], asset: entry, enabled: true } })
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `背景导入失败：${error?.message || '无法读取图片'}` }))
    } finally {
      setBusyScope('')
    }
  }

  const renameBackground = (asset, name) => {
    const nextName = name.slice(0, 40)
    const updateSelected = (preference) => preference?.asset?.id === asset.id
      ? { ...preference, asset: { ...preference.asset, name: nextName } }
      : preference
    const updateScheme = (scheme) => ({
      ...scheme,
      settings: {
        ...scheme.settings,
        home: updateSelected(scheme.settings?.home),
        reader: updateSelected(scheme.settings?.reader),
      },
    })
    onChange({
      ...appearance,
      custom: custom.map((item) => item.id === asset.id ? { ...item, name: nextName } : item),
      home: updateSelected(appearance.home),
      reader: updateSelected(appearance.reader),
      schemes: schemes.map(updateScheme),
    })
  }

  const deleteBackground = async (asset) => {
    await window.readerAPI?.deleteBackground(asset.assetPath).catch(() => {})
    const clearIfSelected = (current) => current?.asset?.id === asset.id ? { ...current, asset: null, enabled: true } : current
    onChange({
      ...appearance,
      custom: custom.filter((item) => item.id !== asset.id),
      home: clearIfSelected(appearance.home),
      reader: clearIfSelected(appearance.reader),
      schemes: schemes.map((scheme) => ({
        ...scheme,
        settings: {
          ...scheme.settings,
          home: clearIfSelected(scheme.settings?.home),
          reader: clearIfSelected(scheme.settings?.reader),
        },
      })),
      activeSchemeId: '',
    })
    setSchemeDirty(true)
  }

  return (
    <div className="b-panel-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="b-appearance-panel is-compact" role="dialog" aria-modal="true" aria-label="外观设置">
        <header><div><span>外观</span><strong>主题与背景</strong></div><button className="b-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="b-appearance-body">
          <section className="b-schemes-section">
            <div className="b-section-heading"><div><h2>外观方案</h2><p>{schemeDirty ? '当前效果尚未保存到方案' : '切换时会应用整套背景、遮罩与界面配色'}</p></div><button className="b-secondary-button" onClick={createScheme}><Plus size={15} />新建方案</button></div>
            <div className="b-scheme-list" aria-label="外观方案">
              {BUILTIN_SCHEMES.map((scheme) => <button key={scheme.id} className={selectedSchemeId === scheme.id && !schemeDirty ? 'active' : ''} onClick={() => applyScheme(scheme)}><span className={`b-scheme-swatch is-${scheme.settings.theme}`}><i /><i /><i /></span><span><strong>{scheme.name}</strong><small>内置，只读</small></span>{selectedSchemeId === scheme.id && !schemeDirty ? <Check size={14} /> : null}</button>)}
              {schemes.map((scheme) => (
                <article className={selectedSchemeId === scheme.id ? `b-scheme-item active${schemeDirty ? ' is-dirty' : ''}` : 'b-scheme-item'} key={scheme.id}>
                  <button className="b-scheme-apply" onClick={() => applyScheme(scheme)} aria-label={`应用 ${scheme.name}`}><span className={`b-scheme-swatch is-${scheme.settings?.theme === 'night' ? 'night' : 'mist'}`}><i /><i /><i /></span></button>
                  <input value={scheme.name} maxLength={30} onChange={(event) => renameScheme(scheme.id, event.target.value)} aria-label={`重命名 ${scheme.name}`} />
                  {selectedSchemeId === scheme.id && !schemeDirty ? <Check size={14} /> : null}
                  <button className="b-icon-button danger" onClick={() => deleteScheme(scheme.id)} title="删除方案" aria-label={`删除 ${scheme.name}`}><Trash2 size={14} /></button>
                </article>
              ))}
            </div>
          </section>

          <section className="b-theme-section">
            <h2>主题</h2>
            <div className="b-theme-switch">
              {THEMES.map((theme) => (
                <button key={theme.id} className={appearance.theme === theme.id ? 'active' : ''} onClick={() => updateDraft({ ...appearance, theme: theme.id })}>
                  <span className="b-theme-swatches">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
                  <span>{theme.name}</span>
                  {appearance.theme === theme.id ? <Check size={14} /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="b-background-section">
            <div className="b-section-heading"><div><h2>背景</h2></div><div className="b-segmented" aria-label="背景使用位置">{Object.entries(SCOPE_LABELS).map(([id, label]) => <button key={id} className={scope === id ? 'active' : ''} onClick={() => setScope(id)}>{label}</button>)}</div></div>
            <div className="b-background-source-row">
              <div><strong>{scopePreference.asset?.name || '跟随主题默认背景'}</strong><span>{scopePreference.asset?.fileName || '使用对应深浅主题的主页背景图'}</span></div>
              {scopePreference.asset ? <button className="b-icon-button" onClick={() => updateScope(scope, { asset: null, enabled: true })} title="恢复默认背景" aria-label="恢复默认背景"><RotateCcw size={15} /></button> : null}
              <button className="b-secondary-button" onClick={() => choose(scope)} disabled={Boolean(busyScope)}><ImagePlus size={16} />{busyScope === scope ? '导入中' : '上传图片'}</button>
            </div>
            <div className="b-scope-overlay-grid">
              {THEMES.map((theme) => {
                const overlay = scopePreference.overlay[theme.id]
                return <div className="b-overlay-theme-group" key={theme.id}><strong>{theme.name}遮罩</strong><OverlayGradientControl overlay={overlay} onChange={(patch) => updateOverlay(scope, theme.id, patch)} /><ColorOpacityControl label="起点" color={overlay.startColor} opacity={overlay.startOpacity} onColor={(startColor) => updateOverlay(scope, theme.id, { startColor })} onOpacity={(startOpacity) => updateOverlay(scope, theme.id, { startOpacity })} /><ColorOpacityControl label="终点" color={overlay.endColor} opacity={overlay.endOpacity} onColor={(endColor) => updateOverlay(scope, theme.id, { endColor })} onOpacity={(endOpacity) => updateOverlay(scope, theme.id, { endOpacity })} /></div>
              })}
            </div>
          </section>

          <section className="b-background-library-section">
            <div className="b-section-heading"><div><h2>已上传背景</h2></div></div>
            {custom.length ? (
              <div className="b-background-library" aria-label="已上传背景">
                {custom.map((entry) => {
                  const usedHome = appearance.home?.asset?.id === entry.id
                  const usedReader = appearance.reader?.asset?.id === entry.id
                  return (
                    <article className="b-background-card" key={entry.id}>
                      <div className="b-background-thumb">{thumbs[entry.id] ? <img src={thumbs[entry.id]} alt="" /> : null}</div>
                      <div className="b-background-meta"><input value={entry.name || ''} maxLength={40} onChange={(event) => renameBackground(entry, event.target.value)} aria-label={`重命名 ${entry.fileName || '背景图片'}`} /><span>{entry.fileName || '本地图片'}</span></div>
                      <div className="b-background-targets" aria-label={`${entry.name || entry.fileName} 使用位置`}>
                        <button className={usedHome ? 'active' : ''} onClick={() => assign(entry, 'home')}>{usedHome ? <Check size={13} /> : null}主页</button>
                        <button className={usedReader ? 'active' : ''} onClick={() => assign(entry, 'reader')}>{usedReader ? <Check size={13} /> : null}阅读</button>
                      </div>
                      <button className="b-icon-button danger" onClick={() => deleteBackground(entry)} title="删除背景" aria-label={`删除 ${entry.name || entry.fileName}`}><Trash2 size={15} /></button>
                    </article>
                  )
                })}
              </div>
            ) : <div className="b-background-library-empty"><ImagePlus size={22} /><span>还没有上传背景</span></div>}
          </section>

          <section className="b-bars-section">
            <div className="b-section-heading"><div><h2>界面条与图标</h2></div></div>
            <div className="b-bar-controls">
              <div><strong>顶部栏</strong><ColorOpacityControl label="栏" color={appearance.bars.top.color} opacity={appearance.bars.top.opacity} onColor={(color) => updateBar('top', { color })} onOpacity={(opacity) => updateBar('top', { opacity })} /><ColorOpacityControl label="图标" color={appearance.bars.top.iconColor} opacity={appearance.bars.top.iconOpacity} onColor={(iconColor) => updateBar('top', { iconColor })} onOpacity={(iconOpacity) => updateBar('top', { iconOpacity })} /></div>
              <div><strong>主页底栏</strong><ColorOpacityControl label="栏" color={appearance.bars.bottom.color} opacity={appearance.bars.bottom.opacity} onColor={(color) => updateBar('bottom', { color })} onOpacity={(opacity) => updateBar('bottom', { opacity })} /><ColorOpacityControl label="侧图标" color={appearance.bars.bottom.iconColor} opacity={appearance.bars.bottom.iconOpacity} onColor={(iconColor) => updateBar('bottom', { iconColor })} onOpacity={(iconOpacity) => updateBar('bottom', { iconOpacity })} /><ColorOpacityControl label="切换圆" color={appearance.bars.bottom.circleColor} opacity={appearance.bars.bottom.circleOpacity} onColor={(circleColor) => updateBar('bottom', { circleColor })} onOpacity={(circleOpacity) => updateBar('bottom', { circleOpacity })} /><GradientOpacityControl label="太阳" startColor={appearance.bars.bottom.sunStartColor} endColor={appearance.bars.bottom.sunEndColor} opacity={appearance.bars.bottom.sunOpacity} onStartColor={(sunStartColor) => updateBar('bottom', { sunStartColor })} onEndColor={(sunEndColor) => updateBar('bottom', { sunEndColor })} onOpacity={(sunOpacity) => updateBar('bottom', { sunOpacity })} /><GradientOpacityControl label="月亮" startColor={appearance.bars.bottom.moonStartColor} endColor={appearance.bars.bottom.moonEndColor} opacity={appearance.bars.bottom.moonOpacity} onStartColor={(moonStartColor) => updateBar('bottom', { moonStartColor })} onEndColor={(moonEndColor) => updateBar('bottom', { moonEndColor })} onOpacity={(moonOpacity) => updateBar('bottom', { moonOpacity })} /></div>
            </div>
          </section>
        </div>
        <footer><span className="b-scheme-save-status">{selectedCustomScheme ? (schemeDirty ? `“${selectedCustomScheme.name}”有未保存更改` : `已保存到“${selectedCustomScheme.name}”`) : (selectedSchemeId.startsWith('builtin-') && !schemeDirty ? '当前为内置默认方案' : '新建方案后可保存当前效果')}</span>{selectedCustomScheme ? <button className="b-secondary-button" onClick={saveScheme} disabled={!schemeDirty}><Save size={15} />保存方案</button> : null}<button className="b-primary-button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}
