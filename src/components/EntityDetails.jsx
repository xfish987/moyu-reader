const LABELS = {
  protagonistRelation: '与主角的关系',
  firstEncounter: '与主角何时相识',
  relationships: '人物关系',
  identity: '身份与职责',
  owner: '归属',
  acquisition: '获得时间与经过',
  purpose: '用途与能力',
  location: '位置与性质',
  features: '这里有什么',
  relatedPeople: '相关人物与势力',
  relatedEvents: '相关事件',
}

export default function EntityDetails({ details }) {
  const entries = Object.entries(details || {}).filter(([, value]) => String(value || '').trim())
  if (!entries.length) return null
  return <dl className="entity-details">{entries.map(([key, value]) => <div key={key}><dt>{LABELS[key] || key}</dt><dd>{String(value)}</dd></div>)}</dl>
}
