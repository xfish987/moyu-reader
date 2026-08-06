import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'

// AI 陪读状态栏：吸附在阅读窗底部外侧的独立小窗（owned 子窗口随主窗同进退）。
// 只做状态展示 + 三个动作入口，动作全部经 IPC 转发回阅读窗执行。
export default function CompanionBarWindow() {
  const [snapshot, setSnapshot] = useState(null)
  useEffect(() => window.readerAPI?.onCompanionBarSync?.((next) => setSnapshot(next)), [])
  const generating = Boolean(snapshot?.generating)
  const label = String(snapshot?.label || '')
  const action = (type) => window.readerAPI?.sendCompanionBarAction?.({ type })

  return (
    <div className="companion-bar-window">
      <span className="companion-status">
        <Sparkles size={13} />
        {generating ? `AI 正在陪读 · 正在总结《${label}》…` : 'AI 正在陪读'}
        {generating ? <span className="ai-thinking"><i /><i /><i /></span> : null}
      </span>
      <div className="companion-actions">
        <button onClick={() => action('open-storyline')}><span className="companion-action-full">查看剧情梳理</span><span className="companion-action-short">梳理</span></button>
        <button onClick={() => action('open-companion')}><span className="companion-action-full">剧情提问</span><span className="companion-action-short">提问</span></button>
        <button onClick={() => action('stop')}>停止</button>
      </div>
    </div>
  )
}
