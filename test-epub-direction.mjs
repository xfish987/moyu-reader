import assert from 'node:assert/strict'
import { inspectEpubPageDirection, normalizeEpubDirection, resolveEpubReadingDirection } from './src/epubDirection.js'

function documentFixture({ bodyWritingMode = 'horizontal-tb', rootWritingMode = 'horizontal-tb', bodyDir = '', rootDir = '' } = {}) {
  const body = { getAttribute: (name) => name === 'dir' ? bodyDir : '' }
  const documentElement = { getAttribute: (name) => name === 'dir' ? rootDir : '' }
  return {
    body,
    documentElement,
    defaultView: {
      getComputedStyle: (node) => ({ writingMode: node === body ? bodyWritingMode : rootWritingMode }),
    },
  }
}

assert.equal(normalizeEpubDirection('RTL'), 'rtl')
assert.equal(normalizeEpubDirection('default'), null)
assert.equal(resolveEpubReadingDirection('ltr'), 'ltr')
assert.equal(resolveEpubReadingDirection('rtl'), 'rtl')
assert.equal(resolveEpubReadingDirection('default'), 'ltr')
assert.equal(resolveEpubReadingDirection(null, { explicitDirection: 'rtl' }), 'rtl')

const verticalJapanese = inspectEpubPageDirection(documentFixture({ rootWritingMode: 'vertical-rl' }))
assert.equal(verticalJapanese.writingDirection, 'rtl')
assert.equal(resolveEpubReadingDirection('ltr', verticalJapanese), 'rtl')

const horizontalEnglish = inspectEpubPageDirection(documentFixture({ bodyDir: 'ltr' }))
assert.equal(horizontalEnglish.writingDirection, null)
assert.equal(resolveEpubReadingDirection(null, horizontalEnglish), 'ltr')

const explicitRtl = inspectEpubPageDirection(documentFixture({ rootDir: 'rtl' }))
assert.equal(resolveEpubReadingDirection(null, explicitRtl), 'rtl')

console.log('EPUB direction tests passed')
