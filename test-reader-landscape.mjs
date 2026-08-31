import assert from 'node:assert/strict'
import fs from 'node:fs'

const textReader = fs.readFileSync(new URL('./src/components/TextReader.jsx', import.meta.url), 'utf8')
const epubReader = fs.readFileSync(new URL('./src/components/EpubReader.jsx', import.meta.url), 'utf8')
const settings = fs.readFileSync(new URL('./src/components/ReaderSettings.jsx', import.meta.url), 'utf8')
const css = fs.readFileSync(new URL('./src/ui-b/ui-b.css', import.meta.url), 'utf8')

assert.match(textReader, /columnGap = settings\.layoutMode === 'landscape' \? 56 : 0/)
assert.match(textReader, /\(viewportWidth - columnGap\) \/ 2/)
assert.match(epubReader, /spread: settings\.layoutMode === 'landscape' \? 'both' : 'none'/)
assert.match(epubReader, /minSpreadWidth: settings\.layoutMode === 'landscape' \? 1 : 800/)
assert.match(epubReader, /gap: settings\.layoutMode === 'landscape' \? 56 : 0/)
assert.match(settings, />横版双栏</)
assert.match(css, /layout-landscape \.epub-host \{[^}]*background: transparent;[^}]*box-shadow: none;/s)
assert.doesNotMatch(css, /layout-landscape \.text-viewport::after/)
assert.doesNotMatch(css, /layout-landscape \.epub-host::after/)

console.log('reader landscape two-column tests passed')
