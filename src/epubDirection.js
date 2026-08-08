const VALID_DIRECTIONS = new Set(['ltr', 'rtl'])

export function normalizeEpubDirection(value) {
  const direction = String(value || '').trim().toLowerCase()
  return VALID_DIRECTIONS.has(direction) ? direction : null
}

export function inspectEpubPageDirection(document) {
  const view = document?.defaultView
  const bodyStyle = document?.body && view?.getComputedStyle(document.body)
  const rootStyle = document?.documentElement && view?.getComputedStyle(document.documentElement)
  const writingModes = [bodyStyle?.writingMode, rootStyle?.writingMode]
    .map((value) => String(value || '').trim().toLowerCase())

  if (writingModes.some((value) => value === 'vertical-rl' || value === 'sideways-rl')) {
    return { writingDirection: 'rtl', explicitDirection: null }
  }
  if (writingModes.some((value) => value === 'vertical-lr' || value === 'sideways-lr')) {
    return { writingDirection: 'ltr', explicitDirection: null }
  }

  const explicitDirection = normalizeEpubDirection(
    document?.body?.getAttribute?.('dir') || document?.documentElement?.getAttribute?.('dir'),
  )
  return { writingDirection: null, explicitDirection }
}

export function resolveEpubReadingDirection(publicationDirection, pageDirection = {}) {
  return normalizeEpubDirection(pageDirection.writingDirection)
    || normalizeEpubDirection(publicationDirection)
    || normalizeEpubDirection(pageDirection.explicitDirection)
    || 'ltr'
}
