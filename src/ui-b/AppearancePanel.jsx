import { useEffect, useMemo, useState } from 'react'
import { Check, CloudUpload, Download, Eraser, FolderOutput, ImagePlus, LockKeyhole, LogIn, LogOut, Plus, RotateCcw, Save, Trash2, UserRound, UserX, X } from 'lucide-react'
import { DEFAULT_APPEARANCE, normalizeAppearance } from './appearance'
import AvatarCropDialog from './AvatarCropDialog'

const THEMES = [
  { id: 'mist', name: '浅色', colors: ['#e8ecef', '#c5d8e6', '#396081'] },
  { id: 'night', name: '深色', colors: ['#01162b', '#1c2b48', '#8eb1d1'] },
]

const SCOPE_LABELS = { home: '主页背景', reader: '阅读背景' }

const clone = (value) => JSON.parse(JSON.stringify(value))

const snapshotAppearance = (appearance) => clone({
  theme: appearance.theme,
  home: appearance.home,
  reader: appearance.reader,
  bars: appearance.bars,
})

const BUILTIN_SCHEMES = [
  { id: 'builtin-mist', name: '默认浅色', settings: { ...snapshotAppearance(DEFAULT_APPEARANCE), theme: 'mist' } },
  { id: 'builtin-night', name: '默认深色', settings: { ...snapshotAppearance(DEFAULT_APPEARANCE), theme: 'night' } },
]

const CLOUD_SERVER_URL = import.meta.env.VITE_MOYU_CLOUD_URL || 'https://modu.cxnnn.cn/moyu-reader-cloud'

