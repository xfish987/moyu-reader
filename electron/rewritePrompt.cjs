const { appendDocumentWorkHandshake, withLunaRole } = require('./lunaPrompt.cjs')

function buildRewriteMessages({ bookTitle = '', author = '', chapterLabel = '', originalText = '', paragraph = '', chapterText = '', requirement = '', targetLength = 300 } = {}) {
  const length = Math.max(50, Math.min(5000, Number(targetLength) || 300))
  const source = [
    `Book: 《${bookTitle || 'Unknown'}》${author ? `; Author: ${author}` : ''}`,
    `Chapter: ${chapterLabel || 'Unknown chapter'}`,
    `Reader's rewrite request: ${requirement}`,
    `Target length: approximately ${length} Chinese characters (within 15%)`,
    '',
    `ORIGINAL PASSAGE TO REPLACE:\n${originalText}`,
    '',
    `FULL ORIGINAL PARAGRAPH:\n${paragraph || originalText}`,
    '',
    `CHAPTER CONTEXT:\n${chapterText}`,
  ].join('\n')
  return appendDocumentWorkHandshake([
    { role: 'system', content: withLunaRole([
      'You are an expert fiction rewrite editor embedded in an ebook reader.',
      'Rewrite the specified passage in the original author’s voice, using the chapter context to match the author’s diction, sentence rhythm, imagery, narrative distance, point of view, tense, dialogue style, characterization, names, and world facts.',
      'The rewritten passage must connect seamlessly with the untouched text immediately before and after it. It must read as if it had always been part of the published original, with no visible shift in voice or continuity.',
      'Follow the reader’s request while preserving every chapter fact not explicitly requested to change. Use only the supplied chapter context and never reveal or invent later plot.',
      'For every request, rewrite directly from ORIGINAL PASSAGE TO REPLACE. Never revise or reference a previous generated version.',
      'Output only the replacement prose in Simplified Chinese. Do not explain, summarize, add a title, use Markdown, or wrap the result in quotation marks.',
    ].join('\n')) },
    { role: 'user', content: source },
  ], 'Return only the seamless replacement prose in Simplified Chinese.')
}

module.exports = { buildRewriteMessages }
