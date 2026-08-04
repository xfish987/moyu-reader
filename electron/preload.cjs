const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('readerAPI', {
  chooseDirectory: () => ipcRenderer.invoke('books:choose-directory'),
  chooseBooks: () => ipcRenderer.invoke('books:choose-files'),
  scanDirectory: (directory) => ipcRenderer.invoke('books:scan-directory', directory),
  getEpubCover: (filePath) => ipcRenderer.invoke('books:get-epub-cover', filePath),
  openBook: (filePath, encoding) => ipcRenderer.invoke('books:open', filePath, encoding),
  readTextChunk: (filePath, offset, direction) => ipcRenderer.invoke('books:read-text-chunk', { filePath, offset, direction }),
  getTextToc: (filePath) => ipcRenderer.invoke('books:get-text-toc', filePath),
  searchText: (filePath, query) => ipcRenderer.invoke('books:search-text', { filePath, query }),
  deleteSource: (filePath) => ipcRenderer.invoke('books:delete-source', filePath),
  saveShareImage: (payload) => ipcRenderer.invoke('notes:save-share', payload),
  getStoredValue: (key) => ipcRenderer.invoke('storage:get', key),
  setStoredValue: (key, value) => ipcRenderer.invoke('storage:set', key, value),
  exportReaderData: () => ipcRenderer.invoke('storage:export'),
  importReaderData: () => ipcRenderer.invoke('storage:import'),
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  setPinned: (enabled) => ipcRenderer.send('window:pin', enabled),
})
