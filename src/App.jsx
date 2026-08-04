import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Bookshelf from './components/Bookshelf'
import ReaderView from './components/ReaderView'
import WindowBar from './components/WindowBar'
import { useStoredState } from './hooks'

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
  const [coversMap, setCoversMap] = useStoredState('reader:covers', {})
  const [pinned, setPinned] = useStoredState('reader:pinned', false)
  const [lastBookId, setLastBookId] = useStoredState('reader:last-book', '')
  const [directoryBooks, setDirectoryBooks] = useState([])
  const [activeBook, setActiveBook] = useState(null)
  const [source, setSource] = useState(null)
  const [loading, setLoading] = useState(Boolean(directory))
  const [immersive, setImmersive] = useState(false)
  const [pendingNote, setPendingNote] = useState(null)
  const [notice, setNotice] = useState(null)
  const readerActionRef = useRef(null)

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
      setHiddenBooks((current) => current.filter((path) => !selected.some((book) => book.path === path)))
      setManualBooks((current) => {
        const merged = new Map(current.map((book) => [book.path, book]))
        selected.forEach((book) => merged.set(book.path, book))
        return [...merged.values()]
      })
    } catch (error) {
      showError('添加书籍', error)
    }
  }

  const books = useMemo(() => {
    const hidden = new Set(hiddenBooks)
    const merged = new Map()
    directoryBooks.forEach((book) => merged.set(book.path, book))
    manualBooks.forEach((book) => merged.set(book.path, book))
    return [...merged.values()].filter((book) => !hidden.has(book.path)).sort((a, b) => b.modifiedAt - a.modifiedAt)
  }, [directoryBooks, hiddenBooks, manualBooks])

  const removeBook = (book) => {
    setManualBooks((current) => current.filter((item) => item.path !== book.path))
    setHiddenBooks((current) => current.includes(book.path) ? current : [...current, book.path])
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
  }, [activeBook, setProgressMap])

  return (
    <div className={`app-shell ${immersive ? 'app-immersive' : ''}`}>
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
          onAddNote={(note) => setNotesMap((current) => ({ ...current, [activeBook.id]: [...(current[activeBook.id] || []), note] }))}
          onDeleteNote={(noteId) => setNotesMap((current) => ({ ...current, [activeBook.id]: (current[activeBook.id] || []).filter((note) => note.id !== noteId) }))}
          initialNote={pendingNote}
          onEncodingChange={changeEncoding}
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
          tagsMap={tagsMap}
          setTagsMap={setTagsMap}
          categories={categories}
          setCategories={setCategories}
          notesMap={notesMap}
          onOpenNote={openBookAtNote}
          coversMap={coversMap}
          setCoversMap={setCoversMap}
          onExportData={exportReaderData}
          onImportData={importReaderData}
        />
      )}
    </div>
  )
}
