import { useEffect, useState } from 'react'
import { resolveBackgroundPreference } from './appearance'

export default function BackgroundLayer({ preference, scope, theme }) {
  const [image, setImage] = useState('')
  const resolved = resolveBackgroundPreference(preference, scope, theme)

  useEffect(() => {
    let cancelled = false
    if (!resolved?.asset) {
      setImage('')
      return undefined
    }
    const loaded = resolved.asset.kind === 'builtin'
      ? Promise.resolve(resolved.asset.url)
      : window.readerAPI?.readBackground(resolved.asset.assetPath)
    loaded?.then((value) => {
      if (!cancelled) setImage(value || '')
    }).catch(() => { if (!cancelled) setImage('') })
    return () => { cancelled = true }
  }, [resolved?.asset?.assetPath, resolved?.asset?.url, resolved?.enabled])

  const style = {
    '--b-bg-image': image ? `url("${image}")` : 'none',
    '--b-bg-image-narrow': resolved?.asset?.narrowUrl ? `url("${resolved.asset.narrowUrl}")` : (image ? `url("${image}")` : 'none'),
    '--b-bg-fit': resolved?.fit || 'cover',
    '--b-bg-x': `${resolved?.positionX ?? 50}%`,
    '--b-bg-y': `${resolved?.positionY ?? 50}%`,
    '--b-bg-opacity': image ? resolved.opacity : 0,
    '--b-bg-blur': `${resolved?.blurPx ?? 0}px`,
    '--b-bg-saturation': resolved?.saturation ?? 1,
    '--b-bg-brightness': resolved?.brightness ?? 1,
    '--b-bg-contrast': resolved?.contrast ?? 1,
    // 基础放大 1.08 用于吃掉模糊外溢的透明边缘，用户缩放在此之上叠加。
    '--b-bg-zoom': (1.08 * (resolved?.scale ?? 1)).toFixed(3),
    '--b-bg-overlay-start': resolved?.overlay?.startColor || '#01162b',
    '--b-bg-overlay-start-opacity': `${(resolved?.overlay?.startOpacity ?? 0) * 100}%`,
    '--b-bg-overlay-end': resolved?.overlay?.endColor || '#01162b',
    '--b-bg-overlay-end-opacity': `${(resolved?.overlay?.endOpacity ?? 0) * 100}%`,
    '--b-bg-overlay-angle': `${resolved?.overlay?.angle ?? 90}deg`,
    '--b-bg-overlay-midpoint': `${(resolved?.overlay?.midpoint ?? 0.5) * 100}%`,
    '--b-bg-vignette': resolved?.vignette ?? 0,
  }

  return <div className={`b-background b-background-${scope} theme-${theme}`} style={style} aria-hidden="true"><div className="b-background-image" /><div className="b-background-mask" /></div>
}
