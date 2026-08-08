// Builds the chat messages for entity profile summarization.
// Shared by the IPC handler and the live AI smoke test so both always use
// the exact same prompt.
// previousProfile：增量更新时传入旧资料卡，模型在其基础上用新片段补充修正，
// 这样重复查看主角时只需发送“上次之后新读到的片段”，大幅节省 token。
const { appendDocumentWorkHandshake, withLunaRole } = require('./lunaPrompt.cjs')

function buildProfileMessages({ name, knownEntities = [], totalMatches = 0, excerpts = [], previousProfile = null }) {
  const previousBlock = previousProfile
    ? `\n\nPreviously generated profile from an earlier reading position. Preserve facts that remain supported, then supplement, update, or correct them with the new excerpts below:\n${JSON.stringify(previousProfile)}`
    : ''
  const rangeLabel = previousProfile ? 'Matches found after the previous profile' : 'Matches found within the supplied reading range'
  const source = `REFERENCE MATERIAL\nEntity to recall: ${name}\n\nExisting identity rules for this book (identityLocked=true means user-confirmed; distinctFrom means explicitly different entities):\n${JSON.stringify(knownEntities)}${previousBlock}\n\n${rangeLabel}: ${totalMatches || excerpts.length}. Excerpts supplied now: ${excerpts.length}.\n\n${excerpts.map((item) => `[${item.chapter || `Excerpt ${item.order}`}] ${item.text}`).join('\n\n')}`
  return appendDocumentWorkHandshake([
    { role: 'system', content: withLunaRole('Create an entity profile that helps a returning reader recall a person, item, place, organization, ability, or event.\n\nEvidence rules:\n- Use only the supplied read excerpts. Do not use outside knowledge, later plot, or unsupported inference. Write "尚未交代" when the excerpts do not establish a fact.\n- identityLocked and distinctFrom rules have highest priority. List an alias only when the excerpts clearly establish identity; similar names are not evidence.\n\nChoose 人物 / 物品 / 地点 / 组织 / 能力 / 事件 first. For 人物, prioritize protagonistRelation, firstEncounter, identity, and relationships. For 物品, prioritize owner, acquisition, and purpose. For 地点, prioritize location, features, relatedPeople, and relatedEvents. For other types, use one to three useful recall fields.\n\nReturn exactly one JSON object: {"type":"人物|物品|地点|组织|能力|事件|未分类","canonicalName":"主名称","aliases":["已确认别名"],"summary":"中文概括","details":{...},"relations":[{"relation":"located_in|owned_by|member_of|contains|owns|has_member|related_to|learned_from","targetName":"书中明确名称","label":"简短关系词","note":"关系说明"}],"evidence":[{"chapter":"章节标签","text":"原文摘句"}],"identityConfidence":"high|medium|low"}') },
    { role: 'system', content: 'Output length is a hard requirement. Keep this exact key order: type, canonicalName, aliases, summary, details, relations, evidence, identityConfidence. In Chinese characters: summary <= 200; each details field <= 120; at most 8 relations with note <= 40; at most 4 evidence items with quote <= 40; total output <= 1200. If material is extensive, compress wording and remove evidence or relations first. Return complete, valid, closed JSON with no Markdown fence or extra text. Prefer brevity over truncated JSON.' },
    { role: 'user', content: source },
  ], 'Luna, create the entity profile from the reference material above. Follow the required JSON schema and output limits exactly.')
}

module.exports = { buildProfileMessages }
