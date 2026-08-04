import { useEffect, useState } from 'react'

let converters = null
let loading = null

function loadConverters() {
  if (converters) return Promise.resolve(converters)
  if (!loading) {
    loading = Promise.all([import('opencc-js/t2cn'), import('opencc-js/cn2t')]).then(([t2cn, cn2t]) => {
      converters = {
        simplified: t2cn.Converter({ from: 'tw', to: 'cn' }),
        traditional: cn2t.Converter({ from: 'cn', to: 'tw' }),
      }
      return converters
    })
  }
  return loading
}

export function useChineseConversionReady(mode) {
  const [ready, setReady] = useState(mode === 'none' || Boolean(converters))
  useEffect(() => {
    if (!mode || mode === 'none' || converters) { setReady(true); return undefined }
    let cancelled = false
    setReady(false)
    loadConverters().then(() => { if (!cancelled) setReady(true) })
    return () => { cancelled = true }
  }, [mode])
  return ready
}

export function convertChinese(text, mode = 'none') {
  if (!text || mode === 'none' || !converters) return text
  return converters[mode](text)
}

export function searchVariants(query, mode = 'none') {
  const values = [query]
  if (converters && mode === 'simplified') values.push(converters.traditional(query))
  if (converters && mode === 'traditional') values.push(converters.simplified(query))
  return [...new Set(values.filter(Boolean))]
}
