import { useEffect, useMemo, useState } from 'react'
import { KeyRound, Plus, RefreshCw, Save, ServerCog, ShieldCheck, Trash2, X } from 'lucide-react'

const EMPTY_PROVIDER = { id: '', name: '', baseUrl: '', apiKey: '', model: '', maxTokens: 2000, tokenParameter: 'auto' }

function ErrorDetails({ error }) {
  if (!error) return null
  return <div className="ai-error-card" role="alert"><strong>{error.message || '请求失败'}</strong><div><span>阶段：{error.stage || '未知'}</span><span>状态码：{error.status || '无'}</span><span>错误码：{error.code || 'UNKNOWN'}</span></div></div>
}

export default function AISettingsModal({ open, onClose, onChange }) {
  const [settings, setSettings] = useState(null)
  const [providerForm, setProviderForm] = useState(EMPTY_PROVIDER)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState(null)
  const selectedProvider = useMemo(() => settings?.providers?.find((item) => item.id === providerForm.id), [providerForm.id, settings])

  useEffect(() => {
    if (!open) return
    setError(null)
    window.readerAPI.getAiSettings().then((value) => {
      setSettings(value)
      onChange?.(value)
      const selected = value.providers.find((item) => item.id === value.activeProviderId) || value.providers[0]
      setProviderForm(selected ? { ...EMPTY_PROVIDER, ...selected, apiKey: '' } : EMPTY_PROVIDER)
    }).catch((reason) => setError({ stage: 'setup', code: 'LOAD_FAILED', message: reason?.message }))
  }, [open])

  if (!open) return null
  const updateSettings = (value) => { setSettings(value); onChange?.(value) }
  const selectProvider = (provider) => { setProviderForm({ ...EMPTY_PROVIDER, ...provider, apiKey: '' }); setError(null) }

  const saveProvider = async (event) => {
    event.preventDefault(); setBusy('save'); setError(null)
    try {
      const value = await window.readerAPI.saveAiProvider(providerForm)
      updateSettings(value)
      const saved = value.providers.find((item) => item.id === providerForm.id) || value.providers.find((item) => item.name === providerForm.name && item.baseUrl === providerForm.baseUrl)
      if (saved) {
        setProviderForm({ ...EMPTY_PROVIDER, ...saved, apiKey: '' })
        updateSettings(await window.readerAPI.saveAiPreferences({ activeProviderId: saved.id, providerId: saved.id, model: saved.model, maxTokens: saved.maxTokens, tokenParameter: saved.tokenParameter }))
      }
    } catch (reason) { setError({ stage: 'save', status: 0, code: 'SAVE_FAILED', message: reason?.message || '保存失败' }) }
    finally { setBusy('') }
  }

  const refreshProvider = async () => {
    if (!providerForm.id) return
    setBusy('refresh'); setError(null)
    const result = await window.readerAPI.refreshAiProvider(providerForm.id)
    if (result.settings) updateSettings(result.settings)
    if (!result.ok) setError(result.error)
    else setProviderForm((current) => ({ ...current, ...result.settings.providers.find((item) => item.id === providerForm.id), apiKey: '' }))
    setBusy('')
  }

  const deleteProvider = async () => {
    if (!providerForm.id || !window.confirm(`删除 AI 供应商“${providerForm.name}”？`)) return
    setBusy('delete')
    const value = await window.readerAPI.deleteAiProvider(providerForm.id)
    updateSettings(value)
    const next = value.providers.find((item) => item.id === value.activeProviderId) || value.providers[0]
    setProviderForm(next ? { ...EMPTY_PROVIDER, ...next, apiKey: '' } : EMPTY_PROVIDER)
    setBusy('')
  }

  return (
    <div className="modal-backdrop ai-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section className="ai-settings-modal" role="dialog" aria-modal="true" aria-label="AI 设置">
        <header className="ai-modal-header"><div><ServerCog size={20} /><div><strong>AI 设置</strong><span>用于防剧透资料回顾；配置仅保存在本机</span></div></div><button className="icon-command" onClick={onClose} title="关闭" aria-label="关闭"><X size={18} /></button></header>
        {!settings ? <div className="ai-loading"><RefreshCw className="spin" size={20} /> 正在读取本地设置</div> : (
          <div className="ai-provider-layout">
            <aside className="ai-provider-list">
              <button className="ai-add-provider" onClick={() => setProviderForm(EMPTY_PROVIDER)}><Plus size={15} /> 新建供应商</button>
              {settings.providers.map((provider) => <button key={provider.id} className={provider.id === providerForm.id ? 'active' : ''} onClick={() => selectProvider(provider)}><span><strong>{provider.name}</strong><small>{provider.model || '尚未选择模型'}</small></span><em className={`provider-dot is-${provider.lastStatus || 'idle'}`} /></button>)}
              {!settings.providers.length ? <p>还没有供应商。可使用 Kimi 模板，或填写任意 OpenAI 兼容反代。</p> : null}
            </aside>
            <form className="ai-provider-form" onSubmit={saveProvider}>
              <div className="ai-form-heading"><div><strong>{providerForm.id ? '编辑供应商' : '新建供应商'}</strong><span>保存后可刷新连接状态与模型列表</span></div><button type="button" className="text-button" onClick={() => setProviderForm({ ...EMPTY_PROVIDER, name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1' })}>使用 Kimi 模板</button></div>
              <label><span>方案名称</span><input value={providerForm.name} maxLength={80} placeholder="例如：Kimi 国内接口" onChange={(event) => setProviderForm({ ...providerForm, name: event.target.value })} /></label>
              <label><span>Base URL</span><input value={providerForm.baseUrl} spellCheck="false" placeholder="https://api.example.com/v1" onChange={(event) => setProviderForm({ ...providerForm, baseUrl: event.target.value })} /></label>
              <label><span>API Key</span><div className="secret-input"><KeyRound size={15} /><input type="password" autoComplete="off" value={providerForm.apiKey} placeholder={providerForm.hasKey ? '已安全保存；留空则不更换' : '输入 API Key'} onChange={(event) => setProviderForm({ ...providerForm, apiKey: event.target.value })} /></div></label>
              <div className="ai-security-note"><ShieldCheck size={15} /><span>{settings.encryptionAvailable ? 'Key 使用 Windows 系统安全存储加密，页面无法读回。' : '系统安全存储当前不可用，将拒绝保存 Key。'}</span></div>
              <label><span>模型</span><input list="ai-model-options" value={providerForm.model} placeholder="保存后刷新模型列表，也可手动填写" onChange={(event) => setProviderForm({ ...providerForm, model: event.target.value })} /><datalist id="ai-model-options">{(selectedProvider?.models || []).map((model) => <option value={model} key={model} />)}</datalist></label>
              <div className="ai-inline-fields"><label><span>资料卡最大输出长度</span><input type="number" min="256" max="8000" value={providerForm.maxTokens} onChange={(event) => setProviderForm({ ...providerForm, maxTokens: event.target.value })} /></label><label><span>输出参数</span><select value={providerForm.tokenParameter} onChange={(event) => setProviderForm({ ...providerForm, tokenParameter: event.target.value })}><option value="auto">自动兼容</option><option value="max_completion_tokens">max_completion_tokens</option><option value="max_tokens">max_tokens</option></select></label></div>
              <ErrorDetails error={error} />
              <footer className="ai-form-actions">{providerForm.id ? <button type="button" className="danger-button" onClick={deleteProvider} disabled={Boolean(busy)}><Trash2 size={15} /> 删除</button> : <span />}<div><button type="button" className="secondary-button" onClick={refreshProvider} disabled={!providerForm.id || Boolean(busy)}><RefreshCw className={busy === 'refresh' ? 'spin' : ''} size={15} /> 刷新状态与模型</button><button className="primary-button" disabled={Boolean(busy)}><Save size={15} /> {busy === 'save' ? '保存中' : '保存方案'}</button></div></footer>
            </form>
          </div>
        )}
      </section>
    </div>
  )
}
