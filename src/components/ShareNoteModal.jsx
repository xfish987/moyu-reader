import { useEffect, useState } from 'react'
import { Download, Image, X } from 'lucide-react'

const THEMES = [
  { id: 'minimal', name: '极简留白', color: '#282c29', muted: '#666d68', x: 142, centerY: 660, width: 900, baseSize: 66, metaY: 1405, normalLines: 6 },
  { id: 'spine', name: '墨绿书脊', color: '#202421', muted: '#626a65', x: 118, centerY: 720, width: 920, baseSize: 68, metaY: 1405, normalLines: 6 },
  { id: 'night', name: '夜读蓝', color: '#f2f1e9', muted: '#cbd4df', x: 118, centerY: 690, width: 880, baseSize: 62, metaY: 1405, normalLines: 6 },
  { id: 'terracotta', name: '赤陶刊物', color: '#312d2a', muted: '#746b65', x: 130, centerY: 760, width: 860, baseSize: 64, metaY: 1410, normalLines: 6 },
  { id: 'mono', name: '灰阶杂志', color: '#202220', muted: '#666a67', x: 150, centerY: 720, width: 850, baseSize: 60, metaY: 1410, normalLines: 6 },
]

function wrapText(context, text, maxWidth) {
  const lines = []
  let line = ''
  for (const character of text) {
    if (character === '\n') {
      if (line) lines.push(line)
      line = ''
      continue
    }
    const candidate = line + character
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = character
    } else line = candidate
  }
  if (line) lines.push(line)
  return lines
}

function drawGrain(context, height, dark = 'rgba(55, 52, 46, .018)', accent = 'rgba(36, 70, 57, .024)') {
  let seed = 23
  for (let index = 0; index < Math.round(height * 1.7); index += 1) {
    seed = (seed * 9301 + 49297) % 233280
    const x = (seed / 233280) * 1200
    seed = (seed * 9301 + 49297) % 233280
    const y = (seed / 233280) * height
    context.fillStyle = index % 3 ? dark : accent
    context.fillRect(x, y, 1, 1)
  }
}

function drawMountains(context, height) {
  const layers = [
    { color: '#2b4b73', y: height - 300, points: [0, 70, 120, 5, 260, 92, 390, 25, 540, 110, 680, 35, 840, 95, 990, 20, 1200, 90] },
    { color: '#203d65', y: height - 220, points: [0, 50, 150, 0, 310, 76, 480, 18, 660, 82, 820, 15, 1000, 68, 1200, 8] },
    { color: '#152e50', y: height - 135, points: [0, 25, 180, 0, 360, 45, 570, 8, 760, 56, 970, 5, 1200, 36] },
  ]
  layers.forEach((layer) => {
    context.fillStyle = layer.color
    context.beginPath()
    context.moveTo(0, height)
    for (let index = 0; index < layer.points.length; index += 2) context.lineTo(layer.points[index], layer.y + layer.points[index + 1])
    context.lineTo(1200, height)
    context.closePath()
    context.fill()
  })
}

function drawThemeBackground(context, theme, height) {
  if (theme.id === 'night') {
    context.fillStyle = '#17345c'
    context.fillRect(0, 0, 1200, height)
    let seed = 31
    for (let index = 0; index < Math.round(height * .42); index += 1) {
      seed = (seed * 9301 + 49297) % 233280
      const x = (seed / 233280) * 1200
      seed = (seed * 9301 + 49297) % 233280
      const y = (seed / 233280) * Math.max(400, height - 260)
      const radius = index % 11 === 0 ? 1.7 : .75
      context.fillStyle = index % 7 === 0 ? 'rgba(255,255,244,.82)' : 'rgba(220,229,242,.42)'
      context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2); context.fill()
    }
    context.fillStyle = '#f5f4eb'
    context.beginPath(); context.arc(1030, 150, 38, 0, Math.PI * 2); context.fill()
    context.fillStyle = '#17345c'
    context.beginPath(); context.arc(1014, 134, 38, 0, Math.PI * 2); context.fill()
    drawMountains(context, height)
    return
  }

  const backgrounds = { minimal: '#f7f6f2', spine: '#f5f5f1', terracotta: '#f1ece5', mono: '#e6e5e1' }
  context.fillStyle = backgrounds[theme.id]
  context.fillRect(0, 0, 1200, height)
  drawGrain(context, height, theme.id === 'terracotta' ? 'rgba(91, 61, 47, .022)' : undefined)

  if (theme.id === 'minimal') {
    context.strokeStyle = '#aeb4ad'; context.lineWidth = 1.2; context.beginPath()
    context.moveTo(82, 78); context.lineTo(82, height - 128)
    context.moveTo(82, height - 82); context.lineTo(1118, height - 82); context.stroke()
  } else if (theme.id === 'spine') {
    context.fillStyle = '#174f3f'; context.fillRect(0, 0, 38, height)
    context.fillStyle = '#174f3f'; context.font = '600 40px "Songti SC", SimSun, serif'; context.fillText('墨读摘录', 105, 128)
    context.fillStyle = '#a45343'; context.fillRect(105, 154, 58, 5)
  } else if (theme.id === 'terracotta') {
    context.fillStyle = '#a55342'; context.fillRect(930, 0, 270, 155)
    context.fillStyle = 'rgba(165, 83, 66, .12)'; context.font = '500 250px Georgia, serif'; context.fillText('“', 72, 270)
    context.strokeStyle = '#b6a49a'; context.lineWidth = 1.2; context.beginPath(); context.moveTo(110, 320); context.lineTo(110, height - 130); context.stroke()
  } else if (theme.id === 'mono') {
    context.fillStyle = '#202220'; context.fillRect(82, 78, 92, 92)
    context.fillStyle = '#f2f2ee'; context.font = '600 28px Arial, sans-serif'; context.fillText('01', 110, 137)
    context.strokeStyle = 'rgba(32,34,32,.18)'; context.lineWidth = 1
    for (let x = 82; x <= 1118; x += 172) { context.beginPath(); context.moveTo(x, 220); context.lineTo(x, height - 90); context.stroke() }
    context.fillStyle = '#202220'; context.fillRect(82, height - 98, 1036, 4)
  }
}

