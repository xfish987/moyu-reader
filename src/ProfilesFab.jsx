import { useEffect, useRef, useState } from 'react'
import { BookOpenCheck } from 'lucide-react'

// 设定集收起后的悬浮小图标（独立小窗，阅读窗右缘，owned 子窗口随主窗同进退）。
// 交互：按住移动超过阈值即拖动窗口（IPC 位移）；未发生位移的单击展开完整窗口。
// 不能用 -webkit-app-region: drag 覆盖按钮：Windows 会把点击吞进原生拖动处理。
const DRAG_THRESHOLD = 4

export default function ProfilesFab() {
  const [snapshot, setSnapshot] = useState(null)
  const dragRef = useRef(null)
  useEffect(() => window.readerAPI?.onProfilesSync?.((next) => setSnapshot(next)), [])
  const active = (snapshot?.profileTasks || []).filter((task) => !['done', 'error'].includes(task.status)).length

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.screenX, y: event.screenY, moved: false }
  }
  const onPointerMove = (event) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.screenX - drag.x
    const dy = event.screenY - drag.y
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return
    drag.moved = true
    drag.x = event.screenX
    drag.y = event.screenY
    window.readerAPI?.dragProfilesFab?.({ dx, dy })
  }
  const onPointerUp = () => {
    const wasDrag = dragRef.current?.moved
    dragRef.current = null
    if (wasDrag) window.readerAPI?.dragProfilesFabEnd?.()
    else window.readerAPI?.expandProfilesWindow?.()
  }

  return (
    <div className="profiles-fab-window">
      <button
        className="profiles-fab-button"
        title="展开设定集（按住可拖动）"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <BookOpenCheck size={19} />
        {active ? <span>{active}</span> : null}
      </button>
    </div>
  )
}