function AccountSection() {
  const [status, setStatus] = useState({ loading: true, authenticated: false })
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmRegisterPassword, setConfirmRegisterPassword] = useState('')
  const [authMode, setAuthMode] = useState('login')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [libraryProgress, setLibraryProgress] = useState(null)
  const [nickname, setNickname] = useState('')
  const [avatar, setAvatar] = useState('')
  const [cropImage, setCropImage] = useState('')
  const [danger, setDanger] = useState(null)
  const [inviteCode, setInviteCode] = useState('')
  const [syncOverview, setSyncOverview] = useState(null)

  const refreshSyncOverview = () => { window.readerAPI?.syncOverview?.().then(setSyncOverview).catch(() => setSyncOverview(null)) }

  useEffect(() => {
    let cancelled = false
    if (!window.readerAPI?.getCloudStatus) { setStatus({ loading: false, authenticated: false }); return undefined }
    window.readerAPI.getCloudStatus(CLOUD_SERVER_URL).then((next) => { if (!cancelled) { setStatus({ ...next, loading: false }); setNickname(next.user?.nickname || next.user?.username || ''); setAvatar(next.user?.avatar || '') } }).catch(() => { if (!cancelled) setStatus({ loading: false, authenticated: false, error: '无法连接云服务器，请检查网络' }) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => window.readerAPI?.onCloudLibraryProgress?.(setLibraryProgress), [])

  useEffect(() => { refreshSyncOverview() }, [])

  const run = async (action, operation) => {
    setBusy(action)
    setMessage('')
    try { await operation() } catch (error) { setMessage(error?.message || '操作失败，请稍后再试') } finally { setBusy('') }
  }

  const submitAuth = () => run('login', async () => {
    if (authMode === 'register' && password !== confirmRegisterPassword) throw new Error('两次输入的密码不一致')
    const method = authMode === 'register' ? window.readerAPI.registerCloudAccount : window.readerAPI.loginCloudAccount
    const result = await method({ serverUrl: CLOUD_SERVER_URL, username: username.trim(), password, ...(authMode === 'register' ? { inviteCode: inviteCode.trim() } : {}) })
    setStatus({ loading: false, authenticated: true, ...result })
    setNickname(result.user?.nickname || result.user?.username || ''); setAvatar(result.user?.avatar || '')
    setPassword(''); setConfirmRegisterPassword(''); setInviteCode('')
    try {
      const synced = await window.readerAPI.syncCloudData()
      window.dispatchEvent(new Event('moyu-cloud-changed'))
      setMessage(authMode === 'register' ? '账户创建成功，当前设备数据已同步' : synced.restored ? '登录成功，已恢复云端书架与阅读数据' : '登录成功，阅读数据已同步')
      if (synced.changed) setTimeout(() => window.location.reload(), 500)
    } catch (error) {
      // 登录本身已成功，同步失败不伪装成登录失败（C7）
      setMessage(`登录成功，但数据同步失败：${error?.message || '请稍后点「同步阅读数据」重试'}`)
    }
    refreshSyncOverview()
  })

  const backup = () => run('backup', async () => {
    const result = await window.readerAPI.uploadCloudSnapshot()
    setStatus((current) => ({ ...current, user: { ...current.user, snapshot: result.snapshot } }))
    setMessage('完整灾难备份已上传')
    refreshSyncOverview()
  })

  const syncData = () => run('sync', async () => {
    const result = await window.readerAPI.syncCloudData()
    setStatus((current) => ({ ...current, user: { ...current.user, sync: result.sync } }))
    setMessage('书架、笔记、进度和设置已双向同步')
    refreshSyncOverview()
    window.dispatchEvent(new Event('moyu-cloud-changed'))
    if (result.changed) setTimeout(() => window.location.reload(), 500)
  })

  const syncLibrary = () => run('library', async () => {
    setLibraryProgress({ current: 0, total: 0, title: '正在核对个人书库' })
    try {
      const result = await window.readerAPI.uploadCloudLibrary()
      setStatus((current) => ({ ...current, user: { ...current.user, libraryCount: result.total } }))
      setMessage(result.uploaded ? `已新增上传 ${result.uploaded} 本，云端共 ${result.total} 本` : `个人书库已是最新，共 ${result.total} 本`)
      refreshSyncOverview()
      window.dispatchEvent(new Event('moyu-cloud-changed'))
    } finally { setLibraryProgress(null) }
  })

  const changePassword = () => run('password', async () => {
    if (newPassword !== confirmPassword) throw new Error('两次输入的新密码不一致')
    const result = await window.readerAPI.changeCloudPassword({ currentPassword, newPassword })
    setStatus((current) => ({ ...current, user: result.user }))
    setCurrentPassword(''); setNewPassword(''); setConfirmPassword('')
    setMessage('密码已修改，其他设备的登录已失效')
  })

  const logout = () => run('logout', async () => {
    await window.readerAPI.logoutCloudAccount()
    setStatus({ loading: false, authenticated: false })
    setMessage('已退出登录，本地数据不会被删除')
  })

  const chooseAvatar = () => run('avatar', async () => { const selected = await window.readerAPI.chooseCloudAvatar(); if (selected) setCropImage(selected) })
  const confirmCrop = (cropped) => run('avatar', async () => {
    const result = await window.readerAPI.updateCloudProfile({ nickname: nickname.trim() || status.user?.nickname || status.user?.username, avatar: cropped })
    setAvatar(cropped)
    setStatus((current) => ({ ...current, user: result.user }))
    setCropImage('')
    setMessage('头像已更新，并同步到书城与读者想法')
  })
  const saveProfile = () => run('profile', async () => {
    const result = await window.readerAPI.updateCloudProfile({ nickname, avatar })
    setStatus((current) => ({ ...current, user: result.user })); setMessage('昵称和头像已同步到书城与读者想法')
  })
  const exportAccount = () => run('export', async () => { const file = await window.readerAPI.exportCloudAccount(); if (file) setMessage(`账户数据已导出到 ${file}`) })
  const confirmDanger = () => run(danger.type, async () => {
    if (danger.type === 'clear') {
      await window.readerAPI.clearCloudAccount(danger.input); setStatus((current) => ({ ...current, user: { ...current.user, snapshot: null, sync: null, libraryCount: 0 } })); setMessage('云端账户数据已清空，本机数据仍保留')
    } else if (danger.type === 'restore') {
      // 恢复成功后主进程会自动重启应用
      await window.readerAPI.restoreCloudSnapshot()
    } else {
      await window.readerAPI.deleteCloudAccount(danger.input); setStatus({ loading: false, authenticated: false }); setMessage('账户已永久删除，本机数据仍保留')
    }
    setDanger(null); window.dispatchEvent(new Event('moyu-cloud-changed'))
  })

  const formatSyncTime = (value) => new Date(value).toLocaleString('zh-CN')
  const syncStatusLines = (() => {
    if (!syncOverview) return null
    const localAt = syncOverview.localUpdatedAt ? Date.parse(syncOverview.localUpdatedAt) : 0
    const cloudAt = syncOverview.cloudSyncAt ? Date.parse(syncOverview.cloudSyncAt) : 0
    const reading = !localAt && !cloudAt ? '尚未同步'
      : `本地更新于 ${localAt ? formatSyncTime(syncOverview.localUpdatedAt) : '—'} · 云端同步于 ${cloudAt ? formatSyncTime(syncOverview.cloudSyncAt) : '—'}${localAt > cloudAt ? ' · 有未同步更改' : cloudAt > localAt ? ' · 云端有更新' : ''}`
    const localBooks = syncOverview.localBookCount || 0
    const cloudBooks = syncOverview.libraryCount || 0
    const library = `本地 ${localBooks} 本 · 云端 ${cloudBooks} 本${localBooks > cloudBooks ? ` · 有 ${localBooks - cloudBooks} 本待上传` : ''}`
    const snapshot = syncOverview.snapshotAt ? `最近备份于 ${formatSyncTime(syncOverview.snapshotAt)}` : '从未备份'
    return { reading, library, snapshot }
  })()

  if (status.loading) return <section className="b-account-section"><div className="b-account-loading">正在检查账户状态…</div></section>

  return (
    <section className="b-account-section">
      <div className="b-section-heading"><div><h2>用户账户</h2><p>登录后可将书籍、笔记、阅读记录、AI 数据和外观设置按账户保存到云端</p></div>{status.authenticated ? <span className="b-cloud-state"><i /> 云端已连接</span> : null}</div>
      {status.authenticated ? (
        <div className="b-account-signed-in">
          <div className="b-account-identity"><span>{status.user?.avatar ? <img src={status.user.avatar} alt="" /> : <UserRound size={19} />}</span><div><strong>{status.user?.nickname || status.user?.username}</strong><small>@{status.user?.username} · {status.user?.sync?.updatedAt ? `同步于 ${new Date(status.user.sync.updatedAt).toLocaleString('zh-CN')}` : '尚未建立日常同步数据'}</small></div><button className="b-secondary-button" disabled={Boolean(busy)} onClick={logout}><LogOut size={14} />退出</button></div>
          <details className="b-password-panel" open><summary><UserRound size={14} />个人资料</summary><div className="b-profile-editor"><button className="b-avatar-editor" onClick={chooseAvatar}>{avatar ? <img src={avatar} alt="当前头像" /> : <UserRound size={22} />}<span>更换头像</span></button><label><span>昵称</span><input value={nickname} maxLength={32} onChange={(event) => setNickname(event.target.value)} /></label><button className="b-secondary-button" disabled={Boolean(busy) || !nickname.trim()} onClick={saveProfile}>{busy === 'profile' ? '保存中…' : '保存资料'}</button></div></details>
          <div className="b-account-actions b-sync-actions"><button className="b-primary-button" disabled={Boolean(busy)} onClick={syncData}><CloudUpload size={16} />{busy === 'sync' ? '同步中…' : '同步阅读数据'}</button><button className="b-secondary-button" disabled={Boolean(busy)} onClick={syncLibrary}><CloudUpload size={15} />{busy === 'library' ? (libraryProgress?.total ? `${libraryProgress.current}/${libraryProgress.total}` : '核对中…') : `同步个人书库${status.user?.libraryCount ? `（${status.user.libraryCount} 本）` : ''}`}</button><span>新设备先恢复书架，书籍点击后才下载；已下载书籍断网可读</span></div>
          {syncStatusLines ? <div className="b-sync-status"><span><strong>阅读数据</strong>{syncStatusLines.reading}</span><span><strong>个人书库</strong>{syncStatusLines.library}</span><span><strong>完整备份</strong>{syncStatusLines.snapshot}</span></div> : null}
          {libraryProgress?.title ? <p className="b-library-progress">{libraryProgress.title}</p> : null}
          <details className="b-password-panel"><summary><CloudUpload size={14} />完整灾难备份</summary><div className="b-backup-row"><span>包含全部本地书籍，体积较大，只需偶尔手动执行。API Key 不上传。{status.user?.snapshot?.updatedAt ? ` 最近备份于 ${new Date(status.user.snapshot.updatedAt).toLocaleString('zh-CN')}。` : ''}</span><button className="b-secondary-button" disabled={Boolean(busy)} onClick={backup}>{busy === 'backup' ? '备份中…' : '上传完整备份'}</button><button className="b-secondary-button b-warning-button" disabled={Boolean(busy) || !status.user?.snapshot} onClick={() => setDanger({ type: 'restore', input: '' })}><RotateCcw size={14} />恢复云端备份</button></div></details>
          <details className="b-password-panel"><summary><LockKeyhole size={14} />修改密码</summary><div><input type="password" autoComplete="current-password" value={currentPassword} placeholder="当前密码" onChange={(event) => setCurrentPassword(event.target.value)} /><input type="password" autoComplete="new-password" value={newPassword} placeholder="新密码（至少 10 位）" onChange={(event) => setNewPassword(event.target.value)} /><input type="password" autoComplete="new-password" value={confirmPassword} placeholder="再次输入新密码" onChange={(event) => setConfirmPassword(event.target.value)} /><button className="b-secondary-button" disabled={Boolean(busy) || !currentPassword || !newPassword || !confirmPassword} onClick={changePassword}>{busy === 'password' ? '修改中…' : '确认修改'}</button></div></details>
          <details className="b-password-panel b-account-management"><summary><Download size={14} />账户管理</summary><div><button className="b-secondary-button" onClick={exportAccount}><Download size={14} />导出账户数据</button><button className="b-secondary-button b-warning-button" onClick={() => setDanger({ type: 'clear', input: '' })}><Eraser size={14} />清空云端数据</button><button className="b-secondary-button b-danger-button" onClick={() => setDanger({ type: 'delete', input: '' })}><UserX size={14} />删除账户</button></div></details>
        </div>
      ) : (
        <div className="b-account-auth">
          {status.error ? <p className="b-account-message">{status.error === '登录已失效，请重新登录' ? '登录已失效，请重新登录' : `云端连接异常：${status.error}`}</p> : null}
          <div className="b-auth-tabs"><button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>登录</button><button className={authMode === 'register' ? 'active' : ''} onClick={() => setAuthMode('register')}>创建账户</button></div>
          <div className="b-auth-fields"><label><span>用户名</span><input autoComplete="username" value={username} placeholder="3–32 位字母、数字或下划线" onChange={(event) => setUsername(event.target.value)} /></label><label><span>密码</span><input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={password} placeholder="至少 10 位" onChange={(event) => setPassword(event.target.value)} /></label>{authMode === 'register' ? <label><span>重复密码</span><input type="password" autoComplete="new-password" value={confirmRegisterPassword} placeholder="再次输入密码" onChange={(event) => setConfirmRegisterPassword(event.target.value)} /></label> : null}{authMode === 'register' ? <label><span>邀请码</span><input autoComplete="off" value={inviteCode} placeholder="注册需要有效邀请码" onChange={(event) => setInviteCode(event.target.value)} /></label> : null}<button className="b-primary-button" disabled={Boolean(busy) || !username.trim() || !password || (authMode === 'register' && (!confirmRegisterPassword || !inviteCode.trim()))} onClick={submitAuth}><LogIn size={15} />{busy ? '请稍候…' : authMode === 'register' ? '注册并登录' : '登录'}</button></div>
        </div>
      )}
      {cropImage ? <AvatarCropDialog image={cropImage} onCancel={() => setCropImage('')} onConfirm={confirmCrop} /> : null}
      {message ? <p className="b-account-message">{message}</p> : null}
      {danger ? (() => {
        const dangerConfig = {
          delete: { label: '删除账户警告', title: '永久删除账户', body: '账户、云端书籍、笔记、想法和评价将永久删除，无法恢复。本机书籍不会被删除。', phrase: '我确认删除账号', action: '永久删除账户' },
          clear: { label: '清空账户数据警告', title: '清空云端账户数据', body: '云端书库、同步数据、笔记、想法和评价将被清空；账户和本机数据保留。', phrase: '我确认清空账户数据', action: '确认清空' },
          restore: { label: '恢复云端备份警告', title: '恢复云端完整备份', body: '当前设备上的全部阅读数据、笔记和设置将被云端备份覆盖，书籍文件以云端备份为准。恢复完成后应用会自动重启。', phrase: '我确认恢复云端备份', action: '覆盖并恢复' },
        }[danger.type]
        return <div className="b-danger-overlay" role="alertdialog" aria-modal="true" aria-label={dangerConfig.label}><section><UserX size={25} /><h3>{dangerConfig.title}</h3><p>{dangerConfig.body}</p><label>请输入“{dangerConfig.phrase}”<input autoFocus value={danger.input} onChange={(event) => setDanger({ ...danger, input: event.target.value })} /></label><footer><button className="b-secondary-button" onClick={() => setDanger(null)}>取消</button><button className="b-danger-button" disabled={danger.input !== dangerConfig.phrase || Boolean(busy)} onClick={confirmDanger}>{busy === danger.type ? '正在执行…' : dangerConfig.action}</button></footer></section></div>
      })() : null}
    </section>
  )
}

function ColorOpacityControl({ label, color, opacity, onColor, onOpacity }) {
  return (
    <div className="b-color-opacity-control">
      <span>{label}</span>
      <label className="b-color-field">
        <input type="color" value={color} onChange={(event) => onColor(event.target.value)} aria-label={`${label}色值`} />
        <code>{color}</code>
      </label>
      <input type="range" min="0" max="100" step="1" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} aria-label={`${label}透明度`} />
      <output>{Math.round(opacity * 100)}%</output>
    </div>
  )
}

function GradientOpacityControl({ label, startColor, endColor, opacity, onStartColor, onEndColor, onOpacity }) {
  return (
    <div className="b-gradient-opacity-control">
      <span>{label}</span>
      <label className="b-color-field"><input type="color" value={startColor} onChange={(event) => onStartColor(event.target.value)} aria-label={`${label}起始色`} /><code>{startColor}</code></label>
      <label className="b-color-field"><input type="color" value={endColor} onChange={(event) => onEndColor(event.target.value)} aria-label={`${label}结束色`} /><code>{endColor}</code></label>
      <input type="range" min="0" max="100" step="1" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} aria-label={`${label}透明度`} />
      <output>{Math.round(opacity * 100)}%</output>
    </div>
  )
}

