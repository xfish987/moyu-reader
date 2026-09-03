import { randomBytes, randomUUID, scrypt as scryptCallback } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCallback)
const dataDir = path.resolve(process.env.DATA_DIR || '/data')
const usersFile = path.join(dataDir, 'users.json')
const [action, rawUsername, suppliedPassword] = process.argv.slice(2)
const username = String(rawUsername || '').trim().toLowerCase()
if (!['create', 'delete'].includes(action) || !/^[a-z0-9_\-.]{3,32}$/.test(username)) {
  console.error('用法：node admin.mjs create|delete 用户名 [密码]')
  process.exit(2)
}

await mkdir(dataDir, { recursive: true })
let database
try { database = JSON.parse(await readFile(usersFile, 'utf8')) } catch { database = { users: [], books: [] } }
database.users ||= []
database.books ||= []

async function save() {
  const temporary = `${usersFile}.${process.pid}.tmp`
  await writeFile(temporary, `${JSON.stringify(database, null, 2)}\n`, { mode: 0o600 })
  await rename(temporary, usersFile)
}

if (action === 'create') {
  if (database.users.some((user) => user.username === username)) throw new Error('用户名已存在')
  const password = suppliedPassword || randomBytes(18).toString('base64url')
  if (password.length < 10 || password.length > 128) throw new Error('密码长度需为 10–128 位')
  const salt = randomBytes(16).toString('hex')
  const derived = await scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  const user = { id: randomUUID(), username, passwordSalt: salt, passwordHash: Buffer.from(derived).toString('hex'), createdAt: new Date().toISOString(), sessions: [] }
  database.users.push(user)
  await save()
  console.log(JSON.stringify({ created: true, username, password }))
} else {
  const user = database.users.find((entry) => entry.username === username)
  if (!user) throw new Error('用户不存在')
  const ownedBooks = database.books.filter((book) => book.uploaderId === user.id)
  database.users = database.users.filter((entry) => entry.id !== user.id)
  database.books = database.books.filter((book) => book.uploaderId !== user.id).map((book) => ({ ...book, reviews: (book.reviews || []).filter((review) => review.userId !== user.id) }))
  await Promise.all(ownedBooks.map((book) => rm(path.join(dataDir, 'bookstore', book.fileName), { force: true })))
  await rm(path.join(dataDir, 'snapshots', `${user.id}.zip`), { force: true })
  await save()
  console.log(JSON.stringify({ deleted: true, username, deletedBooks: ownedBooks.length }))
}
