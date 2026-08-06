// Builds the chat messages for the "AI 陪读" (reading companion) feature:
// chapter storyline summaries and free-form companion Q&A.
// Shared by the IPC handlers and tests so both always use the exact same prompt.
//
// 陪读的核心约束与字典百科一致：只能依据读者已读到/已总结的材料，
// 严禁剧透梳理进度之后的情节。

// 前序总结（最多 3 条，按章节顺序最接近的）帮助模型衔接剧情。
function formatPreviousSummaries(previousSummaries = []) {
  const lines = previousSummaries.slice(0, 3).map((item) => {
    const label = String(item?.label || '').trim()
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim()
    return text ? `- ${label || '未命名章节'}：${text}` : ''
  }).filter(Boolean)
  return lines.length ? lines.join('\n') : '（此前还没有任何章节总结）'
}

// 剧情梳理条目（章节级）：label + 连贯叙述 + 时间点/地点。
function formatStoryline(storyline = []) {
  const lines = storyline.slice(0, 60).map((item) => {
    const label = String(item?.label || '').trim()
    const text = String(item?.text || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    const meta = [item?.timePoint, item?.location].map((value) => String(value || '').trim()).filter(Boolean).join('，')
    return `- ${label || '未命名章节'}${meta ? `（${meta}）` : ''}：${text}`
  }).filter(Boolean)
  return lines.length ? lines.join('\n') : '（还没有剧情梳理）'
}

// 设定集压缩成简短名单，辅助模型理解人物/物品/地点，不喧宾夺主。
function formatEntityProfiles(entityProfiles = []) {
  const lines = entityProfiles.slice(0, 60).map((item) => {
    const name = String(item?.name || '').trim()
    const summary = String(item?.summary || '').replace(/\s+/g, ' ').trim()
    return name ? `- ${name}【${String(item?.type || '').trim() || '未分类'}】${summary}` : ''
  }).filter(Boolean)
  return lines.length ? lines.join('\n') : '（本书还没有设定集资料）'
}

// 章节剧情梳理：根据一章全文产出结构化 JSON 总结，供后续陪读问答引用。
function buildChapterSummaryMessages({ bookTitle = '', author = '', chapterLabel = '', chapterText = '', previousSummaries = [], coverageNote = '' } = {}) {
  const system = [
    `你是剧情梳理助手，正在为读者陪读《${bookTitle || '未知'}》${author ? `（作者：${author}）` : ''}。读者每读完一章，你根据该章节全文产出一份结构化剧情总结。`,
    '',
    '输出一个严格闭合的 JSON 对象，schema 如下（键名固定，不要增减键）：',
    '{"timePoint":"故事内时间点","location":"主要地点","characters":["出场人物"],"events":["按顺序的关键事件，每条一句"],"gains":"主角获得/失去的东西，无则空字符串","openThreads":"本章留下的悬念伏笔，无则空字符串","text":"150字以内的本章剧情连贯叙述"}',
    '',
    '约束：',
    '- 只依据所给章节文本与前序总结，不引入外部资料，不剧透未提供的内容。',
    '- events 按故事内时间顺序排列，不超过 6 条，每条一句话。',
    '- characters 列出本章实际出场的人物名，没有把握的不要写。',
    '- 若章节文本标注了截断，则只基于可见内容总结，不要脑补缺失部分。',
    '- 必须输出合法闭合的 JSON；除 JSON 之外不要输出任何内容（不要 Markdown 代码围栏，不要解释）。',
  ].join('\n')
  const user = [
    coverageNote ? `【覆盖范围说明】\n${coverageNote}\n` : '',
    `【前序章节总结（按章节顺序最接近的）】\n${formatPreviousSummaries(previousSummaries)}`,
    '',
    `【本次要总结的章节：${chapterLabel || '未知章节'}】\n${chapterText || '（章节内容不可用）'}`,
    '',
    '请按系统要求的 JSON schema 输出本章剧情总结。',
  ].join('\n')
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ]
}

// 陪读问答：读者针对已读剧情自由提问，材料为剧情梳理 + 设定集 + 对话历史。
function buildCompanionChatMessages({ bookTitle = '', author = '', storyline = [], entityProfiles = [], history = [], question = '' } = {}) {
  const system = [
    `你是《${bookTitle || '未知'}》${author ? `（作者：${author}）` : ''}的 AI 陪读，已跟随读者读到最新总结进度。读者会随时就剧情、人物、伏笔向你提问。`,
    '',
    '回答要求：',
    '- 只能依据所给的剧情梳理、设定集和对话历史回答；严禁剧透梳理进度之后的情节。',
    '- 若所给材料里没有相关信息，就明说"目前读到的部分还没有相关信息"，不要编造。',
    '- 涉及人物、物品、地点等设定时，与所给设定集保持一致。',
    '- 回答用简体中文，可以用 Markdown 列表/加粗组织要点。',
    '- 紧扣问题本身作答，不要客套开场白，不超过 500 字。',
    '',
    `【剧情梳理（读者已总结进度，按章节顺序）】\n${formatStoryline(storyline)}`,
    '',
    `【本书设定集（压缩名单）】\n${formatEntityProfiles(entityProfiles)}`,
  ].join('\n')
  const historyMessages = (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim())
    .slice(-10)
    .map((item) => ({ role: item.role, content: String(item.content) }))
  return [
    { role: 'system', content: system },
    ...historyMessages,
    { role: 'user', content: String(question || '') },
  ]
}

module.exports = { buildChapterSummaryMessages, buildCompanionChatMessages }
