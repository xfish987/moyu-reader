import { useEffect, useRef, useState } from 'react'
import { Check, X, ZoomIn } from 'lucide-react'

const FRAME = 264
const OUTPUT = 256

// 头像裁切：方形取景框，拖动平移、滑杆缩放，确认后在客户端压缩为 256×256。
export default function AvatarCropDialog({ image, onCancel, onConfirm }) {
  const [meta, setMeta] = useState(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const dragRef = useRef(null)

  useEffect(() => {
    const img = new Image()
    img.onload = () => setMeta({ img, width: img.naturalWidth, height: img.naturalHeight, base: FRAME / Math.min(img.naturalWidth, img.naturalHeight) })
    img.src = image
  }, [image])

  const scale = meta ? meta.base * zoom : 1
  const clampAxis = (value, size, scaleValue) => {
    const limit = Math.max(0, (size * scaleValue - FRAME) / 2)
    return Math.min(limit, Math.max(-limit, value))
  }
  const clampOffset = (next, scaleValue = scale) => meta ? { x: clampAxis(next.x, meta.width, scaleValue), y: clampAxis(next.y, meta.height, scaleValue) } : next

  const onPointerDown = (event) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { startX: event.clientX, startY: event.clientY, origin: offset }
  }
  const onPointerMove = (event) => {
    if (!dragRef.current) return
    setOffset(clampOffset({ x: dragRef.current.origin.x + event.clientX - dragRef.current.startX, y: dragRef.current.origin.y + event.clientY - dragRef.current.startY }))
  }
  const onPointerUp = () => { dragRef.current = null }

  const changeZoom = (next) => {
    setZoom(next)
    if (meta) setOffset((current) => clampOffset(current, meta.base * next))
  }

  const confirm = () => {
    if (!meta) return
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT
    canvas.height = OUTPUT
    const ctx = canvas.getContext('2d')
    const visible = FRAME / scale
    const centerX = meta.width / 2 - offset.x / scale
    const centerY = meta.height / 2 - offset.y / scale
    ctx.drawImage(meta.img, centerX - visible / 2, centerY - visible / 2, visible, visible, 0, 0, OUTPUT, OUTPUT)
    let url = canvas.toDataURL('image/webp', 0.88)
    if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/jpeg', 0.88)
    onConfirm(url)
  }

  return (
    <div className="b-danger-overlay" role="dialog" aria-modal="true" aria-label="裁切头像">
      <section className="b-avatar-crop">
        <header><strong>裁切头像</strong><button className="b-icon-button" onClick={onCancel} aria-label="取消"><X size={16} /></button></header>
        <div className="b-avatar-crop-frame" style={{ width: FRAME, height: FRAME }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
          {meta ? <img src={image} alt="待裁切头像" draggable="false" style={{ width: meta.width * scale, height: meta.height * scale, transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))` }} /> : null}
          <i aria-hidden="true" />
        </div>
        <label className="b-avatar-crop-zoom"><ZoomIn size={15} /><input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => changeZoom(Number(event.target.value))} aria-label="缩放" /></label>
        <footer><button className="b-secondary-button" onClick={onCancel}>取消</button><button className="b-primary-button" disabled={!meta} onClick={confirm}><Check size={15} />使用这个头像</button></footer>
      </section>
    </div>
  )
}
