import coverNight from './assets/dark-shelf/default-cover.png'
import darkBackgroundDesktop from './assets/dark-shelf/background-desktop.png'
import darkBackgroundNarrow from './assets/dark-shelf/background-narrow.png'
import coverPaper from './assets/light-shelf/default-cover.png'
import lightBackgroundDesktop from './assets/light-shelf/background-desktop.png'
import lightBackgroundNarrow from './assets/light-shelf/background-narrow.png'

export const DEFAULT_COVERS = { light: coverPaper, dark: coverNight }

const BUILTIN_BACKGROUNDS = {
  mist: { id: 'builtin-mist', kind: 'builtin', name: '浅色默认背景', url: lightBackgroundDesktop, narrowUrl: lightBackgroundNarrow },
  night: { id: 'builtin-night', kind: 'builtin', name: '深色默认背景', url: darkBackgroundDesktop, narrowUrl: darkBackgroundNarrow },
}

const DEFAULT_OVERLAYS = {
  home: {
    mist: { startColor: '#d2dbec', startOpacity: 0.6, endColor: '#d2dbec', endOpacity: 0.6, angle: 90, midpoint: 0.5 },
    night: { startColor: '#01162b', startOpacity: 0.72, endColor: '#01162b', endOpacity: 0.61, angle: 90, midpoint: 0.5 },
  },
  reader: {
    mist: { startColor: '#d2dbec', startOpacity: 0.95, endColor: '#d2dbec', endOpacity: 0.83, angle: 90, midpoint: 0.5 },
    night: { startColor: '#01162b', startOpacity: 0.95, endColor: '#01162b', endOpacity: 0.83, angle: 90, midpoint: 0.5 },
  },
}

const DEFAULT_BARS = {
  top: { color: '#1c2b48', opacity: 0.94, iconColor: '#e8ecef', iconOpacity: 1 },
  bottom: {
    color: '#1c2b48',
    opacity: 0.9,
    iconColor: '#e8ecef',
    iconOpacity: 1,
    circleColor: '#1c2b48',
    circleOpacity: 1,
    sunStartColor: '#1d2c49',
    sunEndColor: '#c5d8e6',
    sunOpacity: 1,
    moonStartColor: '#1d2c49',
    moonEndColor: '#c5d8e6',
    moonOpacity: 1,
  },
}

const clamp01 = (value, fallback) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback
}

const normalizeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback

const normalizeAngle = (value, fallback = 90) => {
  const number = Number(value)
  return Number.isFinite(number) ? ((Math.round(number) % 360) + 360) % 360 : fallback
}

const normalizeMidpoint = (value, fallback = 0.5) => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(0.99, Math.max(0.01, number)) : fallback
}

export function resolveBackgroundPreference(preference, scope = 'home', theme = 'mist') {
  const activeTheme = theme === 'night' ? 'night' : 'mist'
  const customAsset = preference?.enabled !== false && preference?.asset?.assetPath ? preference.asset : null
  return {
    ...DEFAULT_BACKGROUND,
    ...preference,
    enabled: true,
    asset: customAsset || BUILTIN_BACKGROUNDS[activeTheme],
    overlay: preference?.overlay?.[activeTheme] || DEFAULT_OVERLAYS[scope]?.[activeTheme],
  }
}

export const DEFAULT_BACKGROUND = {
  enabled: true,
  asset: null,
  fit: 'cover',
  positionX: 50,
  positionY: 50,
  opacity: 1,
  blurPx: 0,
  saturation: 1,
  brightness: 1,
  contrast: 1,
  scale: 1,
  vignette: 0,
  autoAdaptTheme: false,
}

export const DEFAULT_APPEARANCE = {
  theme: 'mist',
  home: { ...DEFAULT_BACKGROUND, overlay: DEFAULT_OVERLAYS.home },
  reader: { ...DEFAULT_BACKGROUND, overlay: DEFAULT_OVERLAYS.reader },
  bars: DEFAULT_BARS,
  custom: [],
  schemes: [],
  activeSchemeId: 'builtin-mist',
}

export const APPEARANCE_VERSION = 13

