// Builds the chat messages for the in-reading dictionary/encyclopedia feature.
// Shared by the IPC handler and tests so both always use the exact same prompt.
//
// 解说不是孤立查字典：模型必须结合选文前后语境（主角/NPC 的行为与处境）
// 把读者卡住的地方讲通。材料只有读者已读到的内容，严禁剧透后文。

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
    '你是小说阅读器内置的"字典百科"解说员。读者在阅读中划选了一句/一段没读懂的文字，你要当场把它讲明白。',
    '',
    '解说要求：',
    '- 先给这句话的白话释义（字面意思），再结合语境讲透它在此处真正的含义。',
    '- 语境优先：结合选中位置前后文里主角的行为、NPC 的反应、当前形势，解释"为什么说这句话/发生这件事"，把读者可能困惑的点主动说通，而不是孤零零地抠字眼。',
    '- 涉及设定（人物、功法、物品、势力、地名）时，参考用户提供的设定集，与设定集保持一致。',
    '- 铁律：只能使用用户给出的材料（前后文与设定集），严禁引用外部资料，严禁透露选中位置之后的情节；材料里没交代的背景就说"此处尚未交代"，不要编造。',
    '',
    '输出格式（可以使用简单的 Markdown，如加粗、短横线列表；不要标题和图片）：',
    '1. 第一段：一两句话的白话释义。',
    '2. 第二段：结合语境的解读（人物动机、形势、潜台词），这是重点。',
    '3. 如有关键词或梗需要单独点明，最后补一两行"词解："。',
    '总长控制在 400 字以内，说人话，不要学术腔。',
  ].join('\n')
}

// 首次解说 / 重新生成。
function buildDictionaryMessages({ bookTitle = '', author = '', chapterLabel = '', readPercent = 0, selectedText = '', paragraph = '', contextBefore = '', contextAfter = '', entityProfiles = [] } = {}) {
  const percentLabel = `${Math.round((Number(readPercent) || 0) * 100)}%`
  const user = [
    `书名：《${bookTitle || '未知'}》${author ? `（作者：${author}）` : ''}`,
    `读者正读到：${chapterLabel || '未知章节'}（全书约 ${percentLabel} 处），在此处划选了文字求解。`,
    '',
    `【划选的文字】\n${selectedText}`,
    '',
    `【划选文字所在的完整段落】\n${paragraph || selectedText}`,
    '',
    `【段落之前的上下文】\n${contextBefore || '（无，已是开头）'}`,
    '',
    `【段落之后的上下文】\n${contextAfter || '（无）'}`,
    '',
    `【本书设定集（读者已读范围内整理）】\n${formatProfiles(entityProfiles)}`,
    '',
    '请按系统要求的格式解说划选的文字。',
  ].join('\n')
  return [
    { role: 'system', content: explainSystemPrompt() },
    { role: 'user', content: user },
  ]
}

// 追问：读者针对已有解释继续提问（如"那主角为啥这样啊"）。
// 材料升级为：选中行 + 所在章节全文（调用方已控制在约 2 万字符）+ 设定集 + 既有问答。
function buildFollowupMessages({ bookTitle = '', chapterLabel = '', selectedText = '', paragraph = '', chapterText = '', entityProfiles = [], explanation = '', followUps = [], question = '' } = {}) {
  const history = followUps
    .filter((item) => item.question && item.answer)
    .slice(-6)
    .map((item) => `问：${item.question}\n答：${item.answer}`)
    .join('\n\n')
  const user = [
    `书名：《${bookTitle || '未知'}》，章节：${chapterLabel || '未知章节'}。`,
    '',
    `【读者当初划选的文字】\n${selectedText}`,
    '',
    `【划选文字所在的完整段落】\n${paragraph || selectedText}`,
    '',
    `【该章节正文（可能为节选，以划选位置为中心）】\n${chapterText || '（章节内容不可用）'}`,
    '',
    `【本书设定集】\n${formatProfiles(entityProfiles)}`,
    '',
    `【你之前对划选文字的解说】\n${explanation}`,
    history ? `\n【之后的追问记录】\n${history}` : '',
    '',
    `【读者现在追问】\n${question}`,
    '',
    '请回答这个追问。',
  ].join('\n')
  return [
    {
      role: 'system',
      content: [
        '你是小说阅读器内置的"字典百科"解说员，正在回答读者的追问。',
        '',
        '- 读者的追问针对之前划选的文字和你的解说展开（例如"主角为什么这样做"），要联系章节正文里人物的行为、处境与形势来解答，把因果关系讲清楚。',
        '- 依据只能是用户给出的章节正文与设定集；严禁外部资料和剧透选中位置之后的情节；材料没交代的就说"按目前读到的内容还无法确定"，并说明哪种后续发展能验证。',
        '- 直接回答问题本身，不要重复之前的解说，不要客套开场白。',
        '- 控制在 300 字以内；可以使用简单的 Markdown（加粗、短横线列表），不要标题和图片。',
      ].join('\n'),
    },
    { role: 'user', content: user },
  ]
}

module.exports = { buildDictionaryMessages, buildFollowupMessages }
