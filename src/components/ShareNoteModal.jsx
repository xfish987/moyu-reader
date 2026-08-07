import { useEffect, useMemo, useState } from 'react'
import { Download, Image, X } from 'lucide-react'

const CARD_THEMES = [
  {
    id: 'light',
    name: '浅色书房',
    background: '#e8ecef',
    surface: '#d2dbec',
    ink: '#1c2b48',
    muted: '#6a90b4',
    accent: '#396081',
    accentEnd: '#bec9dd',
    grain: 'rgba(28, 43, 72, .035)',
  },
  {
    id: 'dark',
    name: '深色书房',
    background: '#01162b',
    surface: '#1c2b48',
    ink: '#e8ecef',
    muted: '#94a2bf',
    accent: '#8eb1d1',
    accentEnd: '#5c7fa2',
    grain: 'rgba(197, 216, 230, .045)',
  },
]

const CARD_WIDTH = 1200
const BASE_CARD_HEIGHT = 1600
const CONTENT_X = 150
const CONTENT_WIDTH = 900
const SERIF = '"Moyu Source Han Serif", "Songti SC", SimSun, serif'
const DISPLAY = '"Moyu New York", Georgia, serif'

function wrapText(context, text, maxWidth) {
  const lines = []
  let line = ''
  for (const character of text) {
    if (character === '\n') {
      lines.push(line)
      line = ''
      continue
    }
    const candidate = line + character
    if (context.measureText(candidate).width > maxWidth && line) {
      lines.push(line)
      line = character
    } else line = candidate
  }
  if (line || !lines.length) lines.push(line)
  return lines
}

function drawGrain(context, height, color) {
  let seed = 47
  for (let index = 0; index < Math.round(height * 1.25); index += 1) {
    seed = (seed * 9301 + 49297) % 233280
    const x = (seed / 233280) * CARD_WIDTH
    seed = (seed * 9301 + 49297) % 233280
    const y = (seed / 233280) * height
    context.fillStyle = color
    context.fillRect(x, y, index % 9 === 0 ? 2 : 1, 1)
  }
}

function drawBookMark(context, theme) {
  const widths = [18, 13, 22]
  const heights = [68, 51, 82]
  let x = 951
  widths.forEach((width, index) => {
    context.fillStyle = index === 1 ? theme.muted : theme.accent
    context.fillRect(x, 103 + 82 - heights[index], width, heights[index])
    x += width + 9
  })
  context.fillStyle = theme.ink
  context.globalAlpha = .5
  context.fillRect(941, 192, 109, 2)
  context.globalAlpha = 1
}

function drawCardBackground(context, theme, height) {
  context.fillStyle = theme.background
  context.fillRect(0, 0, CARD_WIDTH, height)

  context.fillStyle = theme.surface
  context.fillRect(0, 0, 28, height)
  context.fillRect(28, 0, 5, height)

  const topRule = context.createLinearGradient(CONTENT_X, 0, CARD_WIDTH - CONTENT_X, 0)
  topRule.addColorStop(0, theme.accent)
  topRule.addColorStop(1, theme.accentEnd)
  context.fillStyle = topRule
  context.fillRect(CONTENT_X, 238, CONTENT_WIDTH, 8)

  context.fillStyle = theme.accent
  context.fillRect(CONTENT_X, height - 122, CONTENT_WIDTH, 5)
  context.fillStyle = theme.surface
  context.fillRect(CONTENT_X, height - 117, CONTENT_WIDTH, 2)

  drawGrain(context, height, theme.grain)
  drawBookMark(context, theme)
}

function getQuoteLayout(context, quote) {
  const length = [...quote].length
  let size = Math.max(42, 70 - Math.max(0, Math.min(120, length - 38)) * .22)
  let lines = []
  for (; size >= 42; size -= 2) {
    context.font = `500 ${size}px ${SERIF}`
    lines = wrapText(context, quote, CONTENT_WIDTH - 54)
    if (lines.length <= 7) break
  }
  return { size, lines, lineHeight: Math.round(size * 1.68) }
}

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN').replaceAll('/', '.')
}