function createShareImage(note, book, author, theme) {
  const canvas = document.createElement('canvas')
  canvas.width = 1200
  canvas.height = 1600
  const quoteLength = [...note.text].length
  const size = Math.max(42, theme.baseSize - Math.max(0, Math.min(80, quoteLength - 44)) * .25)
  let context = canvas.getContext('2d')
  context.font = `500 ${size}px "Songti SC", SimSun, serif`
  const lines = wrapText(context, note.text, theme.width)
  const lineHeight = Math.round(size * 1.72)
  const overflowLines = Math.max(0, lines.length - theme.normalLines)
  const canvasHeight = overflowLines ? 1720 + overflowLines * lineHeight : 1600
  if (canvasHeight !== canvas.height) {
    canvas.height = canvasHeight
    context = canvas.getContext('2d')
  }
  drawThemeBackground(context, theme, canvasHeight)

  context.fillStyle = theme.color
  context.font = `500 ${size}px "Songti SC", SimSun, serif`
  context.textAlign = 'left'
  context.textBaseline = 'alphabetic'
  const blockHeight = lines.length * lineHeight
  const firstBaseline = overflowLines ? 330 : Math.max(280, theme.centerY - blockHeight / 2 + lineHeight)
  lines.forEach((line, index) => context.fillText(line, theme.x, firstBaseline + index * lineHeight))

  if (theme.id === 'minimal') {
    context.font = '500 20px "Microsoft YaHei UI", sans-serif'; context.fillStyle = theme.muted; context.fillText('/ DAILY QUOTES', theme.x, 116)
  } else if (theme.id === 'mono') {
    context.font = '500 18px Arial, sans-serif'; context.fillStyle = theme.muted; context.fillText('READING NOTE / MO DU', theme.x, 112)
  }

  const metaY = canvasHeight - (1600 - theme.metaY)
  const sourceTitle = `《${book.title.length > 24 ? `${book.title.slice(0, 24)}…` : book.title}》`
  context.fillStyle = theme.color
  context.font = '600 32px "Songti SC", SimSun, serif'
  context.textAlign = 'left'; context.fillText(sourceTitle, theme.x, metaY)
  context.fillStyle = theme.muted; context.font = '400 22px "Microsoft YaHei UI", sans-serif'; context.fillText(author || '佚名', theme.x, metaY + 46)
  context.textAlign = 'right'; context.fillText(new Date(note.createdAt).toLocaleDateString('zh-CN').replaceAll('/', '.'), 1090, metaY + 46)
  return canvas.toDataURL('image/png')
}

export default function ShareNoteModal({ note, book, onClose }) {
  const [author, setAuthor] = useState(book.author || '佚名')
  const [themeId, setThemeId] = useState('minimal')
  const [imageUrl, setImageUrl] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const theme = THEMES.find((item) => item.id === themeId) || THEMES[0]

  useEffect(() => {
    setImageUrl(createShareImage(note, book, author.trim() || '佚名', theme))
  }, [author, book, note, theme])

  const save = async () => {
    if (!imageUrl) return
    try {
      const filePath = await window.readerAPI.saveShareImage({ dataUrl: imageUrl, bookPath: book.path, quote: note.text })
      if (filePath) setSavedPath(filePath)
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `保存分享图失败：${error?.message || '请检查目标文件夹权限'}` }))
    }
  }

  const selectTheme = (id) => { setSavedPath(''); setThemeId(id) }

  return (
    <div className="manager-backdrop share-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="share-modal" role="dialog" aria-modal="true" aria-label="分享摘录">
        <header><div><Image size={17} /><strong>生成分享图</strong></div><button onClick={onClose} aria-label="关闭分享窗口"><X size={17} /></button></header>
        <div className="share-body">
          <div className="share-preview"><img src={imageUrl} alt={`${theme.name}摘录分享图预览`} /></div>
          <div className="share-fields">
            <div className="theme-picker" aria-label="分享图主题">
              {THEMES.map((item) => (
                <button key={item.id} className={themeId === item.id ? 'active' : ''} onClick={() => selectTheme(item.id)} title={item.name}>
                  <span className={`theme-swatch swatch-${item.id}`} aria-hidden="true"><i /></span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            <label>书名<input value={book.title} readOnly /></label>
            <label>作者<input value={author} maxLength={30} onChange={(event) => { setSavedPath(''); setAuthor(event.target.value) }} /></label>
            <button className="save-share" onClick={save}><Download size={16} /> 保存 PNG</button>
            {savedPath ? <p title={savedPath}>已保存到 {savedPath}</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
