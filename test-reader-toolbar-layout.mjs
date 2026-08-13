import assert from 'node:assert/strict'
import fs from 'node:fs'

const styles = fs.readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8')
const uiBStyles = fs.readFileSync(new URL('./src/ui-b/ui-b.css', import.meta.url), 'utf8')
const readerView = fs.readFileSync(new URL('./src/components/ReaderView.jsx', import.meta.url), 'utf8')
const narrowLayout = styles.match(/@media \(max-width: 780px\) \{[\s\S]*?\.reader-toolbar \{([^}]*)\}/)?.[1] || ''
const compactActions = [...uiBStyles.matchAll(/\.ui-b \.reader-actions \{([^}]*)\}/g)].at(-1)?.[1] || ''

assert.match(narrowLayout, /grid-template-columns:\s*40px\s+minmax\(0,\s*1fr\)\s+auto\s*;/)
assert.doesNotMatch(narrowLayout, /grid-template-columns:[^;]*270px/)
assert.doesNotMatch(readerView, /scrollIntoView\s*\(/)
assert.match(readerView, /tocPanel\.scrollTop\s*=\s*Math\.max\(0,\s*top\)/)
assert.match(compactActions, /overflow:\s*visible\s*;/, 'compact toolbar must not clip its overflow menu')

console.log('reader toolbar layout tests passed')
