import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, BookMarked, Bookmark, BookmarkPlus, BookOpenCheck, BookOpenText, ChevronLeft, ChevronRight, List, Maximize, Minimize2, MoreHorizontal, NotebookPen, Search, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import EpubReader from './EpubReader'
import LargeTextReader from './LargeTextReader'
import ReaderSettings from './ReaderSettings'
import TextReader from './TextReader'
import AISettingsModal from './AISettingsModal'
import EntityIdentityModal from './EntityIdentityModal'
import { searchVariants, useChineseConversionReady } from '../chineseConversion'
import { isCorruptProfile } from '../entityProfiles'
import { buildCoverageNote, selectPreviousSummaries } from '../storyline'

function pickRepresentative(items, limit = 400) {
  if (items.length <= limit) return items
  const first = items.slice(0, 100)
  const last = items.slice(-150)
  const middle = items.slice(100, -150)
  const slots = limit - first.length - last.length
  const sampled = Array.from({ length: slots }, (_, index) => middle[Math.floor(index * middle.length / slots)]).filter(Boolean)
  return [...first, ...sampled, ...last]
}

export default function ReaderView({ book, source, settings, setSettings, savedProgress, immersive, onBack, onToggleImmersive, onProgress, shortcut, actionRef, notes, bookmarks, onAddBookmark, onDeleteBookmark, onAddNote, onDeleteNote, initialNote, onEncodingChange, epubFontOverride, onEpubFontOverrideChange, entityProfiles = [], onSaveEntityProfile, onUpdateEntityIdentity, onMergeEntityProfiles, onSplitEntityAlias, onDeleteEntityProfile, dictionaryEntries = [], onSaveDictEntry, onDeleteDictEntry, companionEnabled, onToggleCompanion, storylineEntries = [], onSaveStorylineEntry, onDeleteStorylineEntry, companionChats = [], onSaveCompanionChats }) {
  const readerRef = useRef(null)
  const conversionReady = useChineseConversionReady(settings.scriptConversion || 'none')
  const activeChapterRef = useRef(null)
  const wheelStateRef = useRef({ accumulated: 0, direction: 0, lockedUntil: 0 })
  const [panel, setPanel] = useState(null)
  const [chapters, setChapters] = useState([])
  const [progress, setProgress] = useState(savedProgress || { percent: 0, page: 0, pageCount: 1 })
  const [epubFontFeatures, setEpubFontFeatures] = useState({ bold: false, italic: false })
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
  const toolbarRef = useRef(null)
  const overflowRef = useRef(null)
  const [toolbarCompact, setToolbarCompact] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)

  // 窄窗只保留两个主操作和“更多”，总计三个图标。
  useEffect(() => {
    const element = toolbarRef.current
    if (!element || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width || 0
      setToolbarCompact(width < 760)
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // 溢出菜单：点击外部或按 Esc 关闭。
  useEffect(() => {
    if (!overflowOpen) return undefined
    const onPointerDown = (event) => { if (!overflowRef.current?.contains(event.target)) setOverflowOpen(false) }
    const onKeyDown = (event) => { if (event.key === 'Escape') setOverflowOpen(false) }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [overflowOpen])

  // 侧栏面板（目录/书签/笔记/搜索/设置）：Esc 或点击面板与工具栏以外的区域关闭。
  // EPUB 正文在 iframe 内，点击不冒泡到这里，由 EpubReader 的 onDismissPanel 兜底。
  useEffect(() => {
    if (!panel) return undefined
    const onKeyDown = (event) => { if (event.key === 'Escape') setPanel(null) }
    const onPointerDown = (event) => {
      if (event.target.closest('.toc-panel, .notes-panel, .search-panel, .settings-panel, .reader-toolbar')) return
      setPanel(null)
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
    }
  }, [panel])

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

  // 沉浸顶栏手动拖拽：frameless 窗口最大化时 app-region 拖动无效，改走 IPC 逐帧 setPosition。
  const startChromeDrag = useCallback((event) => {
    if (event.button !== 0 || event.target.closest('button')) return
    const api = window.readerAPI
    if (!api?.startWindowDrag) return
    event.preventDefault()
    api.startWindowDrag({ offsetX: event.clientX, offsetY: event.clientY, screenX: event.screenX, screenY: event.screenY })
    const onMove = (moveEvent) => api.dragWindowMove({ screenX: moveEvent.screenX, screenY: moveEvent.screenY })
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      api.endWindowDrag()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [])

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
        status: 'queued',
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

  // 换书时清空任务；阅读器卸载（返回书架/关书）时清空设定集窗口内容。
  useEffect(() => { setProfileTasks([]) }, [book.id])

  // ===== AI 陪读（状态与入队）：执行器与触发逻辑在字典百科一节之后 =====
  const [companionTasks, setCompanionTasks] = useState([])
  const companionTasksRef = useRef([])
  const storylineEntriesRef = useRef(storylineEntries)
  storylineEntriesRef.current = storylineEntries

  const patchCompanionTask = (taskId, patch) => setCompanionTasks((current) => current.map((task) => task.id === taskId ? { ...task, ...patch } : task))

  // 当前阅读单元：有目录按章节（ch-N），无目录的 TXT 按 5000 字段（seg-N）；
  // 无目录的 EPUB 无法稳定定位单元，不总结。
  const resolveCompanionUnit = useCallback(() => {
    if (chapters.length > 0) {
      if (activeChapterIndex < 0) return null
      const chapter = chapters[activeChapterIndex]
      return { unitKey: `ch-${activeChapterIndex}`, order: activeChapterIndex, label: chapter.label, chapter }
    }
    if (source.kind === 'epub') return null
    const order = source.kind === 'text-large'
      ? Math.floor((progress.absolutePosition || 0) / 5000)
      : Math.floor((progress.textFraction || 0) * (source.content?.length || 0) / 5000)
    return { unitKey: `seg-${order}`, order, label: `第 ${order + 1} 段（约 ${order * 5000} 字处）`, range: [order * 5000, (order + 1) * 5000] }
  }, [chapters, activeChapterIndex, source.kind, source.content, progress.absolutePosition, progress.textFraction])

  // force 用于"重新生成"：已有总结也照常入队（完成后 upsert 覆盖旧条目）。
  const enqueueCompanionUnit = useCallback((unit, force = false) => {
    if (!unit) return
    setCompanionTasks((current) => {
      if (!force && storylineEntriesRef.current.some((entry) => entry.unitKey === unit.unitKey)) return current
      if (current.some((task) => task.unitKey === unit.unitKey && !['done', 'error'].includes(task.status))) return current
      return [...current, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, unitKey: unit.unitKey, order: unit.order, label: unit.label, unit, status: 'pending', error: null, createdAt: Date.now() }]
    })
  }, [])
  useEffect(() => () => {
    window.readerAPI.sendProfilesSync?.({ bookId: null, bookTitle: '', entityProfiles: [], linkAlias: '', profileTasks: [] })
  }, [])

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
      bookAuthor: book.author || '',
      entityProfiles,
      storyline: storylineEntries,
      companionTasks: companionTasks.map((task) => ({ id: task.id, label: task.label, status: task.status, error: task.error, createdAt: task.createdAt })),
      linkAlias,
      profileTasks: profileTasks.map((task) => ({ id: task.id, name: task.name, status: task.status, incremental: task.incremental, contextInfo: task.contextInfo ? { totalMatches: task.contextInfo.totalMatches, sentCount: task.contextInfo.sentCount } : null, error: task.error, needsSetup: Boolean(task.needsSetup), profileId: task.profileId || null, hasCached: Boolean(task.cachedProfile), startedAt: task.startedAt || 0, createdAt: task.createdAt })),
    })
  }, [book.id, book.title, book.author, entityProfiles, storylineEntries, companionTasks, profileTasks, linkAlias])
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
    // 剧情梳理页：删除某条总结 / 用条目里留存的 unit 重新生成。
    else if (action.type === 'storyline-delete') onDeleteStorylineEntry?.(action.entryId)
    else if (action.type === 'storyline-regenerate') {
      const entry = storylineEntriesRef.current.find((item) => item.id === action.entryId)
      if (entry?.unit) enqueueCompanionUnit(entry.unit, true)
    }
    // 设定集窗口条目右键"更新生成"：基于当前已读进度之前的内容全量重新生成。
    else if (action.type === 'update-profile') {
      const target = entityProfiles.find((item) => item.id === action.profileId)
      if (!target) return
      const location = readerRef.current?.getLocation?.() || {}
      const selection = {
        text: target.name,
        paragraphIndex: location.paragraphIndex,
        spineIndex: location.spineIndex,
        href: location.href,
        readPosition: source.kind === 'text-large' ? (Number(progress.absolutePosition) || 0) : (Number(progress.percent) || 0),
        readPercent: Number(progress.percent) || 0,
      }
      setProfileTasks((current) => {
        if (current.some((task) => task.name === target.name && !['done', 'error'].includes(task.status))) return current
        return [...current, { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, name: target.name, selection, cachedProfile: target, incremental: false, status: 'pending', contextInfo: null, prepared: null, error: null, createdAt: Date.now() }]
      })
    }
  }), [entityProfiles, enqueueCompanionUnit, onDeleteEntityProfile, onDeleteStorylineEntry, onUpdateEntityIdentity, progress.absolutePosition, progress.percent, source.kind])

  // ===== 字典百科：划选文字 → AI 结合上下文解说，独立窗口展示，支持重新生成与追问 =====
  const dictEntriesRef = useRef([])
  const [dictTransient, setDictTransient] = useState({})
  dictEntriesRef.current = dictionaryEntries

  const patchDictTransient = (entryId, patch) => setDictTransient((current) => ({ ...current, [entryId]: { ...current[entryId], ...patch } }))
  const clearDictTransient = (entryId) => setDictTransient((current) => {
    if (!current[entryId]) return current
    const next = { ...current }
    delete next[entryId]
    return next
  })
  const lightProfiles = useMemo(() => entityProfiles.map(({ name, aliases, type, summary }) => ({ name, aliases, type, summary })), [entityProfiles])

  const resolveDictProvider = async () => {
    const config = aiConfig || await window.readerAPI.getAiSettings()
    setAiConfig(config)
    return config.providers.find((item) => item.id === config.activeProviderId) || config.providers[0] || null
  }

  const freshDictContext = async (anchor) => {
    try { return await readerRef.current?.getDictContext?.(anchor) || null } catch { return null }
  }

  // 首次解说 / 重新生成：上下文尽量现取（读者可能又往后读了），取不到就用条目里存的段落。
  const runDictExplain = useCallback(async (entry) => {
    patchDictTransient(entry.id, { generating: true, error: null })
    try {
      const provider = await resolveDictProvider()
      if (!provider) {
        patchDictTransient(entry.id, { generating: false, error: '请先设置并选择 AI 供应商' })
        setAiSettingsOpen(true)
        return
      }
      const ctx = await freshDictContext(entry.anchor)
      const result = await window.readerAPI.dictionaryChat({
        mode: 'explain',
        providerId: provider.id,
        model: provider.model || provider.models?.[0],
        bookTitle: book.title,
        author: book.author || '',
        chapterLabel: entry.chapterLabel,
        readPercent: entry.readPercent,
        selectedText: entry.text,
        paragraph: ctx?.paragraph || entry.paragraph,
        contextBefore: ctx?.contextBefore || '',
        contextAfter: ctx?.contextAfter || '',
        entityProfiles: lightProfiles,
      })
      if (!result?.ok) {
        patchDictTransient(entry.id, { generating: false, error: result?.error?.message || '解说失败' })
        return
      }
      const latest = dictEntriesRef.current.find((item) => item.id === entry.id) || entry
      onSaveDictEntry?.({ ...latest, explanation: result.text, providerName: result.providerName, model: result.model, updatedAt: Date.now() })
      clearDictTransient(entry.id)
    } catch (reason) {
      patchDictTransient(entry.id, { generating: false, error: reason?.message || '解说失败' })
    }
  }, [book.title, book.author, lightProfiles, onSaveDictEntry, aiConfig])

  // 追问：选中行 + 所在章节全文（约 2 万字符）+ 设定集一起发给 AI。
  const runDictFollowup = useCallback(async (entryId, followup) => {
    const entry = dictEntriesRef.current.find((item) => item.id === entryId)
    if (!entry || !followup) return
    patchDictTransient(entryId, { pendingFollowupId: followup.id, followUpErrorId: null, followUpError: null })
    try {
      const provider = await resolveDictProvider()
      if (!provider) {
        patchDictTransient(entryId, { pendingFollowupId: null, followUpErrorId: followup.id, followUpError: '请先设置并选择 AI 供应商' })
        setAiSettingsOpen(true)
        return
      }
      const ctx = await freshDictContext(entry.anchor)
      const result = await window.readerAPI.dictionaryChat({
        mode: 'followup',
        providerId: provider.id,
        model: provider.model || provider.models?.[0],
        bookTitle: book.title,
        chapterLabel: entry.chapterLabel,
        selectedText: entry.text,
        paragraph: ctx?.paragraph || entry.paragraph,
        chapterText: ctx?.chapterText || '',
        explanation: entry.explanation,
        followUps: (entry.followUps || []).filter((item) => item.answer && item.id !== followup.id),
        question: followup.question,
        entityProfiles: lightProfiles,
      })
      if (!result?.ok) {
        patchDictTransient(entryId, { pendingFollowupId: null, followUpErrorId: followup.id, followUpError: result?.error?.message || '回答失败' })
        return
      }
      const latest = dictEntriesRef.current.find((item) => item.id === entryId) || entry
      onSaveDictEntry?.({ ...latest, followUps: (latest.followUps || []).map((item) => item.id === followup.id ? { ...item, answer: result.text } : item), updatedAt: Date.now() })
      patchDictTransient(entryId, { pendingFollowupId: null, followUpErrorId: null, followUpError: null })
    } catch (reason) {
      patchDictTransient(entryId, { pendingFollowupId: null, followUpErrorId: followup.id, followUpError: reason?.message || '回答失败' })
    }
  }, [book.title, lightProfiles, onSaveDictEntry, aiConfig])

  // 右键"字典百科"：同一位置已解释过则直接开窗复看，否则新建条目并请求解说。
  const openDictionary = useCallback((selection) => {
    const text = String(selection?.text || '').trim()
    if (!text) return
    const anchor = source.kind === 'epub'
      ? { kind: 'epub', cfi: selection.cfi, href: selection.href, text: text.slice(0, 500), paragraph: String(selection.paragraph || '').slice(0, 4000) }
      : { kind: source.kind, paragraphIndex: selection.paragraphIndex, startOffset: selection.startOffset, endOffset: selection.endOffset, chunkOffset: selection.chunkOffset }
    const anchorKey = anchor.kind === 'epub' ? `cfi:${anchor.cfi}` : `p:${anchor.chunkOffset ?? 0}:${anchor.paragraphIndex}:${anchor.startOffset}-${anchor.endOffset}`
    const existing = dictEntriesRef.current.find((item) => item.anchorKey === anchorKey)
    if (existing?.explanation) {
      window.readerAPI.openDictionaryWindow?.(existing.id)
      return
    }
    const entry = existing || {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      anchorKey,
      anchor,
      text: text.slice(0, 500),
      paragraph: String(selection.currentParagraph || selection.paragraph || text).slice(0, 4000),
      chapterLabel: selection.chapterLabel || activeChapter?.label || '',
      readPercent: Number(selection.readPercent ?? progress.percent) || 0,
      explanation: '',
      followUps: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    if (!existing) onSaveDictEntry?.(entry)
    window.readerAPI.openDictionaryWindow?.(entry.id)
    if (!existing?.explanation) runDictExplain(entry)
  }, [activeChapter?.label, onSaveDictEntry, progress.percent, runDictExplain, source.kind])

  const openDictEntry = useCallback((entry) => { if (entry) window.readerAPI.openDictionaryWindow?.(entry.id) }, [])

  // 快照：持久化条目 + 生成中/出错的瞬时状态，推给字典窗口。
  const dictSnapshotEntries = useMemo(() => dictionaryEntries.map((item) => {
    const transient = dictTransient[item.id] || {}
    return {
      ...item,
      generating: Boolean(transient.generating),
      error: transient.error || null,
      followUpPending: Boolean(transient.pendingFollowupId),
      followUps: (item.followUps || []).map((followup) => ({
        ...followup,
        pending: transient.pendingFollowupId === followup.id,
        error: transient.followUpErrorId === followup.id ? transient.followUpError : null,
      })),
    }
  }), [dictionaryEntries, dictTransient])

  const pushDictSync = useCallback(() => {
    window.readerAPI.sendDictSync?.({ bookId: book.id, bookTitle: book.title, entries: dictSnapshotEntries })
  }, [book.id, book.title, dictSnapshotEntries])
  useEffect(() => { pushDictSync() }, [pushDictSync])
  useEffect(() => window.readerAPI.onDictSyncRequest?.(() => pushDictSync()), [pushDictSync])
  // 关闭阅读器时清空字典窗口内容。
  useEffect(() => () => { window.readerAPI.sendDictSync?.({ bookId: null, bookTitle: '', entries: [] }) }, [])

  // 字典窗口回传的动作：重新生成、追问、重试追问、删除追问。
  useEffect(() => window.readerAPI.onDictAction?.((action) => {
    if (!action) return
    if (action.type === 'regenerate') {
      const entry = dictEntriesRef.current.find((item) => item.id === action.entryId)
      if (entry) runDictExplain(entry)
    } else if (action.type === 'followup') {
      const entry = dictEntriesRef.current.find((item) => item.id === action.entryId)
      const question = String(action.question || '').trim().slice(0, 500)
      if (!entry || !question) return
      const followup = { id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, question, answer: '', createdAt: Date.now() }
      onSaveDictEntry?.({ ...entry, followUps: [...(entry.followUps || []), followup], updatedAt: Date.now() })
      runDictFollowup(action.entryId, followup)
    } else if (action.type === 'retry-followup') {
      const entry = dictEntriesRef.current.find((item) => item.id === action.entryId)
      const followup = entry?.followUps?.find((item) => item.id === action.followupId)
      if (entry && followup) runDictFollowup(entry.id, followup)
    } else if (action.type === 'edit-followup') {
      // 编辑追问：改写问题、清空旧回答（追问历史里它仍未回答），然后重跑。
      const entry = dictEntriesRef.current.find((item) => item.id === action.entryId)
      const followup = entry?.followUps?.find((item) => item.id === action.followupId)
      const question = String(action.question || '').trim().slice(0, 500)
      if (!entry || !followup || !question) return
      const nextFollowup = { ...followup, question, answer: '' }
      onSaveDictEntry?.({ ...entry, followUps: (entry.followUps || []).map((item) => (item.id === followup.id ? nextFollowup : item)), updatedAt: Date.now() })
      runDictFollowup(entry.id, nextFollowup)
    } else if (action.type === 'delete-followup') {
      const entry = dictEntriesRef.current.find((item) => item.id === action.entryId)
      if (entry) onSaveDictEntry?.({ ...entry, followUps: (entry.followUps || []).filter((item) => item.id !== action.followupId), updatedAt: Date.now() })
    } else if (action.type === 'delete-entry') {
      // 字典窗口删除整条解释（含全部追问），同时清掉它的瞬时状态。
      onDeleteDictEntry?.(action.entryId)
      clearDictTransient(action.entryId)
    } else if (action.type === 'jump-to-source') {
      // 字典窗口里点击引用块：跳转到书中原文位置（主进程同时会把阅读窗提到前台）。
      const entry = dictEntriesRef.current.find((item) => item.id === action.entryId)
      if (!entry?.anchor) return
      if (entry.anchor.kind === 'epub') readerRef.current?.goToBookmark?.({ cfi: entry.anchor.cfi })
      else if (entry.anchor.kind === 'text-large') readerRef.current?.goToNote?.({ chunkOffset: entry.anchor.chunkOffset, paragraphIndex: entry.anchor.paragraphIndex })
      else readerRef.current?.goToParagraph?.(entry.anchor.paragraphIndex)
    }
  }), [onSaveDictEntry, onDeleteDictEntry, runDictExplain, runDictFollowup])


  // ===== 剧情提问：独立问答窗口的会话数据流（快照下发 + 动作回传，仿字典百科） =====
  // 会话本体持久化在 App（reader:companion-chats）；pending/error 是瞬时状态，只进快照不落盘。
  const companionChatsRef = useRef([])
  companionChatsRef.current = companionChats
  const [companionChatTransient, setCompanionChatTransient] = useState({}) // { [sessionId]: { pendingId, errorId, error } }
  const [activeCompanionSessionId, setActiveCompanionSessionId] = useState('')

  const patchCompanionChatTransient = (sessionId, patch) => setCompanionChatTransient((current) => ({ ...current, [sessionId]: { ...current[sessionId], ...patch } }))

  // 所有会话变更统一走这里：同步刷新 ref（同一轮动作里连续读写不受渲染间隙影响），再经 App 落盘。
  const saveCompanionSessions = useCallback((updater) => {
    const next = updater(companionChatsRef.current)
    companionChatsRef.current = next
    onSaveCompanionChats?.(next)
  }, [onSaveCompanionChats])

  const newCompanionSession = () => ({ id: `${Date.now()}-${Math.random().toString(16).slice(2)}`, title: '新会话', messages: [], createdAt: Date.now(), updatedAt: Date.now() })

  // 回答指定会话里的一条（空或待重答的）assistant 消息：问题取它前面最近的一条 user 消息，
  // 历史取该 user 消息之前的最近 10 条问答（当前问题经 question 单独传递，不进 history，避免重复）。
  const runCompanionChat = useCallback(async (sessionId, assistantId) => {
    const session = companionChatsRef.current.find((item) => item.id === sessionId)
    if (!session) return
    const messages = session.messages || []
    const assistantIndex = messages.findIndex((item) => item.id === assistantId)
    if (assistantIndex < 0) return
    let userIndex = -1
    for (let index = assistantIndex - 1; index >= 0; index -= 1) {
      if (messages[index].role === 'user' && String(messages[index].content || '').trim()) { userIndex = index; break }
    }
    if (userIndex < 0) return
    patchCompanionChatTransient(sessionId, { pendingId: assistantId, errorId: null, error: null })
    try {
      const provider = await resolveDictProvider()
      if (!provider) {
        patchCompanionChatTransient(sessionId, { pendingId: null, errorId: assistantId, error: '请先设置并选择 AI 供应商' })
        setAiSettingsOpen(true)
        return
      }
      const history = messages
        .slice(0, userIndex)
        .filter((item) => (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim())
        .slice(-10)
        .map((item) => ({ role: item.role, content: item.content }))
      const result = await window.readerAPI.companionChat({
        providerId: provider.id,
        model: provider.model || provider.models?.[0],
        maxTokens: Math.min(4000, provider.maxTokens || 2000),
        bookTitle: book.title,
        author: book.author || '',
        storyline: storylineEntriesRef.current.map(({ label, text, timePoint, location }) => ({ label, text, timePoint, location })),
        entityProfiles: lightProfiles,
        history,
        question: messages[userIndex].content,
      })
      if (!result?.ok) {
        patchCompanionChatTransient(sessionId, { pendingId: null, errorId: assistantId, error: result?.error?.message || '回答失败' })
        return
      }
      saveCompanionSessions((current) => current.map((item) => item.id === sessionId ? {
        ...item,
        updatedAt: Date.now(),
        messages: (item.messages || []).map((message) => message.id === assistantId ? { ...message, content: result.text, providerName: result.providerName, model: result.model } : message),
      } : item))
      patchCompanionChatTransient(sessionId, { pendingId: null, errorId: null, error: null })
    } catch (reason) {
      patchCompanionChatTransient(sessionId, { pendingId: null, errorId: assistantId, error: reason?.message || '回答失败' })
    }
  }, [book.title, book.author, lightProfiles, aiConfig, saveCompanionSessions])

  // 快照：持久化会话 + 生成中/出错的瞬时状态，推给剧情提问窗口。
  const companionSnapshotSessions = useMemo(() => companionChats.map((session) => {
    const transient = companionChatTransient[session.id] || {}
    return {
      ...session,
      messages: (session.messages || []).map((message) => ({
        ...message,
        pending: transient.pendingId === message.id,
        error: transient.errorId === message.id ? transient.error : null,
      })),
    }
  }), [companionChats, companionChatTransient])

  const pushCompanionSync = useCallback(() => {
    window.readerAPI.sendCompanionSync?.({
      bookId: book.id,
      bookTitle: book.title,
      sessions: companionSnapshotSessions,
      activeSessionId: activeCompanionSessionId || companionSnapshotSessions[companionSnapshotSessions.length - 1]?.id || '',
    })
  }, [book.id, book.title, companionSnapshotSessions, activeCompanionSessionId])
  useEffect(() => { pushCompanionSync() }, [pushCompanionSync])
  useEffect(() => window.readerAPI.onCompanionSyncRequest?.(() => pushCompanionSync()), [pushCompanionSync])
  // 关闭阅读器时清空剧情提问窗口内容。
  useEffect(() => () => { window.readerAPI.sendCompanionSync?.({ bookId: null, bookTitle: '', sessions: [] }) }, [])

  // 剧情提问窗口回传的动作：会话增删选、发问、重试、重新生成、编辑、删除消息。
  useEffect(() => window.readerAPI.onCompanionAction?.((action) => {
    if (!action) return
    if (action.type === 'new-session') {
      const session = newCompanionSession()
      saveCompanionSessions((current) => [...current, session])
      setActiveCompanionSessionId(session.id)
    } else if (action.type === 'select-session') {
      if (action.sessionId) setActiveCompanionSessionId(action.sessionId)
    } else if (action.type === 'delete-session') {
      saveCompanionSessions((current) => current.filter((item) => item.id !== action.sessionId))
      setCompanionChatTransient((current) => {
        if (!current[action.sessionId]) return current
        const next = { ...current }
        delete next[action.sessionId]
        return next
      })
      // active 被删时顺延到最新一个会话。
      setActiveCompanionSessionId((current) => {
        if (current && current !== action.sessionId) return current
        const remaining = companionChatsRef.current
        return remaining[remaining.length - 1]?.id || ''
      })
    } else if (action.type === 'rename-session') {
      const title = String(action.title || '').trim().slice(0, 40)
      if (!title) return
      saveCompanionSessions((current) => current.map((item) => item.id === action.sessionId ? { ...item, title, updatedAt: Date.now() } : item))
    } else if (action.type === 'send') {
      const question = String(action.question || '').trim().slice(0, 2000)
      if (!question) return
      // 窗口在没有任何会话时直接发问：隐式建一个会话再追加问答。
      let session = companionChatsRef.current.find((item) => item.id === action.sessionId) || null
      if (!session) {
        session = newCompanionSession()
        saveCompanionSessions((current) => [...current, session])
        setActiveCompanionSessionId(session.id)
      }
      const pairId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const userMessage = { id: `u-${pairId}`, role: 'user', content: question, createdAt: Date.now() }
      const assistantMessage = { id: `a-${pairId}`, role: 'assistant', content: '', createdAt: Date.now() }
      saveCompanionSessions((current) => current.map((item) => item.id === session.id ? {
        ...item,
        title: item.title === '新会话' ? question.slice(0, 20) : item.title,
        messages: [...(item.messages || []), userMessage, assistantMessage],
        updatedAt: Date.now(),
      } : item))
      runCompanionChat(session.id, assistantMessage.id)
    } else if (action.type === 'retry' || action.type === 'regenerate') {
      const session = companionChatsRef.current.find((item) => item.id === action.sessionId)
      if (!session?.messages?.some((item) => item.id === action.messageId && item.role === 'assistant')) return
      if (action.type === 'regenerate') {
        // 清掉旧回答，重新生成期间窗口显示"正在思考"。
        saveCompanionSessions((current) => current.map((item) => item.id === session.id ? { ...item, messages: (item.messages || []).map((message) => message.id === action.messageId ? { ...message, content: '' } : message) } : item))
      }
      runCompanionChat(session.id, action.messageId)
    } else if (action.type === 'edit-message') {
      // 编辑 user 消息：改写内容、丢弃它之后的全部问答，追加空 assistant 消息重新提问。
      const content = String(action.content || '').trim().slice(0, 2000)
      const session = companionChatsRef.current.find((item) => item.id === action.sessionId)
      if (!session || !content) return
      const messages = session.messages || []
      const index = messages.findIndex((item) => item.id === action.messageId && item.role === 'user')
      if (index < 0) return
      const pairId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
      const assistantMessage = { id: `a-${pairId}`, role: 'assistant', content: '', createdAt: Date.now() }
      const edited = { ...messages[index], content }
      saveCompanionSessions((current) => current.map((item) => item.id === session.id ? {
        ...item,
        messages: [...messages.slice(0, index), edited, assistantMessage],
        updatedAt: Date.now(),
      } : item))
      runCompanionChat(session.id, assistantMessage.id)
    } else if (action.type === 'delete-message') {
      const session = companionChatsRef.current.find((item) => item.id === action.sessionId)
      if (!session) return
      const messages = session.messages || []
      const index = messages.findIndex((item) => item.id === action.messageId)
      if (index < 0) return
      // 删除 user 消息时连带删掉紧随其后的 assistant 回答，保持问答成对。
      const dropIds = new Set([action.messageId])
      if (messages[index].role === 'user' && messages[index + 1]?.role === 'assistant') dropIds.add(messages[index + 1].id)
      saveCompanionSessions((current) => current.map((item) => item.id === session.id ? { ...item, messages: (item.messages || []).filter((message) => !dropIds.has(message.id)), updatedAt: Date.now() } : item))
    }
  }), [runCompanionChat, saveCompanionSessions])


  // ===== AI 陪读：阅读位置变化时自动把当前章节/段落交给 AI 总结，结果存入剧情梳理 =====
  // 触发：陪读开启且当前单元还没总结过、也不在队列里时，入队等待总结。
  useEffect(() => {
    if (!companionEnabled) return
    enqueueCompanionUnit(resolveCompanionUnit())
  }, [companionEnabled, activeChapterIndex, progress.textFraction, progress.absolutePosition, chapters, storylineEntries, resolveCompanionUnit, enqueueCompanionUnit])

  const runCompanionTask = async (task) => {
    patchCompanionTask(task.id, { status: 'generating', error: null })
    try {
      const provider = await resolveDictProvider()
      if (!provider) {
        patchCompanionTask(task.id, { status: 'error', error: { message: '请先设置并选择 AI 供应商' } })
        setAiSettingsOpen(true)
        return
      }
      const text = await readerRef.current?.getChapterText?.(task.unit)
      if (!text || !String(text).trim()) {
        patchCompanionTask(task.id, { status: 'error', error: { message: '没有取到该章节的正文内容' } })
        return
      }
      const entries = storylineEntriesRef.current
      const coverageNote = buildCoverageNote(entries, task.order, task.label)
      const previousSummaries = selectPreviousSummaries(entries, task.order)
      const result = await window.readerAPI.companionSummary({
        providerId: provider.id,
        model: provider.model || provider.models?.[0],
        maxTokens: Math.min(4000, provider.maxTokens || 2000),
        bookTitle: book.title,
        author: book.author || '',
        chapterLabel: task.label,
        chapterText: text,
        coverageNote,
        previousSummaries,
      })
      // 任务可能已被"停止陪读"/换书清掉：结果直接丢弃。
      if (!companionTasksRef.current.some((item) => item.id === task.id)) return
      if (!result?.ok) {
        patchCompanionTask(task.id, { status: 'error', error: { message: result?.error?.message || '总结失败', ...result?.error } })
        return
      }
      const summary = result.summary || {}
      onSaveStorylineEntry?.({
        id: task.id,
        unitKey: task.unitKey,
        order: task.order,
        label: task.label,
        timePoint: summary.timePoint || '',
        location: summary.location || '',
        characters: summary.characters || [],
        events: summary.events || [],
        gains: summary.gains || '',
        openThreads: summary.openThreads || [],
        text: summary.text || '',
        unit: task.unit, // 留存定位信息，剧情梳理窗口"重新生成"时直接复用
        providerName: result.providerName,
        model: result.model,
        truncated: Boolean(result.truncated),
        createdAt: Date.now(),
      })
      patchCompanionTask(task.id, { status: 'done' })
    } catch (reason) {
      patchCompanionTask(task.id, { status: 'error', error: { message: reason?.message || '总结失败' } })
    }
  }

  // 任务队列：同一时刻只跑一个总结，其余排队等待（仿设定集任务队列）。
  useEffect(() => {
    companionTasksRef.current = companionTasks
    if (companionTasks.some((task) => task.status === 'generating')) return
    const nextTask = companionTasks.find((task) => task.status === 'pending')
    if (nextTask) runCompanionTask(nextTask)
  }, [companionTasks])

  // 换书清空陪读任务；关闭陪读时清掉未完成任务（进行中的结果由 ref 检查丢弃）。
  useEffect(() => { setCompanionTasks([]) }, [book.id])
  useEffect(() => {
    if (!companionEnabled) setCompanionTasks((current) => current.filter((task) => ['done', 'error'].includes(task.status)))
  }, [companionEnabled])

  const stopCompanion = () => {
    onToggleCompanion?.()
    setCompanionTasks((current) => current.filter((task) => ['done', 'error'].includes(task.status)))
  }

  const companionGenerating = companionTasks.find((task) => task.status === 'generating') || null

  // AI 陪读状态栏：独立小窗吸附阅读窗底边外侧（无 Electron API 的环境回退到窗内悬浮条）。
  const companionBarSupported = Boolean(window.readerAPI?.setCompanionBarVisible)
  const stopCompanionRef = useRef(stopCompanion)
  stopCompanionRef.current = stopCompanion

  useEffect(() => {
    if (!companionBarSupported) return undefined
    window.readerAPI.setCompanionBarVisible(companionEnabled)
    return () => window.readerAPI.setCompanionBarVisible(false)
  }, [companionEnabled, companionBarSupported])

  useEffect(() => {
    if (!companionBarSupported || !companionEnabled) return undefined
    const pushBarSync = () => window.readerAPI.sendCompanionBarSync({ generating: Boolean(companionGenerating), label: companionGenerating?.label || '' })
    pushBarSync()
    return window.readerAPI.onCompanionBarSyncRequest?.(pushBarSync)
  }, [companionEnabled, companionGenerating, companionBarSupported])

  useEffect(() => {
    if (!companionBarSupported) return undefined
    return window.readerAPI.onCompanionBarAction?.((action) => {
      if (action?.type === 'open-storyline') window.readerAPI.openProfilesStoryline?.()
      else if (action?.type === 'open-companion') window.readerAPI.openCompanionWindow?.()
      else if (action?.type === 'stop') stopCompanionRef.current()
    })
  }, [companionBarSupported])

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

  useEffect(() => {
    setEpubFontFeatures({ bold: false, italic: false })
  }, [book.id])

  if (actionRef) {
    actionRef.current = {
      next: () => readerRef.current?.next(),
      prev: () => readerRef.current?.prev(),
      goLeft: () => readerRef.current?.goLeft ? readerRef.current.goLeft() : readerRef.current?.prev(),
      goRight: () => readerRef.current?.goRight ? readerRef.current.goRight() : readerRef.current?.next(),
    }
  }

  // 工具栏按钮配置：pinned 的窄屏时仍平铺，其余收进溢出菜单。
  // 后续新增按钮（如“AI陪读”）在这里加一项并决定是否 pinned 即可。
  const toolbarActions = [
    { id: 'toc', icon: List, iconSize: 18, label: '目录', pinned: true, active: panel === 'toc', onClick: () => setPanel(panel === 'toc' ? null : 'toc') },
    { id: 'add-bookmark', icon: BookmarkPlus, iconSize: 17, label: '添加书签', onClick: addBookmark },
    { id: 'bookmarks', icon: BookMarked, iconSize: 17, label: '书签', active: panel === 'bookmarks', onClick: () => setPanel(panel === 'bookmarks' ? null : 'bookmarks') },
    { id: 'notes', icon: NotebookPen, iconSize: 17, label: '摘录与笔记', active: panel === 'notes', onClick: () => setPanel(panel === 'notes' ? null : 'notes') },
    { id: 'profiles', icon: BookOpenCheck, iconSize: 17, label: '本书设定集', title: '本书设定集（打开/关闭独立窗口）', onClick: () => window.readerAPI.toggleProfilesWindow?.() },
    { id: 'dictionary', icon: BookOpenText, iconSize: 17, label: '字典百科', title: '字典百科（本书全部解释记录）', onClick: () => window.readerAPI.openDictionaryWindow?.('') },
    { id: 'companion', icon: Sparkles, iconSize: 17, label: 'AI陪读', title: 'AI陪读（F2 开始 / F3 停止）', active: companionEnabled, pinned: false, onClick: onToggleCompanion },
    { id: 'search', icon: Search, iconSize: 17, label: '全书搜索', active: panel === 'search', onClick: () => setPanel(panel === 'search' ? null : 'search') },
    { id: 'settings', icon: Settings2, iconSize: 18, label: '阅读设置', active: panel === 'settings', onClick: () => setPanel(panel === 'settings' ? null : 'settings') },
    { id: 'immersive', icon: Maximize, iconSize: 17, label: '沉浸阅读', title: '沉浸阅读 (F11)', pinned: true, onClick: onToggleImmersive },
  ]
  const visibleActions = toolbarCompact ? toolbarActions.filter((action) => action.pinned) : toolbarActions
  const overflowActions = toolbarCompact ? toolbarActions.filter((action) => !action.pinned) : []

  return (
    <main className={`reader-view theme-${settings.theme} ${immersive ? 'is-immersive' : ''} ${!settings.showProgress ? 'without-progress' : ''}`} onMouseLeave={() => setChromeZone(null)}>
      {!immersive ? (
        <header className="reader-toolbar" ref={toolbarRef}>
          <button className="toolbar-button back" onClick={onBack} title="返回书架"><ArrowLeft size={18} /></button>
          <div className="book-heading">
            <strong>{book.title}</strong>
            <span title={activeChapter?.label || book.format}>{activeChapter ? activeChapter.label : book.format}</span>
          </div>
          <div className="reader-actions">
            {visibleActions.map((action) => (
              <button key={action.id} className={`toolbar-button ${action.active ? 'active' : ''}`} onClick={action.onClick} title={action.title || action.label}>
                <action.icon size={action.iconSize} />
              </button>
            ))}
            {overflowActions.length ? (
              <div className="toolbar-overflow" ref={overflowRef}>
                <button className={`toolbar-button ${overflowOpen ? 'active' : ''}`} onClick={() => setOverflowOpen(!overflowOpen)} title="更多操作"><MoreHorizontal size={17} /></button>
                {overflowOpen ? (
                  <div className="toolbar-overflow-menu">
                    {overflowActions.map((action) => (
                      <button key={action.id} className={action.active ? 'active' : ''} onClick={() => { setOverflowOpen(false); action.onClick() }}>
                        <action.icon size={15} />
                        <span>{action.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </header>
      ) : null}

      <section className="reading-stage" onClick={() => panel && setPanel(null)} onWheel={handlePageWheel}>
        {source.kind === 'text' ? (
          <TextReader key={`${settings.scriptConversion || 'none'}-${conversionReady}`} ref={readerRef} content={source.content} settings={settings} initialPage={progress.page ?? savedProgress?.page} onProgress={updateProgress} onChapters={updateChapters} onCollect={onAddNote} notes={notes} onLookupEntity={openEntityLookup} onCheckEntityProfile={checkEntityProfile} hasAnyProfile={entityProfiles.length > 0} dictEntries={dictionaryEntries.filter((item) => item.anchor?.kind === 'text')} onLookupDict={openDictionary} onOpenDictEntry={openDictEntry} />
        ) : source.kind === 'text-large' ? (
          <LargeTextReader key={`${settings.scriptConversion || 'none'}-${conversionReady}`} ref={readerRef} book={book} source={source} settings={settings} savedProgress={progress || savedProgress} onProgress={updateProgress} onChapters={updateChapters} onCollect={onAddNote} notes={notes} onLookupEntity={openEntityLookup} onCheckEntityProfile={checkEntityProfile} hasAnyProfile={entityProfiles.length > 0} dictEntries={dictionaryEntries.filter((item) => item.anchor?.kind === 'text-large')} onLookupDict={openDictionary} onOpenDictEntry={openDictEntry} />
        ) : (
          <EpubReader key={`${settings.scriptConversion || 'none'}-${conversionReady}`} ref={readerRef} data={source.data} settings={settings} fontOverride={epubFontOverride} onFontFeatures={setEpubFontFeatures} initialCfi={progress.cfi || savedProgress?.cfi} onProgress={updateProgress} onChapters={updateChapters} onShortcut={shortcut} onWheel={handlePageWheel} onCollect={onAddNote} notes={notes} onLookupEntity={openEntityLookup} onCheckEntityProfile={checkEntityProfile} hasAnyProfile={entityProfiles.length > 0} dictEntries={dictionaryEntries.filter((item) => item.anchor?.kind === 'epub')} onLookupDict={openDictionary} onOpenDictEntry={openDictEntry} onDismissPanel={() => setPanel(null)} />
        )}

        <button className="page-zone previous" onClick={() => readerRef.current?.goLeft ? readerRef.current.goLeft() : readerRef.current?.prev()} aria-label="向左翻页"><ChevronLeft size={22} /></button>
        <button className="page-zone next" onClick={() => readerRef.current?.goRight ? readerRef.current.goRight() : readerRef.current?.next()} aria-label="向右翻页"><ChevronRight size={22} /></button>
      </section>

      {immersive ? <div className="chrome-edge-trigger is-top" onMouseEnter={() => setChromeZone('top')} aria-hidden="true" /> : null}
      <div className="chrome-edge-trigger is-bottom" onMouseEnter={() => setChromeZone('bottom')} aria-hidden="true" />

      {settings.showProgress ? (
        <footer
          className={`reader-footer ${footerVisible ? 'is-visible' : ''}`}
          onMouseEnter={() => setChromeZone('bottom')}
          onMouseLeave={() => setChromeZone((current) => (current === 'bottom' ? null : current))}
          onFocusCapture={() => setChromeZone('bottom')}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setChromeZone((current) => (current === 'bottom' ? null : current)) }}
        >
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

      {companionEnabled && !companionBarSupported ? (
        <div className="companion-bar">
          <span className="companion-status"><Sparkles size={13} /> {companionGenerating ? `AI 正在陪读 · 正在总结《${companionGenerating.label}》…` : 'AI 正在陪读'}{companionGenerating ? <span className="ai-thinking"><i /><i /><i /></span> : null}</span>
          <div className="companion-actions">
            <button onClick={() => window.readerAPI.openProfilesStoryline?.()}><span className="companion-action-full">查看剧情梳理</span><span className="companion-action-short">梳理</span></button>
            <button onClick={() => window.readerAPI.openCompanionWindow?.()}><span className="companion-action-full">剧情提问</span><span className="companion-action-short">提问</span></button>
            <button onClick={stopCompanion}>停止</button>
          </div>
        </div>
      ) : null}

      {immersive ? (
        <div
          className={`immersive-topbar ${chromeZone === 'top' ? 'is-visible' : ''}`}
          onMouseDown={startChromeDrag}
          onMouseEnter={() => setChromeZone('top')}
          onMouseLeave={() => setChromeZone((current) => (current === 'top' ? null : current))}
          onFocusCapture={() => setChromeZone('top')}
          onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setChromeZone((current) => (current === 'top' ? null : current)) }}
        >
          <div className="immersive-heading">
            <strong>{book.title}</strong>
            <span title={activeChapter?.label || ''}>{activeChapter ? activeChapter.label : ' '}</span>
          </div>
          <button className="toolbar-button" onClick={onToggleImmersive} title="退出沉浸阅读 (F11)" aria-label="退出沉浸阅读"><Minimize2 size={17} /></button>
        </div>
      ) : null}
      {panel === 'settings' && !immersive ? <ReaderSettings settings={settings} onChange={setSettings} encoding={source.kind.startsWith('text') ? source.encoding : null} onEncodingChange={onEncodingChange} epubFontOverride={source.kind === 'epub' ? epubFontOverride : undefined} epubFontFeatures={epubFontFeatures} onEpubFontOverrideChange={onEpubFontOverrideChange} /> : null}
      {panel === 'toc' && !immersive ? (
        <aside className="toc-panel">
          <div className="toc-title"><List size={16} /><strong>目录</strong><span>{percent}% · {chapters.length} 章</span><button className="panel-close" onClick={() => setPanel(null)} title="关闭" aria-label="关闭面板"><X size={14} /></button></div>
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
          <div className="toc-title"><Bookmark size={16} /><strong>收藏笔记</strong><span>{notes.length} 条</span><button className="panel-close" onClick={() => setPanel(null)} title="关闭" aria-label="关闭面板"><X size={14} /></button></div>
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
          <div className="toc-title"><Bookmark size={16} /><strong>书签</strong><span>{bookmarks.length} 条</span><button className="panel-close" onClick={() => setPanel(null)} title="关闭" aria-label="关闭面板"><X size={14} /></button></div>
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
            <button type="button" className="panel-close" onClick={() => setPanel(null)} title="关闭" aria-label="关闭面板"><X size={14} /></button>
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
