import coverNight from './assets/cover-night.png'
import coverPaper from './assets/light-shelf/default-cover.png'

export const DEFAULT_COVERS = { light: coverPaper, dark: coverNight }

export function resolveBackgroundPreference(preference) {
  return preference
}

export const DEFAULT_BACKGROUND = {
  enabled: false,
  asset: null,
  fit: 'cover',
  positionX: 50,
  positionY: 50,
  opacity: 1,
  blurPx: 0,
  overlayOpacity: 0.06,
  saturation: 1,
  brightness: 1,
  contrast: 1,
  scale: 1,
  vignette: 0,
  autoAdaptTheme: false,
}

export const DEFAULT_APPEARANCE = {
  theme: 'mist',
  home: { ...DEFAULT_BACKGROUND },
  reader: { ...DEFAULT_BACKGROUND, opacity: 0.16, overlayOpacity: 0.56 },
}

export const APPEARANCE_VERSION = 6

export function normalizeAppearance(value) {
  const current = value && typeof value === 'object' ? value : {}
  const custom = Array.isArray(current.custom) ? current.custom.filter((asset) => asset?.assetPath) : []
  const normalizeScope = (scope) => {
    const previous = current[scope] || {}
    const asset = previous.asset?.assetPath ? { ...previous.asset, kind: 'custom' } : null
    return {
      ...DEFAULT_APPEARANCE[scope],
      ...previous,
      asset,
      enabled: Boolean(asset && previous.enabled !== false),
      autoAdaptTheme: false,
    }
  }
  return {
    ...DEFAULT_APPEARANCE,
    theme: current.theme === 'night' ? 'night' : 'mist',
    home: normalizeScope('home'),
    reader: normalizeScope('reader'),
    custom,
    v: APPEARANCE_VERSION,
  }
}
