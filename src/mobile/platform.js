import { Capacitor, registerPlugin } from '@capacitor/core'
import { App as CapacitorApp } from '@capacitor/app'
import { Share } from '@capacitor/share'
import { StatusBar, Style } from '@capacitor/status-bar'
import { createMobileAiApi } from './ai'
import { createMobileBookApi, mobileState } from './books'

const native = registerPlugin('MoyuNative')
const snapshots = { profiles: null, dictionary: null, companion: null }
const listeners = new Map()

export const isMobileRuntime = Capacitor.isNativePlatform() || new URLSearchParams(window.location.search).get('mobile') === '1'

function listen(channel, callback) {
  const set = listeners.get(channel) || new Set()
  set.add(callback)
  listeners.set(channel, set)
  return () => set.delete(callback)
}

function emit(channel, payload) {
  for (const callback of listeners.get(channel) || []) callback(payload)
}

function openAuxiliary(kind, focus) {
  window.dispatchEvent(new CustomEvent('moyu:aux-open', { detail: { kind } }))
  queueMicrotask(() => {
    if (kind === 'profiles') {
      emit('profiles:sync', snapshots.profiles)
      emit('profiles:focus', focus)
      emit('profiles:request-sync')
    } else if (kind === 'dictionary') {
      emit('dictionary:sync', snapshots.dictionary)
      if (focus) emit('dictionary:focus', focus)
      emit('dictionary:request-sync')
    } else if (kind === 'companion') {
      emit('companion:sync', snapshots.companion)
      emit('companion:request-sync')
    }
  })
  return true
}

function closeAuxiliary() {
  window.dispatchEvent(new CustomEvent('moyu:aux-close'))
}

function actionSheet(options = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div')
    backdrop.className = 'mobile-action-backdrop'
    const sheet = document.createElement('div')
    sheet.className = 'mobile-action-sheet'
    sheet.setAttribute('role', 'dialog')
    sheet.setAttribute('aria-modal', 'true')
    const heading = document.createElement('strong')
    heading.textContent = '选中文字'
    sheet.appendChild(heading)
    const choices = [
      ['copy', '复制'],
      ['note', '添加笔记 / 评论'],
      ['dictionary', '字典百科'],
      ...(options.canLookupEntity ? [
        ['view-entity', '查看资料', !options.hasEntityProfile],
        ['lookup-entity', options.hasEntityProfile ? '更新资料' : '生成资料'],
        ['link-entity', '关联到已有资料', !options.hasAnyProfile],
      ] : []),
    ]
    let settled = false
    const finish = (value) => {
      if (settled) return
      settled = true
      backdrop.remove()
      resolve(value)
    }
    for (const [value, label, disabled] of choices) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = label
      button.disabled = Boolean(disabled)
      button.addEventListener('click', () => {
        if (value === 'copy') navigator.clipboard?.writeText(window.getSelection()?.toString() || '').catch(() => {})
        finish(value)
      })
      sheet.appendChild(button)
    }
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'is-cancel'
    cancel.textContent = '取消'
    cancel.addEventListener('click', () => finish('cancel'))
    sheet.appendChild(cancel)
    backdrop.addEventListener('click', (event) => { if (event.target === backdrop) finish('cancel') })
    backdrop.appendChild(sheet)
    document.body.appendChild(backdrop)
  })
}

function chooseFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)
    input.addEventListener('change', () => { const file = input.files?.[0] || null; input.remove(); resolve(file) })
    input.click()
  })
}

async function shareFile(name, type, content) {
  const blob = content instanceof Blob ? content : new Blob([content], { type })
  const file = new File([blob], name, { type })
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: name })
    return name
  }
  const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob) })
  try { await Share.share({ title: name, url: dataUrl, dialogTitle: `导出 ${name}` }) }
  catch { throw new Error('当前设备无法导出该文件') }
  return name
}

async function installSystemHooks() {
  document.documentElement.classList.add('moyu-mobile')
  try {
    await StatusBar.setOverlaysWebView({ overlay: false })
    await StatusBar.setStyle({ style: Style.Light })
    await StatusBar.setBackgroundColor({ color: '#1c2b48' })
  } catch {}
  try {
    await CapacitorApp.addListener('backButton', () => window.dispatchEvent(new CustomEvent('moyu:android-back')))
  } catch {}
  window.addEventListener('moyu:volume-key', (event) => emit('volume', event.detail))
}

