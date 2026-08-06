import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { marked } from 'marked'

// 共享聊天消息列表：字典百科追问区与"剧情提问"陪读窗口共用。
// messages: [{ id, role: 'user'|'assistant', content, createdAt?, pending?, error? }]
// 动作回调全部由调用方注入（窗口侧映射到 IPC action，阅读窗侧执行）。

marked.use({ breaks: true, gfm: true })

// marked 不做 XSS 消毒：先把内容里的 HTML 特殊字符转成实体（原始 HTML 一律按文本
// 显示，只保留 Markdown 语法效果），再交给 marked 解析。
function escapeHtml(text) {
  return String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function MarkdownText({ text }) {
  const html = useMemo(() => marked.parse(escapeHtml(text)), [text])
  // eslint-disable-next-line react/no-danger
  return <div className="chat-md" dangerouslySetInnerHTML={{ __html: html }} />
}

export default function ChatMessages({ messages = [], onCopy, onEdit, onDelete, onRegenerate, onRetry, emptyHint }) {
  const bottomRef = useRef(null)
  const copyTimerRef = useRef(null)
  const [copiedId, setCopiedId] = useState('')
  const [editing, setEditing] = useState(null) // { id, message, draft }

  // 新消息到达时滚到底部。
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
  }, [messages.length])

  useEffect(() => () => clearTimeout(copyTimerRef.current), [])

  const copyMessage = (message) => {
    navigator.clipboard?.writeText(message.content || '').catch(() => {})
    onCopy?.(message)
    setCopiedId(message.id)
    clearTimeout(copyTimerRef.current)
    copyTimerRef.current = setTimeout(() => setCopiedId(''), 1500)
  }

  const confirmDelete = (message) => {
    if (window.confirm('确定删除这条消息吗？')) onDelete?.(message)
  }

  const saveEdit = () => {
    const draft = String(editing?.draft || '').trim()
    if (editing && draft) onEdit?.(editing.message, draft)
    setEditing(null)
  }

  if (!messages.length) {
    return (
      <div className="chat-messages">
        <div className="chat-empty">{emptyHint || ''}</div>
      </div>
    )
  }

  return (
    <div className="chat-messages">
      {messages.map((message) => {
        const isUser = message.role === 'user'
        const isEditing = editing?.id === message.id
        return (
          <div key={message.id} className={`chat-msg ${isUser ? 'is-user' : 'is-assistant'} ${isEditing ? 'is-editing' : ''}`}>
            <div className="chat-bubble">
              {isEditing ? (
                <div className="chat-edit">
                  <textarea
                    autoFocus
                    value={editing.draft}
                    rows={Math.min(8, Math.max(2, editing.draft.split('\n').length))}
                    onChange={(event) => setEditing({ id: editing.id, message: editing.message, draft: event.target.value })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); saveEdit() }
                      if (event.key === 'Escape') setEditing(null)
                    }}
                  />
                  <div className="chat-edit-actions">
                    <button onClick={() => setEditing(null)}>取消</button>
                    <button className="is-primary" disabled={!editing.draft.trim()} onClick={saveEdit}>保存并重新提问</button>
                  </div>
                </div>
              ) : isUser ? (
                <span className="chat-text">{message.content}</span>
              ) : message.pending ? (
                <span className="chat-pending">正在思考<span className="ai-thinking"><i /><i /><i /></span></span>
              ) : message.error ? (
                <span className="chat-error">
                  <span>回答失败：{message.error}</span>
                  {onRetry ? <button onClick={() => onRetry(message)}>重试</button> : null}
                </span>
              ) : (
                <MarkdownText text={message.content} />
              )}
            </div>
            {!isEditing && !message.pending ? (
              <div className="chat-actions">
                <button title="复制" onClick={() => copyMessage(message)}>
                  {copiedId === message.id ? <Check size={12} /> : <Copy size={12} />}
                </button>
                {isUser && onEdit ? (
                  <button title="编辑并重新提问" onClick={() => setEditing({ id: message.id, message, draft: message.content || '' })}><Pencil size={12} /></button>
                ) : null}
                {!isUser && onRegenerate && !message.error ? (
                  <button title="重新生成" onClick={() => onRegenerate(message)}><RefreshCw size={12} /></button>
                ) : null}
                {onDelete ? (
                  <button title="删除" className="is-danger" onClick={() => confirmDelete(message)}><Trash2 size={12} /></button>
                ) : null}
              </div>
            ) : null}
          </div>
        )
      })}
      <div ref={bottomRef} />
    </div>
  )
}
