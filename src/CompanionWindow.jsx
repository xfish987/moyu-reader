import { useEffect, useMemo, useRef, useState } from 'react'
import { MessagesSquare, PanelLeftClose, PanelLeftOpen, Pencil, SendHorizonal, SquarePen, Trash2, X } from 'lucide-react'
import ChatMessages from './components/ChatMessages'

// "剧情提问"独立窗口：针对已读剧情的陪读问答。
// 左侧边栏列出本书全部会话（按更新时间倒序），右侧是共享聊天气泡 + 底部输入框。
// 数据全部来自阅读窗口推送的快照；动作通过 companion:action 回传阅读窗口执行。
// 注意：本应用的 Electron 页面 UA 默认样式不生效，所有元素必须显式类名 + CSS display。

function formatSessionTime(timestamp) {
  if (!timestamp) return ''
  const diff = Date.now() - timestamp
  if (diff < 60 * 1000) return '刚刚'
  if (diff < 3600 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 3600 * 1000) return `${Math.floor(diff / 3600000)} 小时前`
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}

export default function CompanionWindow() {
  const [snapshot, setSnapshot] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [question, setQuestion] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('companion-sidebar-collapsed') === '1')
  const [renamingId, setRenamingId] = useState('')
  const [renameText, setRenameText] = useState('')
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('companion-sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  useEffect(() => window.readerAPI?.onCompanionSync?.((next) => setSnapshot(next)), [])
  useEffect(() => {
    document.title = snapshot?.bookTitle ? `剧情提问 - ${snapshot.bookTitle}` : '剧情提问'
  }, [snapshot?.bookTitle])

  const sessions = useMemo(() => snapshot?.sessions || [], [snapshot])
  // 选中会话：优先阅读窗指定的 activeSessionId，其次本地点击选择，最后兜底最新一个。
  const session = sessions.find((item) => item.id === snapshot?.activeSessionId)
    || sessions.find((item) => item.id === selectedId)
    || sessions[sessions.length - 1]
    || null
  const sortedSessions = useMemo(() => [...sessions].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [sessions])
  const sending = Boolean(session?.messages?.some((message) => message.pending))

  const send = (action) => window.readerAPI?.sendCompanionAction?.(action)

  // 回答流式写回 / 切换会话时滚到底部。
  const lastMessage = session?.messages?.[session.messages.length - 1]
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [session?.id, session?.messages?.length, lastMessage?.content, lastMessage?.error])

  // 输入框自适应 1–5 行。
  const autoResizeInput = () => {
    const element = inputRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 116)}px`
  }
  useEffect(() => { autoResizeInput() }, [question])

  const askQuestion = () => {
    const text = question.trim()
    if (!text || sending || !snapshot?.bookId) return
    // 没有会话时 sessionId 传 null，阅读窗会隐式新建会话再发问（两边对齐的约定）。
    send({ type: 'send', sessionId: session?.id || null, question: text.slice(0, 2000) })
    setQuestion('')
  }

  const hasBook = Boolean(snapshot?.bookId)

  return (
    <main className="companion-window">
      <header className="companion-header">
        <div className="companion-title">
          <MessagesSquare size={16} />
          <strong>{snapshot?.bookTitle ? `《${snapshot.bookTitle}》剧情提问` : '剧情提问'}</strong>
          {sessions.length ? <span>{sessions.length} 个会话</span> : null}
        </div>
        <div className="companion-nav">
          {hasBook ? <button onClick={() => send({ type: 'new-session' })} title="新会话"><SquarePen size={15} /></button> : null}
          <button onClick={() => window.close()} title="关闭"><X size={15} /></button>
        </div>
      </header>
      {hasBook ? (
        <div className="companion-main">
          <nav className={`companion-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
            <button className="companion-collapse" onClick={toggleSidebar} title={sidebarCollapsed ? '展开会话列表' : '收起会话列表'}>
              {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
            </button>
            {sidebarCollapsed ? null : sortedSessions.map((item) => (
              <div className="companion-session" key={item.id}>
                {renamingId === item.id ? (
                  <input
                    className="companion-session-rename"
                    autoFocus
                    value={renameText}
                    maxLength={40}
                    onChange={(event) => setRenameText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.nativeEvent?.isComposing) return
                      if (event.key === 'Enter') {
                        const title = renameText.trim()
                        if (title) send({ type: 'rename-session', sessionId: item.id, title })
                        setRenamingId('')
                      }
                      if (event.key === 'Escape') setRenamingId('')
                    }}
                    onBlur={() => setRenamingId('')}
                  />
                ) : (
                  <button
                    className={`companion-session-open ${session?.id === item.id ? 'active' : ''}`}
                    onClick={() => { setSelectedId(item.id); send({ type: 'select-session', sessionId: item.id }) }}
                    onDoubleClick={() => { setRenamingId(item.id); setRenameText(item.title || '') }}
                    title={item.title}
                  >
                    <strong>{item.title || '新会话'}</strong>
                    <span>{formatSessionTime(item.updatedAt)} · {item.messages?.length ? `${Math.ceil(item.messages.length / 2)} 轮问答` : '空会话'}</span>
                  </button>
                )}
                {renamingId === item.id ? null : (
                  <div className="companion-session-actions">
                    <button
                      className="companion-session-rename-btn"
                      title="重命名会话"
                      onClick={() => { setRenamingId(item.id); setRenameText(item.title || '') }}
                    ><Pencil size={11} /></button>
                    <button
                      className="companion-session-delete"
                      title="删除这个会话"
                      onClick={() => { if (window.confirm(`确定删除会话“${item.title || '新会话'}”吗？`)) send({ type: 'delete-session', sessionId: item.id }) }}
                    ><Trash2 size={11} /></button>
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div className="companion-chat">
            <div className="companion-scroll" ref={scrollRef}>
              <ChatMessages
                messages={session?.messages || []}
                emptyHint="开启 AI 陪读后，可以问我任何已读剧情的问题"
                onEdit={(message, content) => session && send({ type: 'edit-message', sessionId: session.id, messageId: message.id, content })}
                onDelete={(message) => session && send({ type: 'delete-message', sessionId: session.id, messageId: message.id })}
                onRegenerate={(message) => session && send({ type: 'regenerate', sessionId: session.id, messageId: message.id })}
                onRetry={(message) => session && send({ type: 'retry', sessionId: session.id, messageId: message.id })}
              />
            </div>
            <footer className="companion-input">
              <textarea
                ref={inputRef}
                value={question}
                rows={1}
                placeholder="问问剧情：主角现在在哪？刚才发生了什么？"
                onChange={(event) => setQuestion(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); askQuestion() }
                }}
              />
              <button disabled={!question.trim() || sending} onClick={askQuestion} title="发送"><SendHorizonal size={15} /></button>
            </footer>
          </div>
        </div>
      ) : (
        <div className="companion-empty">
          <MessagesSquare size={26} />
          <strong>{snapshot ? '当前没有打开的书' : '等待阅读窗口同步'}</strong>
          <span>回到阅读窗口打开一本书并开启 AI 陪读</span>
        </div>
      )}
    </main>
  )
}
