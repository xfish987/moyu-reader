import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Bookshelf from './components/Bookshelf'
import ReaderView from './components/ReaderView'
import WindowBar from './components/WindowBar'
import { useStoredState } from './hooks'
import { mergeEntityProfiles as mergeProfiles, removeEntityProfile, setEntityIdentity, splitEntityAlias as splitAlias, upsertEntityProfile } from './entityProfiles'

const DEFAULT_SETTINGS = {
  fontFamily: 'serif',
  fontSize: 20,
  lineHeight: 1.9,
  paragraphGap: 16,
  letterSpacing: 0.5,
  pageMargin: 68,
  opacity: 0.92,
  theme: 'paper',
  showProgress: true,
  scriptConversion: 'none',
}

export default function App() {
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
  const [lastBookId, setLastBookId] = useStoredState('reader:last-book', '')
  const [statusMap, setStatusMap] = useStoredState('reader:book-status', {})
  const [bookmarksMap, setBookmarksMap] = useStoredState('reader:bookmarks', {})
  const [bookMetadata, setBookMetadata] = useStoredState('reader:book-metadata', {})
  const [entityProfilesMap, setEntityProfilesMap] = useStoredState('reader:entity-profiles', {})
  const [directoryBooks, setDirectoryBooks] = useState([])
  const [activeBook, setActiveBook] = useState(null)
  const [source, setSource] = useState(null)
  const [loading, setLoading] = useState(Boolean(directory))
  const [immersive, setImmersive] = useState(false)
  const [pendingNote, setPendingNote] = useState(null)
  const [notice, setNotice] = useState(null)
  const readerActionRef = useRef(null)
  const manualUpgradeRef = useRef(new Set())

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
    ;[setProgressMap, setTagsMap, setNotesMap, setCoversMap, setStatusMap, setBookmarksMap, setBookMetadata, setEntityProfilesMap].forEach(migrateMap)
    const currentBook = books.find((book) => (book.legacyId || book.path) === lastBookId)
    if (currentBook && currentBook.id !== lastBookId) setLastBookId(currentBook.id)
    setBookMetadata((current) => {
      const next = { ...current }
      let changed = false
      books.forEach((book) => {
        const snapshot = { id: book.id, title: book.title, author: book.author || '', format: book.format, path: book.path }
        if (JSON.stringify(next[book.id]) !== JSON.stringify(snapshot)) { next[book.id] = snapshot; changed = true }
      })
      return changed ? next : current
    })
  }, [books, lastBookId, setBookMetadata, setBookmarksMap, setCoversMap, setEntityProfilesMap, setLastBookId, setNotesMap, setProgressMap, setStatusMap, setTagsMap])

  const removeBook = (book) => {
    setManualBooks((current) => current.filter((item) => item.id !== book.id && item.path !== book.path))
    setHiddenBooks((current) => current.includes(book.id) ? current : [...current, book.id])
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
      setLastBookId(book.id)
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

  const shortcut = useCallback((event) => {
    if (!activeBook) return
    const target = event.target
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
    const key = event.key.toLowerCase()
    if (key === 'a' || key === 'arrowleft') {
      event.preventDefault()
      readerActionRef.current?.goLeft()
    } else if (key === 'd' || key === 'arrowright') {
      event.preventDefault()
      readerActionRef.current?.goRight()
    } else if (event.key === 'F11') {
      event.preventDefault()
      toggleImmersive()
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      setSettings((current) => ({ ...current, opacity: Math.min(1, +(current.opacity + 0.05).toFixed(2)) }))
    } else if (event.key === '-' || event.key === '_') {
      event.preventDefault()
      setSettings((current) => ({ ...current, opacity: Math.max(0.15, +(current.opacity - 0.05).toFixed(2)) }))
    }
  }, [activeBook, setSettings, toggleImmersive])

  useEffect(() => {
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [shortcut])

  const closeReader = () => {
    if (immersive) setImmersive(false)
    setActiveBook(null)
    setSource(null)
    setPendingNote(null)
  }

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

  return (
    <div className={`app-shell ${immersive ? 'app-immersive' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={handleDrop}>
      {notice ? <div className={`app-notice is-${notice.type}`} role="status"><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="关闭提示">×</button></div> : null}
      {!immersive ? <WindowBar pinned={pinned} onTogglePin={() => setPinned((current) => !current)} /> : null}
      {activeBook && source ? (
        <ReaderView
          book={activeBook}
          source={source}
          settings={settings}
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
          entityProfiles={entityProfilesMap[activeBook.id] || []}
          onSaveEntityProfile={saveEntityProfile}
          onUpdateEntityIdentity={updateEntityIdentity}
          onMergeEntityProfiles={mergeEntityProfiles}
          onSplitEntityAlias={splitEntityAlias}
          onDeleteEntityProfile={deleteEntityProfile}
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
        />
      )}
    </div>
  )
}
