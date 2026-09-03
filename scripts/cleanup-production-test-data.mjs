import { copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const dataDir = path.resolve(process.argv[2] || '/data')
const apply = process.argv.includes('--apply')
const usersPath = path.join(dataDir, 'users.json')
const database = JSON.parse(await readFile(usersPath, 'utf8'))
const testUploader = /^(curltest|multitest|single|zipint)\d+$/
const removedBooks = (database.books || []).filter((book) => testUploader.test(String(book.uploader || '')))
const removedUsers = (database.users || []).filter((user) => testUploader.test(String(user.username || '')))

console.log(JSON.stringify({ apply, books: removedBooks.map((book) => ({ id: book.id, title: book.title, uploader: book.uploader, files: (book.files || []).length })), users: removedUsers.map((user) => user.username) }, null, 2))
if (!apply) process.exit(0)

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
await copyFile(usersPath, `${usersPath}.before-test-cleanup-${stamp}.bak`)
database.books = (database.books || []).filter((book) => !removedBooks.includes(book))
database.users = (database.users || []).filter((user) => !removedUsers.includes(user))
for (const book of removedBooks) {
  const files = Array.isArray(book.files) && book.files.length ? book.files : book.fileName ? [{ fileName: book.fileName }] : []
  await Promise.all(files.map((file) => rm(path.join(dataDir, 'bookstore', path.basename(file.fileName)), { force: true })))
  if (book.coverFileName) await rm(path.join(dataDir, 'bookstore-covers', path.basename(book.coverFileName)), { force: true })
}
await writeFile(usersPath, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
console.log(`Removed ${removedBooks.length} test books and ${removedUsers.length} test users.`)
