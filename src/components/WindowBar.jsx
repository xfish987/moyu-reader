import { BookOpen, Minus, Pin, X } from 'lucide-react'

export default function WindowBar({ pinned, onTogglePin }) {
  return (
    <header className="window-bar">
      <div className="brand-lockup">
        <BookOpen size={16} strokeWidth={1.8} />
        <span>墨读阅读器</span>
      </div>
      <div className="window-actions">
        <button className={pinned ? 'pin-button active' : 'pin-button'} aria-label={pinned ? '取消置顶' : '窗口置顶'} title={pinned ? '取消置顶' : '固定在最前'} onClick={onTogglePin}><Pin size={14} fill={pinned ? 'currentColor' : 'none'} /></button>
        <button aria-label="最小化" title="最小化" onClick={() => window.readerAPI.minimize()}><Minus size={15} /></button>
        <button className="close-button" aria-label="关闭" title="关闭" onClick={() => window.readerAPI.close()}><X size={15} /></button>
      </div>
    </header>
  )
}
