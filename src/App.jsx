import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Bookshelf from './components/Bookshelf'
import ReaderView from './components/ReaderView'
import WindowBar from './components/WindowBar'
import ShortcutsModal from './components/ShortcutsModal'
import { useStoredState } from './hooks'
import { DEFAULT_SHORTCUTS, normalizeKey } from './shortcuts'
import { mergeEntityProfiles as mergeProfiles, removeEntityProfile, setEntityIdentity, splitEntityAlias as splitAlias, upsertEntityProfile } from './entityProfiles'
import { removeStorylineEntry, upsertStorylineEntry } from './storyline'
import AppearancePanel from './ui-b/AppearancePanel'
import BackgroundLayer from './ui-b/BackgroundLayer'
import { DEFAULT_APPEARANCE, DEFAULT_COVERS, normalizeAppearance } from './ui-b/appearance'
import VirtualBookshelfHome from './ui-b/VirtualBookshelfHome'
import { moveBeforeOrAfter } from './ui-b/shelfLayout'
import MobileAuxiliaryLayer from './components/MobileAuxiliaryLayer'

const DEFAULT_SETTINGS = {
  fontFamily: 'serif',
  fontWeight: 400,
  titleFontFamily: 'serif',
  titleFontWeight: 700,
  fontSize: 20,
  lineHeight: 1.9,
  paragraphGap: 16,
  letterSpacing: 0.5,
  pageMargin: 68,
  opacity: 0.92,
  theme: 'light',
  showProgress: true,
  scriptConversion: 'none',
}

