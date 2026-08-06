import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import ProfilesWindow from './ProfilesWindow'
import ProfilesFab from './ProfilesFab'
import DictionaryWindow from './DictionaryWindow'
import CompanionWindow from './CompanionWindow'
import CompanionBarWindow from './CompanionBarWindow'
import './styles.css'

const windowKind = new URLSearchParams(window.location.search).get('window')

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {windowKind === 'profiles' ? <ProfilesWindow /> : windowKind === 'profiles-fab' ? <ProfilesFab /> : windowKind === 'dictionary' ? <DictionaryWindow /> : windowKind === 'companion' ? <CompanionWindow /> : windowKind === 'companion-bar' ? <CompanionBarWindow /> : <App />}
  </React.StrictMode>,
)
