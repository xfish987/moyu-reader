import { useMemo, useRef, useState } from 'react'
import { Highlighter, Undo2 } from 'lucide-react'
import { addHighlight, segmentByHighlights } from '../noteHighlights'

// 可划选高亮的排版面：段首缩进、段落间距；选中文字后右键「高亮」，可撤销。
// 收藏弹窗与手动新增弹窗共用。highlights = [{start,end}]，相对 text 的偏移。
export default function HighlightTextEditor({ text, highlights, onChange }) {
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
    onChange(addHighlight(highlights, menu.range, text.length))
    window.getSelection()?.removeAllRanges()
    setMenu(null)
  }

  const undo = () => {
    if (!history.length) return
    onChange(history[history.length - 1])
    setHistory(history.slice(0, -1))
  }

  return (
    <div className="hl-editor" onClick={() => setMenu(null)}>
      <div className="hl-editor-bar">
        <span>选中文字后右键可高亮核心句子</span>
        <button disabled={!history.length} onClick={undo} title="撤销上一次高亮"><Undo2 size={13} /> 撤销高亮</button>
      </div>
      <div className="collect-text" ref={contentRef} onContextMenu={openHighlightMenu}>
        {paragraphs.map((paragraph, index) => (
          <p key={index} data-pstart={paragraph.start}>
            {segmentByHighlights(text, highlights, paragraph.start, paragraph.start + paragraph.text.length).map((segment, segmentIndex) => (
              segment.highlighted ? <span className="hl" key={segmentIndex}>{segment.text}</span> : <span key={segmentIndex}>{segment.text}</span>
            ))}
            {paragraph.text ? null : ' '}
          </p>
        ))}
      </div>
      {menu ? (
        <div className="highlight-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          <button onClick={applyHighlight}><Highlighter size={13} /> 高亮</button>
        </div>
      ) : null}
    </div>
  )
}
