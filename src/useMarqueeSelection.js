import { useRef, useState } from 'react'

const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top

// Desktop-style rubber-band selection. The gesture only starts from blank container space.
export function useMarqueeSelection({ itemSelector, idAttribute, selectedIds, onChange, disabled = false }) {
  const [box, setBox] = useState(null)
  const gestureRef = useRef(null)

  const onPointerDown = (event) => {
    if (disabled || event.button !== 0 || event.target.closest(itemSelector) || event.target.closest('button,input,textarea,select,a')) return
    const start = { x: event.clientX, y: event.clientY }
    const baseline = event.ctrlKey || event.metaKey ? new Set(selectedIds) : new Set()
    gestureRef.current = { start, moved: false, baseline }
    const move = (moveEvent) => {
      const gesture = gestureRef.current
      if (!gesture) return
      if (!gesture.moved && Math.abs(moveEvent.clientX - start.x) + Math.abs(moveEvent.clientY - start.y) < 4) return
      gesture.moved = true
      const rect = {
        left: Math.min(start.x, moveEvent.clientX), top: Math.min(start.y, moveEvent.clientY),
        right: Math.max(start.x, moveEvent.clientX), bottom: Math.max(start.y, moveEvent.clientY),
      }
      setBox({ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top })
      const next = new Set(gesture.baseline)
      document.querySelectorAll(itemSelector).forEach((item) => {
        const id = item.getAttribute(idAttribute)
        if (id && intersects(rect, item.getBoundingClientRect())) next.add(id)
      })
      onChange(next)
    }
    const up = () => {
      const moved = gestureRef.current?.moved
      gestureRef.current = null
      setBox(null)
      if (!moved && !(event.ctrlKey || event.metaKey)) onChange(new Set())
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
  }

  return { box, onPointerDown }
}
