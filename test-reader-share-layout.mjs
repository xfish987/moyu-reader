import assert from 'node:assert/strict'
import fs from 'node:fs'

const textReader = fs.readFileSync(new URL('./src/components/TextReader.jsx', import.meta.url), 'utf8')
const epubReader = fs.readFileSync(new URL('./src/components/EpubReader.jsx', import.meta.url), 'utf8')
const readerView = fs.readFileSync(new URL('./src/components/ReaderView.jsx', import.meta.url), 'utf8')
const shareModal = fs.readFileSync(new URL('./src/components/ShareNoteModal.jsx', import.meta.url), 'utf8')

assert.match(textReader, /formattedText[\s\S]*join\('\\n\\n'\)/)
assert.match(epubReader, /formattedText: text\.slice/)
assert.match(readerView, /draft\.formattedText \|\| draft\.text/)
assert.match(readerView, /initialSource=\{`《\$\{book\.title\}》/)
assert.match(readerView, /if \(noteSource\) note\.source = noteSource/)
assert.match(readerView, /initialAuthor=\{book\.author \|\| ''\}/)
assert.match(readerView, /selectHighlights/)
assert.match(shareModal, /text\.matchAll\(\/\[\^\\n\]\+\/g\)/)
assert.match(shareModal, /titleParagraphs/)
assert.doesNotMatch(shareModal, /note\.title\.slice/)
assert.match(shareModal, /block\.author/)

console.log('reader share paragraph and source tests passed')
