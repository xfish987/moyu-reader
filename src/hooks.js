import { useCallback, useEffect, useRef, useState } from 'react'

function reportStorageError(error) {
  window.dispatchEvent(new CustomEvent('reader-error', {
    detail: `阅读数据保存失败：${error?.message || '无法写入本地数据'}`,
  }))
}

export function useStoredState(key, initialValue) {
  const legacyRef = useRef({ found: false, value: initialValue })
  const hydratedRef = useRef(false)
  const [value, setValue] = useState(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved === null) return initialValue
      legacyRef.current = { found: true, value: JSON.parse(saved) }
      return legacyRef.current.value
    } catch {
      return initialValue
    }
  })

  useEffect(() => {
    let cancelled = false
    const hydrate = async () => {
      if (!window.readerAPI?.getStoredValue) {
        hydratedRef.current = true
        return
      }
      try {
        const stored = await window.readerAPI.getStoredValue(key)
        if (cancelled) return
        if (stored?.found) {
          setValue(stored.value)
        } else {
          await window.readerAPI.setStoredValue(key, legacyRef.current.value)
        }
        hydratedRef.current = true
      } catch (error) {
        hydratedRef.current = true
        reportStorageError(error)
      }
    }
    hydrate()
    return () => { cancelled = true }
  }, [key])

  useEffect(() => {
    if (!hydratedRef.current || !window.readerAPI?.setStoredValue) return
    window.readerAPI.setStoredValue(key, value).catch(reportStorageError)
  }, [key, value])

  const setStoredValue = useCallback((next) => setValue(next), [])

  return [value, setStoredValue]
}

export function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
