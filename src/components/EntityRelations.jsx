const FALLBACK_LABELS = {
  located_in: '位于', contains: '包含', owned_by: '归属于', owns: '持有',
  member_of: '隶属于', has_member: '成员', related_to: '相关', learned_from: '传承自',
}

export default function EntityRelations({ relations = [], inbound = [], resolveProfile, onOpen }) {
  const rows = [
    ...relations.map((item) => ({ ...item, direction: 'out' })),
    ...inbound.map((item) => ({ ...item, direction: 'in' })),
  ].filter((item) => item.targetName)
  if (!rows.length) return null
  return <section className="entity-relations"><strong>关联索引</strong><div>{rows.map((item, index) => {
    const target = resolveProfile?.(item.targetName)
    return <button type="button" key={`${item.direction}-${item.relation}-${item.targetName}-${index}`} disabled={!target || !onOpen} onClick={() => target && onOpen?.(target)}>
      <span>{item.label || FALLBACK_LABELS[item.relation] || '相关'}</span><strong>{item.targetName}</strong>{item.note ? <small>{item.note}</small> : null}
    </button>
  })}</div></section>
}
