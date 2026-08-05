import { useEffect, useRef, useState } from 'react'
import { BookOpenCheck, Copy, MapPin, RefreshCw, ServerCog, ShieldCheck, Trash2, X } from 'lucide-react'
import AISettingsModal from './AISettingsModal'
import EntityDetails from './EntityDetails'
import EntityRelations from './EntityRelations'
import { isCorruptProfile } from '../entityProfiles'

function pickRepresentative(items, limit = 400) {
  if (items.length <= limit) return items
  const first = items.slice(0, 100)
  const last = items.slice(-150)
  const middle = items.slice(100, -150)
  const slots = limit - first.length - last.length
  const sampled = Array.from({ length: slots }, (_, index) => middle[Math.floor(index * middle.length / slots)]).filter(Boolean)
  return [...first, ...sampled, ...last]
}

export default function EntityProfileModal({ selection, loadContext, cachedProfile, entityProfiles = [], onSave, onDelete, onClose }) {
  const [settings, setSettings] = useState(null)
  const [profile, setProfile] = useState(cachedProfile || null)
  const [contextInfo, setContextInfo] = useState(null)
  const [status, setStatus] = useState(cachedProfile ? 'cached' : 'searching')
  const [error, setError] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const [streamReceived, setStreamReceived] = useState(false)
  const [prepared, setPrepared] = useState(null)
  const startedRef = useRef(false)
  const isLaterProgress = !cachedProfile || Number(selection.readPosition) > Number(cachedProfile.readPosition) + (Number(selection.readPosition) <= 1 ? 0.0005 : 1)

  // 只做本地检索（不消耗 token），把检索结果备好，等用户确认后再生成。
  const search = async () => {
    setError(null)
    setStatus('searching')
    setElapsedSeconds(0)
    try {
      const config = settings || await window.readerAPI.getAiSettings()
      setSettings(config)
      const provider = config.providers.find((item) => item.id === config.activeProviderId) || config.providers[0]
      if (!provider) {
        setStatus('setup')
        setSettingsOpen(true)
        return null
      }
      const lookupNames = cachedProfile ? [cachedProfile.name, ...(cachedProfile.aliases || []), selection.text] : [selection.text]
      const uniqueNames = [...new Set(lookupNames.filter(Boolean))]
      // 增量更新：有旧卡且进度更靠后时，只检索旧卡位置之后的新片段，随旧卡一起发给模型。
      let incremental = Boolean(cachedProfile && isLaterProgress)
      let context = await loadContext(uniqueNames, incremental ? { fromReadPosition: Number(cachedProfile.readPosition) || 0 } : {})
      let excerpts = pickRepresentative(context.excerpts || [])
      if (incremental && !excerpts.length) {
        // 增量检索为空（位置映射偏差等）时回退全量检索，保证链路不断。
        incremental = false
        context = await loadContext(uniqueNames)
        excerpts = pickRepresentative(context.excerpts || [])
      }
      setContextInfo({ ...context, sentCount: excerpts.length })
      if (!excerpts.length) {
        setError({ stage: 'search', status: 0, code: 'NO_PRIOR_EVIDENCE', message: '当前阅读位置之前没有找到这个名称的相关片段' })
        setStatus('error')
        return null
      }
      const prep = { excerpts, context, incremental, provider }
      setPrepared(prep)
      setStatus('ready')
      return prep
    } catch (reason) {
      setError({ stage: 'search', status: 0, code: 'LOOKUP_FAILED', message: reason?.message || '资料检索失败' })
      setStatus('error')
      return null
    }
  }

  // 用户点击后才会走到这里：调用模型生成/更新资料卡。
  const generate = async (prep) => {
    const ready = prep || prepared || await search()
    if (!ready) return
    setError(null)
    setStatus('summarizing')
    setElapsedSeconds(0)
    setStreamReceived(false)
    try {
      const result = await window.readerAPI.summarizeEntity({
        name: selection.text,
        excerpts: ready.excerpts,
        totalMatches: ready.context.totalMatches || ready.excerpts.length,
        providerId: ready.provider.id,
        model: ready.provider.model || ready.provider.models?.[0],
        maxTokens: Math.min(8000, ready.provider.maxTokens || 2000),
        knownEntities: entityProfiles.map(({ name, aliases, distinctFrom, identityLocked }) => ({ name, aliases, distinctFrom, identityLocked })),
        previousProfile: ready.incremental ? { type: cachedProfile.type, summary: cachedProfile.summary, details: cachedProfile.details, relations: cachedProfile.relations } : null,
      })
      if (!result.ok) {
        setError(result.error)
        setStatus('error')
        return
      }
      const generated = result.profile || { canonicalName: selection.text, aliases: [], type: '未分类', summary: result.summary, evidence: [] }
      const next = { id: cachedProfile?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: generated.canonicalName || selection.text, aliases: [...new Set([...(cachedProfile?.identityLocked ? (cachedProfile.aliases || []) : []), ...(generated.aliases || []), ...(generated.canonicalName !== selection.text ? [selection.text] : [])])], type: generated.type || '未分类', summary: generated.summary || result.summary, details: generated.details || {}, relations: generated.relations || [], evidence: generated.evidence || [], identityConfidence: generated.identityConfidence || 'low', identityLocked: Boolean(cachedProfile?.identityLocked), distinctFrom: cachedProfile?.distinctFrom || [], incremental: ready.incremental, providerId: result.providerId, providerName: result.providerName, model: result.model, totalMatches: ready.context.totalMatches || ready.excerpts.length, sentCount: ready.excerpts.length, readPosition: selection.readPosition, readPercent: selection.readPercent, createdAt: Date.now() }
      setProfile(next)
      setStatus('complete')
      onSave?.(next)
    } catch (reason) {
      setError({ stage: 'summary', status: 0, code: 'LOOKUP_FAILED', message: reason?.message || '资料回顾失败' })
      setStatus('error')
    }
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    // 打开弹窗只自动检索（本地、免费），绝不自动调用模型。
    if (!cachedProfile || isLaterProgress) search()
  }, [])

  // 早期版本曾把破损 JSON 存成 summary；打开时本地修复（不调用模型），修好后自动替换缓存。
  useEffect(() => {
    if (!cachedProfile || !isCorruptProfile(cachedProfile)) return undefined
    let cancelled = false
    window.readerAPI.repairProfileJson?.({ text: cachedProfile.summary, name: cachedProfile.name }).then((result) => {
      if (cancelled || !result?.ok || !result.profile?.summary) return
      const recovered = { ...cachedProfile, type: result.profile.type, summary: result.profile.summary, details: result.profile.details, relations: result.profile.relations, evidence: result.profile.evidence, recovered: true }
      setProfile(recovered)
      onSave?.(recovered)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const corrupt = Boolean(profile && isCorruptProfile(profile))
  const handleDelete = () => {
    if (!cachedProfile || !onDelete) return
    if (!window.confirm(`删除「${cachedProfile.name}」的资料卡？此操作不可撤销。`)) return
    onDelete(cachedProfile.id)
    onClose()
  }

  useEffect(() => {
    if (!['searching', 'summarizing'].includes(status)) return undefined
    const startedAt = Date.now()
    const timer = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [status])

  useEffect(() => {
    const unsubscribe = window.readerAPI.onAiSummaryProgress?.((payload) => {
      if (payload?.phase === 'first-chunk' || payload?.phase === 'stream-started') setStreamReceived(true)
    })
    return unsubscribe
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
          <div className="dialog-header-actions">{cachedProfile ? <button className="icon-command" onClick={handleDelete} title="删除这份资料卡"><Trash2 size={16} /></button> : null}<button className="icon-command" onClick={() => setSettingsOpen(true)} title="AI 供应商"><ServerCog size={17} /></button><button className="icon-command" onClick={onClose} title="关闭"><X size={18} /></button></div>
        </header>
        <div className="entity-profile-body">
          <div className="spoiler-safe-note"><ShieldCheck size={16} /><span><strong>防剧透检索</strong><small>没有读取当前选区之后的章节，也没有使用外部资料。</small></span></div>
          {['searching', 'summarizing'].includes(status) ? (
            <div className="entity-loading"><RefreshCw className="spin" size={22} /><strong>{status === 'searching' ? '正在检索此前出现的片段' : streamReceived ? '已收到模型输出，正在整理资料卡' : '正在连接供应商'}</strong><span>{contextInfo ? `已选 ${contextInfo.sentCount} 条代表性依据（原命中 ${contextInfo.totalMatches} 条）` : '正在筛选首次、最近和章节均匀分布的依据'}</span></div>
          ) : profile ? (
            <>
              <div className="entity-profile-title"><span>{profile.type || '未分类'}</span><strong>{profile.name}</strong>{profile.aliases?.length ? <small>别名：{profile.aliases.join('、')}</small> : null}</div>
              {corrupt ? <div className="ai-error-card" role="alert"><strong>这份资料卡的内容异常（早期版本留下的损坏缓存），可点右下角“重新生成”，或点右上角删除。</strong></div> : null}
              {profile.recovered ? <div className="spoiler-safe-note"><ShieldCheck size={16} /><span><strong>已从损坏缓存自动修复</strong><small>未调用模型，本地还原了结构化内容。</small></span></div> : null}
              <div className="entity-summary">{profile.summary}</div>
              <EntityDetails details={profile.details} />
              <EntityRelations relations={profile.relations} />
              {profile.evidence?.length ? <div className="entity-evidence"><strong>已读内容依据</strong>{profile.evidence.map((item, index) => <p key={index}><span>{item.chapter || `片段 ${index + 1}`}</span>{item.text}</p>)}</div> : null}
              <div className="entity-meta"><span><MapPin size={13} /> 总结到当前阅读位置</span><span>找到 {profile.totalMatches} 处 · 使用 {profile.sentCount} 处</span><span>{profile.providerName} / {profile.model}</span>{profile.incremental ? <span>增量更新（基于旧卡 + 新读片段）</span> : null}{profile.truncated ? <span>输出达到长度上限，末尾内容已省略，可点“更新到当前进度”重试补全</span> : null}</div>
            </>
          ) : status === 'ready' ? (
            <div className="entity-ready"><BookOpenCheck size={24} /><strong>已找到 {contextInfo?.totalMatches ?? 0} 处相关依据</strong><span>将使用其中 {contextInfo?.sentCount ?? 0} 条代表性片段，由 {provider?.name || 'AI'} 生成资料卡{prepared?.incremental ? '（增量更新：旧卡 + 新读片段，更省 token）' : ''}。点击右下角按钮开始生成。</span></div>
          ) : null}
          {error ? <div className="ai-error-card" role="alert"><strong>{error.message}</strong><div><span>阶段：{error.stage}</span><span>状态码：{error.status || '无'}</span><span>错误码：{error.code}</span></div><button onClick={() => navigator.clipboard.writeText(diagnostic)}><Copy size={13} /> 复制诊断信息</button></div> : null}
        </div>
        <footer className="dialog-footer"><span>{provider ? `${provider.name} · ${provider.model || '未选模型'}` : '尚未设置供应商'}</span><div><button className="secondary-button" onClick={onClose}>关闭</button><button className="primary-button" onClick={() => generate()} disabled={['searching', 'summarizing'].includes(status) || status === 'setup'}><RefreshCw size={14} /> {['searching', 'summarizing'].includes(status) ? '处理中' : corrupt ? '重新生成' : error ? '重新尝试' : profile ? (isLaterProgress ? '更新到当前进度' : '重新生成') : '生成资料'}</button></div></footer>
      </section>
      <AISettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onChange={(value) => setSettings(value)} />
    </div>
  )
}