export default function App() {
  const isMobile = Boolean(window.readerAPI?.isMobile)
  const [directory, setDirectory] = useStoredState('reader:directory', '')
  const [settings, setSettings] = useStoredState('reader:settings', DEFAULT_SETTINGS)
  const [progressMap, setProgressMap] = useStoredState('reader:progress', {})
  const [manualBooks, setManualBooks] = useStoredState('reader:manual-books', [])
  const [hiddenBooks, setHiddenBooks] = useStoredState('reader:hidden-books', [])
  const [tagsMap, setTagsMap] = useStoredState('reader:tags', {})
  const [categories, setCategories] = useStoredState('reader:categories', [])
  const [notesMap, setNotesMap] = useStoredState('reader:notes', {})
  const [coversMap, setCoversMap, coversReady] = useStoredState('reader:covers', {})
  const [pinned, setPinned] = useStoredState('reader:pinned', false)
  const [shortcuts, setShortcuts] = useStoredState('reader:shortcuts', DEFAULT_SHORTCUTS)
  const [lastBookId, setLastBookId] = useStoredState('reader:last-book', '')
  const [statusMap, setStatusMap] = useStoredState('reader:book-status', {})
  const [bookmarksMap, setBookmarksMap] = useStoredState('reader:bookmarks', {})
  const [bookMetadata, setBookMetadata] = useStoredState('reader:book-metadata', {})
  const [entityProfilesMap, setEntityProfilesMap] = useStoredState('reader:entity-profiles', {})
  const [dictionaryMap, setDictionaryMap] = useStoredState('reader:dictionary', {})
  const [companionMap, setCompanionMap] = useStoredState('reader:companion-enabled', {})
  const [companionChatsMap, setCompanionChatsMap] = useStoredState('reader:companion-chats', {})
  const [storylineMap, setStorylineMap] = useStoredState('reader:storyline', {})
  const [storedAppearance, setAppearance] = useStoredState('reader:appearance-v2', DEFAULT_APPEARANCE)
  const [recentBookIds, setRecentBookIds, recentBooksReady] = useStoredState('reader:recent-books', [])
  const [categoryBookOrder, setCategoryBookOrder] = useStoredState('reader:shelf-book-order', {})
  const [epubFontOverrides, setEpubFontOverrides] = useStoredState('reader:epub-font-overrides', {})
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const [shortcutSettingsOpen, setShortcutSettingsOpen] = useState(false)
  const [homeView, setHomeView] = useState('virtual')
  const [libraryView, setLibraryView] = useState('shelf')
  const [libraryTarget, setLibraryTarget] = useState(null)
  const [directoryBooks, setDirectoryBooks] = useState([])
  const [activeBook, setActiveBook] = useState(null)
  const [source, setSource] = useState(null)
  const [loading, setLoading] = useState(Boolean(directory))
  const [immersive, setImmersive] = useState(false)
  const [pendingNote, setPendingNote] = useState(null)
  const [notice, setNotice] = useState(null)
  const readerActionRef = useRef(null)
  const manualUpgradeRef = useRef(new Set())
  const recentSeededRef = useRef(false)
  // 主页两种视图（书脊 / 管理）共用一个滚动记忆，来回切换时恢复各自位置。
  const homeScrollRef = useRef({ virtual: 0, library: 0 })
  const appearance = useMemo(() => normalizeAppearance(storedAppearance), [storedAppearance])
  const colorTheme = appearance.theme === 'night' ? 'night' : 'light'
  const readerSettings = useMemo(() => ({ ...settings, theme: colorTheme }), [colorTheme, settings])

  useEffect(() => {
    document.documentElement.dataset.moyuTheme = colorTheme
    try { localStorage.setItem('reader:appearance-v2', JSON.stringify(appearance)) } catch {}
  }, [appearance, colorTheme])

  const mergeManualBooks = useCallback((selected) => {
    setHiddenBooks((current) => current.filter((value) => !selected.some((book) => book.path === value || book.id === value)))
    setManualBooks((current) => {
      const merged = new Map(current.map((book) => [book.id || book.path, book]))
      selected.forEach((book) => merged.set(book.id, book))
      return [...merged.values()]
    })
  }, [setHiddenBooks, setManualBooks])

  const showError = useCallback((action, error) => {
    setNotice({ type: 'error', message: `${action}失败：${error?.message || '请稍后重试'}` })
  }, [])

  const showSuccess = useCallback((message) => setNotice({ type: 'success', message }), [])

  useEffect(() => {
    const handleStorageError = (event) => setNotice({ type: 'error', message: event.detail })
    window.addEventListener('reader-error', handleStorageError)
    return () => window.removeEventListener('reader-error', handleStorageError)
  }, [])

  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(null), notice.type === 'error' ? 8000 : 4000)
    return () => clearTimeout(timer)
  }, [notice])

  const refresh = useCallback(async () => {
    if (!directory || !window.readerAPI) return
    setLoading(true)
    try {
      setDirectoryBooks(await window.readerAPI.scanDirectory(directory))
    } catch (error) {
      showError('刷新书架', error)
    } finally {
      setLoading(false)
    }
  }, [directory, showError])

  useEffect(() => { refresh() }, [refresh])
  useEffect(() => { window.readerAPI?.setPinned(pinned) }, [pinned])
  // 老板键是全局快捷键，注册在主进程：配置变化时同步过去重注册。
  useEffect(() => { window.readerAPI?.updateBossKey?.(shortcuts.boss || DEFAULT_SHORTCUTS.boss) }, [shortcuts.boss])
  useEffect(() => {
    if (settings.showProgress === undefined) setSettings((current) => ({ ...current, showProgress: true }))
  }, [setSettings, settings.showProgress])

  const chooseDirectory = async () => {
    try {
      const result = await window.readerAPI?.chooseDirectory()
      if (!result) return
      setDirectory(result.directory)
      setDirectoryBooks(result.books)
    } catch (error) {
      showError('读取书籍目录', error)
    }
  }

  const addBooks = async () => {
    try {
      const selected = await window.readerAPI?.chooseBooks()
      if (!selected?.length) return
      mergeManualBooks(selected)
    } catch (error) {
      showError('添加书籍', error)
    }
  }

  const books = useMemo(() => {
    const hidden = new Set(hiddenBooks)
    const merged = new Map()
    directoryBooks.forEach((book) => merged.set(book.id || book.path, book))
    manualBooks.forEach((book) => merged.set(book.id || book.path, book))
    return [...merged.values()].filter((book) => !hidden.has(book.path) && !hidden.has(book.id)).sort((a, b) => b.modifiedAt - a.modifiedAt)
  }, [directoryBooks, hiddenBooks, manualBooks])

  useEffect(() => {
    if (!window.readerAPI?.describeBookPaths) return
    const legacy = manualBooks.filter((book) => !book.fingerprint && book.path && !manualUpgradeRef.current.has(book.path))
    if (!legacy.length) return
    legacy.forEach((book) => manualUpgradeRef.current.add(book.path))
    window.readerAPI.describeBookPaths(legacy.map((book) => book.path)).then((upgraded) => {
      if (!upgraded.length) return
      const byPath = new Map(upgraded.map((book) => [book.path, book]))
      setManualBooks((current) => current.map((book) => byPath.get(book.path) || book))
    }).catch(() => {})
  }, [manualBooks, setManualBooks])

  useEffect(() => {
    if (!books.length) return
    const migrateMap = (setter) => setter((current) => {
      let changed = false
      const next = { ...current }
      books.forEach((book) => {
        const legacy = book.legacyId || book.path
        if (legacy !== book.id && Object.prototype.hasOwnProperty.call(next, legacy) && !Object.prototype.hasOwnProperty.call(next, book.id)) {
          next[book.id] = next[legacy]
          delete next[legacy]
          changed = true
        }
      })
      return changed ? next : current
    })
    ;[setProgressMap, setTagsMap, setNotesMap, setCoversMap, setStatusMap, setBookmarksMap, setBookMetadata, setEntityProfilesMap, setDictionaryMap, setCompanionMap, setCompanionChatsMap, setStorylineMap].forEach(migrateMap)
    const currentBook = books.find((book) => (book.legacyId || book.path) === lastBookId)
    if (currentBook && currentBook.id !== lastBookId) setLastBookId(currentBook.id)
    const migrateId = (id) => books.find((book) => book.id === id || (book.legacyId || book.path) === id)?.id || id
    setRecentBookIds((current) => {
      const next = [...new Set(current.map(migrateId))]
      return next.some((id, index) => id !== current[index]) || next.length !== current.length ? next : current
    })
    setCategoryBookOrder((current) => {
      let changed = false
      const next = Object.fromEntries(Object.entries(current).map(([category, ids]) => {
        const migrated = [...new Set((Array.isArray(ids) ? ids : []).map(migrateId))]
        if (migrated.length !== (ids || []).length || migrated.some((id, index) => id !== ids[index])) changed = true
        return [category, migrated]
      }))
      return changed ? next : current
    })
    setBookMetadata((current) => {
      const next = { ...current }
      let changed = false
      books.forEach((book) => {
        const snapshot = { id: book.id, title: book.title, author: book.author || '', format: book.format, path: book.path }
        if (JSON.stringify(next[book.id]) !== JSON.stringify(snapshot)) { next[book.id] = snapshot; changed = true }
      })
      return changed ? next : current
    })
  }, [books, lastBookId, setBookMetadata, setBookmarksMap, setCategoryBookOrder, setCompanionChatsMap, setCompanionMap, setCoversMap, setDictionaryMap, setEntityProfilesMap, setLastBookId, setNotesMap, setProgressMap, setRecentBookIds, setStatusMap, setStorylineMap, setTagsMap])

  useEffect(() => {
    if (!recentBooksReady || loading || recentSeededRef.current) return
    recentSeededRef.current = true
    const bookIds = new Set(books.map((book) => book.id))
    setRecentBookIds((current) => {
      const valid = [...new Set(current)].filter((id) => bookIds.has(id))
      if (valid.length) return valid
      const legacy = books.filter((book) => progressMap[book.id]?.updatedAt).sort((a, b) => progressMap[b.id].updatedAt - progressMap[a.id].updatedAt).map((book) => book.id)
      if (lastBookId && bookIds.has(lastBookId)) return [lastBookId, ...legacy.filter((id) => id !== lastBookId)]
      return legacy
    })
  }, [books, lastBookId, loading, progressMap, recentBooksReady, setRecentBookIds])

  const removeBook = (book) => {
    setManualBooks((current) => current.filter((item) => item.id !== book.id && item.path !== book.path))
    setHiddenBooks((current) => current.includes(book.id) ? current : [...current, book.id])
    // 书籍删除时，字典百科解释、设定集与 AI 陪读数据随这本书的阅读数据一起消失。
    setDictionaryMap((current) => { if (!(book.id in current)) return current; const next = { ...current }; delete next[book.id]; return next })
    setEntityProfilesMap((current) => { if (!(book.id in current)) return current; const next = { ...current }; delete next[book.id]; return next })
    setCompanionMap((current) => { if (!(book.id in current)) return current; const next = { ...current }; delete next[book.id]; return next })
    setCompanionChatsMap((current) => { if (!(book.id in current)) return current; const next = { ...current }; delete next[book.id]; return next })
    setStorylineMap((current) => { if (!(book.id in current)) return current; const next = { ...current }; delete next[book.id]; return next })
    setRecentBookIds((current) => current.filter((id) => id !== book.id))
    setCategoryBookOrder((current) => Object.fromEntries(Object.entries(current).map(([category, ids]) => [category, ids.filter((id) => id !== book.id)])))
  }

  const relocateBook = async (book) => {
    try {
      const replacement = await window.readerAPI.relocateBook(book)
      if (!replacement) return false
      setManualBooks((current) => [...current.filter((item) => item.id !== book.id), replacement])
      if (replacement.id !== book.id) showSuccess('已作为新书添加，原阅读数据仍保留')
      else showSuccess('书籍位置已更新')
      return true
    } catch (error) {
      showError('重新定位书籍', error)
      return false
    }
  }

  const deleteSource = async (book) => {
    try {
      await window.readerAPI.deleteSource(book.path)
      removeBook(book)
      showSuccess('源文件已移入回收站')
      return true
    } catch (error) {
      showError('删除源文件', error)
      return false
    }
  }

  const openBook = async (book) => {
    setLoading(true)
    try {
      const nextSource = await window.readerAPI.openBook(book.path)
      setActiveBook(book)
      setSource(nextSource)
      if (isMobile) setImmersive(true)
      setLastBookId(book.id)
      setRecentBookIds((current) => [book.id, ...current.filter((id) => id !== book.id)])
      return true
    } catch (error) {
      showError(`打开《${book.title}》`, error)
      return false
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => window.readerAPI?.onExternalBooks?.((incoming) => {
    if (!incoming?.length) return
    mergeManualBooks(incoming)
    openBook(incoming[0])
  }), [mergeManualBooks])

  const handleDrop = async (event) => {
    event.preventDefault()
    if (!event.dataTransfer.files?.length) return
    try {
      const paths = [...event.dataTransfer.files].map((file) => window.readerAPI.getPathForFile(file)).filter(Boolean)
      const incoming = await window.readerAPI.describeBookPaths(paths)
      if (!incoming.length) return
      mergeManualBooks(incoming)
      showSuccess(`已添加 ${incoming.length} 本书`)
    } catch (error) {
      showError('拖放添加书籍', error)
    }
  }

  const openBookAtNote = async (book, note) => {
    setPendingNote(note)
    if (!await openBook(book)) setPendingNote(null)
  }

  const changeEncoding = async (encoding) => {
    if (!activeBook) return
    try {
      setSource(await window.readerAPI.openBook(activeBook.path, encoding))
    } catch (error) {
      showError('切换文本编码', error)
    }
  }

  const exportReaderData = async () => {
    try {
      const filePath = await window.readerAPI.exportReaderData()
      if (filePath) showSuccess(`阅读数据已导出到 ${filePath}`)
    } catch (error) {
      showError('导出阅读数据', error)
    }
  }

  const importReaderData = async () => {
    try {
      const result = await window.readerAPI.importReaderData()
      if (result) window.location.reload()
    } catch (error) {
      showError('导入阅读数据', error)
    }
  }

  const toggleImmersive = useCallback(() => setImmersive((current) => !current), [])

  // 清空本地书架数据，但绝不调用源文件删除接口。
  const clearReadingData = () => {
    if (!window.confirm('将清空书架、目录记忆、分类、阅读进度、笔记、自定义封面与 AI 衍生数据。源文件不会被删除。确定清理吗？')) return
    setDirectory('')
    setDirectoryBooks([])
    setManualBooks([])
    setHiddenBooks([])
    setTagsMap({})
    setCategories([])
    setCategoryBookOrder({})
    setEpubFontOverrides({})
    setProgressMap({})
    setStatusMap({})
    setNotesMap({})
    setBookmarksMap({})
    setBookMetadata({})
    setCoversMap({})
    setEntityProfilesMap({})
    setDictionaryMap({})
    setCompanionMap({})
    setCompanionChatsMap({})
    setStorylineMap({})
    setLastBookId('')
    setRecentBookIds([])
    showSuccess('全部本地书架数据已清空，源文件未删除')
  }

  const shortcut = useCallback((event) => {
    const pressed = normalizeKey(event)
    if (!pressed) return
    const target = event.target
    // 输入框中不拦截字母键（要打字），功能键（F1–F12）照常生效。
    if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && !pressed.startsWith('F')) return
    if (pressed === (shortcuts.toggleProfiles || 'F1')) {
      event.preventDefault()
      window.readerAPI?.toggleProfilesWindow?.()
      return
    }
    if (!activeBook) return
    if (pressed === (shortcuts.startCompanion || 'F2')) {
      event.preventDefault()
      setCompanionMap((current) => current[activeBook.id] ? current : { ...current, [activeBook.id]: true })
    } else if (pressed === (shortcuts.stopCompanion || 'F3')) {
      event.preventDefault()
      setCompanionMap((current) => current[activeBook.id] ? { ...current, [activeBook.id]: false } : current)
    } else if (pressed === (shortcuts.prevPage || 'a') || event.key === 'ArrowLeft') {
      event.preventDefault()
      readerActionRef.current?.goLeft()
    } else if (pressed === (shortcuts.nextPage || 'd') || event.key === 'ArrowRight') {
      event.preventDefault()
      readerActionRef.current?.goRight()
    } else if (pressed === (shortcuts.immersive || 'F11')) {
      event.preventDefault()
      toggleImmersive()
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setSettings((current) => ({ ...current, opacity: Math.min(1, +(current.opacity + 0.05).toFixed(2)) }))
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      setSettings((current) => ({ ...current, opacity: Math.max(0.15, +(current.opacity - 0.05).toFixed(2)) }))
    }
  }, [activeBook, setCompanionMap, setSettings, shortcuts, toggleImmersive])

  useEffect(() => {
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [shortcut])

  const closeReader = () => {
    if (immersive) setImmersive(false)
    setActiveBook(null)
    setSource(null)
    setPendingNote(null)
    setHomeView('virtual')
  }

  useEffect(() => {
    if (!isMobile) return undefined
    window.readerAPI?.setReadingMode?.(Boolean(activeBook))
    return () => window.readerAPI?.setReadingMode?.(false)
  }, [activeBook, isMobile])

  useEffect(() => {
    if (!isMobile) return undefined
    const handleBack = (event) => {
      if (event.defaultPrevented || window.__moyuAuxOpen) return
      if (activeBook) {
        event.preventDefault()
        closeReader()
      }
    }
    window.addEventListener('moyu:android-back', handleBack)
    return () => window.removeEventListener('moyu:android-back', handleBack)
  }, [activeBook, isMobile])

  const saveProgress = useCallback((nextProgress) => {
    if (!activeBook) return
    setProgressMap((current) => ({ ...current, [activeBook.id]: { ...nextProgress, updatedAt: Date.now() } }))
    setStatusMap((current) => current[activeBook.id] ? current : { ...current, [activeBook.id]: 'reading' })
  }, [activeBook, setProgressMap, setStatusMap])

  const saveEntityProfile = useCallback((profile) => {
    if (!activeBook || !profile) return
    setEntityProfilesMap((current) => {
      return { ...current, [activeBook.id]: upsertEntityProfile(current[activeBook.id] || [], profile) }
    })
  }, [activeBook, setEntityProfilesMap])

  const updateEntityIdentity = useCallback((profileId, identity) => {
    if (!activeBook) return
    setEntityProfilesMap((current) => ({ ...current, [activeBook.id]: setEntityIdentity(current[activeBook.id] || [], profileId, identity) }))
  }, [activeBook, setEntityProfilesMap])

  const mergeEntityProfiles = useCallback((targetId, sourceId) => {
    if (!activeBook || targetId === sourceId) return
    setEntityProfilesMap((current) => {
      return { ...current, [activeBook.id]: mergeProfiles(current[activeBook.id] || [], targetId, sourceId) }
    })
  }, [activeBook, setEntityProfilesMap])

  const splitEntityAlias = useCallback((profileId, alias) => {
    if (!activeBook || !alias) return
    setEntityProfilesMap((current) => {
      return { ...current, [activeBook.id]: splitAlias(current[activeBook.id] || [], profileId, alias) }
    })
  }, [activeBook, setEntityProfilesMap])

  const deleteEntityProfile = useCallback((profileId) => {
    if (!activeBook) return
    setEntityProfilesMap((current) => ({ ...current, [activeBook.id]: removeEntityProfile(current[activeBook.id] || [], profileId) }))
  }, [activeBook, setEntityProfilesMap])

  const saveDictEntry = useCallback((entry) => {
    if (!activeBook || !entry) return
    setDictionaryMap((current) => {
      const list = current[activeBook.id] || []
      const index = list.findIndex((item) => item.id === entry.id)
      const next = index >= 0 ? list.map((item) => (item.id === entry.id ? entry : item)) : [...list, entry]
      return { ...current, [activeBook.id]: next }
    })
  }, [activeBook, setDictionaryMap])

  const deleteDictEntry = useCallback((entryId) => {
    if (!activeBook || !entryId) return
    setDictionaryMap((current) => {
      const list = current[activeBook.id] || []
      return { ...current, [activeBook.id]: list.filter((item) => item.id !== entryId) }
    })
  }, [activeBook, setDictionaryMap])

  const reorderCategories = useCallback((source, target, position) => {
    setCategories((current) => moveBeforeOrAfter(current, source, target, position))
  }, [setCategories])

  const openLibraryTarget = useCallback((row) => {
    setLibraryView('shelf')
    setLibraryTarget({
      kind: row?.managementKey || (row?.key === 'recent' ? 'recent' : row?.reorderable ? 'category' : 'all'),
      category: row?.managementKey === 'category' || row?.reorderable ? row.key : '',
      nonce: Date.now(),
    })
    setHomeView('library')
  }, [])

  const toggleAppearanceTheme = useCallback(() => setAppearance((current) => {
    const normalized = normalizeAppearance(current)
    return { ...normalized, theme: normalized.theme === 'night' ? 'mist' : 'night', activeSchemeId: '' }
  }), [setAppearance])

  const appearanceStyle = {
    '--b-topbar-color': appearance.bars.top.color,
    '--b-topbar-opacity': `${appearance.bars.top.opacity * 100}%`,
    '--b-topbar-icon-color': appearance.bars.top.iconColor,
    '--b-topbar-icon-opacity': appearance.bars.top.iconOpacity,
    '--b-bottombar-color': appearance.bars.bottom.color,
    '--b-bottombar-opacity': `${appearance.bars.bottom.opacity * 100}%`,
    '--b-bottombar-icon-color': appearance.bars.bottom.iconColor,
    '--b-bottombar-icon-opacity': appearance.bars.bottom.iconOpacity,
    '--b-theme-circle-color': appearance.bars.bottom.circleColor,
    '--b-theme-circle-opacity': appearance.bars.bottom.circleOpacity,
    '--b-theme-sun-start': appearance.bars.bottom.sunStartColor,
    '--b-theme-sun-end': appearance.bars.bottom.sunEndColor,
    '--b-theme-sun-opacity': appearance.bars.bottom.sunOpacity,
    '--b-theme-moon-start': appearance.bars.bottom.moonStartColor,
    '--b-theme-moon-end': appearance.bars.bottom.moonEndColor,
    '--b-theme-moon-opacity': appearance.bars.bottom.moonOpacity,
  }

  return (
    <div className={`app-shell ui-b ui-b-theme-${appearance.theme} ${!immersive ? 'has-designed-titlebar' : ''} ${!activeBook && homeView === 'virtual' ? 'is-virtual-home' : ''} ${!activeBook && homeView === 'library' ? 'is-library-home' : ''} ${activeBook && !immersive ? 'is-reader' : ''} ${immersive ? 'app-immersive' : ''} ${activeBook ? `theme-${colorTheme}` : ''}`} style={appearanceStyle} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      <BackgroundLayer scope={activeBook ? 'reader' : 'home'} preference={activeBook ? appearance.reader : appearance.home} theme={appearance.theme} />
      {notice ? <div className={`app-notice is-${notice.type}`} role="status"><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div> : null}
      {!immersive && !isMobile ? <WindowBar onOpenShortcuts={() => setShortcutSettingsOpen(true)} appearanceTheme={appearance.theme} onToggleTheme={activeBook ? toggleAppearanceTheme : null} /> : null}
      {activeBook && source ? (
        <ReaderView
          book={activeBook}
          source={source}
          settings={readerSettings}
          setSettings={setSettings}
          savedProgress={progressMap[activeBook.id]}
          immersive={immersive}
          onBack={closeReader}
          onToggleImmersive={toggleImmersive}
          onProgress={saveProgress}
          shortcut={shortcut}
          actionRef={readerActionRef}
          notes={notesMap[activeBook.id] || []}
          bookmarks={bookmarksMap[activeBook.id] || []}
          onAddBookmark={(bookmark) => setBookmarksMap((current) => ({ ...current, [activeBook.id]: [...(current[activeBook.id] || []), bookmark] }))}
          onDeleteBookmark={(bookmarkId) => setBookmarksMap((current) => ({ ...current, [activeBook.id]: (current[activeBook.id] || []).filter((item) => item.id !== bookmarkId) }))}
          onAddNote={(note) => setNotesMap((current) => ({ ...current, [activeBook.id]: [...(current[activeBook.id] || []), note] }))}
          onDeleteNote={(noteId) => setNotesMap((current) => ({ ...current, [activeBook.id]: (current[activeBook.id] || []).filter((note) => note.id !== noteId) }))}
          initialNote={pendingNote}
          onEncodingChange={changeEncoding}
          epubFontOverride={epubFontOverrides[activeBook.id] || null}
          onEpubFontOverrideChange={(nextValue) => setEpubFontOverrides((current) => {
            const next = typeof nextValue === 'function' ? nextValue(current[activeBook.id] || null) : nextValue
            if (next) return { ...current, [activeBook.id]: next }
            const remaining = { ...current }
            delete remaining[activeBook.id]
            return remaining
          })}
          entityProfiles={entityProfilesMap[activeBook.id] || []}
          onSaveEntityProfile={saveEntityProfile}
          onUpdateEntityIdentity={updateEntityIdentity}
          onMergeEntityProfiles={mergeEntityProfiles}
          onSplitEntityAlias={splitEntityAlias}
          onDeleteEntityProfile={deleteEntityProfile}
          dictionaryEntries={dictionaryMap[activeBook.id] || []}
          onSaveDictEntry={saveDictEntry}
          onDeleteDictEntry={deleteDictEntry}
          companionEnabled={Boolean(companionMap[activeBook.id])}
          onToggleCompanion={() => setCompanionMap((current) => ({ ...current, [activeBook.id]: !current[activeBook.id] }))}
          companionChats={companionChatsMap[activeBook.id] || []}
          onSaveCompanionChats={(sessions) => setCompanionChatsMap((current) => ({ ...current, [activeBook.id]: sessions }))}
          storylineEntries={storylineMap[activeBook.id] || []}
          onSaveStorylineEntry={(entry) => setStorylineMap((current) => ({ ...current, [activeBook.id]: upsertStorylineEntry(current[activeBook.id] || [], entry) }))}
          onDeleteStorylineEntry={(entryId) => setStorylineMap((current) => ({ ...current, [activeBook.id]: removeStorylineEntry(current[activeBook.id] || [], entryId) }))}
        />
      ) : homeView === 'virtual' ? (
        <VirtualBookshelfHome
          books={books}
          progressMap={progressMap}
          statusMap={statusMap}
          coversMap={coversMap}
          defaultCover={appearance.theme === 'night' ? DEFAULT_COVERS.dark : DEFAULT_COVERS.light}
          categories={categories}
          tagsMap={tagsMap}
          categoryBookOrder={categoryBookOrder}
          recentBookIds={recentBookIds}
          onOpen={openBook}
          onAddBooks={addBooks}
          onOpenLibrary={openLibraryTarget}
          onOpenNotes={() => { setLibraryView('notes'); setHomeView('library') }}
          onSearch={() => { setLibraryView('shelf'); setHomeView('library'); setTimeout(() => document.querySelector('.shelf-search input')?.focus(), 80) }}
          onOpenAppearance={() => setAppearanceOpen(true)}
          onChooseDirectory={chooseDirectory}
          onClearAllData={clearReadingData}
          onToggleTheme={toggleAppearanceTheme}
          onReorderCategories={reorderCategories}
          scrollMemory={homeScrollRef.current}
        />
      ) : (
        <Bookshelf
          books={books}
          directory={directory}
          progressMap={progressMap}
          loading={loading}
          onChooseDirectory={chooseDirectory}
          onAddBooks={addBooks}
          onRefresh={refresh}
          onOpen={openBook}
          lastBookId={lastBookId}
          onRemove={removeBook}
          onDeleteSource={deleteSource}
          onRelocate={relocateBook}
          tagsMap={tagsMap}
          setTagsMap={setTagsMap}
          categories={categories}
          setCategories={setCategories}
          notesMap={notesMap}
          onOpenNote={openBookAtNote}
          coversMap={coversMap}
          setCoversMap={setCoversMap}
          coversReady={coversReady}
          onExportData={exportReaderData}
          onImportData={importReaderData}
          statusMap={statusMap}
          setStatusMap={setStatusMap}
          onUpdateNote={(bookId, noteId, comment) => setNotesMap((current) => ({ ...current, [bookId]: (current[bookId] || []).map((note) => note.id === noteId ? { ...note, comment, updatedAt: Date.now() } : note) }))}
          onExportNotes={async (book, notes) => {
            try {
              const filePath = await window.readerAPI.exportNotes({ title: book?.title || '全部阅读笔记', notes })
              if (filePath) showSuccess(`笔记已导出到 ${filePath}`)
            } catch (error) { showError('导出笔记', error) }
          }}
          bookMetadata={bookMetadata}
          shortcuts={shortcuts}
          setShortcuts={setShortcuts}
          defaultCover={appearance.theme === 'night' ? DEFAULT_COVERS.dark : DEFAULT_COVERS.light}
          initialView={libraryView}
          onViewChange={setLibraryView}
          onOpenVirtualHome={() => setHomeView('virtual')}
          onOpenAppearance={() => setAppearanceOpen(true)}
          onToggleTheme={toggleAppearanceTheme}
          appearanceTheme={appearance.theme}
          scrollMemory={homeScrollRef.current}
          onClearReadingData={clearReadingData}
          recentBookIds={recentBookIds}
          categoryBookOrder={categoryBookOrder}
          setCategoryBookOrder={setCategoryBookOrder}
          navigationTarget={libraryTarget}
          onReorderCategories={reorderCategories}
        />
      )}
      {appearanceOpen ? <AppearancePanel appearance={appearance} onChange={setAppearance} onClose={() => setAppearanceOpen(false)} /> : null}
      {shortcutSettingsOpen ? <ShortcutsModal shortcuts={shortcuts} setShortcuts={setShortcuts} onClose={() => setShortcutSettingsOpen(false)} /> : null}
      {isMobile ? <MobileAuxiliaryLayer /> : null}
    </div>
  )
}
