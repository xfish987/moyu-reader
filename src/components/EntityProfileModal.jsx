import { useEffect, useRef, useState } from 'react'
import { BookOpenCheck, Copy, MapPin, RefreshCw, ServerCog, ShieldCheck, X } from 'lucide-react'
import AISettingsModal from './AISettingsModal'
import EntityDetails from './EntityDetails'
import EntityRelations from './EntityRelations'

function pickRepresentative(items, limit = 120) {
  if (items.length <= limit) return items
  const first = items.slice(0, 30)
  const last = items.slice(-60)
  const middle = items.slice(30, -60)
  const slots = limit - first.length - last.length
  const sampled = Array.from({ length: slots }, (_, index) => middle[Math.floor(index * middle.length / slots)]).filter(Boolean)
  return [...first, ...sampled, ...last]
}

export default function EntityProfileModal({ selection, loadContext, cachedProfile, entityProfiles = [], onSave, onClose }) {
  const [settings, setSettings] = useState(null)
  const [profile, setProfile] = useState(cachedProfile || null)
  const [contextInfo, setContextInfo] = useState(null)
  const [status, setStatus] = useState(cachedProfile ? 'cached' : 'searching')
  const [error, setError] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const startedRef = useRef(false)
  const isLaterProgress = !cachedProfile || Number(selection.readPosition) > Number(cachedProfile.readPosition) + (Number(selection.readPosition) <= 1 ? 0.0005 : 1)

  const run = async () => {
    setError(null)
    setStatus('searching')
    try {
      const config = settings || await window.readerAPI.getAiSettings()
      setSettings(config)
      const provider = config.providers.find((item) => item.id === config.activeProviderId) || config.providers[0]
      if (!provider) {
        setStatus('setup')
        setSettingsOpen(true)
        return
      }
      const lookupNames = cachedProfile ? [cachedProfile.name, ...(cachedProfile.aliases || []), selection.text] : [selection.text]
      const context = await loadContext([...new Set(lookupNames.filter(Boolean))])
      const excerpts = pickRepresentative(context.excerpts || [])
      setContextInfo({ ...context, sentCount: excerpts.length })
      if (!excerpts.length) {
        setError({ stage: 'search', status: 0, code: 'NO_PRIOR_EVIDENCE', message: '当前阅读位置之前没有找到这个名称的相关片段' })
        setStatus('error')
        return
      }
      setStatus('summarizing')
      const result = await window.readerAPI.summarizeEntity({
        name: selection.text,
        excerpts,
        totalMatches: context.totalMatches || excerpts.length,
        providerId: provider.id,
        model: provider.model || provider.models?.[0],
        maxTokens: Math.min(8000, provider.maxTokens || 2000),
        knownEntities: entityProfiles.map(({ name, aliases, distinctFrom, identityLocked }) => ({ name, aliases, distinctFrom, identityLocked })),
      })
      if (!result.ok) {
        setError(result.error)
        setStatus('error')
        return
      }
      const generated = result.profile || { canonicalName: selection.text, aliases: [], type: '未分类', summary: result.summary, evidence: [] }
      const next = { id: cachedProfile?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: generated.canonicalName || selection.text, aliases: [...new Set([...(cachedProfile?.identityLocked ? (cachedProfile.aliases || []) : []), ...(generated.aliases || []), ...(generated.canonicalName !== selection.text ? [selection.text] : [])])], type: generated.type || '未分类', summary: generated.summary || result.summary, details: generated.details || {}, relations: generated.relations || [], evidence: generated.evidence || [], identityConfidence: generated.identityConfidence || 'low', identityLocked: Boolean(cachedProfile?.identityLocked), distinctFrom: cachedProfile?.distinctFrom || [], providerId: result.providerId, providerName: result.providerName, model: result.model, totalMatches: context.totalMatches || excerpts.length, sentCount: excerpts.length, readPosition: selection.readPosition, readPercent: selection.readPercent, createdAt: Date.now() }
      setProfile(next)
      setStatus('complete')
      onSave?.(next)
    } catch (reason) {
      setError({ stage: status === 'searching' ? 'search' : 'summary', status: 0, code: 'LOOKUP_FAILED', message: reason?.message || '资料回顾失败' })
      setStatus('error')
    }
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    if (!cachedProfile || isLaterProgress) run()
  }, [])

  const provider = settings?.providers?.find((item) => item.id === settings.activeProviderId) || settings?.providers?.[0]
  const diagnostic = error ? [
    '墨读阅读器资料回顾诊断',
    `名称：${selection.text}`,
    `阶段：${error.stage || '未知'}`,
    `HTTP 状态码：${error.status || '无'}`,
    `错误码：${error.code || 'UNKNOWN'}`,
    `信息：${error.message}`,
  ].join('\n') : ''

  return (
    <div className="modal-backdrop entity-profile-backdrop">
      <section className="entity-profile-modal" role="dialog" aria-modal="true" aria-label={`${selection.text}的资料回顾`}>
        <header className="ai-modal-header">
          <div><BookOpenCheck size={20} /><div><strong>{selection.text} · 资料回顾</strong><span>只依据当前位置之前已经读过的内容</span></div></div>
          <div className="dialog-header-actions"><button className="icon-command" onClick={() => setSettingsOpen(true)} title="AI 供应商"><ServerCog size={17} /></button><button className="icon-command" onClick={onClose} title="关闭"><X size={18} /></button></div>
        </header>
        <div className="entity-profile-body">
          <div className="spoiler-safe-note"><ShieldCheck size={16} /><span><strong>防剧透检索</strong><small>没有读取当前选区之后的章节，也没有使用外部资料。</small></span></div>
          {['searching', 'summarizing'].includes(status) ? (
            <div className="entity-loading"><RefreshCw className="spin" size={22} /><strong>{status === 'searching' ? '正在检索此前出现的片段' : '正在整理资料卡片'}</strong><span>{contextInfo ? `共找到 ${contextInfo.totalMatches} 处，选取 ${contextInfo.sentCount} 处用于总结` : '长篇书籍可能需要一点时间'}</span></div>
          ) : profile ? (
            <>
              <div className="entity-profile-title"><span>{profile.type || '未分类'}</span><strong>{profile.name}</strong>{profile.aliases?.length ? <small>别名：{profile.aliases.join('、')}</small> : null}</div>
              <div className="entity-summary">{profile.summary}</div>
              <EntityDetails details={profile.details} />
              <EntityRelations relations={profile.relations} />
              {profile.evidence?.length ? <div className="entity-evidence"><strong>已读内容依据</strong>{profile.evidence.map((item, index) => <p key={index}><span>{item.chapter || `片段 ${index + 1}`}</span>{item.text}</p>)}</div> : null}
              <div className="entity-meta"><span><MapPin size={13} /> 总结到当前阅读位置</span><span>找到 {profile.totalMatches} 处 · 使用 {profile.sentCount} 处</span><span>{profile.providerName} / {profile.model}</span></div>
            </>
          ) : null}
          {error ? <div className="ai-error-card" role="alert"><strong>{error.message}</strong><div><span>阶段：{error.stage}</span><span>状态码：{error.status || '无'}</span><span>错误码：{error.code}</span></div><button onClick={() => navigator.clipboard.writeText(diagnostic)}><Copy size={13} /> 复制诊断信息</button></div> : null}
        </div>
        <footer className="dialog-footer"><span>{provider ? `${provider.name} · ${provider.model || '未选模型'}` : '尚未设置供应商'}</span><div><button className="secondary-button" onClick={onClose}>关闭</button><button className="primary-button" onClick={run} disabled={['searching', 'summarizing'].includes(status) || (Boolean(cachedProfile) && !isLaterProgress && !error)}><RefreshCw size={14} /> {cachedProfile && !isLaterProgress && !error ? '已是当前进度最新资料' : profile ? '更新到当前进度' : '重新尝试'}</button></div></footer>
      </section>
      <AISettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onChange={(value) => setSettings(value)} />
    </div>
  )
}
