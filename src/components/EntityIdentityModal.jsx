import { useEffect, useState } from 'react'
import { Link2, Save, Scissors, ShieldCheck, X } from 'lucide-react'

const parseNames = (value) => [...new Set(String(value || '').split(/[，,、\n]/).map((item) => item.trim()).filter(Boolean))]

export default function EntityIdentityModal({ profile, profiles, onSave, onMerge, onSplit, onClose }) {
  const [name, setName] = useState(profile?.name || '')
  const [aliases, setAliases] = useState((profile?.aliases || []).join('、'))
  const [distinctFrom, setDistinctFrom] = useState((profile?.distinctFrom || []).join('、'))
  const [mergeId, setMergeId] = useState('')
  useEffect(() => {
    setName(profile?.name || '')
    setAliases((profile?.aliases || []).join('、'))
    setDistinctFrom((profile?.distinctFrom || []).join('、'))
  }, [profile])
  if (!profile) return null
  const otherProfiles = profiles.filter((item) => item.id !== profile.id)
  const submit = (event) => {
    event.preventDefault()
    const canonical = name.trim()
    if (!canonical) return
    onSave?.(profile.id, { name: canonical, aliases: parseNames(aliases).filter((item) => item !== canonical), distinctFrom: parseNames(distinctFrom) })
    onClose?.()
  }
  return (
    <div className="modal-backdrop identity-modal-backdrop">
      <form className="identity-modal" onSubmit={submit} role="dialog" aria-modal="true" aria-label="管理资料关联">
        <header className="ai-modal-header"><div><Link2 size={19} /><div><strong>管理名称与关联</strong><span>人工确认将覆盖今后的 AI 判断</span></div></div><button type="button" className="icon-command" onClick={onClose} title="关闭"><X size={17} /></button></header>
        <div className="identity-body">
          <div className="ai-security-note"><ShieldCheck size={15} /><span>保存后，这些名称会被锁定为同一对象；“明确不同”中的名称永远不会被自动合并。</span></div>
          <label><span>主名称</span><input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} /></label>
          <label><span>同一对象的昵称、外号或简称</span><textarea value={aliases} onChange={(event) => setAliases(event.target.value)} rows="4" placeholder="用逗号、顿号或换行分隔" /></label>
          {(profile.aliases || []).length ? <div className="identity-alias-list"><span>将错误别名拆成独立资料：</span>{profile.aliases.map((alias) => <button type="button" key={alias} onClick={() => { onSplit?.(profile.id, alias); onClose?.() }}><Scissors size={12} /> {alias}</button>)}</div> : null}
          <label><span>明确不是同一对象的名称</span><textarea value={distinctFrom} onChange={(event) => setDistinctFrom(event.target.value)} rows="3" placeholder="例如：同姓但不同人的另一个名字" /></label>
          <div className="identity-merge"><label><span>合并另一张已有资料卡</span><select value={mergeId} onChange={(event) => setMergeId(event.target.value)}><option value="">选择资料卡</option>{otherProfiles.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><button type="button" className="secondary-button" disabled={!mergeId} onClick={() => { onMerge?.(profile.id, mergeId); onClose?.() }}><Link2 size={13} /> 确认为同一对象</button></div>
        </div>
        <footer className="dialog-footer"><span>修改只影响当前书的设定集</span><div><button type="button" className="secondary-button" onClick={onClose}>取消</button><button className="primary-button"><Save size={14} /> 保存人工规则</button></div></footer>
      </form>
    </div>
  )
}
