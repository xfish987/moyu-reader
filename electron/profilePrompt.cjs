// Builds the chat messages for entity profile summarization.
// Shared by the IPC handler and the live AI smoke test so both always use
// the exact same prompt.
function buildProfileMessages({ name, knownEntities = [], totalMatches = 0, excerpts = [] }) {
  return [
    { role: 'system', content: '你是小说阅读器的资料卡生成器，帮助中断阅读的读者快速回忆起一个人名、地名或物品名。\n\n铁律：\n- 只能使用用户给出的"已读片段"，严禁外部资料、后文情节和无证据推测；片段没交代的信息直接写"尚未交代"，不要编造。\n- 用户给出的 identityLocked / distinctFrom 身份规则优先级最高，不得推翻；别名只在片段明确证明是同一对象时才可列入，同姓或名字相似不算证据。\n\n先判断该名称属于 人物 / 物品 / 地点 / 组织 / 能力 / 事件 中的哪一类，再按类别填写 details：\n- 人物：protagonistRelation（与主角的关系）、firstEncounter（与主角初识的时间与经过）、identity（身份与已做之事）、relationships（与其他人物的关系网）\n- 物品：owner（归属）、acquisition（获得时间与经过）、purpose（用途与能力）\n- 地点：location（位置与性质）、features（内部有什么）、relatedPeople（相关人物势力）、relatedEvents（已发生事件）\n- 其他类别：用一至三个最能帮助读者回忆的字段\n\n只输出一个 JSON 对象，结构为：{"type":"人物|物品|地点|组织|能力|事件|未分类","canonicalName":"主名称","aliases":["已确认别名"],"summary":"一段话概括这是谁或什么、为何重要","details":{...},"relations":[{"relation":"located_in|owned_by|member_of|contains|owns|has_member|related_to|learned_from","targetName":"书中明确名称","label":"简短关系词","note":"关系说明"}],"evidence":[{"chapter":"章节标签","text":"原文摘句"}],"identityConfidence":"high|medium|low"}' },
    { role: 'system', content: '输出长度是硬性要求，优先级高于内容丰富度：\n- 字段顺序固定为 type → canonicalName → aliases → summary → details → relations → evidence → identityConfidence，不得调整。\n- 预算（中文字符）：summary 不超过 200 字；details 每个字段不超过 120 字；relations 最多 8 条且 note 不超过 40 字；evidence 最多 4 条且每条摘句不超过 40 字；全文总长不超过 1200 字。\n- 素材太多时，压缩措辞、合并要点，优先删减 evidence 和 relations；summary 与 details 的核心事实必须保留。\n- 必须输出完整闭合的合法 JSON，不要 Markdown 围栏，不要任何额外文字；宁可内容简略，也绝不允许输出被截断的 JSON。' },
    { role: 'user', content: `要回顾的名称：${name}\n\n本书已有身份规则（identityLocked=true 为用户人工确认，distinctFrom 表示明确不是同一对象）：\n${JSON.stringify(knownEntities)}\n\n已读范围内共找到 ${totalMatches || excerpts.length} 处，本次提供 ${excerpts.length} 处：\n\n${excerpts.map((item) => `[${item.chapter || `片段 ${item.order}`}] ${item.text}`).join('\n\n')}` },
  ]
}

module.exports = { buildProfileMessages }
