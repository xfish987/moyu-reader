// 极简 EPUB（ZIP）封面提取：解析中央目录，无需外部依赖。
// 先用 OPF 的 cover-image / meta cover 定位，失败则回退文件名匹配。
import { inflateRawSync } from 'node:zlib'

function findCentralDirectory(buffer) {
  // End of Central Directory 签名 0x06054b50，从尾部搜索
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 22 - 65536); offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset
  }
  return -1
}

function readEntries(buffer) {
  const eocd = findCentralDirectory(buffer)
  if (eocd < 0) return []
  const count = buffer.readUInt16LE(eocd + 10)
  let offset = buffer.readUInt32LE(eocd + 16)
  const entries = []
  for (let i = 0; i < count && offset + 46 <= buffer.length; i++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString('utf8')
    entries.push({ name, method, compressedSize, localOffset })
    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readEntryData(buffer, entry) {
  const local = entry.localOffset
  if (buffer.readUInt32LE(local) !== 0x04034b50) return null
  const nameLength = buffer.readUInt16LE(local + 26)
  const extraLength = buffer.readUInt16LE(local + 28)
  const start = local + 30 + nameLength + extraLength
  const data = buffer.subarray(start, start + entry.compressedSize)
  if (entry.method === 0) return Buffer.from(data)
  if (entry.method === 8) { try { return inflateRawSync(data) } catch { return null } }
  return null
}

const COVER_NAME = /cover[^/]*\.(jpe?g|png|webp)$/i

// 解析 OPF：返回 { title, author, coverHref, opfPath }，供封面与元数据提取共用
function parseOpf(entries, read) {
  const container = read('META-INF/container.xml')
  if (!container) return null
  const opfPath = container.toString('utf8').match(/full-path=["']([^"']+)["']/)?.[1]
  const opfEntry = opfPath && entries.find((item) => item.name === opfPath)
  const opf = opfEntry ? read(opfPath)?.toString('utf8') : null
  if (!opf || !opfPath) return null
  const tag = (name) => {
    const match = opf.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'))
    return match ? match[1].replace(/<[^>]+>/g, '').trim() : ''
  }
  const coverId = opf.match(/<meta[^>]+name=["']cover["'][^>]+content=["']([^"']+)["']/)?.[1]
  const item = opf.match(/<item[^>]+properties=["'][^"']*cover-image[^"']*["'][^>]*>/i)?.[0]
  const coverHref = (item && item.match(/href=["']([^"']+)["']/)?.[1])
    || (coverId && opf.match(new RegExp(`<item[^>]+id=["']${coverId}["'][^>]*>`))?.[0]?.match(/href=["']([^"']+)["']/)?.[1])
    || null
  return { title: tag('dc:title') || tag('title'), author: tag('dc:creator') || tag('dc:author'), coverHref, opfPath }
}

const decodeText = (value) => String(value || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')

// 提取 EPUB 的书名、作者与封面，一次解析全部返回（任一字段可能为空）
export function extractEpubMeta(buffer) {
  try {
    const entries = readEntries(buffer)
    if (!entries.length) return null
    const read = (name) => {
      const entry = entries.find((item) => item.name === name || item.name.toLowerCase() === name.toLowerCase())
      return entry ? readEntryData(buffer, entry) : null
    }
    const mimeOf = (name) => /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg'
    const meta = parseOpf(entries, read) || { title: '', author: '', coverHref: null, opfPath: '' }
    let cover = null
    if (meta.coverHref) {
      const dir = meta.opfPath.includes('/') ? meta.opfPath.slice(0, meta.opfPath.lastIndexOf('/') + 1) : ''
      const coverPath = decodeURIComponent(dir + meta.coverHref).replace(/^\//, '')
      const data = read(coverPath)
      if (data?.length) cover = { data, mime: mimeOf(coverPath) }
    }
    if (!cover) {
      const fallback = entries.find((item) => COVER_NAME.test(item.name))
      if (fallback) {
        const data = readEntryData(buffer, fallback)
        if (data?.length) cover = { data, mime: mimeOf(fallback.name) }
      }
    }
    return { title: decodeText(meta.title), author: decodeText(meta.author), cover }
  } catch { return null }
}

export function extractEpubCover(buffer) {
  return extractEpubMeta(buffer)?.cover || null
}
