import { AlignJustify, Circle, Eye, EyeOff, Minus, Plus, Type } from 'lucide-react'

const FONT_OPTIONS = [
  { label: '宋体', value: 'serif' },
  { label: '黑体', value: 'sans' },
  { label: '楷体', value: 'kai' },
]

const THEMES = [
  { label: '纸白', value: 'paper', color: '#f7f5ef' },
  { label: '护眼', value: 'sage', color: '#dfe7da' },
  { label: '夜间', value: 'night', color: '#202322' },
]

function Stepper({ value, min, max, step, onChange, suffix }) {
  return (
    <div className="stepper">
      <button aria-label="减小" onClick={() => onChange(Math.max(min, +(value - step).toFixed(2)))}><Minus size={14} /></button>
      <span>{value}{suffix}</span>
      <button aria-label="增大" onClick={() => onChange(Math.min(max, +(value + step).toFixed(2)))}><Plus size={14} /></button>
    </div>
  )
}

export default function ReaderSettings({ settings, onChange, encoding, onEncodingChange }) {
  const set = (key, value) => onChange((current) => ({ ...current, [key]: value }))
  return (
    <aside className="settings-panel">
      <div className="settings-title"><Type size={16} /><strong>阅读设置</strong></div>

      <section>
        <label>字体</label>
        <div className="segment-control">
          {FONT_OPTIONS.map((option) => (
            <button key={option.value} className={settings.fontFamily === option.value ? 'active' : ''} onClick={() => set('fontFamily', option.value)}>{option.label}</button>
          ))}
        </div>
      </section>
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
      <section>
        <label>主题</label>
        <div className="theme-options">
          {THEMES.map((theme) => (
            <button key={theme.value} className={settings.theme === theme.value ? 'active' : ''} onClick={() => set('theme', theme.value)} title={theme.label}>
              <Circle size={24} fill={theme.color} color={theme.value === 'night' ? '#434846' : '#c5c4be'} />
              <span>{theme.label}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  )
}
