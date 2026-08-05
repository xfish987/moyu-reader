import { useEffect, useState } from 'react'
import { BookOpenCheck } from 'lucide-react'

// 设定集收起后的悬浮小图标（独立小窗，屏幕右缘，可拖动，点击展开完整窗口）。
export default function ProfilesFab() {
  const [snapshot, setSnapshot] = useState(null)
  useEffect(() => window.readerAPI?.onProfilesSync?.((next) => setSnapshot(next)), [])
  const active = (snapshot?.profileTasks || []).filter((task) => !['done', 'error'].includes(task.status)).length
  return (
    <div className="profiles-fab-window">
      <button className="profiles-fab-button" onClick={() => window.readerAPI?.expandProfilesWindow?.()} title="展开设定集">
        <BookOpenCheck size={19} />
        {active ? <span>{active}</span> : null}
      </button>
    </div>
  )
}
