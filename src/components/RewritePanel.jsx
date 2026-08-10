import { RotateCcw, Sparkles, Undo2, X } from 'lucide-react'

export default function RewritePanel({ entry, requirement, targetLength, busy, error, onRequirement, onTargetLength, onGenerate, onApply, onUndo, onClose }) {
  if (!entry) return null
  return (
    <aside className="rewrite-panel" aria-label="AI 改写">
      <header><div><Sparkles size={16} /><strong>改写</strong><span>{entry.chapterLabel || '当前章节'}</span></div><button onClick={onClose} aria-label="关闭改写面板"><X size={16} /></button></header>
      <div className="rewrite-panel-body">
        <section className="rewrite-original"><span>原始片段</span><p>{entry.originalText}</p></section>
        <label className="rewrite-requirement"><span>改写要求</span><textarea rows={3} value={requirement} onChange={(event) => onRequirement(event.target.value)} placeholder="例如：增强压迫感，保留第一人称和人物语气" /></label>
        <label className="rewrite-length"><span>目标字数</span><input type="number" min="50" max="5000" step="50" value={targetLength} onChange={(event) => onTargetLength(event.target.value)} /><em>字左右</em></label>
        {error ? <p className="rewrite-error">{error}</p> : null}
        <section className={`rewrite-result ${busy ? 'is-generating' : ''}`}>
          <span>{busy ? '正在结合本章上下文改写…' : '改写结果'}</span>
          {entry.generatedText ? <p>{entry.generatedText}</p> : <p className="rewrite-placeholder">填写要求后生成；每次重新生成都以最初原文为底稿。</p>}
        </section>
      </div>
      <footer>
        <button className="rewrite-regenerate" disabled={busy || !requirement.trim()} onClick={onGenerate}><RotateCcw size={14} />{entry.generatedText ? '重新生成' : '生成改写'}</button>
        {entry.applied ? <button className="rewrite-undo" onClick={onUndo}><Undo2 size={14} />撤销覆盖</button> : <button className="rewrite-apply" disabled={!entry.generatedText || busy} onClick={onApply}><Sparkles size={14} />覆盖显示</button>}
      </footer>
    </aside>
  )
}
