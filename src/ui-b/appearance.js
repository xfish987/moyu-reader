import coverNight from './assets/cover-night.png'
import coverPaper from './assets/cover-paper.png'
import bgBlossomMoon from './assets/bg-blossom-moon.png'
import bgBlueMoon from './assets/bg-blue-moon.png'
import bgSnowLake from './assets/bg-snow-lake.png'
import bgPinkPavilion from './assets/bg-pink-pavilion.png'
import bgStarryNight from './assets/bg-starry-night.png'
import irisLilac from './assets/iris-lilac.png'
import irisPeach from './assets/iris-peach.png'
import irisGreen from './assets/iris-green.png'

/* focus 是该预设构图主体所在位置（cover 裁切时的默认聚焦点），按素材实际画面标定。
   本批为竖构图（941×1672），横向裁切主要损失两侧，纵向焦点取中上（月亮/花枝头）。 */
export const PRESET_BACKGROUNDS = [
  { id: 'bg-blossom-moon', scopes: ['home', 'reader'], name: '花月平湖', url: bgBlossomMoon, focus: { x: 60, y: 28 } },
  { id: 'bg-blue-moon', scopes: ['home', 'reader'], name: '清辉夜泊', url: bgBlueMoon, focus: { x: 50, y: 30 } },
  { id: 'bg-snow-lake', scopes: ['home', 'reader'], name: '雪湖初晴', url: bgSnowLake, focus: { x: 50, y: 42 } },
  { id: 'bg-pink-pavilion', scopes: ['home', 'reader'], name: '繁花水榭', url: bgPinkPavilion, focus: { x: 55, y: 32 } },
  { id: 'bg-starry-night', scopes: ['home', 'reader'], name: '星河寒夜', url: bgStarryNight, focus: { x: 65, y: 28 } },
]

const THEME_HOME_PRESETS = {
  mist: 'bg-blue-moon',
  night: 'bg-starry-night',
  porcelain: 'bg-blossom-moon',
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
  home: { ...DEFAULT_BACKGROUND, opacity: 0.6, blurPx: 0, overlayOpacity: 0.05, saturation: 0.95, contrast: 1.08, positionX: 50, positionY: 30, asset: themeHomeBackground('mist'), enabled: true },
  reader: { ...DEFAULT_BACKGROUND, opacity: 0.08, blurPx: 12, overlayOpacity: 0.48, paperOpacity: 0.94, asset: preset('bg-blue-moon'), enabled: true },
}

/* 外观参数版本：默认推荐值或预设素材变更后递增，旧存档自动迁移。
   迁移保留主题与用户上传的背景图；内置预设引用（url 会随构建失效）重置为新默认。 */
export const APPEARANCE_VERSION = 4

export function normalizeAppearance(value) {
  const current = value && typeof value === 'object' ? value : {}
  const custom = Array.isArray(current.custom) ? current.custom : []
  if (current.v !== APPEARANCE_VERSION) {
    const migrate = (scope) => ({
      ...DEFAULT_APPEARANCE[scope],
      asset: (current[scope]?.asset && current[scope].asset.kind !== 'builtin') ? current[scope].asset : DEFAULT_APPEARANCE[scope].asset,
      enabled: current[scope]?.enabled ?? DEFAULT_APPEARANCE[scope].enabled,
      autoAdaptTheme: current[scope]?.autoAdaptTheme ?? DEFAULT_APPEARANCE[scope].autoAdaptTheme,
    })
    return { ...DEFAULT_APPEARANCE, theme: current.theme || DEFAULT_APPEARANCE.theme, home: migrate('home'), reader: migrate('reader'), custom, v: APPEARANCE_VERSION }
  }
  return {
    ...DEFAULT_APPEARANCE,
    ...current,
    custom,
    home: { ...DEFAULT_APPEARANCE.home, ...(current.home || {}) },
    reader: { ...DEFAULT_APPEARANCE.reader, ...(current.reader || {}) },
  }
}
