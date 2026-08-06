import { useEffect, useState } from 'react'
import { BookOpen, Copy, Minus, Palette, Pin, Square, X } from 'lucide-react'

export default function WindowBar({ pinned, onTogglePin, onOpenAppearance }) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => window.readerAPI?.onMaximized?.(setMaximized), [])
  return (
    <header className="window-bar" onDoubleClick={(event) => { if (!event.target.closest('button')) window.readerAPI.maximize() }}>
      <div className="brand-lockup">
        <BookOpen size={16} strokeWidth={1.8} />
        <span>墨读书房</span>
      </div>
      <div className="window-center-actions">
        <button title="外观设置" aria-label="外观设置" onClick={onOpenAppearance}><Palette size={16} strokeWidth={1.75} /></button>
        <button className={pinned ? 'pin-button active' : 'pin-button'} aria-label={pinned ? '取消置顶' : '窗口置顶'} title={pinned ? '取消置顶' : '固定在最前'} onClick={onTogglePin}><Pin size={15} strokeWidth={1.75} fill={pinned ? 'currentColor' : 'none'} /></button>
      </div>
      <div className="window-actions" aria-label="窗口控制">
        <button aria-label="最小化" title="最小化" onClick={() => window.readerAPI.minimize()}><Minus size={17} strokeWidth={1.7} /></button>
        <button aria-label={maximized ? '还原窗口' : '最大化'} title={maximized ? '还原窗口' : '最大化'} onClick={() => window.readerAPI.maximize()}>{maximized ? <Copy size={14} strokeWidth={1.7} /> : <Square size={13} strokeWidth={1.7} />}</button>
        <button className="close-button" aria-label="关闭" title="关闭" onClick={() => window.readerAPI.close()}><X size={17} strokeWidth={1.7} /></button>
      </div>
    </header>
  )
}