export function installMobilePlatform() {
  if (!isMobileRuntime || window.readerAPI) return false
  const bookApi = createMobileBookApi()
  const aiApi = createMobileAiApi(native)
  window.readerAPI = {
    isMobile: true,
    ...bookApi,
    ...aiApi,
    getStoredValue: async (key) => {
      const entry = await mobileState.get(key)
      return entry ? { found: true, value: entry.value } : { found: false, value: null }
    },
    setStoredValue: async (key, value) => { await mobileState.set(key, value); return true },
    exportReaderData: async () => {
      const entries = await mobileState.entries()
      const store = { version: 1, updatedAt: new Date().toISOString(), data: Object.fromEntries(entries.map((entry) => [entry.key, entry.value])) }
      const name = `墨读阅读数据-${new Date().toISOString().slice(0, 10)}.json`
      await shareFile(name, 'application/json', `${JSON.stringify(store, null, 2)}\n`)
      return name
    },
    importReaderData: async () => {
      const file = await chooseFile('.json,application/json')
      if (!file) return false
      const parsed = JSON.parse(await file.text())
      const data = parsed?.data && typeof parsed.data === 'object' ? parsed.data : parsed
      await mobileState.replace(Object.entries(data).map(([key, value]) => ({ key, value })))
      return true
    },
    exportNotes: async ({ title, notes }) => {
      const body = [`# ${title || '阅读笔记'}`, '', ...(notes || []).flatMap((note) => [`> ${String(note.text || '').replace(/\r?\n/g, '\n> ')}`, note.comment ? `\n${note.comment}` : '', `\n_${new Date(note.createdAt || Date.now()).toLocaleDateString('zh-CN')}_`, ''])].join('\n')
      const name = `${String(title || '阅读笔记').slice(0, 60)}-笔记.md`
      await shareFile(name, 'text/markdown', body)
      return name
    },
    saveShareImage: async ({ dataUrl, quote }) => {
      const response = await fetch(dataUrl)
      const name = `${String(quote || '摘录').slice(0, 18)}-墨读分享.png`
      await shareFile(name, 'image/png', await response.blob())
      return name
    },
    chooseBackground: async (scope) => {
      const file = await chooseFile('image/jpeg,image/png,image/webp')
      if (!file) return null
      if (file.size > 20 * 1024 * 1024) throw new Error('背景图片不能超过 20 MB')
      const dataUrl = await new Promise((resolve) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(file) })
      const id = randomUUID()
      const assetPath = `mobile-background:${scope}:${id}`
      await mobileState.set(assetPath, dataUrl)
      return { id, scope, assetPath, fileName: file.name, mime: file.type, sizeBytes: file.size, createdAt: new Date().toISOString() }
    },
    readBackground: async (assetPath) => (await mobileState.get(assetPath))?.value || null,
    deleteBackground: async (assetPath) => { await mobileState.set(assetPath, null); return true },
    openSelectionMenu: actionSheet,
    openProfilesWindow: async (focus) => openAuxiliary('profiles', focus),
    toggleProfilesWindow: async () => openAuxiliary('profiles'),
    openProfilesStoryline: () => openAuxiliary('profiles', { storyline: true }),
    openDictionaryWindow: (entryId) => openAuxiliary('dictionary', entryId),
    closeDictionaryWindow: closeAuxiliary,
    openCompanionWindow: () => openAuxiliary('companion'),
    closeAuxiliary,
    sendProfilesSync: (snapshot) => { snapshots.profiles = snapshot; emit('profiles:sync', snapshot) },
    onProfilesSync: (callback) => { const off = listen('profiles:sync', callback); if (snapshots.profiles) queueMicrotask(() => callback(snapshots.profiles)); return off },
    onProfilesSyncRequest: (callback) => listen('profiles:request-sync', callback),
    sendProfilesAction: (action) => emit('profiles:action', action),
    onProfilesAction: (callback) => listen('profiles:action', callback),
    onProfilesFocus: (callback) => listen('profiles:focus', callback),
    sendDictSync: (snapshot) => { snapshots.dictionary = snapshot; emit('dictionary:sync', snapshot) },
    onDictSync: (callback) => { const off = listen('dictionary:sync', callback); if (snapshots.dictionary) queueMicrotask(() => callback(snapshots.dictionary)); return off },
    onDictSyncRequest: (callback) => listen('dictionary:request-sync', callback),
    sendDictAction: (action) => emit('dictionary:action', action),
    onDictAction: (callback) => listen('dictionary:action', callback),
    onDictFocus: (callback) => listen('dictionary:focus', callback),
    sendCompanionSync: (snapshot) => { snapshots.companion = snapshot; emit('companion:sync', snapshot) },
    onCompanionSync: (callback) => { const off = listen('companion:sync', callback); if (snapshots.companion) queueMicrotask(() => callback(snapshots.companion)); return off },
    onCompanionSyncRequest: (callback) => listen('companion:request-sync', callback),
    sendCompanionAction: (action) => emit('companion:action', action),
    onCompanionAction: (callback) => listen('companion:action', callback),
    onAiSummaryProgress: () => () => {},
    onExternalBooks: () => () => {},
    setPinned: () => {},
    updateBossKey: () => {},
    onVolumeKey: (callback) => listen('volume', callback),
    setReadingMode: async (active) => {
      document.body.classList.toggle('mobile-reading-active', Boolean(active))
      try { await native.setReadingActive({ active: Boolean(active) }) } catch {}
      try { await native.setImmersive({ active: Boolean(active) }) } catch {
        try { if (active) await StatusBar.hide(); else await StatusBar.show() } catch {}
      }
    },
  }
  installSystemHooks()
  return true
}

function randomUUID() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}
