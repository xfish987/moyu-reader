const fs = require('node:fs/promises')

module.exports = async function fixMsiCodepage(projectFile) {
  const source = await fs.readFile(projectFile, 'utf8')
  let updated = source.replace(/(<Product\b[^>]*\bLanguage=")[^"]*(")/i, (_, before, after) => `${before}2052${after}`)
  updated = updated.replace(/(<Product\b[^>]*\bCodepage=")[^"]*(")/i, (_, before, after) => `${before}936${after}`)
  if (/<Package\b[^>]*\bSummaryCodepage=/i.test(updated)) {
    updated = updated.replace(/(<Package\b[^>]*\bSummaryCodepage=")[^"]*(")/i, (_, before, after) => `${before}936${after}`)
  } else {
    updated = updated.replace(/<Package\b([^>]*?)(\/?)>/i, '<Package$1 SummaryCodepage="936"$2>')
  }
  if (!/<Product\b[^>]*\bLanguage="2052"[^>]*\bCodepage="936"/i.test(updated)
    || !/<Package\b[^>]*\bSummaryCodepage="936"/i.test(updated)) {
    throw new Error(`Unable to normalize the WiX code pages in ${projectFile}`)
  }
  await fs.writeFile(projectFile, updated, 'utf8')
}
