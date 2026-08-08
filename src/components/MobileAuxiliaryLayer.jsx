import { useEffect, useState } from 'react'
import ProfilesWindow from '../ProfilesWindow'
import DictionaryWindow from '../DictionaryWindow'
import CompanionWindow from '../CompanionWindow'

export default function MobileAuxiliaryLayer() {
  const [kind, setKind] = useState('')

  useEffect(() => {
    const open = (event) => {
      const next = event.detail?.kind || ''
      window.__moyuAuxOpen = Boolean(next)
      setKind(next)
    }
    const close = () => {
      window.__moyuAuxOpen = false
      setKind('')
    }
    const back = (event) => {
      if (!window.__moyuAuxOpen) return
      event.preventDefault()
      close()
    }
    window.addEventListener('moyu:aux-open', open)
    window.addEventListener('moyu:aux-close', close)
    window.addEventListener('moyu:android-back', back)
    return () => {
      window.removeEventListener('moyu:aux-open', open)
      window.removeEventListener('moyu:aux-close', close)
      window.removeEventListener('moyu:android-back', back)
    }
  }, [])

  if (!kind) return null
  const close = () => window.readerAPI?.closeAuxiliary?.()
  return (
    <div className="mobile-auxiliary-layer" role="dialog" aria-modal="true">
      {kind === 'profiles' ? <ProfilesWindow onClose={close} /> : null}
      {kind === 'dictionary' ? <DictionaryWindow onClose={close} /> : null}
      {kind === 'companion' ? <CompanionWindow onClose={close} /> : null}
    </div>
  )
}
