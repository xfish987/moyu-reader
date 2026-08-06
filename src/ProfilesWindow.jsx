import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, BookOpenCheck, ListChecks, RefreshCw, ScrollText, Search, ServerCog, Trash2, X } from 'lucide-react'
import AISettingsModal from './components/AISettingsModal'
import EntityDetails from './components/EntityDetails'
import EntityRelations from './components/EntityRelations'
import { isCorruptProfile } from './entityProfiles'
import { hasGapBefore, sortStorylineEntries } from './storyline'
import './storyline-page.css'

const TYPE_ORDER = ['人物', '物品', '地点', '组织', '能力', '事件', '未分类']

// 设定集独立窗口：与阅读窗口并排存在，显示资料卡和后台生成任务队列。
// 所有数据来自阅读窗口推送的快照（主进程会留存最新一份，窗口打开即有数据）；
// 用户操作通过 profiles:action 回传阅读窗口执行。
// 不用 localStorage 缓存快照：关窗后换书，旧书快照会残留成“上一本书的设定集”。
export default function ProfilesWindow() {
  const [snapshot, setSnapshot] = useState(null)
  const [toast, setToast] = useState(null)
  const previousTasksRef = useRef([])

  useEffect(() => window.readerAPI?.onProfilesSync?.((next) => setSnapshot(next)), [])
  const [profileQuery, setProfileQuery] = useState('')
  const [profileType, setProfileType] = useState('全部')
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const [expandedTaskId, setExpandedTaskId] = useState(null)
  const [linkQuery, setLinkQuery] = useState('')
  const [aliasInputFor, setAliasInputFor] = useState(null)
  const [aliasText, setAliasText] = useState('')
  // 左侧条目右键菜单：更新生成 / 删除。
  const [entryMenu, setEntryMenu] = useState(null)
  // 顶层页面：条目设定（原有内容）/ 剧情梳理（AI 陪读逐章总结的时间线）。
  const [page, setPage] = useState('profiles')
  const [storylineQuery, setStorylineQuery] = useState('')
  const [storylineTasksOpen, setStorylineTasksOpen] = useState(false)

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

  useEffect(() => window.readerAPI?.onProfilesFocus?.((payload) => {
    // 兼容两种 payload：对象 { storyline: true } 表示切到剧情梳理页；名字字符串表示切回条目设定并选中资料卡。
    if (payload && typeof payload === 'object') {
      if (payload.storyline) setPage('storyline')
      return
    }
    setPage('profiles')
    const target = entityProfiles.find((item) => item.name === payload || item.aliases?.includes(payload))
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
  // 任务完成/失败时窗口顶部通知；点击：成功直达资料卡，失败直达任务详情。
  useEffect(() => {
    const previous = new Map(previousTasksRef.current.map((task) => [task.id, task.status]))
    previousTasksRef.current = profileTasks
    if (!previous.size) return
    const changed = profileTasks.find((task) => previous.has(task.id) && previous.get(task.id) !== task.status && ['done', 'error'].includes(task.status))
    if (!changed) return
    setToast({
      id: changed.id,
      kind: changed.status,
      profileId: changed.profileId || null,
      text: changed.status === 'done' ? `「${changed.name}」资料卡已生成，点击查看` : `「${changed.name}」生成失败，点击查看原因`,
    })
  }, [profileTasks])

  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  // 右键菜单打开后，点击任意处或滚动时收起。
  useEffect(() => {
    if (!entryMenu) return undefined
    const close = () => setEntryMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [entryMenu])

  const openEntryMenu = (event, profile) => {
    event.preventDefault()
    event.stopPropagation()
    setSelectedProfileId(profile.id)
    setEntryMenu({ profile, x: Math.min(event.clientX, window.innerWidth - 150), y: Math.min(event.clientY, window.innerHeight - 90) })
  }

  const activeTaskCount = profileTasks.filter((task) => !['done', 'error'].includes(task.status)).length

  // 剧情梳理页数据：快照里的逐章总结按 order 排序，陪读任务单独收纳。
  const storylineEntries = useMemo(() => sortStorylineEntries(snapshot?.storyline), [snapshot])
  const companionTasks = useMemo(() => snapshot?.companionTasks || [], [snapshot])
  const activeCompanionCount = companionTasks.filter((task) => !['done', 'error'].includes(task.status)).length
  // 独立搜索：只搜剧情条目（章节/叙述/时间/地点/人物/事件），与条目设定搜索互不影响；记录在全量排序里的下标用于缺口判断。
  const storylineQueryText = storylineQuery.trim().toLocaleLowerCase('zh-CN')
  const visibleStoryline = storylineEntries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !storylineQueryText || [entry.label, entry.text, entry.timePoint, entry.location, ...(entry.characters || []), ...(entry.events || [])].filter(Boolean).join('\n').toLocaleLowerCase('zh-CN').includes(storylineQueryText))
  // 命中设定集的名称渲染成可点击 chip，点击跳回条目设定页并选中该卡。
  const openProfile = (name) => {
    const target = resolveProfile(name)
    if (!target) return
    setSelectedProfileId(target.id)
    setPage('profiles')
  }
  const renderNameChip = (name) => (resolveProfile(name)
    ? <button className="storyline-chip is-link" key={name} onClick={() => openProfile(name)} title="查看资料卡">{name}</button>
    : <span className="storyline-chip" key={name}>{name}</span>)
  const asText = (value) => (Array.isArray(value) ? value.filter(Boolean).join('；') : String(value || ''))

  return (
    <main className="profiles-window">
      {toast ? <button className={`profiles-toast is-${toast.kind}`} onClick={() => {
        if (toast.kind === 'done' && toast.profileId) { setSelectedProfileId(toast.profileId); setTasksOpen(false) }
        else { setTasksOpen(true); setExpandedTaskId(toast.id) }
        setToast(null)
      }}>{toast.text}</button> : null}
      <header className="profiles-window-header">
        <div><BookOpenCheck size={17} /><strong>{snapshot?.bookTitle ? `《${snapshot.bookTitle}》设定集` : '设定集'}</strong><span>{page === 'storyline' ? `${storylineEntries.length} 条总结${activeCompanionCount ? ` · ${activeCompanionCount} 个任务进行中` : ''}` : `${entityProfiles.length} 条${activeTaskCount ? ` · ${activeTaskCount} 个任务进行中` : ''}`}</span></div>
        <div className="profile-panel-actions">
          <button className="profiles-tasks-toggle" onClick={() => setTasksOpen((current) => !current)} title="生成任务队列"><ListChecks size={16} />{activeTaskCount ? <span className="tasks-badge">{activeTaskCount}</span> : null}</button>
          <button onClick={() => setSettingsOpen(true)} title="AI 供应商"><ServerCog size={16} /></button>
        </div>
      </header>
      <nav className="storyline-page-tabs" aria-label="设定集页面">
        <button className={page === 'profiles' ? 'active' : ''} onClick={() => setPage('profiles')}>条目设定</button>
        <button className={page === 'storyline' ? 'active' : ''} onClick={() => setPage('storyline')}>剧情梳理</button>
        {page === 'storyline' ? (
          <button className="storyline-tasks-toggle profiles-tasks-toggle" onClick={() => setStorylineTasksOpen((current) => !current)} title="陪读总结任务"><ListChecks size={15} />{activeCompanionCount ? <span className="tasks-badge">{activeCompanionCount}</span> : null}</button>
        ) : null}
      </nav>
      {page === 'storyline' ? (
        <div className="storyline-view">
          {storylineTasksOpen ? (
            <div className="storyline-tasks">
              {companionTasks.length ? companionTasks.map((task) => (
                <div className={`storyline-task is-${task.status}`} key={task.id}>
                  <strong>{task.label}</strong>
                  {task.status === 'pending' ? <span>排队等待总结…</span> : null}
                  {task.status === 'generating' ? <span><RefreshCw className="spin" size={12} /> AI 总结中…</span> : null}
                  {task.status === 'done' ? <span>已总结</span> : null}
                  {task.status === 'error' ? <span className="storyline-task-error">总结失败：{task.error?.message || String(task.error || '未知错误')}</span> : null}
                </div>
              )) : <div className="storyline-tasks-empty">暂无陪读总结任务</div>}
            </div>
          ) : null}
          <label className="profile-collection-search"><Search size={14} /><input value={storylineQuery} onChange={(event) => setStorylineQuery(event.target.value)} placeholder="搜索剧情：章节、时间、地点、人物或事件" /></label>
          {visibleStoryline.length ? (
            <div className="storyline-timeline">
              {visibleStoryline.map(({ entry, index }) => (
                <div className="storyline-item" key={entry.id}>
                  {hasGapBefore(storylineEntries, index) ? <div className="storyline-gap"><AlertTriangle size={12} /> 此处之前有章节/段落尚未总结（剧情可能不连贯）</div> : null}
                  <article className="storyline-card">
                    <header>
                      <strong>{entry.label}</strong>
                      {entry.truncated ? <span className="storyline-truncated" title="生成时输出达到长度上限">总结曾被截断</span> : null}
                      <div className="storyline-card-actions">
                        <button onClick={() => window.readerAPI?.sendProfilesAction?.({ type: 'storyline-regenerate', entryId: entry.id })} title="重新生成这段总结"><RefreshCw size={13} /></button>
                        <button className="is-danger" onClick={() => { if (window.confirm(`删除「${entry.label}」的剧情总结？此操作不可撤销。`)) window.readerAPI?.sendProfilesAction?.({ type: 'storyline-delete', entryId: entry.id }) }} title="删除这段总结"><Trash2 size={13} /></button>
                      </div>
                    </header>
                    {entry.timePoint ? <p className="storyline-meta"><em>时间</em>{entry.timePoint}</p> : null}
                    {entry.location ? <p className="storyline-meta"><em>地点</em>{renderNameChip(entry.location)}</p> : null}
                    {entry.characters?.length ? <p className="storyline-meta"><em>人物</em><span className="storyline-chips">{entry.characters.map((name) => renderNameChip(name))}</span></p> : null}
                    {entry.events?.length ? (
                      <div className="storyline-events"><em>事件</em><ol>{entry.events.map((event, eventIndex) => <li key={eventIndex}>{event}</li>)}</ol></div>
                    ) : null}
                    {asText(entry.gains) ? <p className="storyline-extra"><em>获得</em>{asText(entry.gains)}</p> : null}
                    {asText(entry.openThreads) ? <p className="storyline-extra"><em>悬念伏笔</em>{asText(entry.openThreads)}</p> : null}
                    {entry.text ? <p className="storyline-text">{entry.text}</p> : null}
                  </article>
                </div>
              ))}
            </div>
          ) : (
            <div className="profiles-empty"><ScrollText size={28} /><strong>{snapshot ? (storylineEntries.length ? '没有匹配的剧情总结' : '还没有剧情总结') : '等待阅读窗口同步'}</strong><span>{snapshot ? (storylineEntries.length ? '换个关键词试试' : '在阅读窗口工具栏开启「AI陪读」后，每读一章会自动总结剧情到这里') : '打开一本书后，这里会显示它的剧情梳理'}</span></div>
          )}
        </div>
      ) : tasksOpen ? (
        <div className="profile-tasks-view">
          {profileTasks.length ? profileTasks.map((task) => (
            <div className={`profile-task is-${task.status}${task.status === 'error' ? ' is-clickable' : ''}`} key={task.id} onClick={() => { if (task.status === 'error') setExpandedTaskId(expandedTaskId === task.id ? null : task.id) }}>
              <div className="profile-task-main">
                <strong>{task.name}</strong>
                {task.status === 'pending' ? <span>排队等待检索…</span> : null}
                {task.status === 'searching' ? <span><RefreshCw className="spin" size={12} /> 检索资料中（本地，不消耗 token）…</span> : null}
                {task.status === 'queued' ? <span>已找到 {task.contextInfo?.totalMatches ?? 0} 处依据，排队等待生成…</span> : null}
                {task.status === 'generating' ? <span><RefreshCw className="spin" size={12} /> AI 生成资料卡中…</span> : null}
                {task.status === 'done' ? <span>资料卡已生成</span> : null}
                {task.status === 'error' ? <span className="profile-task-error">生成失败{expandedTaskId === task.id ? '，点击收起详情' : '，点击查看详情'}</span> : null}
                {task.status === 'error' && expandedTaskId === task.id ? <div className="profile-task-error-detail">{task.error?.message || '未知错误'}{task.error?.code ? `（错误码 ${task.error.code}）` : ''}</div> : null}
              </div>
              <div className="profile-task-actions">
                {task.status === 'done' ? <button className="profile-task-primary" onClick={() => { setSelectedProfileId(task.profileId || ''); setTasksOpen(false); window.readerAPI?.sendProfilesAction?.({ type: 'dismiss', taskId: task.id }) }}>查看</button> : null}
                {task.status === 'error' ? <button className="profile-task-primary" onClick={(event) => { event.stopPropagation(); window.readerAPI?.sendProfilesAction?.({ type: 'retry', taskId: task.id }) }}>重试</button> : null}
                <button className="profile-task-dismiss" onClick={(event) => { event.stopPropagation(); window.readerAPI?.sendProfilesAction?.({ type: 'dismiss', taskId: task.id }) }} title="删除任务"><X size={12} /></button>
              </div>
            </div>
          )) : <div className="profiles-empty"><ListChecks size={26} /><strong>暂无生成任务</strong><span>在阅读窗口选中人物、物品或地点，右键选择“生成资料”</span></div>}
        </div>
      ) : linkAlias ? (
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
              <nav>{Object.entries(groupedProfiles).map(([group, profiles]) => <section key={group}><h3>{group}</h3>{profiles.map((profile) => <button className={selectedProfile?.id === profile.id ? 'active' : ''} key={profile.id} onClick={() => setSelectedProfileId(profile.id)} onContextMenu={(event) => openEntryMenu(event, profile)} title="右键：更新生成 / 删除"><strong>{profile.name}</strong><span>{profile.aliases?.length ? `别名 ${profile.aliases.slice(0, 2).join('、')} · ` : ''}总结至 {Math.round((profile.readPercent || 0) * 100)}%</span></button>)}</section>)}</nav>
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
      {entryMenu ? (
        <div className="profile-entry-menu" style={{ left: entryMenu.x, top: entryMenu.y }} onMouseDown={(event) => event.stopPropagation()}>
          <button onClick={() => { window.readerAPI?.sendProfilesAction?.({ type: 'update-profile', profileId: entryMenu.profile.id }); setEntryMenu(null) }}>更新生成（按当前已读进度）</button>
          <button className="is-danger" onClick={() => {
            if (window.confirm(`删除「${entryMenu.profile.name}」的资料卡？此操作不可撤销。`)) {
              window.readerAPI?.sendProfilesAction?.({ type: 'delete-profile', profileId: entryMenu.profile.id })
              setSelectedProfileId('')
            }
            setEntryMenu(null)
          }}>删除</button>
        </div>
      ) : null}
    </main>
  )
}
