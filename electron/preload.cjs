const { contextBridge, ipcRenderer, webUtils } = require('electron')

contextBridge.exposeInMainWorld('readerAPI', {
  chooseDirectory: () => ipcRenderer.invoke('books:choose-directory'),
  chooseBooks: () => ipcRenderer.invoke('books:choose-files'),
  describeBookPaths: (paths) => ipcRenderer.invoke('books:describe-paths', paths),
  relocateBook: (book) => ipcRenderer.invoke('books:relocate', book),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  scanDirectory: (directory) => ipcRenderer.invoke('books:scan-directory', directory),
  getEpubCover: (filePath) => ipcRenderer.invoke('books:get-epub-cover', filePath),
  openBook: (filePath, encoding) => ipcRenderer.invoke('books:open', filePath, encoding),
  readTextChunk: (filePath, offset, direction) => ipcRenderer.invoke('books:read-text-chunk', { filePath, offset, direction }),
  getTextToc: (filePath) => ipcRenderer.invoke('books:get-text-toc', filePath),
  searchText: (filePath, query, options) => ipcRenderer.invoke('books:search-text', { filePath, query, ...(options || {}) }),
  deleteSource: (filePath) => ipcRenderer.invoke('books:delete-source', filePath),
  saveShareImage: (payload) => ipcRenderer.invoke('notes:save-share', payload),
  exportNotes: (payload) => ipcRenderer.invoke('notes:export-markdown', payload),
  openSelectionMenu: (options) => ipcRenderer.invoke('reader:selection-menu', options),
  getAiSettings: () => ipcRenderer.invoke('ai:get-settings'),
  saveAiProvider: (provider) => ipcRenderer.invoke('ai:save-provider', provider),
  deleteAiProvider: (providerId) => ipcRenderer.invoke('ai:delete-provider', providerId),
  refreshAiProvider: (providerId) => ipcRenderer.invoke('ai:refresh-provider', providerId),
  saveAiPreferences: (preferences) => ipcRenderer.invoke('ai:save-preferences', preferences),
  summarizeEntity: (payload) => ipcRenderer.invoke('ai:summarize-entity', payload),
  onAiSummaryProgress: (listener) => {
    const wrapped = (_event, payload) => listener(payload)
    ipcRenderer.on('ai:summary-progress', wrapped)
    return () => ipcRenderer.removeListener('ai:summary-progress', wrapped)
  },
  getStoredValue: (key) => ipcRenderer.invoke('storage:get', key),
  setStoredValue: (key, value) => ipcRenderer.invoke('storage:set', key, value),
  exportReaderData: () => ipcRenderer.invoke('storage:export'),
  importReaderData: () => ipcRenderer.invoke('storage:import'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  setPinned: (enabled) => ipcRenderer.send('window:pin', enabled),
  onExternalBooks: (callback) => {
    const listener = (_event, books) => callback(books)
    ipcRenderer.on('books:open-external', listener)
    return () => ipcRenderer.removeListener('books:open-external', listener)
  },
  onMaximized: (callback) => {
    const listener = (_event, maximized) => callback(maximized)
    ipcRenderer.on('window:maximized', listener)
    return () => ipcRenderer.removeListener('window:maximized', listener)
  },
})