export function normalizeAppearance(value) {
  const current = value && typeof value === 'object' ? value : {}
  const storedVersion = Number(current.v || 0)
  const usesBuiltInScheme = !current.activeSchemeId || /^builtin-(mist|night)$/.test(current.activeSchemeId)
  const custom = Array.isArray(current.custom)
    ? current.custom.filter((asset) => asset?.assetPath).map((asset) => ({ ...asset, name: String(asset.name || asset.fileName || '自定义背景').trim().slice(0, 40) }))
    : []

  const normalizeScope = (scope) => {
    const previous = current[scope] || {}
    const asset = previous.asset?.assetPath ? { ...previous.asset, kind: 'custom' } : null
    const overlay = Object.fromEntries(['mist', 'night'].map((theme) => {
      const defaults = DEFAULT_OVERLAYS[scope][theme]
      const legacyOpacity = scope === 'home' ? current.shelfOverlayOpacity?.[theme] : previous.overlayOpacity
      const saved = previous.overlay?.[theme] || {}
      let legacyResolvedOpacity = clamp01(saved.opacity ?? legacyOpacity, defaults.startOpacity)
      if (scope === 'home' && theme === 'night' && Number(current.v || 0) < 9 && legacyResolvedOpacity === 0.4) legacyResolvedOpacity = 0.5
      const migrateReaderPreset = scope === 'reader'
        && storedVersion < 13
        && usesBuiltInScheme
        && clamp01(saved.startOpacity, legacyResolvedOpacity) === 0.8
        && clamp01(saved.endOpacity, legacyResolvedOpacity) === 0.8
      const migrateDarkHomePreset = scope === 'home'
        && theme === 'night'
        && storedVersion < 13
        && usesBuiltInScheme
        && clamp01(saved.startOpacity, legacyResolvedOpacity) === 0.5
        && clamp01(saved.endOpacity, legacyResolvedOpacity) === 0.5
      const migratePreset = migrateReaderPreset || migrateDarkHomePreset
      return [theme, {
        startColor: normalizeColor(saved.startColor ?? saved.color, defaults.startColor),
        startOpacity: migratePreset ? defaults.startOpacity : clamp01(saved.startOpacity, legacyResolvedOpacity),
        endColor: normalizeColor(saved.endColor ?? saved.color, defaults.endColor),
        endOpacity: migratePreset ? defaults.endOpacity : clamp01(saved.endOpacity, legacyResolvedOpacity),
        angle: normalizeAngle(saved.angle, defaults.angle),
        midpoint: normalizeMidpoint(saved.midpoint, defaults.midpoint),
      }]
    }))
    return {
      ...DEFAULT_BACKGROUND,
      ...previous,
      asset,
      enabled: true,
      opacity: 1,
      overlay,
      autoAdaptTheme: false,
    }
  }

  const normalizeBar = (bar) => {
    const defaults = DEFAULT_BARS[bar]
    const saved = current.bars?.[bar] || {}
    const normalized = {
      color: normalizeColor(saved.color, defaults.color),
      opacity: clamp01(saved.opacity, defaults.opacity),
      iconColor: normalizeColor(saved.iconColor, defaults.iconColor),
      iconOpacity: clamp01(saved.iconOpacity, defaults.iconOpacity),
    }
    if (bar === 'bottom') {
      normalized.circleColor = normalizeColor(saved.circleColor, defaults.circleColor)
      normalized.circleOpacity = clamp01(saved.circleOpacity, defaults.circleOpacity)
      normalized.sunStartColor = normalizeColor(saved.sunStartColor, defaults.sunStartColor)
      normalized.sunEndColor = normalizeColor(saved.sunEndColor, defaults.sunEndColor)
      normalized.sunOpacity = clamp01(saved.sunOpacity, defaults.sunOpacity)
      normalized.moonStartColor = normalizeColor(saved.moonStartColor, defaults.moonStartColor)
      normalized.moonEndColor = normalizeColor(saved.moonEndColor, defaults.moonEndColor)
      normalized.moonOpacity = clamp01(saved.moonOpacity, defaults.moonOpacity)
    }
    return normalized
  }

  return {
    ...DEFAULT_APPEARANCE,
    theme: current.theme === 'night' ? 'night' : 'mist',
    home: normalizeScope('home'),
    reader: normalizeScope('reader'),
    bars: { top: normalizeBar('top'), bottom: normalizeBar('bottom') },
    custom,
    schemes: Array.isArray(current.schemes)
      ? current.schemes.filter((scheme) => scheme?.id && scheme?.settings).map((scheme) => ({
        id: String(scheme.id),
        name: String(scheme.name || '自定义外观').trim().slice(0, 30) || '自定义外观',
        settings: scheme.settings,
      }))
      : [],
    activeSchemeId: typeof current.activeSchemeId === 'string' ? current.activeSchemeId : `builtin-${current.theme === 'night' ? 'night' : 'mist'}`,
    v: APPEARANCE_VERSION,
  }
}
