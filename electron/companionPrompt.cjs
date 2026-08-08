// Builds the chat messages for the "AI 陪读" (reading companion) feature:
// chapter storyline summaries and free-form companion Q&A.
// Shared by the IPC handlers and tests so both always use the exact same prompt.
//
// 陪读的核心约束与字典百科一致：只能依据读者已读到/已总结的材料，
// 严禁剧透梳理进度之后的情节。
const { appendDocumentWorkHandshake, withLunaRole } = require('./lunaPrompt.cjs')

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
    `Create structured plot notes while accompanying the reader through 《${bookTitle || '未知'}》${author ? ` by ${author}` : ''}. Produce one summary after each supplied chapter.`,
    '',
    'Return one strictly closed JSON object with exactly these keys:',
    '{"timePoint":"故事内时间点","location":"主要地点","characters":["出场人物"],"events":["按顺序的关键事件，每条一句"],"gains":"主角获得/失去的东西，无则空字符串","openThreads":"本章留下的悬念伏笔，无则空字符串","text":"150字以内的本章剧情连贯叙述"}',
    '',
    'Rules:',
    '- Use only the supplied chapter text and preceding summaries. Do not add outside information or reveal unsupplied plot.',
    '- Write all JSON values in concise Simplified Chinese.',
    '- Order events by in-story chronology, with at most 6 one-sentence items.',
    '- Include only characters who actually appear in this chapter and whose names are supported.',
    '- If the chapter text is marked as truncated, summarize only the visible material and do not invent the missing portion.',
    '- Return complete, valid JSON only, with no Markdown fence or explanation. Prefer a shorter complete object over a truncated response.',
  ].join('\n')
  const source = [
    'REFERENCE MATERIAL',
    coverageNote ? `COVERAGE NOTE\n${coverageNote}\n` : '',
    `NEAREST PRECEDING CHAPTER SUMMARIES\n${formatPreviousSummaries(previousSummaries)}`,
    '',
    `CHAPTER TO SUMMARIZE: ${chapterLabel || '未知章节'}\n${chapterText || '(Chapter content unavailable.)'}`,
  ].join('\n')
  return appendDocumentWorkHandshake([
    { role: 'system', content: withLunaRole(system) },
    { role: 'user', content: source },
  ], 'Luna, summarize the supplied chapter now. Return only the complete JSON object required by the system instructions.')
}

// 陪读问答：读者针对已读剧情自由提问，材料为剧情梳理 + 设定集 + 对话历史。
function buildCompanionChatMessages({ bookTitle = '', author = '', storyline = [], entityProfiles = [], history = [], question = '' } = {}) {
  const system = [
    `Act as the AI reading companion for 《${bookTitle || '未知'}》${author ? ` by ${author}` : ''}. You have followed the reader only through the latest supplied summary and will answer questions about plot, characters, and open threads.`,
    '',
    'Answering rules:',
    '- Use only the supplied plot notes, entity notes, and conversation history. Never reveal events beyond the supplied summary range.',
    '- If the material has no relevant evidence, say "目前读到的部分还没有相关信息" instead of inventing an answer.',
    '- Keep people, objects, places, and other entities consistent with the supplied entity notes.',
    '- Answer the question directly in natural Simplified Chinese, without a greeting, in at most 500 Chinese characters. Simple Markdown lists and bold text are allowed.',
  ].join('\n')
  const source = [
    'REFERENCE MATERIAL',
    `PLOT NOTES IN CHAPTER ORDER\n${formatStoryline(storyline)}`,
    '',
    `ENTITY NOTES\n${formatEntityProfiles(entityProfiles)}`,
  ].join('\n')
  const historyMessages = (Array.isArray(history) ? history : [])
    .filter((item) => item && (item.role === 'user' || item.role === 'assistant') && String(item.content || '').trim())
    .slice(-10)
    .map((item) => ({ role: item.role, content: String(item.content) }))
  return appendDocumentWorkHandshake([
    { role: 'system', content: withLunaRole(system) },
    { role: 'user', content: source },
    ...historyMessages,
  ], question)
}

module.exports = { buildChapterSummaryMessages, buildCompanionChatMessages }
