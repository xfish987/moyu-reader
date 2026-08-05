import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookMarked, Bookmark, BookmarkPlus, BookOpenCheck, ChevronLeft, ChevronRight, List, Maximize, Minimize2, NotebookPen, Search, Settings2, Trash2, X } from 'lucide-react'
import EpubReader from './EpubReader'
import LargeTextReader from './LargeTextReader'
import ReaderSettings from './ReaderSettings'
import TextReader from './TextReader'
import AISettingsModal from './AISettingsModal'
import EntityIdentityModal from './EntityIdentityModal'
import { searchVariants, useChineseConversionReady } from '../chineseConversion'
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

export default function ReaderView({ book, source, settings, setSettings, savedProgress, immersive, onBack, onToggleImmersive, onProgress, shortcut, actionRef, notes, bookmarks, onAddBookmark, onDeleteBookmark, onAddNote, onDeleteNote, initialNote, onEncodingChange, entityProfiles = [], onSaveEntityProfile, onUpdateEntityIdentity, onMergeEntityProfiles, onSplitEntityAlias, onDeleteEntityProfile }) {
  const readerRef = useRef(null)
  const conversionReady = useChineseConversionReady(settings.scriptConversion || 'none')
  const activeChapterRef = useRef(null)
  const wheelStateRef = useRef({ accumulated: 0, direction: 0, lockedUntil: 0 })
  const [panel, setPanel] = useState(null)
  const [chapters, setChapters] = useState([])
  const [progress, setProgress] = useState(savedProgress || { percent: 0, page: 0, pageCount: 1 })
  const [scrubProgress, setScrubProgress] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchProgress, setSearchProgress] = useState(0)
  const [searchTruncated, setSearchTruncated] = useState(false)
  const [chromeZone, setChromeZone] = useState(null)
  const [profileTasks, setProfileTasks] = useState([])
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [aiConfig, setAiConfig] = useState(null)
  const profileTasksRef = useRef([])
  const [identityProfile, setIdentityProfile] = useState(null)
  const [linkAlias, setLinkAlias] = useState('')
  const chromeTimerRef = useRef(null)

  const updateProgress = useCallback((next) => {
    setProgress(next)
    onProgress(next)
  }, [onProgress])

  const updateChapters = useCallback((items) => setChapters(items), [])

  const activeChapterIndex = useMemo(() => {
    if (!chapters.length) return -1
    if (source.kind === 'text-large') {
      const position = progress.absolutePosition ?? progress.offset ?? 0
      let low = 0
      let high = chapters.length - 1
      let match = -1
      while (low <= high) {
        const middle = Math.floor((low + high) / 2)
        if ((chapters[middle].offset ?? 0) <= position) {
          match = middle
          low = middle + 1
        } else high = middle - 1
      }
      return match
    }
    if (source.kind === 'text') return progress.chapterIndex ?? -1
    const normalizeHref = (href = '', keepFragment = false) => {
      const value = keepFragment ? href : href.split('#')[0]
      try { return decodeURIComponent(value).replace(/^\.\//, '') }
      catch { return value.replace(/^\.\//, '') }
    }
    const exactHref = normalizeHref(progress.href, true)
    const exactMatch = chapters.findIndex((chapter) => normalizeHref(chapter.href, true) === exactHref)
    if (exactMatch >= 0) return exactMatch
    const currentHref = normalizeHref(progress.href)
    if (!currentHref) return -1
    return chapters.findIndex((chapter) => normalizeHref(chapter.href) === currentHref)
  }, [chapters, progress.absolutePosition, progress.chapterIndex, progress.href, progress.offset, source.kind])

  useEffect(() => {
    if (panel !== 'toc' || activeChapterIndex < 0) return undefined
    const frame = requestAnimationFrame(() => {
      activeChapterRef.current?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' })
    })
    return () => cancelAnimationFrame(frame)
  }, [activeChapterIndex, panel])

  const handlePageWheel = useCallback((event) => {
    if (event.ctrlKey || event.metaKey) return
    const absY = Math.abs(event.deltaY)
    const absX = Math.abs(event.deltaX)
    // Ignore diagonal/trackpad noise: only page when one axis clearly dominates.
    const delta = absY >= absX * 2 ? event.deltaY : absX >= absY * 2 ? event.deltaX : 0
    if (!delta) return
    event.preventDefault?.()
    const now = performance.now()
    const state = wheelStateRef.current
    if (now < state.lockedUntil) return
    const direction = delta > 0 ? 1 : -1
    if (state.direction !== direction) {
      state.direction = direction
      state.accumulated = 0
    }
    state.accumulated += Math.abs(delta)
    const threshold = event.deltaMode === 0 ? 40 : 2
    if (state.accumulated < threshold) return
    state.accumulated = 0
    state.lockedUntil = now + 320
    direction > 0 ? readerRef.current?.next() : readerRef.current?.prev()
  }, [])

  const scheduleChromeHide = useCallback(() => {
    clearTimeout(chromeTimerRef.current)
    chromeTimerRef.current = setTimeout(() => setChromeZone(null), 650)
  }, [])

  const handleChromeMouseMove = useCallback((event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const y = event.clientY - rect.top
    const zone = y <= 86 ? 'top' : rect.height - y <= 104 ? 'bottom' : null
    if (zone) {
      clearTimeout(chromeTimerRef.current)
      chromeTimerRef.current = null
      setChromeZone((current) => (current === zone ? current : zone))
    } else {
      scheduleChromeHide()
    }
  }, [scheduleChromeHide])

  useEffect(() => () => clearTimeout(chromeTimerRef.current), [])

  const jumpToChapter = (chapter) => {
    if (source.kind === 'epub') readerRef.current?.goToChapter(chapter.href)
    else if (source.kind === 'text-large') readerRef.current?.goToChapter(chapter)
    else readerRef.current?.goToChapter(chapter.index)
    setPanel(null)
  }

  const addBookmark = () => {
    const location = readerRef.current?.getLocation?.()
    if (!location) return
    onAddBookmark({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, ...location, label: activeChapter?.label || `${percent}% 处`, percent: progress.percent || 0, createdAt: Date.now() })
  }

  const percent = Math.max(0, Math.min(100, Math.round((progress.percent || 0) * 100)))
  const displayedPercent = scrubProgress === null ? percent : Math.round(scrubProgress / 10)
  const activeChapter = activeChapterIndex >= 0 ? chapters[activeChapterIndex] : null
  const footerVisible = scrubProgress !== null || chromeZone === 'bottom'

  const checkEntityProfile = useCallback((text) => entityProfiles.some((item) => item.name === text || item.aliases?.includes(text)), [entityProfiles])

  // 右键三种动作：view=只看已有卡（免费）、link=把该名字关联为某张卡的别名、generate=生成/更新。
  const openEntityLookup = (selection, mode = 'generate') => {
    const full = {
      ...selection,
      readPosition: source.kind === 'text-large' ? (Number(selection.readPosition) || Number(progress.absolutePosition) || 0) : (Number(progress.percent) || 0),
      readPercent: Number(progress.percent) || 0,
    }
    const cached = [...entityProfiles].reverse().find((item) => item.name === full.text || item.aliases?.includes(full.text))
    if (mode === 'view') { window.readerAPI.openProfilesWindow?.(cached ? full.text : ''); return }
    if (mode === 'link') { setLinkAlias(full.text); window.readerAPI.openProfilesWindow?.(); return }
    const isLater = !cached || Number(full.readPosition) > Number(cached.readPosition) + (Number(full.readPosition) <= 1 ? 0.0005 : 1)
    window.readerAPI.openProfilesWindow?.(cached && !isLater ? full.text : '')
    if (cached && !isLater) return
    setProfileTasks((current) => {
      if (current.some((task) => task.name === full.text && !['done', 'error'].includes(task.status))) return current
      return [...current, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: full.text, selection: full, cachedProfile: cached || null, incremental: Boolean(cached && isLater), status: 'pending', contextInfo: null, prepared: null, error: null, createdAt: Date.now() }]
    })
  }

  const loadEntityContext = async (selection, names, options = {}) => {
    if (!selection) return { excerpts: [], totalMatches: 0 }
    const terms = Array.isArray(names) ? names : [names]
    // 增量更新时从上份资料卡的阅读位置开始检索（本地检索免费，省的是发给模型的 token）。
    const from = Number(options.fromReadPosition) || 0
    if (source.kind === 'text') return readerRef.current?.lookupEntity?.(terms, { ...selection, fromReadPercent: from > 0 ? from : 0 }) || { excerpts: [], totalMatches: 0 }
    if (source.kind === 'epub') return readerRef.current?.lookupEntity?.(terms, { ...selection, fromReadPercent: from > 0 ? from : 0 }) || { excerpts: [], totalMatches: 0 }
    const before = Number(selection.readPosition) || 0
    const searchOptions = { sample: true, fromOffset: from > 0 ? Math.max(0, from - 2000) : 0 }
    const responses = await Promise.all(terms.flatMap((name) => searchVariants(name, settings.scriptConversion)).filter((value, index, items) => items.indexOf(value) === index).map((name) => window.readerAPI.searchText(book.path, name, searchOptions)))
    const matches = responses.flatMap((response) => response.results || []).filter((item) => item.matchOffset < Math.max(0, before - 32)).filter((item, index, items) => items.findIndex((candidate) => candidate.matchOffset === item.matchOffset) === index).sort((a, b) => a.matchOffset - b.matchOffset)
    const excerpts = matches.map((item, index) => {
      let chapter = '此前内容'
      for (const candidate of chapters) {
        if ((candidate.offset || 0) > item.matchOffset) break
        chapter = candidate.label
      }
      return { order: index + 1, chapter, text: item.label }
    })
    if (selection.currentExcerpt && terms.some((term) => selection.currentExcerpt.includes(term))) excerpts.push({ order: excerpts.length + 1, chapter: selection.chapterLabel || activeChapter?.label || '当前位置', text: selection.currentExcerpt })
    const reportedTotal = responses.reduce((sum, response) => sum + (Number(response.total) || 0), 0)
    return { excerpts, totalMatches: Math.max(reportedTotal, excerpts.length), truncated: responses.some((response) => response.truncated) }
  }

  const patchProfileTask = (taskId, patch) => setProfileTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...patch } : task))
  const dismissProfileTask = (taskId) => setProfileTasks((current) => current.filter((task) => task.id !== taskId))

  // 任务检索阶段（本地、免费）：备好象征性片段，等用户点"生成资料"。
  const runProfileTaskSearch = async (task) => {
    patchProfileTask(task.id, { status: 'searching', error: null })
    try {
      const config = aiConfig || await window.readerAPI.getAiSettings()
      setAiConfig(config)
      const provider = config.providers.find((item) => item.id === config.activeProviderId) || config.providers[0]
      if (!provider) {
        patchProfileTask(task.id, { status: 'error', error: { message: '请先设置并选择 AI 供应商' }, needsSetup: true })
        setAiSettingsOpen(true)
        return
      }
      const lookupNames = task.cachedProfile ? [task.cachedProfile.name, ...(task.cachedProfile.aliases || []), task.name] : [task.name]
      const uniqueNames = [...new Set(lookupNames.filter(Boolean))]
      let incremental = task.incremental
      let context = await loadEntityContext(task.selection, uniqueNames, incremental ? { fromReadPosition: Number(task.cachedProfile.readPosition) || 0 } : {})
      let excerpts = pickRepresentative(context.excerpts || [])
      if (incremental && !excerpts.length) {
        incremental = false
        context = await loadEntityContext(task.selection, uniqueNames)
        excerpts = pickRepresentative(context.excerpts || [])
      }
      if (!profileTasksRef.current.some((item) => item.id === task.id)) return
      if (!excerpts.length) {
        patchProfileTask(task.id, { status: 'error', error: { message: '当前阅读位置之前没有找到这个名称的相关片段' } })
        return
      }
      patchProfileTask(task.id, {
        status: 'ready',
        contextInfo: { ...context, sentCount: excerpts.length },
        prepared: { excerpts, context, incremental, providerId: provider.id, model: provider.model || provider.models?.[0], maxTokens: Math.min(8000, provider.maxTokens || 2000) },
      })
    } catch (reason) {
      patchProfileTask(task.id, { status: 'error', error: { message: reason?.message || '资料检索失败' } })
    }
  }

  // 任务生成阶段（消耗 token）：用户确认后才进入队列执行。
  const runProfileTaskGenerate = async (task) => {
    const prepared = task.prepared
    if (!prepared) { patchProfileTask(task.id, { status: 'pending' }); return }
    patchProfileTask(task.id, { status: 'generating', startedAt: Date.now(), error: null })
    try {
      const { selection, cachedProfile: cached } = task
      const result = await window.readerAPI.summarizeEntity({
        name: task.name,
        excerpts: prepared.excerpts,
        totalMatches: prepared.context.totalMatches || prepared.excerpts.length,
        providerId: prepared.providerId,
        model: prepared.model,
        maxTokens: prepared.maxTokens,
        knownEntities: entityProfiles.map(({ name, aliases, distinctFrom, identityLocked }) => ({ name, aliases, distinctFrom, identityLocked })),
        previousProfile: prepared.incremental && cached ? { type: cached.type, summary: cached.summary, details: cached.details, relations: cached.relations } : null,
      })
      if (!profileTasksRef.current.some((item) => item.id === task.id)) return
      if (!result.ok) {
        patchProfileTask(task.id, { status: 'error', error: { message: result.error?.message || '生成失败', ...result.error } })
        return
      }
      const generated = result.profile || { canonicalName: selection.text, aliases: [], type: '未分类', summary: result.summary, evidence: [] }
      const nextProfile = { id: cached?.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: generated.canonicalName || selection.text, aliases: [...new Set([...(cached?.identityLocked ? (cached.aliases || []) : []), ...(generated.aliases || []), ...(generated.canonicalName !== selection.text ? [selection.text] : [])])], type: generated.type || '未分类', summary: generated.summary || result.summary, details: generated.details || {}, relations: generated.relations || [], evidence: generated.evidence || [], identityConfidence: generated.identityConfidence || 'low', identityLocked: Boolean(cached?.identityLocked), distinctFrom: cached?.distinctFrom || [], incremental: prepared.incremental, truncated: Boolean(result.profile?.truncated), providerId: result.providerId, providerName: result.providerName, model: result.model, totalMatches: prepared.context.totalMatches || prepared.excerpts.length, sentCount: prepared.excerpts.length, readPosition: selection.readPosition, readPercent: selection.readPercent, createdAt: Date.now() }
      onSaveEntityProfile?.(nextProfile)
      patchProfileTask(task.id, { status: 'done', profileId: nextProfile.id })
    } catch (reason) {
      patchProfileTask(task.id, { status: 'error', error: { message: reason?.message || '资料生成失败' } })
    }
  }

  // 任务队列：同一时刻只跑一个检索或生成，其余排队等待。
  useEffect(() => {
    profileTasksRef.current = profileTasks
    if (profileTasks.some((task) => ['searching', 'generating'].includes(task.status))) return
    const nextTask = profileTasks.find((task) => task.status === 'pending') || profileTasks.find((task) => task.status === 'queued')
    if (!nextTask) return
    if (nextTask.status === 'pending') runProfileTaskSearch(nextTask)
    else runProfileTaskGenerate(nextTask)
  }, [profileTasks])

  // 换书时清空任务。
  useEffect(() => { setProfileTasks([]) }, [book.id])

  // 早期版本曾把破损 JSON 存成 summary；后台静默本地修复（不调用模型）。
  useEffect(() => {
    const corruptProfiles = entityProfiles.filter(isCorruptProfile)
    if (!corruptProfiles.length || !window.readerAPI.repairProfileJson) return
    corruptProfiles.forEach(async (profile) => {
      try {
        const result = await window.readerAPI.repairProfileJson({ text: profile.summary, name: profile.name })
        if (result?.ok && result.profile?.summary) onSaveEntityProfile?.({ ...profile, type: result.profile.type, summary: result.profile.summary, details: result.profile.details, relations: result.profile.relations, evidence: result.profile.evidence, recovered: true })
      } catch {}
    })
  }, [entityProfiles])

  // 向设定集独立窗口推送状态快照（资料卡 + 任务进度），窗口打开时也会主动请求。
  const pushProfilesSync = useCallback(() => {
    window.readerAPI.sendProfilesSync?.({
      bookId: book.id,
      bookTitle: book.title,
      entityProfiles,
      linkAlias,
      profileTasks: profileTasks.map((task) => ({ id: task.id, name: task.name, status: task.status, incremental: task.incremental, contextInfo: task.contextInfo ? { totalMatches: task.contextInfo.totalMatches, sentCount: task.contextInfo.sentCount } : null, error: task.error, needsSetup: Boolean(task.needsSetup), profileId: task.profileId || null, hasCached: Boolean(task.cachedProfile), startedAt: task.startedAt || 0, createdAt: task.createdAt })),
    })
  }, [book.id, book.title, entityProfiles, profileTasks, linkAlias])
  useEffect(() => { pushProfilesSync() }, [pushProfilesSync])
  useEffect(() => window.readerAPI.onProfilesSyncRequest?.(() => pushProfilesSync()), [pushProfilesSync])

  // 设定集窗口回传的用户动作：确认生成、重试、移除任务、删除资料卡、打开关联管理、关联别名。
  useEffect(() => window.readerAPI.onProfilesAction?.((action) => {
    if (!action) return
    if (action.type === 'confirm') patchProfileTask(action.taskId, { status: 'queued' })
    else if (action.type === 'retry') patchProfileTask(action.taskId, { status: 'pending', error: null, needsSetup: false })
    else if (action.type === 'dismiss') dismissProfileTask(action.taskId)
    else if (action.type === 'delete-profile') onDeleteEntityProfile?.(action.profileId)
    else if (action.type === 'open-identity') {
      const target = entityProfiles.find((item) => item.id === action.profileId)
      if (target) setIdentityProfile(target)
    } else if (action.type === 'add-alias') {
      // 手动关联：把别名写进目标卡并人工锁定；若该名字已是另一张卡的本名/别名则拒绝，避免两卡混同。
      const target = entityProfiles.find((item) => item.id === action.profileId)
      const alias = String(action.alias || '').trim().slice(0, 80)
      const owner = entityProfiles.find((item) => item.id !== action.profileId && (item.name === alias || item.aliases?.includes(alias)))
      if (target && alias && alias !== target.name && !(target.aliases || []).includes(alias) && !owner) {
        onUpdateEntityIdentity?.(target.id, { aliases: [...(target.aliases || []), alias] })
      }
      setLinkAlias('')
    } else if (action.type === 'remove-alias') {
      // 误关联修正：移除别名并记入 distinctFrom，防止之后被自动重新关联。
      const target = entityProfiles.find((item) => item.id === action.profileId)
      const alias = String(action.alias || '').trim()
      if (target && alias && (target.aliases || []).includes(alias)) {
        onUpdateEntityIdentity?.(target.id, {
          aliases: (target.aliases || []).filter((name) => name !== alias),
          distinctFrom: [...new Set([...(target.distinctFrom || []), alias])],
        })
      }
    } else if (action.type === 'cancel-link') setLinkAlias('')
  }), [entityProfiles, onDeleteEntityProfile, onUpdateEntityIdentity])


  const commitSeek = (event) => {
    const value = Number(event.currentTarget.value)
    readerRef.current?.seek(value / 1000)
    setScrubProgress(null)
  }

  const commitPercent = (event) => {
    const value = Math.max(0, Math.min(100, Number(event.currentTarget.value) || 0))
    readerRef.current?.seek(value / 100)
    setScrubProgress(null)
  }

  const runSearch = async (event) => {
    event.preventDefault()
    const query = searchQuery.trim()
    if (!query) return
    setSearching(true)
    setSearchProgress(0)
    setSearchTruncated(false)
    setSearchResults([])
    try {
      if (source.kind === 'text-large') {
        const response = await window.readerAPI.searchText(book.path, searchVariants(query, settings.scriptConversion))
        setSearchResults(response.results || [])
        setSearchTruncated(Boolean(response.truncated))
      } else if (source.kind === 'epub') {
        const response = await readerRef.current?.search(query, (partial, ratio) => {
          setSearchResults(partial)
          setSearchProgress(ratio)
        })
        setSearchResults(response?.results || [])
        setSearchTruncated(Boolean(response?.truncated))
      } else {
        let occurrence = 0
        const variants = searchVariants(query, settings.scriptConversion)
        const allResults = source.content.replace(/^\uFEFF/, '').split(/\r?\n+/).map((line) => line.trim()).filter(Boolean).flatMap((label, paragraphIndex) => {
          const matches = []
          const seen = new Set()
          variants.forEach((variant) => {
            let position = label.indexOf(variant)
            while (position >= 0) {
              if (!seen.has(position)) matches.push({ label: label.slice(Math.max(0, position - 70), position + variant.length + 110), query: variant, occurrence: occurrence++, paragraphIndex, position })
              seen.add(position)
              position = label.indexOf(variant, position + Math.max(1, variant.length))
            }
          })
          matches.sort((a, b) => a.position - b.position)
          return matches
        })
        setSearchResults(allResults.slice(0, 5000))
        setSearchTruncated(allResults.length > 5000)
      }
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `搜索失败：${error?.message || '无法读取书籍内容'}` }))
    } finally {
      setSearching(false)
      setSearchProgress(1)
    }
  }

  useEffect(() => {
    if (!initialNote) return undefined
    const frame = requestAnimationFrame(() => readerRef.current?.goToNote ? readerRef.current.goToNote(initialNote) : readerRef.current?.goToParagraph(initialNote.paragraphIndex))
    return () => cancelAnimationFrame(frame)
  }, [initialNote, source.kind])

  if (actionRef) {
    actionRef.current = {
      next: () => readerRef.current?.next(),
      prev: () => readerRef.current?.prev(),
      goLeft: () => readerRef.current?.goLeft ? readerRef.current.goLeft() : readerRef.current?.prev(),
      goRight: () => readerRef.current?.goRight ? readerRef.current.goRight() : readerRef.current?.next(),
    }
  }

  return (
    <main className={`reader-view theme-${settings.theme} ${immersive ? 'is-immersive' : ''} ${!settings.showProgress ? 'without-progress' : ''}`} onMouseMove={handleChromeMouseMove} onMouseLeave={scheduleChromeHide}>
      {!immersive ? (
        <header className="reader-toolbar">
          <button className="toolbar-button back" onClick={onBack} title="返回书架"><ArrowLeft size={18} /></button>
          <div className="book-heading">
            <strong>{book.title}</strong>
            <span title={activeChapter?.label || book.format}>{activeChapter ? activeChapter.label : book.format}</span>
          </div>
          <div className="reader-actions">
            <button className={`toolbar-button ${panel === 'toc' ? 'active' : ''}`} onClick={() => setPanel(panel === 'toc' ? null : 'toc')} title="目录"><List size={18} /></button>
            <button className="toolbar-button" onClick={addBookmark} title="添加书签"><BookmarkPlus size={17} /></button>
            <button className={`toolbar-button ${panel === 'bookmarks' ? 'active' : ''}`} onClick={() => setPanel(panel === 'bookmarks' ? null : 'bookmarks')} title="书签"><BookMarked size={17} /></button>
            <button className={`toolbar-button ${panel === 'notes' ? 'active' : ''}`} onClick={() => setPanel(panel === 'notes' ? null : 'notes')} title="摘录与笔记"><NotebookPen size={17} /></button>
            <button className="toolbar-button" onClick={() => window.readerAPI.toggleProfilesWindow?.()} title="本书设定集（打开/关闭独立窗口）"><BookOpenCheck size={17} /></button>
            <button className={`toolbar-button ${panel === 'search' ? 'active' : ''}`} onClick={() => setPanel(panel === 'search' ? null : 'search')} title="全书搜索"><Search size={17} /></button>
            <button className={`toolbar-button ${panel === 'settings' ? 'active' : ''}`} onClick={() => setPanel(panel === 'settings' ? null : 'settings')} title="阅读设置"><Settings2 size={18} /></button>
            <button className="toolbar-button" onClick={onToggleImmersive} title="沉浸阅读 (F11)"><Maximize size={17} /></button>
          </div>
        </header>
      ) : null}

      <section className="reading-stage" onClick={() => panel && setPanel(null)} onWheel={handlePageWheel}>
        {source.kind === 'text' ? (
          <TextReader key={`${settings.scriptConversion || 'none'}-${conversionReady}`} ref={readerRef} content={source.content} settings={settings} initialPage={progress.page ?? savedProgress?.page} onProgress={updateProgress} onChapters={updateChapters} onCollect={onAddNote} notes={notes} onLookupEntity={openEntityLookup} onCheckEntityProfile={checkEntityProfile} hasAnyProfile={entityProfiles.length > 0} />
        ) : source.kind === 'text-large' ? (
          <LargeTextReader key={`${settings.scriptConversion || 'none'}-${conversionReady}`} ref={readerRef} book={book} source={source} settings={settings} savedProgress={progress || savedProgress} onProgress={updateProgress} onChapters={updateChapters} onCollect={onAddNote} notes={notes} onLookupEntity={openEntityLookup} onCheckEntityProfile={checkEntityProfile} hasAnyProfile={entityProfiles.length > 0} />
        ) : (
          <EpubReader key={`${settings.scriptConversion || 'none'}-${conversionReady}`} ref={readerRef} data={source.data} settings={settings} initialCfi={progress.cfi || savedProgress?.cfi} onProgress={updateProgress} onChapters={updateChapters} onShortcut={shortcut} onWheel={handlePageWheel} onCollect={onAddNote} notes={notes} onLookupEntity={openEntityLookup} onCheckEntityProfile={checkEntityProfile} hasAnyProfile={entityProfiles.length > 0} />
        )}

        <button className="page-zone previous" onClick={() => readerRef.current?.goLeft ? readerRef.current.goLeft() : readerRef.current?.prev()} aria-label="向左翻页"><ChevronLeft size={22} /></button>
        <button className="page-zone next" onClick={() => readerRef.current?.goRight ? readerRef.current.goRight() : readerRef.current?.next()} aria-label="向右翻页"><ChevronRight size={22} /></button>
      </section>

      {immersive ? <div className="chrome-edge-trigger is-top" onMouseEnter={() => { clearTimeout(chromeTimerRef.current); setChromeZone('top') }} aria-hidden="true" /> : null}
      <div className="chrome-edge-trigger is-bottom" onMouseEnter={() => { clearTimeout(chromeTimerRef.current); setChromeZone('bottom') }} aria-hidden="true" />

      {settings.showProgress ? (
        <footer className={`reader-footer ${footerVisible ? 'is-visible' : ''}`}>
          <span>{progress.pageCount > 1 ? `${progress.page + (source.kind.startsWith('text') ? 1 : 0)} / ${progress.pageCount}` : ''}</span>
          <input
            className="progress-scrubber"
            type="range"
            min="0"
            max="1000"
            step="1"
            value={scrubProgress === null ? Math.round((progress.percent || 0) * 1000) : scrubProgress}
            aria-label="阅读进度"
            onChange={(event) => setScrubProgress(Number(event.target.value))}
            onPointerUp={commitSeek}
            onKeyUp={(event) => ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) && commitSeek(event)}
          />
          <label className="percent-entry">
            <input
              type="number"
              min="0"
              max="100"
              value={displayedPercent}
              aria-label="输入阅读百分比"
              onChange={(event) => setScrubProgress(Math.max(0, Math.min(100, Number(event.target.value) || 0)) * 10)}
              onBlur={commitPercent}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()}
            />
            <span>%</span>
          </label>
        </footer>
      ) : null}

      {immersive ? (
        <div className={`immersive-topbar ${chromeZone === 'top' ? 'is-visible' : ''}`}>
          <div className="immersive-heading">
            <strong>{book.title}</strong>
            <span title={activeChapter?.label || ''}>{activeChapter ? activeChapter.label : ' '}</span>
          </div>
          <button className="toolbar-button" onClick={onToggleImmersive} title="退出沉浸阅读 (F11)" aria-label="退出沉浸阅读"><Minimize2 size={17} /></button>
        </div>
      ) : null}
      {panel === 'settings' && !immersive ? <ReaderSettings settings={settings} onChange={setSettings} encoding={source.kind.startsWith('text') ? source.encoding : null} onEncodingChange={onEncodingChange} /> : null}
      {panel === 'toc' && !immersive ? (
        <aside className="toc-panel">
          <div className="toc-title"><List size={16} /><strong>目录</strong><span>{percent}% · {chapters.length} 章</span></div>
          <div className="toc-list">
            {chapters.length ? chapters.map((chapter, index) => (
              <button
                key={`${chapter.href || chapter.offset || chapter.index}-${index}`}
                ref={index === activeChapterIndex ? activeChapterRef : null}
                className={index === activeChapterIndex ? 'is-current' : undefined}
                aria-current={index === activeChapterIndex ? 'location' : undefined}
                style={{ paddingLeft: `${16 + (chapter.depth || 0) * 14}px` }}
                onClick={() => jumpToChapter(chapter)}
              >{chapter.label}</button>
            )) : <p>这本书没有可识别的目录</p>}
          </div>
        </aside>
      ) : null}
      {panel === 'notes' && !immersive ? (
        <aside className="notes-panel">
          <div className="toc-title"><Bookmark size={16} /><strong>收藏笔记</strong><span>{notes.length} 条</span></div>
          <div className="notes-list">
            {notes.length ? notes.map((note) => (
              <div className="note-item" key={note.id}>
                <button onClick={() => { readerRef.current?.goToNote ? readerRef.current.goToNote(note) : readerRef.current?.goToParagraph(note.paragraphIndex); setPanel(null) }}>
                  <p>{note.text}</p>
                  {note.comment ? <em className="note-comment">{note.comment}</em> : null}
                  <span>{new Date(note.createdAt).toLocaleDateString('zh-CN')}</span>
                </button>
                <button className="delete-note" onClick={() => onDeleteNote(note.id)} title="删除笔记"><Trash2 size={13} /></button>
              </div>
            )) : <p className="notes-empty">选中正文中的文字即可收藏并评论</p>}
          </div>
        </aside>
      ) : null}
      {panel === 'bookmarks' && !immersive ? (
        <aside className="notes-panel">
          <div className="toc-title"><Bookmark size={16} /><strong>书签</strong><span>{bookmarks.length} 条</span></div>
          <div className="notes-list">
            {bookmarks.length ? [...bookmarks].sort((a, b) => b.createdAt - a.createdAt).map((bookmark) => (
              <div className="note-item" key={bookmark.id}><button onClick={() => { readerRef.current?.goToBookmark?.(bookmark); setPanel(null) }}><p>{bookmark.label}</p><span>{Math.round((bookmark.percent || 0) * 100)}% · {new Date(bookmark.createdAt).toLocaleDateString('zh-CN')}</span></button><button className="delete-note" onClick={() => onDeleteBookmark(bookmark.id)} title="删除书签"><Trash2 size={13} /></button></div>
            )) : <p className="notes-empty">点击工具栏中的“添加书签”保存当前位置</p>}
          </div>
        </aside>
      ) : null}
      {panel === 'search' && !immersive ? (
        <aside className="search-panel">
          <form className="book-search" onSubmit={runSearch}>
            <Search size={15} />
            <input autoFocus value={searchQuery} placeholder="搜索全书" onChange={(event) => setSearchQuery(event.target.value)} />
            <button type="submit">{searching ? `搜索 ${Math.round(searchProgress * 100)}%` : '搜索'}</button>
          </form>
          <div className="search-results">
            {searchResults.length ? <div className="search-summary">找到 {searchResults.length} 处{searchTruncated ? '，结果过多，仅显示前 5000 处' : ''}</div> : null}
            {searchResults.length ? searchResults.map((result, index) => (
              <button key={`${result.offset ?? result.occurrence}-${index}`} onClick={() => { readerRef.current?.goToSearch({ ...result, query: searchQuery.trim() }); setPanel(null) }}>
                <span>{result.label}</span>
                <small>{source.kind === 'text-large' ? `${Math.round(result.offset / source.total * 100)}%` : source.kind === 'epub' ? result.chapter : `结果 ${index + 1}`}</small>
              </button>
            )) : <p>{searchQuery && !searching ? '没有找到匹配内容' : `输入关键词搜索当前${source.kind === 'epub' ? ' EPUB' : ' TXT'}`}</p>}
          </div>
        </aside>
      ) : null}
      {identityProfile ? <EntityIdentityModal profile={entityProfiles.find((item) => item.id === identityProfile.id) || identityProfile} profiles={entityProfiles} onSave={onUpdateEntityIdentity} onMerge={onMergeEntityProfiles} onSplit={onSplitEntityAlias} onClose={() => setIdentityProfile(null)} /> : null}
      <AISettingsModal open={aiSettingsOpen} onClose={() => setAiSettingsOpen(false)} onChange={(value) => setAiConfig(value)} />
    </main>
  )
}
