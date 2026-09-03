import { useCallback, useEffect, useState } from 'react'
import { Heart, MessageCircle, Send, Trash2, X } from 'lucide-react'

const bookKeyOf = (book) => book.fingerprint || book.id || book.path

export default function ReaderThoughtsPanel({ book, draft, onChanged, onClose }) {
  const [thoughts, setThoughts] = useState([])
  const [content, setContent] = useState('')
  const [replyDrafts, setReplyDrafts] = useState({})
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const bookKey = bookKeyOf(book)

  const load = useCallback(async () => {
    try {
      const result = await window.readerAPI.listReaderThoughts(bookKey)
      setThoughts(result.thoughts || [])
      setError('')
    } catch (nextError) { setError(nextError?.message || '请先登录账户后查看读者想法') }
  }, [bookKey])

  useEffect(() => { load() }, [load])

  const run = async (key, operation) => {
    setBusy(key); setError('')
    try { await operation(); await load(); onChanged?.() } catch (nextError) { setError(nextError?.message || '操作失败') } finally { setBusy('') }
  }

  const publish = () => run('publish', async () => {
    await window.readerAPI.createReaderThought({ bookKey, bookTitle: book.title, quote: draft.text, content, anchor: { paragraphIndex: draft.paragraphIndex, startOffset: draft.startOffset, endOffset: draft.endOffset, chapter: draft.chapterLabel, cfi: draft.cfi, href: draft.href, chunkOffset: draft.chunkOffset } })
    setContent('')
  })

  return (
    <aside className="reader-thoughts-panel" aria-label="读者想法">
      <header><div><MessageCircle size={16} /><strong>读者想法</strong><span>{thoughts.length}</span></div><button onClick={onClose} aria-label="关闭读者想法"><X size={16} /></button></header>
      {draft ? <section className="thought-compose"><blockquote>{draft.text}</blockquote><textarea autoFocus rows={4} maxLength={3000} value={content} placeholder="写下这一刻的想法…" onChange={(event) => setContent(event.target.value)} /><button disabled={!content.trim() || Boolean(busy)} onClick={publish}><Send size={14} />发表想法</button></section> : null}
      {error ? <p className="thought-error">{error}</p> : null}
      <div className="thought-stream">
        {thoughts.length ? thoughts.map((thought) => (
          <article key={thought.id}>
            <header><span className="thought-avatar">{thought.avatar ? <img src={thought.avatar} alt="" /> : (thought.nickname || thought.username || '?').slice(0, 1)}</span><strong>{thought.nickname || thought.username}</strong><time>{new Date(thought.createdAt).toLocaleString('zh-CN')}</time>{thought.mine ? <button onClick={() => run(`delete-${thought.id}`, () => window.readerAPI.deleteReaderThought(thought.id))} aria-label="删除自己的想法"><Trash2 size={12} /></button> : null}</header>
            <blockquote>{thought.quote}</blockquote>
            <p>{thought.content}</p>
            <footer><button className={thought.liked ? 'active' : ''} onClick={() => run(`like-${thought.id}`, () => window.readerAPI.likeReaderThought(thought.id))}><Heart size={13} />{thought.likeCount || 0}</button><span>{thought.replies?.length || 0} 条回复</span></footer>
            {thought.replies?.length ? <div className="thought-replies">{thought.replies.map((reply) => <p key={reply.id}><span className="thought-avatar is-small">{reply.avatar ? <img src={reply.avatar} alt="" /> : (reply.nickname || reply.username || '?').slice(0, 1)}</span><strong>{reply.nickname || reply.username}</strong><span>{reply.content}</span>{reply.mine ? <button onClick={() => run(`reply-delete-${reply.id}`, () => window.readerAPI.deleteReaderThoughtReply({ thoughtId: thought.id, replyId: reply.id }))}><X size={11} /></button> : null}</p>)}</div> : null}
            <div className="thought-reply-box"><input maxLength={1200} value={replyDrafts[thought.id] || ''} placeholder="回复这条想法" onChange={(event) => setReplyDrafts((current) => ({ ...current, [thought.id]: event.target.value }))} /><button disabled={!replyDrafts[thought.id]?.trim() || Boolean(busy)} onClick={() => run(`reply-${thought.id}`, async () => { await window.readerAPI.replyReaderThought({ thoughtId: thought.id, content: replyDrafts[thought.id] }); setReplyDrafts((current) => ({ ...current, [thought.id]: '' })) })}><Send size={12} /></button></div>
          </article>
        )) : <div className="thought-empty">还没有读者留下想法。<br />选中一句文字，右键即可成为第一个。</div>}
      </div>
    </aside>
  )
}
