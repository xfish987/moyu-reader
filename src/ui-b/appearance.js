import coverNight from './assets/cover-night.png'
import coverPaper from './assets/cover-paper.png'
import homeMoonLight from './assets/home-moon-light.png'
import homePaperBlossom from './assets/home-paper-blossom.png'
import homeSpring from './assets/home-spring.png'
import readerMoonBlue from './assets/reader-moon-blue.png'
import readerMoonNight from './assets/reader-moon-night.png'
import irisLilac from './assets/iris-lilac.png'
import irisPeach from './assets/iris-peach.png'
import irisGreen from './assets/iris-green.png'

/* focus 是该预设构图主体所在位置（cover 裁切时的默认聚焦点），按素材实际画面标定。 */
export const PRESET_BACKGROUNDS = [
  { id: 'home-moon-light', scopes: ['home', 'reader'], name: '月下浅山', url: homeMoonLight, focus: { x: 68, y: 55 } },
  { id: 'home-paper-blossom', scopes: ['home', 'reader'], name: '纸上花枝', url: homePaperBlossom, focus: { x: 82, y: 45 } },
  { id: 'home-spring', scopes: ['home', 'reader'], name: '春日山水', url: homeSpring, focus: { x: 72, y: 58 } },
  { id: 'reader-moon-blue', scopes: ['home', 'reader'], name: '清夜湖光', url: readerMoonBlue, focus: { x: 76, y: 45 } },
  { id: 'reader-moon-night', scopes: ['home', 'reader'], name: '雪线寒夜', url: readerMoonNight, focus: { x: 75, y: 35 } },
]

const THEME_HOME_PRESETS = {
  mist: 'reader-moon-blue',
  night: 'reader-moon-night',
  porcelain: 'home-paper-blossom',
}

export const IRIS_ASSETS = [
  { id: 'iris-lilac', name: '淡紫鸢尾', url: irisLilac },
  { id: 'iris-peach', name: '暖粉鸢尾', url: irisPeach },
  { id: 'iris-green', name: '青绿鸢尾', url: irisGreen },
]

export const DEFAULT_COVERS = { light: coverPaper, dark: coverNight }

const preset = (id) => {
  const item = PRESET_BACKGROUNDS.find((entry) => entry.id === id)
  return item ? { kind: 'builtin', ...item } : null
}

export function themeHomeBackground(theme) {
  return preset(THEME_HOME_PRESETS[theme] || THEME_HOME_PRESETS.mist)
}

export function resolveBackgroundPreference(preference, scope, theme) {
  if (scope !== 'home' || !preference?.autoAdaptTheme || (preference.asset && preference.asset.kind !== 'builtin')) return preference
  const asset = themeHomeBackground(theme)
  // 主题自动匹配的内置背景同时带上构图焦点，窄窗 cover 裁切后仍能看到主体。
  return { ...preference, asset, positionX: asset?.focus?.x ?? preference.positionX, positionY: asset?.focus?.y ?? preference.positionY, enabled: true }
}

export const DEFAULT_BACKGROUND = {
  enabled: false,
  asset: null,
  fit: 'cover',
  positionX: 50,
  positionY: 50,
  opacity: 0.14,
  blurPx: 18,
  overlayOpacity: 0.32,
  saturation: 0.82,
  brightness: 1,
  contrast: 1,
  scale: 1,
  vignette: 0.2,
  autoAdaptTheme: true,
}

export const DEFAULT_APPEARANCE = {
  theme: 'mist',
  // 图案靠清晰度和焦点呈现，不靠模糊遮羞；可读性由遮罩兜底。
  // 雾蓝预设（清夜湖光）主体在画面右侧，默认聚焦 (76, 45)。
  home: { ...DEFAULT_BACKGROUND, opacity: 0.72, blurPx: 0, overlayOpacity: 0.08, saturation: 0.86, contrast: 1.04, positionX: 76, positionY: 45, asset: themeHomeBackground('mist'), enabled: true },
  reader: { ...DEFAULT_BACKGROUND, opacity: 0.08, blurPx: 12, overlayOpacity: 0.48, paperOpacity: 0.94, asset: preset('reader-moon-blue'), enabled: true },
}

/* 外观参数版本：默认推荐值调整后递增，旧存档自动迁移（保留主题与用户上传的背景图）。 */
export const APPEARANCE_VERSION = 2

export function normalizeAppearance(value) {
  const current = value && typeof value === 'object' ? value : {}
  if (current.v !== APPEARANCE_VERSION) {
    const migrate = (scope) => ({
      ...DEFAULT_APPEARANCE[scope],
      asset: current[scope]?.asset ?? DEFAULT_APPEARANCE[scope].asset,
      enabled: current[scope]?.enabled ?? DEFAULT_APPEARANCE[scope].enabled,
      autoAdaptTheme: current[scope]?.autoAdaptTheme ?? DEFAULT_APPEARANCE[scope].autoAdaptTheme,
    })
    return { ...DEFAULT_APPEARANCE, theme: current.theme || DEFAULT_APPEARANCE.theme, home: migrate('home'), reader: migrate('reader'), v: APPEARANCE_VERSION }
  }
  return {
    ...DEFAULT_APPEARANCE,
    ...current,
    home: { ...DEFAULT_APPEARANCE.home, ...(current.home || {}) },
    reader: { ...DEFAULT_APPEARANCE.reader, ...(current.reader || {}) },
  }
}
