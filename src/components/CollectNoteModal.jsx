import { useEffect, useMemo, useRef, useState } from 'react'
import { Bookmark, Highlighter, Undo2, X } from 'lucide-react'
import { addHighlight, normalizeHighlights, segmentByHighlights } from '../noteHighlights'
import TagEditor from './TagEditor'

// 收藏/编辑摘录弹窗：全文排版展示（段首缩进、段落间距），
// 选中文字后右键「高亮」标记核心句子，支持撤销；底部写备注（卡片标题）与标签。
// onSave({ title, tags, highlights })，由调用方合并锚点字段生成完整笔记。
export default function CollectNoteModal({ text, initialTitle = '', initialTags = [], initialHighlights = [], heading = '收藏摘录', onSave, onCancel }) {
  const [title, setTitle] = useState(initialTitle)
  const [tags, setTags] = useState(initialTags)
  const [highlights, setHighlights] = useState(() => normalizeHighlights(initialHighlights, text.length))
  const [history, setHistory] = useState([])
  const [menu, setMenu] = useState(null)
  const contentRef = useRef(null)

  const paragraphs = useMemo(() => {
    const parts = text.split('\n')
    let offset = 0
    return parts.map((part) => {
      const start = offset
      offset += part.length + 1
      return { text: part, start }
    })
  }, [text])

  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onCancel])

  // 计算选区端点相对全文的偏移：定位所在段落，再算段内偏移，避免跨段落换行符的歧义。
  const locateOffset = (container, offset) => {
    const element = (container.nodeType === Node.ELEMENT_NODE ? container : container.parentElement)?.closest?.('[data-pstart]')
    if (!element || !contentRef.current?.contains(element)) return null
    const pre = document.createRange()
    pre.selectNodeContents(element)
    pre.setEnd(container, offset)
    return Number(element.dataset.pstart) + pre.toString().length
  }

  const openHighlightMenu = (event) => {
    setMenu(null)
    const selection = window.getSelection()
    if (!selection?.rangeCount || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    const start = locateOffset(range.startContainer, range.startOffset)
    const end = locateOffset(range.endContainer, range.endOffset)
    if (start === null || end === null || end <= start) return
    event.preventDefault()
    setMenu({ x: event.clientX, y: event.clientY, range: { start, end } })
  }

  const applyHighlight = () => {
    if (!menu) return
    setHistory((current) => [...current, highlights])
    setHighlights((current) => addHighlight(current, menu.range, text.length))
    window.getSelection()?.removeAllRanges()
    setMenu(null)
  }

  const undo = () => {
    setHistory((current) => {
      if (!current.length) return current
      setHighlights(current[current.length - 1])
      return current.slice(0, -1)
    })
  }

  const save = () => onSave({ title: title.trim(), tags, highlights })

  return (
    <div className="manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section className="collect-modal" role="dialog" aria-modal="true" aria-label={heading} onClick={() => setMenu(null)}>
        <header>
          <div><Bookmark size={15} /><strong>{heading}</strong><span>选中文字后右键可高亮核心句子</span></div>
          <button onClick={onCancel} aria-label="关闭"><X size={16} /></button>
        </header>
        <div className="collect-text" ref={contentRef} onContextMenu={openHighlightMenu} onClick={() => setMenu(null)}>
          {paragraphs.map((paragraph, index) => (
            <p key={index} data-pstart={paragraph.start}>
              {segmentByHighlights(text, highlights, paragraph.start, paragraph.start + paragraph.text.length).map((segment, segmentIndex) => (
                segment.highlighted ? <span className="hl" key={segmentIndex}>{segment.text}</span> : <span key={segmentIndex}>{segment.text}</span>
              ))}
              {paragraph.text ? null : ' '}
            </p>
          ))}
        </div>
        <div className="collect-fields">
          <label>备注<input value={title} maxLength={60} placeholder="可留空，将成为卡片标题，如：小哥初见" onChange={(event) => setTitle(event.target.value)} /></label>
          <label>标签<TagEditor tags={tags} onChange={setTags} /></label>
        </div>
        <footer>
          <button className="collect-undo" disabled={!history.length} onClick={undo} title="撤销上一次高亮"><Undo2 size={14} /> 撤销高亮</button>
          <div>
            <button onClick={onCancel}>取消</button>
            <button className="primary-command" onClick={save}><Bookmark size={13} /> 收藏</button>
          </div>
        </footer>
      </section>
      {menu ? (
        <div className="highlight-menu" style={{ left: menu.x, top: menu.y }}>
          <button onClick={applyHighlight}><Highlighter size={13} /> 高亮</button>
        </div>
      ) : null}
    </div>
  )
}
