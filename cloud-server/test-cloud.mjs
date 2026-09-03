import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

const dataDir = await mkdtemp(path.join(tmpdir(), 'moyu-cloud-test-'))
const port = 18787
const child = spawn(process.execPath, ['server.mjs'], { cwd: new URL('.', import.meta.url), env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ALLOW_PUBLIC_REGISTRATION: 'true' }, stdio: ['ignore', 'pipe', 'inherit'] })
const base = `http://127.0.0.1:${port}`

async function request(route, options = {}) {
  const response = await fetch(`${base}${route}`, options)
  const json = await response.json()
  return { response, json }
}

try {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server start timeout')), 5000)
    child.stdout.on('data', (chunk) => { if (String(chunk).includes('listening')) { clearTimeout(timeout); resolve() } })
  })
  const registered = await request('/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'reader_test', password: 'correct-horse-battery', inviteCode: 'NOOMY' }) })
  assert.equal(registered.response.status, 201)
  const noInvite = await request('/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'reader_noinvite', password: 'correct-horse-battery' }) })
  assert.equal(noInvite.response.status, 403)
  const badInvite = await request('/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'reader_badinvite', password: 'correct-horse-battery', inviteCode: 'WRONG' }) })
  assert.equal(badInvite.response.status, 403)
  const token = registered.json.token
  const auth = { authorization: `Bearer ${token}` }
  const account = await request('/v1/account', { headers: auth })
  assert.equal(account.json.user.username, 'reader_test')
  const snapshot = await request('/v1/snapshot', { method: 'PUT', headers: { ...auth, 'content-type': 'application/zip' }, body: Buffer.from('zip-test') })
  assert.equal(snapshot.json.snapshot.size, 8)
  const synced = await request('/v1/sync', { method: 'PUT', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ data: { 'reader:progress': { book1: { percent: .5 } } } }) })
  assert.equal(synced.response.status, 200)
  const pulled = await request('/v1/sync', { headers: auth })
  assert.equal(pulled.json.sync.data['reader:progress'].book1.percent, .5)
  const metadata = Buffer.from(JSON.stringify({ clientBookId: 'book:test', title: '离线测试书', author: '测试作者', extension: '.txt' })).toString('base64url')
  const libraryUpload = await request('/v1/library/books', { method: 'POST', headers: { ...auth, 'content-type': 'text/plain', 'content-length': '12', 'x-moyu-library-book': metadata }, body: Buffer.from('offline book') })
  assert.equal(libraryUpload.response.status, 201)
  const library = await request('/v1/library/books', { headers: auth })
  assert.equal(library.json.books[0].clientBookId, 'book:test')
  const downloaded = await fetch(`${base}/v1/library/books/${library.json.books[0].id}`, { headers: auth })
  assert.equal(await downloaded.text(), 'offline book')
  const removedLibraryBook = await request(`/v1/library/books/${library.json.books[0].id}`, { method: 'DELETE', headers: auth })
  assert.equal(removedLibraryBook.response.status, 200)
  const libraryAfterDelete = await request('/v1/library/books', { headers: auth })
  assert.equal(libraryAfterDelete.json.books.length, 0)
  const profile = await request('/v1/account/profile', { method: 'PATCH', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: '测试读者', avatar: '' }) })
  assert.equal(profile.json.user.nickname, '测试读者')
  const exported = await request('/v1/account/export', { headers: auth })
  assert.equal(exported.json.user.nickname, '测试读者')
  assert.equal('passwordHash' in exported.json.user, false)
  const createdThought = await request('/v1/thoughts', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ bookKey: 'book-fingerprint', bookTitle: '测试书', quote: '被选中的原句', content: '这是我的想法', anchor: { paragraphIndex: 2 } }) })
  assert.equal(createdThought.response.status, 201)
  const thoughtId = createdThought.json.thought.id
  const replied = await request(`/v1/thoughts/${thoughtId}/replies`, { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ content: '一条回复' }) })
  assert.equal(replied.response.status, 201)
  const liked = await request(`/v1/thoughts/${thoughtId}/like`, { method: 'POST', headers: auth })
  assert.equal(liked.json.likeCount, 1)
  const listedThoughts = await request('/v1/thoughts?bookKey=book-fingerprint', { headers: auth })
  assert.equal(listedThoughts.json.thoughts[0].replies.length, 1)
  const changed = await request('/v1/account/password', { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ currentPassword: 'correct-horse-battery', newPassword: 'new-correct-horse-battery' }) })
  assert.ok(changed.json.token)
  const oldSession = await request('/v1/account', { headers: auth })
  assert.equal(oldSession.response.status, 401)
  const newAuth = { authorization: `Bearer ${changed.json.token}` }
  // 快照可取回（C1 服务端一侧）
  const snapshotBack = await fetch(`${base}/v1/snapshot`, { headers: newAuth })
  assert.equal(snapshotBack.status, 200)
  assert.equal(await snapshotBack.text(), 'zip-test')
  // 书城列表返回 sha256（C11），重复上传返回 409
  const storeMeta = Buffer.from(JSON.stringify({ title: '共享测试书', author: '', category: '测试', extension: '.txt' })).toString('base64url')
  const storeUpload = await request('/v1/store/books', { method: 'POST', headers: { ...newAuth, 'content-type': 'text/plain', 'x-moyu-book': storeMeta }, body: Buffer.from('shared book') })
  assert.equal(storeUpload.response.status, 201)
  const storeList = await request('/v1/store/books', { headers: newAuth })
  assert.equal(storeList.json.books[0].sha256, createHash('sha256').update('shared book').digest('hex'))
  const duplicate = await request('/v1/store/books', { method: 'POST', headers: { ...newAuth, 'content-type': 'text/plain', 'x-moyu-book': storeMeta }, body: Buffer.from('shared book') })
  assert.equal(duplicate.response.status, 409)
  // 封面上传与读取
  const bookId = storeList.json.books[0].id
  const coverPut = await fetch(`${base}/v1/store/books/${bookId}/cover`, { method: 'PUT', headers: { ...newAuth, 'content-type': 'image/png' }, body: Buffer.from('fake-png-cover') })
  assert.equal(coverPut.status, 200)
  const listWithCover = await request('/v1/store/books', { headers: newAuth })
  assert.equal(listWithCover.json.books[0].hasCover, true)
  const coverGet = await fetch(`${base}/v1/store/books/${bookId}/cover`, { headers: newAuth })
  assert.equal(coverGet.status, 200)
  assert.equal(await coverGet.text(), 'fake-png-cover')
  // 通知：他人评价与下载会通知上传者（这里用自己的第二账户模拟）
  const second = await request('/v1/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'reader_second', password: 'correct-horse-battery', inviteCode: 'noomy' }) })
  assert.equal(second.response.status, 201)
  const secondAuth = { authorization: `Bearer ${second.json.token}` }
  await request(`/v1/store/books/${bookId}/review`, { method: 'PUT', headers: { ...secondAuth, 'content-type': 'application/json' }, body: JSON.stringify({ rating: 4, comment: '不错' }) })
  await fetch(`${base}/v1/store/books/${bookId}`, { headers: secondAuth })
  const notices = await request('/v1/notifications', { headers: newAuth })
  assert.equal(notices.json.unreadCount, 2)
  assert.deepEqual(notices.json.notifications.map((entry) => entry.type).sort(), ['download', 'review'])
  await request('/v1/notifications/read', { method: 'POST', headers: { ...newAuth, 'content-type': 'application/json' }, body: '{}' })
  const noticesAfter = await request('/v1/notifications', { headers: newAuth })
  assert.equal(noticesAfter.json.unreadCount, 0)
  // 改昵称同步到想法的回复（C9）
  await request('/v1/account/profile', { method: 'PATCH', headers: { ...newAuth, 'content-type': 'application/json' }, body: JSON.stringify({ nickname: '改名读者', avatar: '' }) })
  const thoughtsAfter = await request('/v1/thoughts?bookKey=book-fingerprint', { headers: newAuth })
  assert.equal(thoughtsAfter.json.thoughts[0].nickname, '改名读者')
  assert.equal(thoughtsAfter.json.thoughts[0].replies[0].nickname, '改名读者')
  // 清空账户清理孤儿书库文件（C10），并撤下共享书城的书
  const libraryAgain = await request('/v1/library/books', { method: 'POST', headers: { ...newAuth, 'content-type': 'text/plain', 'content-length': '12', 'x-moyu-library-book': metadata }, body: Buffer.from('offline book') })
  assert.equal(libraryAgain.response.status, 201)
  const orphanPath = path.join(dataDir, 'library-files', `${createHash('sha256').update('offline book').digest('hex')}.txt`)
  await access(orphanPath)
  const cleared = await request('/v1/account/clear', { method: 'POST', headers: { ...newAuth, 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: '我确认清空账户数据' }) })
  assert.equal(cleared.response.status, 200)
  await assert.rejects(access(orphanPath))
  const storeAfterClear = await request('/v1/store/books', { headers: newAuth })
  assert.equal(storeAfterClear.json.books.length, 0)
  console.log('cloud account integration tests passed')
} finally {
  child.kill()
  await rm(dataDir, { recursive: true, force: true })
}
