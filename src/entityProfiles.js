const unique = (values) => [...new Set(values.filter(Boolean))]

// 早期版本曾把破损的原始 JSON 当作 summary 存进缓存，这类坏卡可以本地修复或删除。
export function isCorruptProfile(profile) {
  const summary = String(profile?.summary || '').trim()
  return /^\{\s*"(type|canonicalName|aliases|summary)"/.test(summary)
}

export function removeEntityProfile(profiles, profileId) {
  return (profiles || []).filter((item) => item.id !== profileId)
}

export function upsertEntityProfile(profiles, incoming) {
  const next = [...(profiles || [])]
  const incomingNames = new Set([incoming.name, ...(incoming.aliases || [])].filter(Boolean))
  const conflicts = (candidate) => (candidate.distinctFrom || []).some((name) => incomingNames.has(name))
    || (incoming.distinctFrom || []).some((name) => name === candidate.name || candidate.aliases?.includes(name))
  let index = next.findIndex((item) => item.id === incoming.id)
  if (index < 0) index = next.findIndex((item) => !conflicts(item) && (incomingNames.has(item.name) || item.aliases?.some((alias) => incomingNames.has(alias))))
  if (index < 0) return [...next, incoming]
  const existing = next[index]
  next[index] = existing.identityLocked
    ? { ...incoming, id: existing.id, name: existing.name, aliases: existing.aliases || [], distinctFrom: existing.distinctFrom || [], identityLocked: true }
    : { ...existing, ...incoming, id: existing.id, aliases: unique([...(existing.aliases || []), ...(incoming.aliases || [])]).filter((name) => name !== incoming.name) }
  return next
}

export function setEntityIdentity(profiles, profileId, identity, now = Date.now()) {
  return (profiles || []).map((profile) => profile.id === profileId ? { ...profile, ...identity, identityLocked: true, updatedAt: now } : profile)
}

export function mergeEntityProfiles(profiles, targetId, sourceId, now = Date.now()) {
  if (targetId === sourceId) return profiles
  const target = profiles.find((item) => item.id === targetId)
  const source = profiles.find((item) => item.id === sourceId)
  if (!target || !source) return profiles
  const newest = Number(source.readPosition) > Number(target.readPosition) ? source : target
  const aliases = unique([...(target.aliases || []), source.name, ...(source.aliases || [])]).filter((name) => name !== target.name)
  const merged = { ...newest, id: target.id, name: target.name, aliases, distinctFrom: unique([...(target.distinctFrom || []), ...(source.distinctFrom || [])]).filter((name) => name !== target.name && !aliases.includes(name)), identityLocked: true, updatedAt: now }
  return profiles.filter((item) => item.id !== sourceId).map((item) => item.id === targetId ? merged : item)
}

export function splitEntityAlias(profiles, profileId, alias, now = Date.now(), id = `${now}-${Math.random().toString(16).slice(2)}`) {
  const source = profiles.find((item) => item.id === profileId)
  if (!source || !alias || !(source.aliases || []).includes(alias)) return profiles
  const remainingAliases = (source.aliases || []).filter((name) => name !== alias)
  const sourceNames = [source.name, ...remainingAliases]
  const updated = { ...source, aliases: remainingAliases, distinctFrom: unique([...(source.distinctFrom || []), alias]), identityLocked: true, updatedAt: now }
  const separate = { id, name: alias, aliases: [], distinctFrom: sourceNames, identityLocked: true, type: source.type || '未分类', summary: '已由用户确认为独立对象，尚未在更后阅读进度单独更新资料。', evidence: [], totalMatches: 0, sentCount: 0, readPosition: source.readPosition, readPercent: source.readPercent, createdAt: now }
  return [...profiles.map((item) => item.id === profileId ? updated : item), separate]
}