function createShareImage(note, book, author, theme) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = BASE_CARD_HEIGHT
  let context = canvas.getContext('2d')
  const quote = note.text?.trim() || ' '
  const initialLayout = getQuoteLayout(context, quote)
  const overflowLines = Math.max(0, initialLayout.lines.length - 7)
  const canvasHeight = BASE_CARD_HEIGHT + overflowLines * initialLayout.lineHeight
  if (canvasHeight !== canvas.height) {
    canvas.height = canvasHeight
    context = canvas.getContext('2d')
  }
  const layout = getQuoteLayout(context, quote)

  drawCardBackground(context, theme, canvasHeight)

  context.fillStyle = theme.ink
  context.font = `700 36px ${SERIF}`
  context.textAlign = 'left'
  context.fillText('墨读', CONTENT_X, 135)
  context.fillStyle = theme.muted
  context.font = `500 22px ${DISPLAY}`
  context.fillText('READING NOTE', CONTENT_X, 184)

  const quoteTop = overflowLines ? 370 : Math.max(405, 700 - (layout.lines.length * layout.lineHeight) / 2)
  context.fillStyle = theme.accent
  context.globalAlpha = theme.id === 'dark' ? .52 : .38
  context.font = `700 178px ${SERIF}`
  context.fillText('“', 86, quoteTop + 40)
  context.globalAlpha = 1

  context.fillStyle = theme.ink
  context.font = `500 ${layout.size}px ${SERIF}`
  context.textBaseline = 'alphabetic'
  layout.lines.forEach((line, index) => context.fillText(line, CONTENT_X, quoteTop + 110 + index * layout.lineHeight))

  const metaY = canvasHeight - 296
  context.fillStyle = theme.muted
  context.font = `500 20px ${DISPLAY}`
  context.fillText('FROM', CONTENT_X, metaY - 35)

  const sourceTitle = `《${book.title.length > 26 ? `${book.title.slice(0, 26)}…` : book.title}》`
  context.fillStyle = theme.ink
  context.font = `700 36px ${SERIF}`
  context.fillText(sourceTitle, CONTENT_X, metaY + 25)

  context.fillStyle = theme.muted
  context.font = `400 24px ${SERIF}`
  context.fillText(author || '佚名', CONTENT_X, metaY + 78)
  context.textAlign = 'right'
  context.font = `500 21px ${DISPLAY}`
  context.fillText(formatDate(note.createdAt), CARD_WIDTH - CONTENT_X, metaY + 78)

  context.textAlign = 'left'
  context.fillStyle = theme.muted
  context.font = `500 17px ${DISPLAY}`
  context.fillText('MOYU READER', CONTENT_X, canvasHeight - 70)
  context.textAlign = 'right'
  context.fillText('摘录 · 阅读 · 留存', CARD_WIDTH - CONTENT_X, canvasHeight - 70)
  return canvas.toDataURL('image/png')
}

export default function ShareNoteModal({ note, book, appearanceTheme = 'mist', onClose }) {
  const preferredTheme = appearanceTheme === 'night' ? 'dark' : 'light'
  const [author, setAuthor] = useState(book.author || '佚名')
  const [themeId, setThemeId] = useState(preferredTheme)
  const [imageUrl, setImageUrl] = useState('')
  const [savedPath, setSavedPath] = useState('')
  const theme = useMemo(() => CARD_THEMES.find((item) => item.id === themeId) || CARD_THEMES[0], [themeId])

  useEffect(() => {
    let cancelled = false
    const render = async () => {
      if (document.fonts?.load) {
        await Promise.all([
          document.fonts.load(`500 64px ${SERIF}`),
          document.fonts.load(`500 22px ${DISPLAY}`),
        ])
      }
      if (!cancelled) setImageUrl(createShareImage(note, book, author.trim() || '佚名', theme))
    }
    render()
    return () => { cancelled = true }
  }, [author, book, note, theme])

  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

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
        <header><div><Image size={17} /><strong>分享阅读笔记</strong></div><button onClick={onClose} aria-label="关闭分享窗口"><X size={17} /></button></header>
        <div className="share-body">
          <div className="share-preview">{imageUrl ? <img src={imageUrl} alt={`${theme.name}阅读笔记分享卡片预览`} /> : <span>正在生成预览...</span>}</div>
          <div className="share-fields">
            <div className="theme-picker" role="group" aria-label="分享卡片主题">
              {CARD_THEMES.map((item) => (
                <button key={item.id} className={themeId === item.id ? 'active' : ''} onClick={() => selectTheme(item.id)} aria-pressed={themeId === item.id}>
                  <span className={`theme-swatch swatch-${item.id}`} aria-hidden="true"><i /></span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            <label>书名<input value={book.title} readOnly /></label>
            <label>作者<input value={author} maxLength={30} onChange={(event) => { setSavedPath(''); setAuthor(event.target.value) }} /></label>
            <button className="save-share" disabled={!imageUrl} onClick={save}><Download size={16} /> {imageUrl ? '保存 PNG' : '正在生成'}</button>
            {savedPath ? <p title={savedPath}>已保存到 {savedPath}</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
