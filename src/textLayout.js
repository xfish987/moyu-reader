const CHINESE_CHARACTER = /[\u3400-\u9fff]/
const PARAGRAPH_END = /[。！？!?；;…][”’」』】》〉〕）)]?$|[…]{2}[”’」』】》〉〕）)]?$/
const LEADING_INDENT = /^(?:[\u3000]{1,2}|[ \t]{2,})/

// 韩国网络小说目录通常是“001화”或“제 1화”。标题前可以有书名，
// 因此只要求行尾是韩文章节号，而不是整行只有章节号。
export const TXT_CHAPTER_PATTERN = /^(?:(?:正文\s*)?第\s*[0-9０-９零〇一二三四五六七八九十百千万两壹贰叁肆伍陆柒捌玖拾佰仟]+\s*[章节卷部篇回集幕]\s*.{0,50}|(?:卷|部|篇|章)\s*[0-9０-９零〇一二三四五六七八九十百千万两]+(?:[\s:：.-]+.{0,45})?|(?:序章|序言|前言|楔子|引子|后记|尾声|终章|大结局)(?:[\s:：.-]+.{0,45})?|(?:番外|外传|附录)\s*[0-9０-９零〇一二三四五六七八九十百千万两]*(?:[\s:：.-]+.{0,45})?|(?:chapter|part|volume|book)\s+[0-9ivxlcdm]+(?:[\s:：.-]+.{0,50})?|.*(?:\d{1,4}\s*화|제\s*\d{1,4}\s*화)(?:\s*[:：.-].{0,45})?|(?:프롤로그|에필로그)(?:[\s:：.-]+.{0,45})?)$/i

export function isTxtChapter(value) {
  const line = String(value || '').replace(/[\u3000\t]+/g, ' ').trim()
  return line.length <= 80 && TXT_CHAPTER_PATTERN.test(line)
}

function joinWrappedLines(left, right) {
  if (!left) return right
  if (!right) return left
  const needsSpace = !CHINESE_CHARACTER.test(left.at(-1)) && !CHINESE_CHARACTER.test(right[0])
    && /[\p{L}\p{N}]$/u.test(left) && /^[\p{L}\p{N}]/u.test(right)
  return `${left}${needsSpace ? ' ' : ''}${right}`
}

// TXT 文件经常按固定列宽硬换行。空行、章节行、显式全角/双空格缩进和完整
// 句末是可靠的段落边界，其余单换行视为软换行并重新拼成自然段。
export function layoutTxtBlocks(content) {
  const normalized = String(content || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const lines = normalized.split('\n')
  const blocks = []
  let current = null
  let sourceOffset = 0
  const flush = () => {
    if (current?.text) blocks.push(current)
    current = null
  }
  for (const sourceLine of lines) {
    const hasIndent = LEADING_INDENT.test(sourceLine)
    const line = sourceLine.trim()
    const leading = sourceLine.length - sourceLine.trimStart().length
    const lineStart = sourceOffset + leading
    const lineEnd = lineStart + line.length
    if (!line) flush()
    else if (isTxtChapter(line)) {
      flush()
      blocks.push({ text: line, start: lineStart, end: lineEnd })
    } else {
      if (current && (hasIndent || PARAGRAPH_END.test(current.text))) flush()
      current = current
        ? { ...current, text: joinWrappedLines(current.text, line), end: lineEnd }
        : { text: line, start: lineStart, end: lineEnd }
    }
    sourceOffset += sourceLine.length + 1
  }
  flush()
  return blocks
}

export function layoutTxtParagraphs(content) {
  return layoutTxtBlocks(content).map((block) => block.text)
}
