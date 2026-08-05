import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpenText, RefreshCw, SendHorizonal, Trash2, X } from 'lucide-react'

// 字典百科独立窗口：吸附在阅读窗外上侧。
// 左侧边栏列出本书全部已解释条目（点击只切换详情，不跳转）；
// 右侧详情：引用块（点击跳转到书中原文位置）→ AI 初解释 → 追问对话 → 底部输入框。
// 数据全部来自阅读窗口推送的快照；动作通过 dict:action 回传阅读窗口执行。
// 注意：本应用的 Electron 页面 UA 默认样式不生效，所有元素必须显式类名 + CSS display。
export default function DictionaryWindow() {
  const [snapshot, setSnapshot] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [question, setQuestion] = useState('')
  const bottomRef = useRef(null)

  useEffect(() => window.readerAPI?.onDictSync?.((next) => setSnapshot(next)), [])
  useEffect(() => window.readerAPI?.onDictFocus?.((entryId) => { if (entryId) setSelectedId(entryId) }), [])

  const entries = useMemo(() => snapshot?.entries || [], [snapshot])
  const entry = entries.find((item) => item.id === selectedId) || entries[entries.length - 1] || null

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
          <button onClick={() => window.close()} title="关闭"><X size={15} /></button>
        </div>
      </header>
      {entries.length ? (
        <div className="dictionary-main">
          <nav className="dictionary-sidebar">
            {[...entries].reverse().map((item) => (
              <button key={item.id} className={entry?.id === item.id ? 'active' : ''} onClick={() => setSelectedId(item.id)} title={item.text}>
                <strong>{item.text}</strong>
                <span>{item.chapterLabel || '未知章节'} · {Math.round((item.readPercent || 0) * 100)}%</span>
              </button>
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
                  <div className="dictionary-pending"><RefreshCw className="spin" size={14} /> AI 正在结合上下文解说…</div>
                ) : entry.error ? (
                  <div className="dictionary-error"><span>解说失败：{entry.error}</span><button onClick={() => send({ type: 'regenerate', entryId: entry.id })}>重试</button></div>
                ) : (
                  <p>{entry.explanation}</p>
                )}
                <div className="dictionary-answer-actions">
                  <button disabled={Boolean(entry.generating)} onClick={() => send({ type: 'regenerate', entryId: entry.id })} title="重新让 AI 解释这段文字"><RefreshCw size={13} className={entry.generating ? 'spin' : ''} /> 重新生成</button>
                  {entry.providerName ? <span className="dictionary-meta">{entry.providerName} / {entry.model}</span> : null}
                </div>
              </section>
              {(entry.followUps || []).map((item) => (
                <section className="dictionary-followup" key={item.id}>
                  <div className="followup-question">
                    <p>{item.question}</p>
                    <button title="删除这条追问及回答" onClick={() => send({ type: 'delete-followup', entryId: entry.id, followupId: item.id })}><Trash2 size={12} /></button>
                  </div>
                  <div className="followup-answer">
                    {item.pending ? <div className="dictionary-pending"><RefreshCw className="spin" size={13} /> AI 正在翻章节回答…</div>
                      : item.error ? <div className="dictionary-error"><span>回答失败：{item.error}</span><button onClick={() => send({ type: 'retry-followup', entryId: entry.id, followupId: item.id })}>重试</button></div>
                      : <p>{item.answer}</p>}
                  </div>
                </section>
              ))}
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