function OverlayGradientControl({ overlay, onChange }) {
  const midpoint = Math.round(overlay.midpoint * 100)
  const gradient = `linear-gradient(${overlay.angle}deg, color-mix(in srgb, ${overlay.startColor} ${Math.round(overlay.startOpacity * 100)}%, transparent) 0%, ${midpoint}%, color-mix(in srgb, ${overlay.endColor} ${Math.round(overlay.endOpacity * 100)}%, transparent) 100%)`

  return (
    <div className="b-overlay-gradient-control">
      <label className="b-gradient-angle-field">
        <span>方向</span>
        <span className="b-number-field"><input type="number" min="0" max="359" step="1" value={overlay.angle} onChange={(event) => onChange({ angle: ((Number(event.target.value) % 360) + 360) % 360 })} aria-label="渐变方向" /><i>°</i></span>
      </label>
      <div className="b-gradient-midpoint-field">
        <span>过渡中心</span>
        <div className="b-gradient-track" style={{ '--b-overlay-preview': gradient }}>
          <i className="is-start" style={{ background: overlay.startColor, opacity: overlay.startOpacity }} />
          <input type="range" min="1" max="99" step="1" value={midpoint} onChange={(event) => onChange({ midpoint: Number(event.target.value) / 100 })} aria-label="渐变过渡中心" />
          <i className="is-end" style={{ background: overlay.endColor, opacity: overlay.endOpacity }} />
        </div>
        <output>{midpoint}%</output>
      </div>
    </div>
  )
}

