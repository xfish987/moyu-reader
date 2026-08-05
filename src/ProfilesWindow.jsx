import { useEffect, useMemo, useState } from 'react'
import { BookOpenCheck, RefreshCw, Search, ServerCog, SquareChevronRight, X } from 'lucide-react'
import AISettingsModal from './components/AISettingsModal'
import EntityDetails from './components/EntityDetails'
import EntityRelations from './components/EntityRelations'
import { isCorruptProfile } from './entityProfiles'

const TYPE_ORDER = ['人物', '物品', '地点', '组织', '能力', '事件', '未分类']

// 设定集独立窗口：与阅读窗口并排存在，显示资料卡和后台生成任务队列。
// 所有数据来自阅读窗口推送的快照；用户操作通过 profiles:action 回传阅读窗口执行。
export default function ProfilesWindow() {
  const [snapshot, setSnapshot] = useState(null)
  const [profileQuery, setProfileQuery] = useState('')
  const [profileType, setProfileType] = useState('全部')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [aliasInputFor, setAliasInputFor] = useState(null)
  const [aliasText, setAliasText] = useState('')

  useEffect(() => window.readerAPI?.onProfilesSync?.((next) => setSnapshot(next)), [])
  useEffect(() => {
    document.title = snapshot?.bookTitle ? `设定集 - ${snapshot.bookTitle}` : '设定集'
  }, [snapshot?.bookTitle])

  const entityProfiles = useMemo(() => snapshot?.entityProfiles || [], [snapshot])
  const profileTasks = useMemo(() => snapshot?.profileTasks || [], [snapshot])
  const linkAlias = String(snapshot?.linkAlias || '')
  // 关联模式：输入即时过滤候选卡（名称/别名/摘要），条目再多也能快速定位。
  const linkCandidates = entityProfiles.filter((item) => !linkQuery.trim() || `${item.name}\n${(item.aliases || []).join(' ')}\n${item.summary}`.toLocaleLowerCase('zh-CN').includes(linkQuery.trim().toLocaleLowerCase('zh-CN')))
  const linkTo = (profile) => {
    window.readerAPI?.sendProfilesAction?.({ type: 'add-alias', profileId: profile.id, alias: linkAlias })
    setSelectedProfileId(profile.id)
    setLinkQuery('')
  }
  const submitAliasInput = (profileId) => {
    const alias = aliasText.trim()
    if (alias) window.readerAPI?.sendProfilesAction?.({ type: 'add-alias', profileId, alias })
    setAliasInputFor(null)
    setAliasText('')
  }

  useEffect(() => window.readerAPI?.onProfilesFocus?.((name) => {
    const target = entityProfiles.find((item) => item.name === name || item.aliases?.includes(name))
    if (target) setSelectedProfileId(target.id)
  }), [entityProfiles])

  const profileTypes = ['全部', ...TYPE_ORDER.filter((type) => entityProfiles.some((item) => (item.type || '未分类') === type))]
  const filteredProfiles = entityProfiles.filter((item) => (profileType === '全部' || (item.type || '未分类') === profileType) && (!profileQuery.trim() || `${item.name}\n${(item.aliases || []).join(' ')}\n${item.summary}\n${(item.relations || []).map((relation) => `${relation.targetName} ${relation.label}`).join(' ')}`.toLocaleLowerCase('zh-CN').includes(profileQuery.trim().toLocaleLowerCase('zh-CN'))))
  const selectedProfile = entityProfiles.find((item) => item.id === selectedProfileId) || filteredProfiles[0]
  const resolveProfile = (name) => entityProfiles.find((item) => [item.name, ...(item.aliases || [])].some((value) => value?.toLocaleLowerCase('zh-CN') === name?.toLocaleLowerCase('zh-CN')))
  const inboundRelations = selectedProfile ? entityProfiles.flatMap((sourceProfile) => (sourceProfile.relations || []).filter((relation) => resolveProfile(relation.targetName)?.id === selectedProfile.id).map((relation) => ({ ...relation, targetName: sourceProfile.name, label: relation.relation === 'owned_by' ? '持有' : relation.relation === 'member_of' ? '成员' : relation.relation === 'located_in' ? '包含地点' : `反向·${relation.label || '相关'}` }))) : []
  const relationGroup = (profile) => {
    if (profileType === '全部') return profile.type || '未分类'
    const desired = profileType === '人物' ? 'member_of' : profileType === '物品' ? 'owned_by' : profileType === '地点' ? 'located_in' : null
    return (desired && (profile.relations || []).find((relation) => relation.relation === desired)?.targetName) || '未归属'
  }
  const groupedProfiles = filteredProfiles.reduce((groups, profile) => { const key = relationGroup(profile); (groups[key] ||= []).push(profile); return groups }, {})
  const activeTaskCount = profileTasks.filter((task) => !['done', 'error'].includes(task.status)).length

  return (
    <main className="profiles-window">
      <header className="profiles-window-header">
        <div><BookOpenCheck size={17} /><strong>{snapshot?.bookTitle ? `《${snapshot.bookTitle}》设定集` : '设定集'}</strong><span>{entityProfiles.length} 条{activeTaskCount ? ` · ${activeTaskCount} 个任务进行中` : ''}</span></div>
        <div className="profile-panel-actions">
          <button onClick={() => setSettingsOpen(true)} title="AI 供应商"><ServerCog size={16} /></button>
          <button onClick={() => window.readerAPI?.collapseProfilesWindow?.()} title="收起为屏幕右缘悬浮图标"><SquareChevronRight size={16} /></button>
        </div>
      </header>
      {profileTasks.length ? (
        <div className="profile-tasks">
          {profileTasks.map((task) => (
            <div className={`profile-task is-${task.status}`} key={task.id}>
              <div className="profile-task-main">
                <strong>{task.name}</strong>
                {task.status === 'pending' ? <span>排队等待检索…</span> : null}
                {task.status === 'searching' ? <span><RefreshCw className="spin" size={12} /> 正在检索已读依据…</span> : null}
                {task.status === 'ready' ? <span>已找到 {task.contextInfo?.totalMatches ?? 0} 处依据，将使用 {task.contextInfo?.sentCount ?? 0} 条{task.incremental ? ' · 增量更新' : ''}</span> : null}
                {task.status === 'queued' ? <span>排队等待生成…</span> : null}
                {task.status === 'generating' ? <span><RefreshCw className="spin" size={12} /> 正在生成资料卡…</span> : null}
                {task.status === 'done' ? <span>资料卡已生成</span> : null}
                {task.status === 'error' ? <span className="profile-task-error" title={task.error?.message}>{task.error?.message || '生成失败'}</span> : null}
              </div>
              <div className="profile-task-actions">
                {task.status === 'ready' ? <button className="profile-task-primary" onClick={() => window.readerAPI?.sendProfilesAction?.({ type: 'confirm', taskId: task.id })}>{task.hasCached ? (task.incremental ? '更新资料' : '重新生成') : '生成资料'}</button> : null}
                {task.status === 'done' ? <button className="profile-task-primary" onClick={() => { setSelectedProfileId(task.profileId || ''); window.readerAPI?.sendProfilesAction?.({ type: 'dismiss', taskId: task.id }) }}>查看</button> : null}
                {task.status === 'error' ? <button className="profile-task-primary" onClick={() => window.readerAPI?.sendProfilesAction?.({ type: 'retry', taskId: task.id })}>重试</button> : null}
                {!['searching', 'generating'].includes(task.status) ? <button className="profile-task-dismiss" onClick={() => window.readerAPI?.sendProfilesAction?.({ type: 'dismiss', taskId: task.id })} title="移除任务"><X size={12} /></button> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {linkAlias ? (
        <div className="profile-link-picker">
          <div className="profile-link-banner"><span>正在为「{linkAlias}」选择要关联到的资料卡，关联后它就是该卡的别名</span><button onClick={() => window.readerAPI?.sendProfilesAction?.({ type: 'cancel-link' })}>取消</button></div>
          <label className="profile-collection-search"><Search size={14} /><input autoFocus value={linkQuery} onChange={(event) => setLinkQuery(event.target.value)} placeholder="搜索要关联的资料卡（名称、别名、内容）" /></label>
          <nav className="profile-link-list">
            {linkCandidates.length ? linkCandidates.map((profile) => (
              <button key={profile.id} onClick={() => linkTo(profile)}>
                <strong>{profile.name}</strong>
                <span>{profile.type || '未分类'}{profile.aliases?.length ? ` · 别名 ${profile.aliases.slice(0, 3).join('、')}` : ''}</span>
                <em>{String(profile.summary || '').slice(0, 60)}</em>
              </button>
            )) : <p>没有匹配的资料卡</p>}
          </nav>
        </div>
      ) : (
        <>
          <label className="profile-collection-search"><Search size={14} /><input value={profileQuery} onChange={(event) => setProfileQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && filteredProfiles.length) setSelectedProfileId(filteredProfiles[0].id) }} placeholder="搜索人物、物品、地点、别名或资料内容，回车直达" /></label>
          <nav className="profile-type-tabs" aria-label="资料类型">{profileTypes.map((type) => <button className={profileType === type ? 'active' : ''} key={type} onClick={() => { setProfileType(type); setSelectedProfileId('') }}>{type}<span>{type === '全部' ? entityProfiles.length : entityProfiles.filter((item) => (item.type || '未分类') === type).length}</span></button>)}</nav>
          {filteredProfiles.length ? (
            <div className="profile-collection-content">
              <nav>{Object.entries(groupedProfiles).map(([group, profiles]) => <section key={group}><h3>{group}</h3>{profiles.map((profile) => <button className={selectedProfile?.id === profile.id ? 'active' : ''} key={profile.id} onClick={() => setSelectedProfileId(profile.id)}><strong>{profile.name}</strong><span>{profile.aliases?.length ? `别名 ${profile.aliases.slice(0, 2).join('、')} · ` : ''}总结至 {Math.round((profile.readPercent || 0) * 100)}%</span></button>)}</section>)}</nav>
              {selectedProfile ? (
                <article>
                  <header>
                    <div><strong>{selectedProfile.name}</strong><span>{selectedProfile.type || '未分类'} · 已读范围内找到 {selectedProfile.totalMatches} 处{selectedProfile.identityLocked ? ' · 人工关联已锁定' : ''}{selectedProfile.incremental ? ' · 增量更新' : ''}{selectedProfile.truncated ? ' · 输出曾被截断' : ''}</span>{selectedProfile.aliases?.length ? <em className="profile-alias-chips">别名：{selectedProfile.aliases.map((alias) => <span key={alias} title="右键移除这个别名" onContextMenu={(event) => { event.preventDefault(); if (window.confirm(`将「${alias}」从「${selectedProfile.name}」的别名中移除？\n移除后会记住它不是同一对象，之后不会被自动关联。`)) window.readerAPI?.sendProfilesAction?.({ type: 'remove-alias', profileId: selectedProfile.id, alias }) }}>{alias}</span>)}</em> : null}</div>
                    <div className="profile-article-actions"><button onClick={() => { setAliasInputFor(aliasInputFor === selectedProfile.id ? null : selectedProfile.id); setAliasText('') }}>添加别名</button><button onClick={() => window.readerAPI?.sendProfilesAction?.({ type: 'open-identity', profileId: selectedProfile.id })}>管理关联</button><button onClick={() => { if (window.confirm(`删除「${selectedProfile.name}」的资料卡？此操作不可撤销。`)) { window.readerAPI?.sendProfilesAction?.({ type: 'delete-profile', profileId: selectedProfile.id }); setSelectedProfileId('') } }}>删除</button></div>
                  </header>
                  {aliasInputFor === selectedProfile.id ? (
                    <div className="profile-alias-input"><input autoFocus value={aliasText} onChange={(event) => setAliasText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submitAliasInput(selectedProfile.id); if (event.key === 'Escape') setAliasInputFor(null) }} placeholder="输入别名/昵称，回车关联为同一对象" /><button onClick={() => submitAliasInput(selectedProfile.id)}>关联</button></div>
                  ) : null}
                  {isCorruptProfile(selectedProfile) ? <div className="profile-corrupt-note">这份资料卡内容异常（早期版本留下的损坏缓存），建议删除后回到阅读窗口选中名称重新生成。</div> : null}
                  <div>{selectedProfile.summary}</div>
                  <EntityDetails details={selectedProfile.details} />
                  <EntityRelations relations={selectedProfile.relations} inbound={inboundRelations} resolveProfile={resolveProfile} onOpen={(profile) => setSelectedProfileId(profile.id)} />
                  <footer>{selectedProfile.providerName} / {selectedProfile.model} · 更新于 {new Date(selectedProfile.createdAt).toLocaleString('zh-CN')}</footer>
                </article>
              ) : null}
            </div>
          ) : (
            <div className="profiles-empty"><BookOpenCheck size={28} /><strong>{snapshot ? (entityProfiles.length ? '没有匹配的资料' : '本书还没有资料卡') : '等待阅读窗口同步'}</strong><span>{snapshot ? (entityProfiles.length ? '换个关键词或类型试试' : '在阅读窗口选中人物、物品或地点，右键选择“生成资料”') : '打开一本书后，这里会显示它的设定集'}</span></div>
          )}
        </>
      )}
      <AISettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} onChange={() => {}} />
    </main>
  )
}
