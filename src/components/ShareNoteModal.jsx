import { useEffect, useMemo, useState } from 'react'
import { Download, Image, X } from 'lucide-react'
import { segmentByHighlights } from '../noteHighlights'

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
const SERIF = '"Moyu UI Song", "DFSongGB", "Songti SC", SimSun, serif'
const DISPLAY = SERIF
// Adobe CJK/JIS 严格避头尾：闭标点不得顶格，开标点不得落在行尾。
const PROHIBITED_LINE_START = new Set([...`、。，．！？：；）〕］｝〉》」』】〙〗〟’”ァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎ々ー〜…‥`])
const PROHIBITED_LINE_END = new Set([...`（〔［｛〈《「『【〘〖〝‘“`])

function drawGrain(context, height, color, width = CARD_WIDTH) {
  let seed = 47
  for (let index = 0; index < Math.round(height * 1.25); index += 1) {
    seed = (seed * 9301 + 49297) % 233280
    const x = (seed / 233280) * width
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

function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('zh-CN').replaceAll('/', '.')
}

function createShareImage(note, book, author, theme) {
  const canvas = document.createElement('canvas')
  canvas.width = CARD_WIDTH
  canvas.height = 1
  let context = canvas.getContext('2d')
  const quote = note.text?.trim() || ' '
  const paragraphs = layoutRichText(context, quote, note.highlights, CONTENT_WIDTH, CARD_TYPE)
  const title = note.title ? (note.title.length > 30 ? `${note.title.slice(0, 30)}…` : note.title) : ''
  const contentTop = 238 + 118 + (title ? 72 : 0)
  const textBottom = contentTop + richTextHeight(paragraphs, CARD_TYPE)
  const canvasHeight = Math.max(BASE_CARD_HEIGHT, textBottom + 430)
  canvas.height = canvasHeight
  context = canvas.getContext('2d')

  drawCardBackground(context, theme, canvasHeight)

  context.fillStyle = theme.ink
  context.font = `700 36px ${SERIF}`
  context.textAlign = 'left'
  context.fillText('墨读', CONTENT_X, 135)
  context.fillStyle = theme.muted
  context.font = `500 22px ${DISPLAY}`
  context.fillText('READING NOTE', CONTENT_X, 184)

  const quoteTop = contentTop
  context.fillStyle = theme.accent
  context.globalAlpha = theme.id === 'dark' ? .52 : .38
  context.font = `700 178px ${SERIF}`
  context.fillText('“', 86, quoteTop + 40)
  context.globalAlpha = 1

  // 备注标题（若有）绘制在摘录上方小字。
  if (title) {
    context.fillStyle = theme.muted
    context.font = `500 23px ${DISPLAY}`
    context.fillText(title, CONTENT_X, 238 + 86)
  }

  // 正文版心与顶部横线完全同宽：首行缩进两字、非末行两端对齐、段距 1.5 行。
  drawRichText(context, paragraphs, CONTENT_X, quoteTop, CONTENT_WIDTH, theme.ink, CARD_TYPE)

  const metaY = canvasHeight - 296
  context.fillStyle = theme.muted
  context.font = `500 20px ${DISPLAY}`
  context.fillText('FROM', CONTENT_X, metaY - 35)

  // 出处：手动摘录用自填出处（如《钓王》），否则用书书名；有章节名时附上。
  const sourceTitle = sourceLine(note, book)
  context.fillStyle = theme.ink
  context.font = `700 36px ${SERIF}`
  context.fillText(sourceTitle, CONTENT_X, metaY + 25)

  // 自填出处已包含来源信息时，作者行省略，避免“佚名”误导。
  const authorLine = note.source ? '' : (author || '佚名')
  context.fillStyle = theme.muted
  context.font = `400 24px ${SERIF}`
  if (authorLine) context.fillText(authorLine, CONTENT_X, metaY + 78)
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

// ===== 手机长图：750px 宽（主流手机满宽查看时正文≈15pt），高度随文字自动伸长 =====
// 排版规则：段首缩进两字符、1.6 倍行距、1.5 倍行距的段间距、非末行两端对齐、
// 高亮用 700 粗华康宋、正文用 300 细华康宋；出处在右侧、距最后一行 2 倍行距，
// 顶部留白与底部留白对称。
const MOBILE_CARD_WIDTH = 750
const MOBILE_CONTENT_X = 56
const MOBILE_CONTENT_WIDTH = MOBILE_CARD_WIDTH - MOBILE_CONTENT_X * 2
const MOBILE_FONT_SIZE = 30
const MOBILE_LINE_HEIGHT = 48
// 段间基线距离为 1.5 行：常规换行已占 1 行，因此这里只追加 0.5 行。
const MOBILE_PARAGRAPH_GAP = MOBILE_LINE_HEIGHT * .5
const MOBILE_SOURCE_GAP = MOBILE_LINE_HEIGHT * 2
const MOBILE_LIGHT_FONT = `300 ${MOBILE_FONT_SIZE}px ${SERIF}`
const MOBILE_BOLD_FONT = `700 ${MOBILE_FONT_SIZE}px ${SERIF}`
const MOBILE_TYPE = {
  fontSize: MOBILE_FONT_SIZE,
  lineHeight: MOBILE_LINE_HEIGHT,
  paragraphGap: MOBILE_PARAGRAPH_GAP,
  lightFont: MOBILE_LIGHT_FONT,
  boldFont: MOBILE_BOLD_FONT,
}
const CARD_FONT_SIZE = 52
const CARD_TYPE = {
  fontSize: CARD_FONT_SIZE,
  lineHeight: 84,
  paragraphGap: 42,
  lightFont: `300 ${CARD_FONT_SIZE}px ${SERIF}`,
  boldFont: `700 ${CARD_FONT_SIZE}px ${SERIF}`,
}

// 把文本按高亮分段后排版成行：首行缩进两字符，逐字测宽（带缓存）。
function layoutRichText(context, text, highlights, width, type = MOBILE_TYPE) {
  const cache = new Map()
  const measure = (character, hl) => {
    const key = `${hl ? 1 : 0}${character}`
    let cached = cache.get(key)
    if (cached === undefined) {
      context.font = hl ? type.boldFont : type.lightFont
      cached = context.measureText(character).width
      cache.set(key, cached)
    }
    return cached
  }
  const paragraphs = []
  let paragraphStart = 0
  for (const raw of text.split('\n')) {
    const items = []
    for (const segment of segmentByHighlights(text, highlights, paragraphStart, paragraphStart + raw.length)) {
      for (const character of segment.text) items.push({ character, hl: segment.highlighted, width: measure(character, segment.highlighted) })
    }
    paragraphStart += raw.length + 1
    const lines = []
    let line = []
    let lineWidth = 0
    let available = width - type.fontSize * 2
    for (const item of items) {
      if (lineWidth + item.width > available && line.length && !PROHIBITED_LINE_START.has(item.character)) {
        const carry = []
        while (line.length && PROHIBITED_LINE_END.has(line.at(-1).character)) carry.unshift(line.pop())
        const keptWidth = line.reduce((sum, entry) => sum + entry.width, 0)
        if (line.length) lines.push({ items: line, width: keptWidth })
        line = carry
        lineWidth = carry.reduce((sum, entry) => sum + entry.width, 0)
        available = width
      }
      line.push(item)
      lineWidth += item.width
    }
    lines.push({ items: line, width: lineWidth })
    paragraphs.push({ lines })
  }
  return paragraphs
}

function richTextHeight(paragraphs, type = MOBILE_TYPE) {
  return paragraphs.reduce((sum, paragraph, index) => sum + paragraph.lines.length * type.lineHeight + (index ? type.paragraphGap : 0), 0)
}

// 绘制排版好的段落，返回文字区底部 y。非末行两端对齐（字间均分多余宽度）。
function drawRichText(context, paragraphs, x, top, width, ink, type = MOBILE_TYPE) {
  let cursor = top
  context.fillStyle = ink
  context.textBaseline = 'alphabetic'
  paragraphs.forEach((paragraph, paragraphIndex) => {
    paragraph.lines.forEach((line, lineIndex) => {
      const indent = lineIndex === 0 ? type.fontSize * 2 : 0
      const baseline = cursor + type.fontSize + Math.round(type.fontSize * .2)
      const isLastLine = lineIndex === paragraph.lines.length - 1
      let dx = x + indent
      const justifyGap = !isLastLine && line.items.length > 1 ? Math.max(0, (width - indent - line.width) / (line.items.length - 1)) : 0
      for (const item of line.items) {
        context.font = item.hl ? type.boldFont : type.lightFont
        context.fillText(item.character, dx, baseline)
        dx += item.width + justifyGap
      }
      cursor += type.lineHeight
    })
    if (paragraphIndex < paragraphs.length - 1) cursor += type.paragraphGap
  })
  return cursor
}

// 长图骨架：背景、书脊条、噪点、头部、顶部分隔线、页脚。
function drawMobileChrome(context, theme, canvasHeight, heading) {
  context.fillStyle = theme.background
  context.fillRect(0, 0, MOBILE_CARD_WIDTH, canvasHeight)
  context.fillStyle = theme.surface
  context.fillRect(0, 0, 17, canvasHeight)
  context.fillRect(17, 0, 3, canvasHeight)
  drawGrain(context, canvasHeight, theme.grain, MOBILE_CARD_WIDTH)

  context.textAlign = 'left'
  context.fillStyle = theme.ink
  context.font = `700 27px ${SERIF}`
  context.fillText('墨读', MOBILE_CONTENT_X, 84)
  context.fillStyle = theme.muted
  context.font = `500 15px ${DISPLAY}`
  context.fillText(heading, MOBILE_CONTENT_X, 116)
  const topRule = context.createLinearGradient(MOBILE_CONTENT_X, 0, MOBILE_CARD_WIDTH - MOBILE_CONTENT_X, 0)
  topRule.addColorStop(0, theme.accent)
  topRule.addColorStop(1, theme.accentEnd)
  context.fillStyle = topRule
  context.fillRect(MOBILE_CONTENT_X, 148, MOBILE_CONTENT_WIDTH, 5)

  context.fillStyle = theme.muted
  context.font = `500 13px ${DISPLAY}`
  context.fillText('MOYU READER', MOBILE_CONTENT_X, canvasHeight - 42)
  context.textAlign = 'right'
  context.fillText('摘录 · 阅读 · 留存', MOBILE_CARD_WIDTH - MOBILE_CONTENT_X, canvasHeight - 42)
  context.textAlign = 'left'
}

function createMobileShareImage(note, book, author, theme) {
  const canvas = document.createElement('canvas')
  canvas.width = MOBILE_CARD_WIDTH
  let context = canvas.getContext('2d')
  const quote = note.text?.trim() || ' '
  const paragraphs = layoutRichText(context, quote, note.highlights, MOBILE_CONTENT_WIDTH)
  const title = note.title ? (note.title.length > 30 ? `${note.title.slice(0, 30)}…` : note.title) : ''
  const sourceTitle = sourceLine(note, book)
  const authorLine = note.source ? '' : (author || '佚名')

  const contentTop = 148 + MOBILE_SOURCE_GAP + (title ? 56 : 0)
  const textBottom = contentTop + richTextHeight(paragraphs)
  const sourceBaseline = textBottom + MOBILE_SOURCE_GAP
  const canvasHeight = sourceBaseline + 34 + 84
  canvas.height = canvasHeight
  context = canvas.getContext('2d')

  drawMobileChrome(context, theme, canvasHeight, 'READING NOTE')

  if (title) {
    context.fillStyle = theme.muted
    context.font = `600 21px ${DISPLAY}`
    context.fillText(title, MOBILE_CONTENT_X, 148 + 62)
  }

  // 引号装饰 + 正文
  context.fillStyle = theme.accent
  context.globalAlpha = theme.id === 'dark' ? .52 : .38
  context.font = `700 92px ${SERIF}`
  context.fillText('“', 18, contentTop + 30)
  context.globalAlpha = 1
  drawRichText(context, paragraphs, MOBILE_CONTENT_X, contentTop, MOBILE_CONTENT_WIDTH, theme.ink)

  // 出处：右对齐，距最后一行 2 倍行距；作者与日期在其下一行。
  context.textAlign = 'right'
  context.fillStyle = theme.ink
  context.font = `700 22px ${SERIF}`
  context.fillText(`—— ${sourceTitle}`, MOBILE_CARD_WIDTH - MOBILE_CONTENT_X, sourceBaseline)
  context.fillStyle = theme.muted
  context.font = `500 15px ${DISPLAY}`
  context.fillText(`${authorLine ? `${authorLine} · ` : ''}${formatDate(note.createdAt)}`, MOBILE_CARD_WIDTH - MOBILE_CONTENT_X, sourceBaseline + 32)
  context.textAlign = 'left'
  return canvas.toDataURL('image/png')
}

// 出处行：自填出处（如《钓王》）或书书名，有章节名时附上章节。
function sourceLine(note, book, maxLength = 28) {
  const raw = `${note.source || `《${book.title}》`}${note.chapter ? ` · ${note.chapter}` : ''}`
  return raw.length > maxLength ? `${raw.slice(0, maxLength)}…` : raw
}

// 多条摘录合并长图（手机格式）：逐条摘录（同样的排版规则）+ 各自右侧出处。
function createMobileMultiShareImage(items, theme) {
  const canvas = document.createElement('canvas')
  canvas.width = MOBILE_CARD_WIDTH
  let context = canvas.getContext('2d')
  const blocks = items.map(({ note, book }) => {
    const paragraphs = layoutRichText(context, note.text?.trim() || ' ', note.highlights, MOBILE_CONTENT_WIDTH)
    const title = note.title ? (note.title.length > 30 ? `${note.title.slice(0, 30)}…` : note.title) : ''
    return { paragraphs, source: sourceLine(note, book, 34), title }
  })
  // 单块高度 = 标题(56) + 正文 + 出处(2 倍行距 + 20)
  const measureBlock = (block) => (block.title ? 56 : 0) + richTextHeight(block.paragraphs) + MOBILE_SOURCE_GAP + 20
  const canvasHeight = 148 + MOBILE_SOURCE_GAP + blocks.reduce((sum, block) => sum + measureBlock(block), 0) + 64
  canvas.height = canvasHeight
  context = canvas.getContext('2d')

  drawMobileChrome(context, theme, canvasHeight, 'READING NOTES')

  let y = 148 + MOBILE_SOURCE_GAP
  blocks.forEach((block) => {
    if (block.title) {
      context.fillStyle = theme.muted
      context.font = `600 21px ${DISPLAY}`
      context.fillText(block.title, MOBILE_CONTENT_X, y + 26)
      y += 56
    }
    const textBottom = drawRichText(context, block.paragraphs, MOBILE_CONTENT_X, y, MOBILE_CONTENT_WIDTH, theme.ink)
    const sourceBaseline = textBottom + MOBILE_SOURCE_GAP
    context.textAlign = 'right'
    context.fillStyle = theme.muted
    context.font = `500 17px ${DISPLAY}`
    context.fillText(`—— ${block.source}`, MOBILE_CARD_WIDTH - MOBILE_CONTENT_X, sourceBaseline)
    context.textAlign = 'left'
    y = sourceBaseline + 20
  })
  return canvas.toDataURL('image/png')
}

export default function ShareNoteModal({ note, book, items, appearanceTheme = 'mist', onClose }) {
  const isMulti = Array.isArray(items) && items.length > 1
  const preferredTheme = appearanceTheme === 'night' ? 'dark' : 'light'
  const [author, setAuthor] = useState(book.author || '佚名')
  const [themeId, setThemeId] = useState(preferredTheme)
  const [format, setFormat] = useState(isMulti ? 'mobile' : 'card')
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
          document.fonts.load(CARD_TYPE.lightFont),
          document.fonts.load(CARD_TYPE.boldFont),
          document.fonts.load(MOBILE_LIGHT_FONT),
          document.fonts.load(MOBILE_BOLD_FONT),
        ])
      }
      if (!cancelled) {
        setImageUrl(isMulti
          ? createMobileMultiShareImage(items, theme)
          : format === 'mobile'
            ? createMobileShareImage(note, book, author.trim() || '佚名', theme)
            : createShareImage(note, book, author.trim() || '佚名', theme))
      }
    }
    render()
    return () => { cancelled = true }
  }, [author, book, format, isMulti, items, note, theme])

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
  const selectFormat = (id) => { setSavedPath(''); setFormat(id) }

  return (
    <div className="manager-backdrop share-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="share-modal" role="dialog" aria-modal="true" aria-label="分享摘录">
        <header><div><Image size={17} /><strong>分享阅读笔记</strong></div><button onClick={onClose} aria-label="关闭分享窗口"><X size={17} /></button></header>
        <div className="share-body">
          <div className="share-preview">{imageUrl ? <img src={imageUrl} alt={`${theme.name}阅读笔记分享卡片预览`} /> : <span>正在生成预览...</span>}</div>
          <div className="share-fields">
            {isMulti ? <p className="multi-share-hint">已选 {items.length} 条摘录，合并为手机长图，每条注明出处</p> : (
              <div className="format-picker" role="group" aria-label="分享图格式">
                <button className={format === 'card' ? 'active' : ''} onClick={() => selectFormat('card')} aria-pressed={format === 'card'}>书房卡片<span>1200×1600 方图</span></button>
                <button className={format === 'mobile' ? 'active' : ''} onClick={() => selectFormat('mobile')} aria-pressed={format === 'mobile'}>手机长图<span>750 宽 · 高度自适应</span></button>
              </div>
            )}
            <div className="theme-picker" role="group" aria-label="分享卡片主题">
              {CARD_THEMES.map((item) => (
                <button key={item.id} className={themeId === item.id ? 'active' : ''} onClick={() => selectTheme(item.id)} aria-pressed={themeId === item.id}>
                  <span className={`theme-swatch swatch-${item.id}`} aria-hidden="true"><i /></span>
                  <span>{item.name}</span>
                </button>
              ))}
            </div>
            {isMulti ? null : <label>出处<input value={note.source || `《${book.title}》`} readOnly /></label>}
            {isMulti || note.source ? null : <label>作者<input value={author} maxLength={30} onChange={(event) => { setSavedPath(''); setAuthor(event.target.value) }} /></label>}
            <button className="save-share" disabled={!imageUrl} onClick={save}><Download size={16} /> {imageUrl ? '保存 PNG' : '正在生成'}</button>
            {savedPath ? <p title={savedPath}>已保存到 {savedPath}</p> : null}
          </div>
        </div>
      </section>
    </div>
  )
}
