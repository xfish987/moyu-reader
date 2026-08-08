import { AlignJustify, Eye, EyeOff, Minus, Plus, RotateCcw, Type } from 'lucide-react'
import { getNearestReaderFontWeight, getReaderFontFaceOptions, normalizeEpubFontOverride, normalizeReaderFontFamily, READER_FONT_OPTIONS } from '../readerFonts'

function Stepper({ value, min, max, step, onChange, suffix }) {
  return (
    <div className="stepper">
      <button aria-label="减小" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}><Minus size={14} /></button>
      <span>{value}{suffix}</span>
      <button aria-label="增大" onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}><Plus size={14} /></button>
    </div>
  )
}

function FontSelect({ label, value, weight, onChange, onWeightChange }) {
  const family = normalizeReaderFontFamily(value)
  const faces = getReaderFontFaceOptions(family)
  const normalizedWeight = getNearestReaderFontWeight(family, weight)
  return (
    <label className="epub-font-select">
      <span>{label}</span>
      <select value={family} title={READER_FONT_OPTIONS.find((option) => option.value === family)?.label} onChange={(event) => {
        const nextFamily = event.target.value
        onChange(nextFamily, getNearestReaderFontWeight(nextFamily, normalizedWeight))
      }}>
        {READER_FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <select value={normalizedWeight} onChange={(event) => onWeightChange(Number(event.target.value))}>
        {faces.map((face) => <option key={face.value} value={face.value}>{face.label}</option>)}
      </select>
    </label>
  )
}

export default function ReaderSettings({ settings, onChange, encoding, onEncodingChange, epubFontOverride, epubFontFeatures = {}, onEpubFontOverrideChange }) {
  const set = (key, value) => onChange((current) => ({ ...current, [key]: value }))
  const setMany = (patch) => onChange((current) => ({ ...current, ...patch }))
  const isEpub = epubFontOverride !== undefined
  const override = normalizeEpubFontOverride(epubFontOverride, settings.fontFamily)
  const setOverride = (patch) => onEpubFontOverrideChange?.((current) => ({
    ...normalizeEpubFontOverride(current, settings.fontFamily),
    ...patch,
  }))
  return (
    <aside className="settings-panel">
      <div className="settings-title"><Type size={16} /><strong>阅读设置</strong></div>

      {!isEpub ? <section>
        <label>字体</label>
        <div className="reader-font-options">
          <FontSelect
            label="标题 / 章节"
            value={settings.titleFontFamily || settings.fontFamily}
            weight={settings.titleFontWeight ?? 700}
            onChange={(family, weight) => setMany({ titleFontFamily: family, titleFontWeight: weight })}
            onWeightChange={(weight) => set('titleFontWeight', weight)}
          />
          <FontSelect
            label="正文"
            value={settings.fontFamily}
            weight={settings.fontWeight ?? 400}
            onChange={(family, weight) => setMany({ fontFamily: family, fontWeight: weight })}
            onWeightChange={(weight) => set('fontWeight', weight)}
          />
        </div>
      </section> : (
        <section className="epub-font-override">
          <div className="setting-row">
            <div><Type size={15} /><span>强制替换为选定字体</span></div>
            <button className={`setting-toggle ${override.enabled ? 'active' : ''}`} role="switch" aria-checked={override.enabled} onClick={() => setOverride({ enabled: !override.enabled })}><span /></button>
          </div>
          {override.enabled ? (
            <div className="epub-font-options">
              <FontSelect label="标题 / 章节" value={override.titleFont} weight={override.titleWeight} onChange={(font, weight) => setOverride({ titleFont: font, titleWeight: weight })} onWeightChange={(value) => setOverride({ titleWeight: value })} />
              <FontSelect label="正文" value={override.bodyFont} weight={override.bodyWeight} onChange={(font, weight) => setOverride({ bodyFont: font, bodyWeight: weight })} onWeightChange={(value) => setOverride({ bodyWeight: value })} />
              {epubFontFeatures.bold ? <FontSelect label="粗体" value={override.boldFont} weight={override.boldWeight} onChange={(font, weight) => setOverride({ boldFont: font, boldWeight: weight })} onWeightChange={(value) => setOverride({ boldWeight: value })} /> : null}
              {epubFontFeatures.italic ? <FontSelect label="斜体" value={override.italicFont} weight={override.italicWeight} onChange={(font, weight) => setOverride({ italicFont: font, italicWeight: weight })} onWeightChange={(value) => setOverride({ italicWeight: value })} /> : null}
              <button className="epub-font-reset" onClick={() => onEpubFontOverrideChange?.(null)}><RotateCcw size={13} />重置</button>
            </div>
          ) : null}
        </section>
      )}
      {encoding ? (
        <section>
          <label>TXT 编码 <span>识别错误时手动切换</span></label>
          <select className="encoding-select" value={encoding} onChange={(event) => onEncodingChange(event.target.value)}>
            <option value="UTF-8">UTF-8</option>
            <option value="GB18030">GB18030 / GBK</option>
            <option value="Big5">Big5</option>
            <option value="UTF-16LE">UTF-16 LE</option>
            <option value="UTF-16BE">UTF-16 BE</option>
          </select>
        </section>
      ) : null}
      <section>
        <label>简繁转换 <span>仅改变显示，不修改源文件</span></label>
        <div className="segment-control">
          <button className={(settings.scriptConversion || 'none') === 'none' ? 'active' : ''} onClick={() => set('scriptConversion', 'none')}>不转换</button>
          <button className={settings.scriptConversion === 'simplified' ? 'active' : ''} onClick={() => set('scriptConversion', 'simplified')}>转简体</button>
          <button className={settings.scriptConversion === 'traditional' ? 'active' : ''} onClick={() => set('scriptConversion', 'traditional')}>转繁体</button>
        </div>
      </section>

      <section className="setting-row">
        <div><Type size={15} /><span>字号</span></div>
        <Stepper value={settings.fontSize} min={14} max={36} step={1} onChange={(value) => set('fontSize', value)} suffix="" />
      </section>
      <section className="setting-row">
        <div><AlignJustify size={15} /><span>行距</span></div>
        <Stepper value={settings.lineHeight} min={1.3} max={2.4} step={0.1} onChange={(value) => set('lineHeight', value)} suffix="" />
      </section>
      <section>
        <label>段落间距 <span>{settings.paragraphGap}px</span></label>
        <input type="range" min="4" max="32" step="2" value={settings.paragraphGap} onChange={(event) => set('paragraphGap', Number(event.target.value))} />
      </section>
      <section>
        <label>字间距 <span>{settings.letterSpacing}px</span></label>
        <input type="range" min="0" max="3" step="0.25" value={settings.letterSpacing} onChange={(event) => set('letterSpacing', Number(event.target.value))} />
      </section>
      <section>
        <label>页边距 <span>{settings.pageMargin}px</span></label>
        <input type="range" min="28" max="100" step="4" value={settings.pageMargin} onChange={(event) => set('pageMargin', Number(event.target.value))} />
      </section>
      <section>
        <label>文字透明度 <span>{Math.round(settings.opacity * 100)}%</span></label>
        <input type="range" min="0.15" max="1" step="0.05" value={settings.opacity} onChange={(event) => set('opacity', Number(event.target.value))} />
      </section>
      <section className="setting-row">
        <div>{settings.showProgress ? <Eye size={15} /> : <EyeOff size={15} />}<span>显示阅读进度</span></div>
        <button className={`setting-toggle ${settings.showProgress ? 'active' : ''}`} role="switch" aria-checked={settings.showProgress} onClick={() => set('showProgress', !settings.showProgress)}><span /></button>
      </section>
    </aside>
  )
}
