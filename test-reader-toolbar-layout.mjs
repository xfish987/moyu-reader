import assert from 'node:assert/strict'
import fs from 'node:fs'

const styles = fs.readFileSync(new URL('./src/styles.css', import.meta.url), 'utf8')
const narrowLayout = styles.match(/@media \(max-width: 780px\) \{[\s\S]*?\.reader-toolbar \{([^}]*)\}/)?.[1] || ''

assert.match(narrowLayout, /grid-template-columns:\s*40px\s+minmax\(0,\s*1fr\)\s+auto\s*;/)
assert.doesNotMatch(narrowLayout, /grid-template-columns:[^;]*270px/)

console.log('reader toolbar layout tests passed')
