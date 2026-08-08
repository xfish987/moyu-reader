import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, PanelLeftClose, PanelLeftOpen, RefreshCw, SendHorizonal, Trash2, X } from 'lucide-react'
import ChatMessages, { MarkdownText } from './components/ChatMessages'

// 字典百科独立窗口：吸附在阅读窗外上侧。
// 左侧边栏列出本书全部已解释条目（点击只切换详情，不跳转）；
// 右侧详情：引用块（点击跳转到书中原文位置）→ AI 初解释 → 追问对话 → 底部输入框。
// 数据全部来自阅读窗口推送的快照；动作通过 dict:action 回传阅读窗口执行。
// 注意：本应用的 Electron 页面 UA 默认样式不生效，所有元素必须显式类名 + CSS display。
export default function DictionaryWindow({ onClose = () => window.close() }) {
  const [snapshot, setSnapshot] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [question, setQuestion] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('dict-sidebar-collapsed') === '1')
  const bottomRef = useRef(null)

  const toggleSidebar = () => {
    setSidebarCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('dict-sidebar-collapsed', next ? '1' : '0')
      return next
    })
  }

  useEffect(() => window.readerAPI?.onDictSync?.((next) => setSnapshot(next)), [])
  useEffect(() => window.readerAPI?.onDictFocus?.((entryId) => { if (entryId) setSelectedId(entryId) }), [])

  const entries = useMemo(() => snapshot?.entries || [], [snapshot])
  const entry = entries.find((item) => item.id === selectedId) || entries[entries.length - 1] || null
  // 追问问答对展开成聊天消息：q-/a- 前缀区分同一 followup 的问题与回答，回调里 slice(2) 还原 followupId。
  const followupMessages = useMemo(() => (entry?.followUps || []).flatMap((item) => [
    { id: `q-${item.id}`, role: 'user', content: item.question, createdAt: item.createdAt },
    { id: `a-${item.id}`, role: 'assistant', content: item.answer, createdAt: item.createdAt, pending: Boolean(item.pending), error: item.error || null },
  ]), [entry])

  useEffect(() => {
    document.title = snapshot?.bookTitle ? `字典百科 - ${snapshot.bookTitle}` : '字典百科'
  }, [snapshot?.bookTitle])

  // 新解说 / 新追问到达时滚到底部；切换条目时回到顶部。
  const followupCount = entry?.followUps?.length || 0
  const lastAnswer = entry?.followUps?.[followupCount - 1]?.answer || ''
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'auto' })
  }, [entry?.explanation, followupCount, lastAnswer])
  useEffect(() => {
    document.querySelector('.dictionary-detail')?.scrollTo({ top: 0 })
  }, [entry?.id])

  const send = (action) => window.readerAPI?.sendDictAction?.(action)

  const askFollowup = () => {
    const text = question.trim()
    if (!text || !entry || entry.followUpPending) return
    send({ type: 'followup', entryId: entry.id, question: text.slice(0, 500) })
    setQuestion('')
  }

  return (
    <main className="dictionary-window">
      <header className="dictionary-header">
        <div className="dictionary-title"><BookOpenText size={16} /><strong>{snapshot?.bookTitle ? `《${snapshot.bookTitle}》字典百科` : '字典百科'}</strong>{entries.length ? <span>{entries.length} 条</span> : null}</div>
        <div className="dictionary-nav">
          <button onClick={onClose} title="关闭"><X size={15} /></button>
        </div>
      </header>
      {entries.length ? (
        <div className="dictionary-main">
          <nav className={`dictionary-sidebar ${sidebarCollapsed ? 'is-collapsed' : ''}`}>
            <button className="dictionary-collapse" onClick={toggleSidebar} title={sidebarCollapsed ? '展开会话列表' : '收起会话列表'}>
              {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
            </button>
            {sidebarCollapsed ? null : [...entries].reverse().map((item) => (
              <div className="dictionary-entry" key={item.id}>
                <button className={`dictionary-entry-open ${entry?.id === item.id ? 'active' : ''}`} onClick={() => setSelectedId(item.id)} title={item.text}>
                  <strong>{item.text}</strong>
                  <span>{item.chapterLabel || '未知章节'} · {Math.round((item.readPercent || 0) * 100)}%</span>
                </button>
                <button
                  className="dictionary-entry-delete"
                  title="删除这条解释（含全部追问）"
                  onClick={() => { if (window.confirm(`删除“${item.text}”的这条解释记录吗？其中的追问对话也会一起删除。`)) send({ type: 'delete-entry', entryId: item.id }) }}
                ><Trash2 size={11} /></button>
              </div>
            ))}
          </nav>
          {entry ? (
            <div className="dictionary-detail">
              <button className="dictionary-quote" onClick={() => send({ type: 'jump-to-source', entryId: entry.id })} title="点击跳转到书中原文位置">
                <span className="quote-text">{entry.text}</span>
                <span className="quote-meta">{entry.chapterLabel || '未知章节'} · 读到 {Math.round((entry.readPercent || 0) * 100)}% 处 · 点击跳转原文</span>
              </button>
              <section className="dictionary-answer">
                {entry.generating ? (
                  <div className="dictionary-pending"><span className="ai-thinking"><i /><i /><i /></span> AI 正在结合上下文解说…</div>
                ) : entry.error ? (
                  <div className="dictionary-error"><span>解说失败：{entry.error}</span><button onClick={() => send({ type: 'regenerate', entryId: entry.id })}>重试</button></div>
                ) : (
                  <MarkdownText text={entry.explanation} />
                )}
                <div className="dictionary-answer-actions">
                  <button disabled={Boolean(entry.generating)} onClick={() => send({ type: 'regenerate', entryId: entry.id })} title="重新让 AI 解释这段文字"><RefreshCw size={13} className={entry.generating ? 'spin' : ''} /> 重新生成</button>
                  {entry.providerName ? <span className="dictionary-meta">{entry.providerName} / {entry.model}</span> : null}
                </div>
              </section>
              {followupMessages.length ? (
                <div className="dictionary-followups">
                  <ChatMessages
                    messages={followupMessages}
                    onEdit={(message, question) => send({ type: 'edit-followup', entryId: entry.id, followupId: message.id.slice(2), question })}
                    onDelete={(message) => send({ type: 'delete-followup', entryId: entry.id, followupId: message.id.slice(2) })}
                    onRegenerate={(message) => send({ type: 'retry-followup', entryId: entry.id, followupId: message.id.slice(2) })}
                    onRetry={(message) => send({ type: 'retry-followup', entryId: entry.id, followupId: message.id.slice(2) })}
                  />
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="dictionary-empty"><BookOpenText size={26} /><strong>{snapshot ? '还没有解释记录' : '等待阅读窗口同步'}</strong><span>在阅读中划选文字，右键选择“字典百科”</span></div>
      )}
      {entry ? (
        <footer className="dictionary-ask">
          <textarea
            value={question}
            rows={2}
            placeholder="追问这段文字，例如：主角为什么这样做？(Enter 发送，Shift+Enter 换行)"
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); askFollowup() }
            }}
          />
          <button disabled={!question.trim() || Boolean(entry.followUpPending)} onClick={askFollowup} title="发送追问"><SendHorizonal size={15} /></button>
        </footer>
      ) : null}
    </main>
  )
}
