import { useEffect, useRef, useState } from 'react'
import { BookOpenText, Plus, SendHorizonal, X } from 'lucide-react'

export default function DictionaryQuestionModal({ selection, onClose, onSubmit }) {
  const [question, setQuestion] = useState('')
  const [useReferences, setUseReferences] = useState(false)
  const [referenceDraft, setReferenceDraft] = useState('')
  const [referenceTerms, setReferenceTerms] = useState([])
  const inputRef = useRef(null)

  useEffect(() => {
    if (!selection) return undefined
    setQuestion('')
    setUseReferences(false)
    setReferenceDraft('')
    setReferenceTerms([])
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [selection])

  useEffect(() => {
    if (!selection) return undefined
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose?.() }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [selection, onClose])

  if (!selection) return null
  const submit = () => {
    const text = question.trim()
    if (text) onSubmit?.({ question: text.slice(0, 500), referenceTerms: useReferences ? referenceTerms : [] })
  }

  const addReference = () => {
    const term = referenceDraft.trim().slice(0, 20)
    if (!term || referenceTerms.includes(term) || referenceTerms.length >= 5) return
    setReferenceTerms((current) => [...current, term])
    setReferenceDraft('')
  }

  return (
    <div className="modal-backdrop dictionary-question-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="dictionary-question-modal" role="dialog" aria-modal="true" aria-labelledby="dictionary-question-title">
        <header>
          <div><BookOpenText size={18} /><strong id="dictionary-question-title">向字典百科提问</strong></div>
          <button type="button" onClick={onClose} title="关闭" aria-label="关闭"><X size={17} /></button>
        </header>
        <blockquote>{selection.text}</blockquote>
        <div className="dictionary-reference-control">
          <label className="dictionary-reference-toggle"><input type="checkbox" checked={useReferences} onChange={(event) => setUseReferences(event.target.checked)} /><span>补充人物 / 地点线索</span></label>
          {useReferences ? (
            <div className="dictionary-reference-fields">
              {referenceTerms.length ? <div className="dictionary-reference-chips">{referenceTerms.map((term) => <span key={term}>{term}<button type="button" title={`移除 ${term}`} aria-label={`移除 ${term}`} onClick={() => setReferenceTerms((current) => current.filter((item) => item !== term))}><X size={11} /></button></span>)}</div> : null}
              <div className="dictionary-reference-input"><input value={referenceDraft} maxLength={20} placeholder="输入人名或地名，如：灵月" onChange={(event) => setReferenceDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); addReference() } }} /><button type="button" disabled={!referenceDraft.trim() || referenceTerms.length >= 5} onClick={addReference} title="添加索引词"><Plus size={14} /></button></div>
              <small>最多 5 个，只检索当前阅读位置之前的内容</small>
            </div>
          ) : null}
        </div>
        <label>
          <span>你对这段文字有什么疑问？</span>
          <textarea ref={inputRef} rows={4} maxLength={500} value={question} placeholder="例如：这里为什么说他没有退路？" onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent?.isComposing) { event.preventDefault(); submit() } }} />
        </label>
        <footer>
          <span>{question.length}/500</span>
          <div><button type="button" className="secondary-button" onClick={onClose}>取消</button><button type="button" className="primary-button" disabled={!question.trim()} onClick={submit}><SendHorizonal size={14} /> 提问</button></div>
        </footer>
      </section>
    </div>
  )
}
