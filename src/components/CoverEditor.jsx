import { useRef, useState } from 'react'
import { Check, ImagePlus, RotateCcw, X } from 'lucide-react'

// 封面裁切固定比例与输出尺寸，与书架 .book-cover 的 3:4.15 一致
const RATIO = 4.15 / 3
const OUTPUT_WIDTH = 300
const OUTPUT_HEIGHT = 415
const MAX_STAGE_WIDTH = 360
const MAX_STAGE_HEIGHT = 420
const MIN_SIZE = 48

function clampCrop(next, stage) {
  const maxSize = Math.floor(Math.min(stage.stageWidth, stage.stageHeight / RATIO))
  const size = Math.min(Math.max(Math.round(next.size), MIN_SIZE), maxSize)
  const maxX = stage.stageWidth - size
  const maxY = stage.stageHeight - size * RATIO
  return {
    size,
    x: Math.min(Math.max(Math.round(next.x), 0), Math.max(0, maxX)),
    y: Math.min(Math.max(Math.round(next.y), 0), Math.max(0, maxY)),
  }
}

export default function CoverEditor({ book, existing, onSave, onReset, onClose }) {
  const [image, setImage] = useState(null)
  const [crop, setCrop] = useState(null)
  const stageRef = useRef(null)
  const boxRef = useRef(null)
  const fileRef = useRef(null)
  const dragRef = useRef(null)

  const loadFile = (file) => {
    if (!file || !file.type.startsWith('image/')) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(MAX_STAGE_WIDTH / img.naturalWidth, MAX_STAGE_HEIGHT / img.naturalHeight, 1)
        const stageWidth = Math.max(1, Math.round(img.naturalWidth * scale))
        const stageHeight = Math.max(1, Math.round(img.naturalHeight * scale))
        const size = Math.floor(Math.min(stageWidth, stageHeight / RATIO) * 0.92)
        const stage = { src: reader.result, img, stageWidth, stageHeight }
        setImage(stage)
        setCrop(clampCrop({
          size,
          x: (stageWidth - size) / 2,
          y: (stageHeight - size * RATIO) / 2,
        }, stage))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  }

  const startDrag = (event, mode) => {
    if (!crop) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = { mode, startX: event.clientX, startY: event.clientY, origin: crop }
    boxRef.current?.setPointerCapture?.(event.pointerId)
  }

  const onDragMove = (event) => {
    const drag = dragRef.current
    if (!drag || !image) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (drag.mode === 'move') {
      setCrop(clampCrop({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }, image))
    } else {
      const delta = (dx + dy / RATIO) / 2
      setCrop(clampCrop({ ...drag.origin, size: drag.origin.size + delta }, image))
    }
  }

  const endDrag = () => { dragRef.current = null }

  const confirm = () => {
    if (!image || !crop) return
    const scale = image.img.naturalWidth / image.stageWidth
    const canvas = document.createElement('canvas')
    canvas.width = OUTPUT_WIDTH
    canvas.height = OUTPUT_HEIGHT
    canvas.getContext('2d').drawImage(
      image.img,
      crop.x * scale, crop.y * scale, crop.size * scale, crop.size * RATIO * scale,
      0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT,
    )
    onSave(canvas.toDataURL('image/jpeg', 0.88))
  }

  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="book-manager cover-editor" role="dialog" aria-modal="true" aria-label="设置封面">
        <header>
          <div><ImagePlus size={17} /><strong>设置《{book.title}》封面</strong></div>
          <button onClick={onClose} aria-label="关闭封面设置"><X size={17} /></button>
        </header>
        <div className="cover-editor-body">
          {image ? (
            <div className="cover-crop-stage" ref={stageRef} style={{ width: image.stageWidth, height: image.stageHeight }}>
              <img src={image.src} alt="" draggable="false" />
              {crop ? (
                <div
                  className="crop-box"
                  ref={boxRef}
                  style={{ left: crop.x, top: crop.y, width: crop.size, height: crop.size * RATIO }}
                  onPointerDown={(event) => startDrag(event, 'move')}
                  onPointerMove={onDragMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                >
                  <span className="crop-handle" onPointerDown={(event) => startDrag(event, 'resize')} />
                </div>
              ) : null}
            </div>
          ) : (
            <button className="cover-drop" onClick={() => fileRef.current?.click()}>
              <ImagePlus size={26} strokeWidth={1.5} />
              <strong>选择本地图片</strong>
              <span>上传后拖动选框，框出 3:4 的封面区域</span>
            </button>
          )}
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(event) => { loadFile(event.target.files?.[0]); event.target.value = '' }} />
        </div>
        <footer>
          <div className="cover-editor-side">
            {image ? <button className="plain-command" onClick={() => fileRef.current?.click()}>换一张</button> : null}
            {existing ? <button className="plain-command" onClick={onReset}><RotateCcw size={13} /> 恢复默认</button> : null}
          </div>
          <button className="primary-command cover-confirm" disabled={!image || !crop} onClick={confirm}><Check size={15} /> 设为封面</button>
        </footer>
      </section>
    </div>
  )
}
