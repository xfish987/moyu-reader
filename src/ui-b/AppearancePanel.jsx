import { useEffect, useMemo, useState } from 'react'
import { Check, ImagePlus, Trash2, X } from 'lucide-react'

const THEMES = [
  { id: 'mist', name: '浅色', colors: ['#e8ecef', '#c5d8e6', '#396081'] },
  { id: 'night', name: '深色', colors: ['#01162b', '#1c2b48', '#8eb1d1'] },
]

export default function AppearancePanel({ appearance, onChange, onClose }) {
  const [busy, setBusy] = useState(false)
  const [thumbs, setThumbs] = useState({})
  const custom = useMemo(() => (Array.isArray(appearance.custom) ? appearance.custom : []), [appearance.custom])

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

  const toggleAssignment = (asset, target) => {
    const current = appearance[target]
    const assigned = current?.asset?.id === asset.id
    onChange({
      ...appearance,
      [target]: { ...current, asset: assigned ? null : asset, enabled: !assigned, autoAdaptTheme: false },
    })
  }

  const choose = async () => {
    setBusy(true)
    try {
      const asset = await window.readerAPI?.chooseBackground('library')
      if (!asset) return
      const entry = { ...asset, kind: 'custom', name: (asset.fileName || '自定义背景').replace(/\.[^.]+$/, '') }
      const nextCustom = [...custom.filter((item) => item.id !== entry.id), entry]
      onChange({ ...appearance, custom: nextCustom })
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `背景导入失败：${error?.message || '无法读取图片'}` }))
    } finally {
      setBusy(false)
    }
  }

  const deleteBackground = async (asset) => {
    await window.readerAPI?.deleteBackground(asset.assetPath).catch(() => {})
    const clearIfSelected = (current) => current?.asset?.id === asset.id
      ? { ...current, asset: null, enabled: false, autoAdaptTheme: false }
      : current
    onChange({
      ...appearance,
      custom: custom.filter((item) => item.id !== asset.id),
      home: clearIfSelected(appearance.home),
      reader: clearIfSelected(appearance.reader),
    })
  }

  return (
    <div className="b-panel-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="b-appearance-panel is-compact" role="dialog" aria-modal="true" aria-label="外观设置">
        <header><div><span>外观</span><strong>主题与背景</strong></div><button className="b-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="b-appearance-body">
          <section className="b-theme-section">
            <h2>主题</h2>
            <div className="b-theme-switch">
              {THEMES.map((theme) => (
                <button key={theme.id} className={appearance.theme === theme.id ? 'active' : ''} onClick={() => onChange({ ...appearance, theme: theme.id })}>
                  <span className="b-theme-swatches">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
                  <span>{theme.name}</span>
                  {appearance.theme === theme.id ? <Check size={14} /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="b-background-section">
            <div className="b-section-heading"><div><h2>上传背景</h2><p>为每张图片指定使用位置；未指定时使用当前主题背景。</p></div><button className="b-secondary-button" onClick={choose} disabled={busy}><ImagePlus size={16} />上传图片</button></div>
            {custom.length ? (
              <div className="b-background-library" aria-label="已上传背景">
                {custom.map((entry) => {
                  const usedHome = appearance.home?.asset?.id === entry.id
                  const usedReader = appearance.reader?.asset?.id === entry.id
                  return (
                    <article className="b-background-card" key={entry.id}>
                      <div className="b-background-thumb">{thumbs[entry.id] ? <img src={thumbs[entry.id]} alt="" /> : null}</div>
                      <div className="b-background-meta"><strong>{entry.name || entry.fileName}</strong><span>{entry.fileName || '本地图片'}</span></div>
                      <div className="b-background-targets" aria-label={`${entry.name || entry.fileName} 使用位置`}>
                        <button className={usedHome ? 'active' : ''} onClick={() => toggleAssignment(entry, 'home')}>{usedHome ? <Check size={13} /> : null}主页</button>
                        <button className={usedReader ? 'active' : ''} onClick={() => toggleAssignment(entry, 'reader')}>{usedReader ? <Check size={13} /> : null}阅读</button>
                      </div>
                      <button className="b-icon-button danger" onClick={() => deleteBackground(entry)} title="删除背景" aria-label={`删除 ${entry.name || entry.fileName}`}><Trash2 size={15} /></button>
                    </article>
                  )
                })}
              </div>
            ) : <div className="b-background-library-empty"><ImagePlus size={22} /><span>还没有上传背景</span></div>}
          </section>
        </div>
        <footer><button className="b-primary-button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}
