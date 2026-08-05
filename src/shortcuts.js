// 快捷键：默认值、动作清单与按键归一化。用户可在书架页“快捷键”里查看和修改，
// 配置存于 localStorage（reader:shortcuts）。
export const DEFAULT_SHORTCUTS = {
  toggleProfiles: 'F1',
  prevPage: 'a',
  nextPage: 'd',
  immersive: 'F11',
  boss: 'F10',
}

export const SHORTCUT_ACTIONS = [
  { id: 'toggleProfiles', label: '打开 / 关闭设定集', note: '书架与阅读中都可用' },
  { id: 'prevPage', label: '阅读 · 上一页', note: '← 方向键始终可用' },
  { id: 'nextPage', label: '阅读 · 下一页', note: '→ 方向键始终可用' },
  { id: 'immersive', label: '阅读 · 沉浸模式', note: '' },
  { id: 'boss', label: '老板键（隐藏窗口）', note: '全局生效，仅支持 F1–F12' },
]

// 归一化键盘事件为可存储的按键名：F1–F12 原样，无修饰键的单字符小写，其余返回空串。
export function normalizeKey(event) {
  const key = event.key || ''
  if (/^F([1-9]|1[0-2])$/.test(key)) return key
  if (key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) return key.toLowerCase()
  return ''
}

export function displayKey(key) {
  return key && key.length === 1 ? key.toUpperCase() : key
}
