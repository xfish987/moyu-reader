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
  dictionaryChat: (payload) => ipcRenderer.invoke('ai:dictionary-chat', payload),
  companionSummary: (payload) => ipcRenderer.invoke('ai:companion-summary', payload),
  companionChat: (payload) => ipcRenderer.invoke('ai:companion-chat', payload),
  openDictionaryWindow: (entryId) => ipcRenderer.invoke('dict:open', entryId || ''),
  closeDictionaryWindow: () => ipcRenderer.send('dict:close'),
  sendDictSync: (snapshot) => ipcRenderer.send('dict:sync', snapshot),
  onDictSync: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('dict:sync', listener)
    return () => ipcRenderer.removeListener('dict:sync', listener)
  },
  onDictSyncRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('dict:request-sync', listener)
    return () => ipcRenderer.removeListener('dict:request-sync', listener)
  },
  sendDictAction: (action) => ipcRenderer.send('dict:action', action),
  onDictAction: (callback) => {
    const listener = (_event, action) => callback(action)
    ipcRenderer.on('dict:action', listener)
    return () => ipcRenderer.removeListener('dict:action', listener)
  },
  onDictFocus: (callback) => {
    const listener = (_event, entryId) => callback(entryId)
    ipcRenderer.on('dict:focus', listener)
    return () => ipcRenderer.removeListener('dict:focus', listener)
  },
  openCompanionWindow: () => ipcRenderer.send('companion:open'),
  sendCompanionSync: (snapshot) => ipcRenderer.send('companion:sync', snapshot),
  onCompanionSync: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('companion:sync', listener)
    return () => ipcRenderer.removeListener('companion:sync', listener)
  },
  onCompanionSyncRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('companion:request-sync', listener)
    return () => ipcRenderer.removeListener('companion:request-sync', listener)
  },
  sendCompanionAction: (action) => ipcRenderer.send('companion:action', action),
  onCompanionAction: (callback) => {
    const listener = (_event, action) => callback(action)
    ipcRenderer.on('companion:action', listener)
    return () => ipcRenderer.removeListener('companion:action', listener)
  },
  openProfilesStoryline: () => ipcRenderer.send('profiles:open-storyline'),
  // AI 陪读状态栏（阅读窗底部外侧的独立小窗口）
  setCompanionBarVisible: (visible) => ipcRenderer.send('companion-bar:toggle', Boolean(visible)),
  sendCompanionBarSync: (snapshot) => ipcRenderer.send('companion-bar:sync', snapshot),
  onCompanionBarSync: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('companion-bar:sync', listener)
    return () => ipcRenderer.removeListener('companion-bar:sync', listener)
  },
  onCompanionBarSyncRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('companion-bar:request-sync', listener)
    return () => ipcRenderer.removeListener('companion-bar:request-sync', listener)
  },
  sendCompanionBarAction: (action) => ipcRenderer.send('companion-bar:action', action),
  onCompanionBarAction: (callback) => {
    const listener = (_event, action) => callback(action)
    ipcRenderer.on('companion-bar:action', listener)
    return () => ipcRenderer.removeListener('companion-bar:action', listener)
  },
  repairProfileJson: (payload) => ipcRenderer.invoke('ai:repair-profile-json', payload),
  openProfilesWindow: (focusName) => ipcRenderer.invoke('profiles:open', focusName || ''),
  toggleProfilesWindow: () => ipcRenderer.invoke('profiles:toggle'),
  collapseProfilesWindow: () => ipcRenderer.send('profiles:collapse'),
  expandProfilesWindow: () => ipcRenderer.send('profiles:expand'),
  dragProfilesFab: (delta) => ipcRenderer.send('profiles:fab-drag', delta),
  dragProfilesFabEnd: () => ipcRenderer.send('profiles:fab-drag-end'),
  sendProfilesSync: (snapshot) => ipcRenderer.send('profiles:sync', snapshot),
  onProfilesSync: (callback) => {
    const listener = (_event, snapshot) => callback(snapshot)
    ipcRenderer.on('profiles:sync', listener)
    return () => ipcRenderer.removeListener('profiles:sync', listener)
  },
  onProfilesSyncRequest: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('profiles:request-sync', listener)
    return () => ipcRenderer.removeListener('profiles:request-sync', listener)
  },
  sendProfilesAction: (action) => ipcRenderer.send('profiles:action', action),
  onProfilesAction: (callback) => {
    const listener = (_event, action) => callback(action)
    ipcRenderer.on('profiles:action', listener)
    return () => ipcRenderer.removeListener('profiles:action', listener)
  },
  onProfilesFocus: (callback) => {
    const listener = (_event, name) => callback(name)
    ipcRenderer.on('profiles:focus', listener)
    return () => ipcRenderer.removeListener('profiles:focus', listener)
  },
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
  startWindowDrag: (payload) => ipcRenderer.send('window:drag-start', payload),
  dragWindowMove: (payload) => ipcRenderer.send('window:drag-move', payload),
  endWindowDrag: () => ipcRenderer.send('window:drag-end'),
  setPinned: (enabled) => ipcRenderer.send('window:pin', enabled),
  updateBossKey: (key) => ipcRenderer.send('shortcuts:boss-key', key),
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
