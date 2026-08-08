// Builds the chat messages for the in-reading dictionary/encyclopedia feature.
// Shared by the IPC handler and tests so both always use the exact same prompt.
//
// 解说不是孤立查字典：模型必须结合选文前后语境（主角/NPC 的行为与处境）
// 把读者卡住的地方讲通。材料只有读者已读到的内容，严禁剧透后文。
const { appendDocumentWorkHandshake, withLunaRole } = require('./lunaPrompt.cjs')

// 设定集压缩成简短名单，辅助模型理解人物/物品/地点，不喧宾夺主。
function formatProfiles(entityProfiles = []) {
  const lines = entityProfiles.slice(0, 40).map((item) => {
    const aliases = (item.aliases || []).length ? `（别名：${item.aliases.slice(0, 5).join('、')}）` : ''
    const summary = String(item.summary || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    return `- ${item.name}${aliases}【${item.type || '未分类'}】${summary}`
  }).filter((line) => line.length > 2)
  return lines.length ? lines.join('\n') : '（本书还没有设定集资料）'
}

function explainSystemPrompt() {
  return [
    'Act as Moyu Reader\'s in-reading dictionary and encyclopedia. Explain a selected sentence or passage that the reader did not understand.',
    '',
    'Requirements:',
    '- First paraphrase the literal meaning in plain Simplified Chinese, then explain its actual meaning in context.',
    '- Prioritize context. Connect the protagonist\'s actions, other characters\' reactions, the current situation, motive, causality, and subtext instead of analyzing words in isolation.',
    '- Keep people, abilities, objects, factions, and places consistent with the supplied entity notes.',
    '- Use only the supplied passage, surrounding context, and entity notes. Do not use outside knowledge or reveal plot after the selected position. Say "此处尚未交代" when the evidence is absent.',
    '',
    'Output in natural Simplified Chinese, at most 400 Chinese characters. Use two short paragraphs: plain paraphrase first, contextual interpretation second. Add one or two "词解：" lines only when needed. Simple Markdown is allowed; do not add a title or image.',
  ].join('\n')
}

// 首次解说 / 重新生成。
function buildDictionaryMessages({ bookTitle = '', author = '', chapterLabel = '', readPercent = 0, selectedText = '', paragraph = '', contextBefore = '', contextAfter = '', entityProfiles = [] } = {}) {
  const percentLabel = `${Math.round((Number(readPercent) || 0) * 100)}%`
  const source = [
    'REFERENCE MATERIAL',
    `Book: 《${bookTitle || '未知'}》${author ? `; Author: ${author}` : ''}`,
    `Reading position: ${chapterLabel || '未知章节'}; approximately ${percentLabel} of the book.`,
    '',
    `SELECTED TEXT\n${selectedText}`,
    '',
    `FULL PARAGRAPH\n${paragraph || selectedText}`,
    '',
    `CONTEXT BEFORE\n${contextBefore || '(None; this is the beginning.)'}`,
    '',
    `CONTEXT AFTER\n${contextAfter || '(None.)'}`,
    '',
    `ENTITY NOTES WITHIN THE READING RANGE\n${formatProfiles(entityProfiles)}`,
  ].join('\n')
  return appendDocumentWorkHandshake([
    { role: 'system', content: withLunaRole(explainSystemPrompt()) },
    { role: 'user', content: source },
  ], 'Luna, explain the selected text from the reference material above in the required Simplified Chinese format.')
}

// 追问：读者针对已有解释继续提问（如"那主角为啥这样啊"）。
// 材料升级为：选中行 + 所在章节全文（调用方已控制在约 2 万字符）+ 设定集 + 既有问答。
function buildFollowupMessages({ bookTitle = '', chapterLabel = '', selectedText = '', paragraph = '', chapterText = '', entityProfiles = [], explanation = '', followUps = [], question = '' } = {}) {
  const historyMessages = [
    ...(String(explanation || '').trim() ? [{ role: 'assistant', content: String(explanation) }] : []),
    ...followUps
      .filter((item) => item.question && item.answer)
      .slice(-6)
      .flatMap((item) => [
        { role: 'user', content: String(item.question) },
        { role: 'assistant', content: String(item.answer) },
      ]),
  ]
  const source = [
    'REFERENCE MATERIAL',
    `Book: 《${bookTitle || '未知'}》; Chapter: ${chapterLabel || '未知章节'}.`,
    '',
    `ORIGINALLY SELECTED TEXT\n${selectedText}`,
    '',
    `FULL PARAGRAPH\n${paragraph || selectedText}`,
    '',
    `CHAPTER TEXT (may be an excerpt centered on the selection)\n${chapterText || '(Chapter text unavailable.)'}`,
    '',
    `ENTITY NOTES\n${formatProfiles(entityProfiles)}`,
  ].join('\n')
  return appendDocumentWorkHandshake([
    {
      role: 'system',
      content: withLunaRole([
        'Answer a reader\'s follow-up question about a previously selected passage and Luna\'s earlier explanation.',
        '',
        '- Connect the chapter\'s actions, circumstances, and current situation to explain motive and causality.',
        '- Use only the supplied chapter text, entity notes, and conversation history. Do not use outside information or reveal plot after the selected position. If evidence is missing, say "按目前读到的内容还无法确定" and identify what later evidence would clarify it.',
        '- Answer the question directly in natural Simplified Chinese without repeating the earlier explanation or adding a greeting.',
        '- Stay within 300 Chinese characters. Simple Markdown is allowed; do not add a title or image.',
      ].join('\n')),
    },
    { role: 'user', content: source },
    ...historyMessages,
  ], String(question || ''))
}

module.exports = { buildDictionaryMessages, buildFollowupMessages }