export default function AppearancePanel({ appearance, onChange, onClose }) {
  const [busyScope, setBusyScope] = useState('')
  const [scope, setScope] = useState('home')
  const [thumbs, setThumbs] = useState({})
  const [selectedSchemeId, setSelectedSchemeId] = useState(appearance.activeSchemeId || '')
  const [schemeDirty, setSchemeDirty] = useState(!appearance.activeSchemeId)
  const [exporting, setExporting] = useState(false)
  const [exportResult, setExportResult] = useState('')

  // 导出用户数据：数据目录 + 便携 exe 打成一个文件夹，方便拷到新电脑。
  const exportUserData = async () => {
    if (exporting) return
    setExporting(true)
    setExportResult('')
    try {
      const result = await window.readerAPI?.exportUserDataFolder?.()
      if (result?.folder) setExportResult(result.folder)
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `导出用户数据失败：${error?.message || '请检查目标文件夹权限'}` }))
    } finally {
      setExporting(false)
    }
  }
  const custom = useMemo(() => (Array.isArray(appearance.custom) ? appearance.custom : []), [appearance.custom])
  const schemes = useMemo(() => (Array.isArray(appearance.schemes) ? appearance.schemes : []), [appearance.schemes])
  const scopePreference = appearance[scope]
  const selectedCustomScheme = schemes.find((scheme) => scheme.id === selectedSchemeId)

  useEffect(() => {
    const handleKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    const missing = custom.filter((entry) => entry.assetPath && !thumbs[entry.id])
    if (!missing.length) return undefined
    Promise.all(missing.map(async (entry) => [entry.id, await window.readerAPI?.readBackground(entry.assetPath).catch(() => '')])).then((loaded) => {
      if (!cancelled) setThumbs((current) => ({ ...current, ...Object.fromEntries(loaded) }))
    })
    return () => { cancelled = true }
  }, [custom, thumbs])

  const updateDraft = (next) => {
    setSchemeDirty(true)
    onChange({ ...next, activeSchemeId: '' })
  }

  const updateScope = (target, patch) => updateDraft({ ...appearance, [target]: { ...appearance[target], ...patch } })

  const updateOverlay = (target, theme, patch) => updateScope(target, {
    overlay: {
      ...appearance[target].overlay,
      [theme]: { ...appearance[target].overlay[theme], ...patch },
    },
  })

  const updateBar = (bar, patch) => updateDraft({
    ...appearance,
    bars: { ...appearance.bars, [bar]: { ...appearance.bars[bar], ...patch } },
  })

  const applyScheme = (scheme) => {
    const next = normalizeAppearance({
      ...appearance,
      ...clone(scheme.settings),
      custom: appearance.custom,
      schemes: appearance.schemes,
      activeSchemeId: scheme.id,
    })
    setSelectedSchemeId(scheme.id)
    setSchemeDirty(false)
    onChange(next)
  }

  const createScheme = () => {
    const id = `custom-${Date.now()}`
    const usedNames = new Set(schemes.map((scheme) => scheme.name))
    let index = schemes.length + 1
    let name = `新外观方案 ${index}`
    while (usedNames.has(name)) name = `新外观方案 ${++index}`
    const scheme = { id, name, settings: snapshotAppearance(appearance) }
    setSelectedSchemeId(id)
    setSchemeDirty(false)
    onChange({ ...appearance, schemes: [...schemes, scheme], activeSchemeId: id })
  }

  const renameScheme = (schemeId, name) => {
    onChange({ ...appearance, schemes: schemes.map((scheme) => scheme.id === schemeId ? { ...scheme, name: name.slice(0, 30) } : scheme) })
  }

  const saveScheme = () => {
    if (!selectedCustomScheme) return
    onChange({
      ...appearance,
      schemes: schemes.map((scheme) => scheme.id === selectedCustomScheme.id ? { ...scheme, name: scheme.name.trim() || '自定义外观', settings: snapshotAppearance(appearance) } : scheme),
      activeSchemeId: selectedCustomScheme.id,
    })
    setSchemeDirty(false)
  }

  const deleteScheme = (schemeId) => {
    const nextSchemes = schemes.filter((scheme) => scheme.id !== schemeId)
    const builtin = BUILTIN_SCHEMES.find((scheme) => scheme.id === `builtin-${appearance.theme}`) || BUILTIN_SCHEMES[0]
    setSelectedSchemeId(builtin.id)
    setSchemeDirty(false)
    onChange(normalizeAppearance({ ...appearance, ...clone(builtin.settings), custom: appearance.custom, schemes: nextSchemes, activeSchemeId: builtin.id }))
  }

  const assign = (asset, target) => {
    const assigned = appearance[target]?.asset?.id === asset.id
    updateScope(target, { asset: assigned ? null : asset, enabled: true })
  }

  const choose = async (target) => {
    setBusyScope(target)
    try {
      const asset = await window.readerAPI?.chooseBackground(target)
      if (!asset) return
      const existing = custom.find((item) => item.id === asset.id)
      const entry = { ...asset, kind: 'custom', name: existing?.name || (asset.fileName || '自定义背景').replace(/\.[^.]+$/, '') }
      const nextCustom = [...custom.filter((item) => item.id !== entry.id), entry]
      updateDraft({ ...appearance, custom: nextCustom, [target]: { ...appearance[target], asset: entry, enabled: true } })
    } catch (error) {
      window.dispatchEvent(new CustomEvent('reader-error', { detail: `背景导入失败：${error?.message || '无法读取图片'}` }))
    } finally {
      setBusyScope('')
    }
  }

  const renameBackground = (asset, name) => {
    const nextName = name.slice(0, 40)
    const updateSelected = (preference) => preference?.asset?.id === asset.id
      ? { ...preference, asset: { ...preference.asset, name: nextName } }
      : preference
    const updateScheme = (scheme) => ({
      ...scheme,
      settings: {
        ...scheme.settings,
        home: updateSelected(scheme.settings?.home),
        reader: updateSelected(scheme.settings?.reader),
      },
    })
    onChange({
      ...appearance,
      custom: custom.map((item) => item.id === asset.id ? { ...item, name: nextName } : item),
      home: updateSelected(appearance.home),
      reader: updateSelected(appearance.reader),
      schemes: schemes.map(updateScheme),
    })
  }

  const deleteBackground = async (asset) => {
    await window.readerAPI?.deleteBackground(asset.assetPath).catch(() => {})
    const clearIfSelected = (current) => current?.asset?.id === asset.id ? { ...current, asset: null, enabled: true } : current
    onChange({
      ...appearance,
      custom: custom.filter((item) => item.id !== asset.id),
      home: clearIfSelected(appearance.home),
      reader: clearIfSelected(appearance.reader),
      schemes: schemes.map((scheme) => ({
        ...scheme,
        settings: {
          ...scheme.settings,
          home: clearIfSelected(scheme.settings?.home),
          reader: clearIfSelected(scheme.settings?.reader),
        },
      })),
      activeSchemeId: '',
    })
    setSchemeDirty(true)
  }

  return (
    <div className="b-panel-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="b-appearance-panel is-compact" role="dialog" aria-modal="true" aria-label="用户数据与外观设置">
        <header><div><span>账户与外观</span><strong>用户数据</strong></div><button className="b-icon-button" onClick={onClose} aria-label="关闭"><X size={18} /></button></header>
        <div className="b-appearance-body">
          <AccountSection />
          <section className="b-export-section">
            <div className="b-section-heading"><div><h2>导出用户数据</h2><p>把全部阅读数据（和便携版程序）打成一个文件夹，拷到新电脑即可继续使用</p></div></div>
            <button className="b-secondary-button" disabled={exporting} onClick={exportUserData}><FolderOutput size={15} />{exporting ? '正在导出…' : '选择位置并导出'}</button>
            {exportResult ? <p className="b-export-result" title={exportResult}>已导出到 {exportResult}</p> : null}
          </section>

          <section className="b-schemes-section">
            <div className="b-section-heading"><div><h2>外观方案</h2><p>{schemeDirty ? '当前效果尚未保存到方案' : '切换时会应用整套背景、遮罩与界面配色'}</p></div><button className="b-secondary-button" onClick={createScheme}><Plus size={15} />新建方案</button></div>
            <div className="b-scheme-list" aria-label="外观方案">
              {BUILTIN_SCHEMES.map((scheme) => <button key={scheme.id} className={selectedSchemeId === scheme.id && !schemeDirty ? 'active' : ''} onClick={() => applyScheme(scheme)}><span className={`b-scheme-swatch is-${scheme.settings.theme}`}><i /><i /><i /></span><span><strong>{scheme.name}</strong><small>内置，只读</small></span>{selectedSchemeId === scheme.id && !schemeDirty ? <Check size={14} /> : null}</button>)}
              {schemes.map((scheme) => (
                <article className={selectedSchemeId === scheme.id ? `b-scheme-item active${schemeDirty ? ' is-dirty' : ''}` : 'b-scheme-item'} key={scheme.id}>
                  <button className="b-scheme-apply" onClick={() => applyScheme(scheme)} aria-label={`应用 ${scheme.name}`}><span className={`b-scheme-swatch is-${scheme.settings?.theme === 'night' ? 'night' : 'mist'}`}><i /><i /><i /></span></button>
                  <input value={scheme.name} maxLength={30} onChange={(event) => renameScheme(scheme.id, event.target.value)} aria-label={`重命名 ${scheme.name}`} />
                  {selectedSchemeId === scheme.id && !schemeDirty ? <Check size={14} /> : null}
                  <button className="b-icon-button danger" onClick={() => deleteScheme(scheme.id)} title="删除方案" aria-label={`删除 ${scheme.name}`}><Trash2 size={14} /></button>
                </article>
              ))}
            </div>
          </section>

          <section className="b-theme-section">
            <h2>主题</h2>
            <div className="b-theme-switch">
              {THEMES.map((theme) => (
                <button key={theme.id} className={appearance.theme === theme.id ? 'active' : ''} onClick={() => updateDraft({ ...appearance, theme: theme.id })}>
                  <span className="b-theme-swatches">{theme.colors.map((color) => <i key={color} style={{ background: color }} />)}</span>
                  <span>{theme.name}</span>
                  {appearance.theme === theme.id ? <Check size={14} /> : null}
                </button>
              ))}
            </div>
          </section>

          <section className="b-background-section">
            <div className="b-section-heading"><div><h2>背景</h2></div><div className="b-segmented" aria-label="背景使用位置">{Object.entries(SCOPE_LABELS).map(([id, label]) => <button key={id} className={scope === id ? 'active' : ''} onClick={() => setScope(id)}>{label}</button>)}</div></div>
            <div className="b-background-source-row">
              <div><strong>{scopePreference.asset?.name || '跟随主题默认背景'}</strong><span>{scopePreference.asset?.fileName || '使用对应深浅主题的主页背景图'}</span></div>
              {scopePreference.asset ? <button className="b-icon-button" onClick={() => updateScope(scope, { asset: null, enabled: true })} title="恢复默认背景" aria-label="恢复默认背景"><RotateCcw size={15} /></button> : null}
              <button className="b-secondary-button" onClick={() => choose(scope)} disabled={Boolean(busyScope)}><ImagePlus size={16} />{busyScope === scope ? '导入中' : '上传图片'}</button>
            </div>
            <div className="b-scope-overlay-grid">
              {THEMES.map((theme) => {
                const overlay = scopePreference.overlay[theme.id]
                return <div className="b-overlay-theme-group" key={theme.id}><strong>{theme.name}遮罩</strong><OverlayGradientControl overlay={overlay} onChange={(patch) => updateOverlay(scope, theme.id, patch)} /><ColorOpacityControl label="起点" color={overlay.startColor} opacity={overlay.startOpacity} onColor={(startColor) => updateOverlay(scope, theme.id, { startColor })} onOpacity={(startOpacity) => updateOverlay(scope, theme.id, { startOpacity })} /><ColorOpacityControl label="终点" color={overlay.endColor} opacity={overlay.endOpacity} onColor={(endColor) => updateOverlay(scope, theme.id, { endColor })} onOpacity={(endOpacity) => updateOverlay(scope, theme.id, { endOpacity })} /></div>
              })}
            </div>
          </section>

          <section className="b-background-library-section">
            <div className="b-section-heading"><div><h2>已上传背景</h2></div></div>
            {custom.length ? (
              <div className="b-background-library" aria-label="已上传背景">
                {custom.map((entry) => {
                  const usedHome = appearance.home?.asset?.id === entry.id
                  const usedReader = appearance.reader?.asset?.id === entry.id
                  return (
                    <article className="b-background-card" key={entry.id}>
                      <div className="b-background-thumb">{thumbs[entry.id] ? <img src={thumbs[entry.id]} alt="" /> : null}</div>
                      <div className="b-background-meta"><input value={entry.name || ''} maxLength={40} onChange={(event) => renameBackground(entry, event.target.value)} aria-label={`重命名 ${entry.fileName || '背景图片'}`} /><span>{entry.fileName || '本地图片'}</span></div>
                      <div className="b-background-targets" aria-label={`${entry.name || entry.fileName} 使用位置`}>
                        <button className={usedHome ? 'active' : ''} onClick={() => assign(entry, 'home')}>{usedHome ? <Check size={13} /> : null}主页</button>
                        <button className={usedReader ? 'active' : ''} onClick={() => assign(entry, 'reader')}>{usedReader ? <Check size={13} /> : null}阅读</button>
                      </div>
                      <button className="b-icon-button danger" onClick={() => deleteBackground(entry)} title="删除背景" aria-label={`删除 ${entry.name || entry.fileName}`}><Trash2 size={15} /></button>
                    </article>
                  )
                })}
              </div>
            ) : <div className="b-background-library-empty"><ImagePlus size={22} /><span>还没有上传背景</span></div>}
          </section>

          <section className="b-bars-section">
            <div className="b-section-heading"><div><h2>界面条与图标</h2></div></div>
            <div className="b-bar-controls">
              <div><strong>顶部栏</strong><ColorOpacityControl label="栏" color={appearance.bars.top.color} opacity={appearance.bars.top.opacity} onColor={(color) => updateBar('top', { color })} onOpacity={(opacity) => updateBar('top', { opacity })} /><ColorOpacityControl label="图标" color={appearance.bars.top.iconColor} opacity={appearance.bars.top.iconOpacity} onColor={(iconColor) => updateBar('top', { iconColor })} onOpacity={(iconOpacity) => updateBar('top', { iconOpacity })} /></div>
              <div><strong>主页底栏</strong><ColorOpacityControl label="栏" color={appearance.bars.bottom.color} opacity={appearance.bars.bottom.opacity} onColor={(color) => updateBar('bottom', { color })} onOpacity={(opacity) => updateBar('bottom', { opacity })} /><ColorOpacityControl label="侧图标" color={appearance.bars.bottom.iconColor} opacity={appearance.bars.bottom.iconOpacity} onColor={(iconColor) => updateBar('bottom', { iconColor })} onOpacity={(iconOpacity) => updateBar('bottom', { iconOpacity })} /><ColorOpacityControl label="切换圆" color={appearance.bars.bottom.circleColor} opacity={appearance.bars.bottom.circleOpacity} onColor={(circleColor) => updateBar('bottom', { circleColor })} onOpacity={(circleOpacity) => updateBar('bottom', { circleOpacity })} /><GradientOpacityControl label="太阳" startColor={appearance.bars.bottom.sunStartColor} endColor={appearance.bars.bottom.sunEndColor} opacity={appearance.bars.bottom.sunOpacity} onStartColor={(sunStartColor) => updateBar('bottom', { sunStartColor })} onEndColor={(sunEndColor) => updateBar('bottom', { sunEndColor })} onOpacity={(sunOpacity) => updateBar('bottom', { sunOpacity })} /><GradientOpacityControl label="月亮" startColor={appearance.bars.bottom.moonStartColor} endColor={appearance.bars.bottom.moonEndColor} opacity={appearance.bars.bottom.moonOpacity} onStartColor={(moonStartColor) => updateBar('bottom', { moonStartColor })} onEndColor={(moonEndColor) => updateBar('bottom', { moonEndColor })} onOpacity={(moonOpacity) => updateBar('bottom', { moonOpacity })} /></div>
            </div>
          </section>
        </div>
        <footer><span className="b-scheme-save-status">{selectedCustomScheme ? (schemeDirty ? `“${selectedCustomScheme.name}”有未保存更改` : `已保存到“${selectedCustomScheme.name}”`) : (selectedSchemeId.startsWith('builtin-') && !schemeDirty ? '当前为内置默认方案' : '新建方案后可保存当前效果')}</span>{selectedCustomScheme ? <button className="b-secondary-button" onClick={saveScheme} disabled={!schemeDirty}><Save size={15} />保存方案</button> : null}<button className="b-primary-button" onClick={onClose}>完成</button></footer>
      </section>
    </div>
  )
}
