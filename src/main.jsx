import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ProfilesWindow from './ProfilesWindow'
import ProfilesFab from './ProfilesFab'
import DictionaryWindow from './DictionaryWindow'
import CompanionWindow from './CompanionWindow'
import CompanionBarWindow from './CompanionBarWindow'
import './styles.css'
import './ui-b/ui-b.css'

const windowKind = new URLSearchParams(window.location.search).get('window')

function applyStoredTheme() {
  try {
    const appearance = JSON.parse(localStorage.getItem('reader:appearance-v2') || '{}')
    document.documentElement.dataset.moyuTheme = appearance.theme === 'night' ? 'night' : 'light'
  } catch {
    document.documentElement.dataset.moyuTheme = 'light'
  }
}

applyStoredTheme()
window.addEventListener('storage', (event) => {
  if (event.key === 'reader:appearance-v2') applyStoredTheme()
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {windowKind === 'profiles' ? <ProfilesWindow /> : windowKind === 'profiles-fab' ? <ProfilesFab /> : windowKind === 'dictionary' ? <DictionaryWindow /> : windowKind === 'companion' ? <CompanionWindow /> : windowKind === 'companion-bar' ? <CompanionBarWindow /> : <App />}
  </React.StrictMode>,
)
