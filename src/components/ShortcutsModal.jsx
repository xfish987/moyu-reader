import { useEffect, useState } from 'react'
import { Keyboard, RotateCcw, X } from 'lucide-react'
import { DEFAULT_SHORTCUTS, SHORTCUT_ACTIONS, displayKey, normalizeKey } from '../shortcuts'

// 快捷键设置：查看与修改。点击按键徽标后按下新键完成修改；
// Esc 取消捕获，Delete/Backspace 恢复该项默认。老板键只接受 F1–F12（全局注册，字母会劫持系统输入）。
export default function ShortcutsModal({ shortcuts, setShortcuts, onClose }) {
  const [capturing, setCapturing] = useState(null)

  useEffect(() => {
    if (!capturing) return undefined
    const handler = (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') { setCapturing(null); return }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        setShortcuts((current) => ({ ...current, [capturing]: DEFAULT_SHORTCUTS[capturing] }))
        setCapturing(null)
        return
      }
      let key = normalizeKey(event)
      if (!key) return
      if (capturing === 'boss' && !/^F([1-9]|1[0-2])$/.test(key)) return
      setShortcuts((current) => ({ ...current, [capturing]: key }))
      setCapturing(null)
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [capturing, setShortcuts])

  return (
    <div className="manager-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <div className="book-manager shortcuts-modal" role="dialog" aria-label="快捷键设置">
        <header>
          <div><Keyboard size={16} /><strong>快捷键</strong></div>
          <button onClick={onClose} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="manager-content shortcuts-list">
          {SHORTCUT_ACTIONS.map((action) => (
            <div className="shortcut-row" key={action.id}>
              <div>
                <strong>{action.label}</strong>
                {action.note ? <span>{action.note}</span> : null}
              </div>
              <button className={`shortcut-key ${capturing === action.id ? 'capturing' : ''}`} onClick={() => setCapturing(capturing === action.id ? null : action.id)}>
                {capturing === action.id ? '按新键…' : displayKey(shortcuts[action.id] || DEFAULT_SHORTCUTS[action.id])}
              </button>
            </div>
          ))}
          <p className="shortcut-tip">点击右侧按键后按下新键即可修改；Esc 取消，Delete 恢复该项默认。翻页 ←/→ 方向键与阅读中 +/− 文字浓度调节为固定按键。</p>
          <div className="shortcut-footer">
            <button onClick={() => setShortcuts({ ...DEFAULT_SHORTCUTS })}><RotateCcw size={13} /> 全部恢复默认</button>
          </div>
        </div>
      </div>
    </div>
  )
}
