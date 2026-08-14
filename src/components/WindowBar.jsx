import { useEffect, useState } from 'react'
import keyboardIcon from '../ui-b/assets/dark-shelf/keyboard.svg'
import moonIcon from '../ui-b/assets/dark-shelf/theme-moon-icon.svg'
import sunIcon from '../ui-b/assets/light-shelf/theme-sun-icon.svg'
import minimizeIcon from '../ui-b/assets/dark-shelf/minimize.svg'
import maximizeIcon from '../ui-b/assets/dark-shelf/maximize.svg'
import closeIcon from '../ui-b/assets/dark-shelf/close.svg'

export default function WindowBar({ onOpenShortcuts, appearanceTheme = 'mist', onToggleTheme }) {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => window.readerAPI?.onMaximized?.(setMaximized), [])
  const icon = (source, className = '') => <span className={`window-action-icon ${className}`} style={{ '--window-icon': `url("${source}")` }} aria-hidden="true" />
  return (
    <header className="window-bar" onDoubleClick={(event) => { if (!event.target.closest('button')) window.readerAPI.maximize() }}>
      <div className="brand-lockup"><span>MODU</span></div>
      <div className="window-actions" aria-label="窗口控制">
        {onToggleTheme ? (
          <button className="reader-theme-toggle" title={appearanceTheme === 'night' ? '切换为浅色阅读' : '切换为深色阅读'} aria-label={appearanceTheme === 'night' ? '切换为浅色阅读' : '切换为深色阅读'} onClick={onToggleTheme}>
            {icon(appearanceTheme === 'night' ? moonIcon : sunIcon, 'is-theme')}
          </button>
        ) : null}
        <button className="keyboard-indicator" title="快捷键设置" aria-label="打开快捷键设置" onClick={onOpenShortcuts}>{icon(keyboardIcon, 'is-keyboard')}</button>
        <button aria-label="最小化" title="最小化" onClick={() => window.readerAPI.minimize()}>{icon(minimizeIcon)}</button>
        <button aria-label={maximized ? '还原窗口' : '最大化'} title={maximized ? '还原窗口' : '最大化'} onClick={() => window.readerAPI.maximize()}>{icon(maximizeIcon)}</button>
        <button className="close-button" aria-label="关闭" title="关闭" onClick={() => window.readerAPI.close()}>{icon(closeIcon)}</button>
      </div>
    </header>
  )
}
