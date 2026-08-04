// 验证 electron/main.cjs 中大文本分块的往返确定性：
// 往前逐块走到底，再往后逐块走回来，两次必须经过完全相同的边界集合。
const fs = require('fs')
const iconv = require('iconv-lite')

const mainSource = fs.readFileSync('electron/main.cjs', 'utf8')

// 从 main.cjs 抽出三个纯函数，在与源码一致的作用域（含 iconv）中执行。
function extract(name) {
  const match = mainSource.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`))
  if (!match) throw new Error(`未找到函数 ${name}`)
  return match[0]
}
const TEXT_CHUNK_SIZE = 32_000
const factory = new Function('iconv', 'TEXT_CHUNK_SIZE', 'largeTextCache', `
  ${extract('newlineLengthAt')}
  ${extract('paragraphBoundary')}
  ${extract('chunkLatticeBounds')}
  ${extract('getTextChunk')}
  return getTextChunk
`)

// 造一本 ~2MB 的假书：随机长度段落 + 章节标题，模拟真实网文结构。
let seed = 42
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const chars = '这是一段用来测试的中文文字，包含标点、数字123和 English 混合内容。'
const paragraphs = []
for (let i = 0; paragraphs.join('\n').length < 2_000_000; i += 1) {
  if (i % 200 === 0) paragraphs.push(`第${i / 200 + 1}章 测试章节`)
  const len = 5 + Math.floor(rand() * rand() * 800) // 偶尔出现超长段落
  let text = ''
  while (text.length < len) text += chars
  paragraphs.push(text.slice(0, len))
}
const book = paragraphs.join('\n')

const results = []
for (const encoding of ['utf8', 'gbk', 'utf16-le', 'utf16-be']) {
  const data = iconv.encode(book, encoding)
  const cache = new Map([['test-book', { data, encoding, detected: encoding }]])
  const getTextChunkBound = factory(iconv, TEXT_CHUNK_SIZE, cache)
  const read = (offset, direction) => getTextChunkBound('test-book', offset, direction)

  // 往前走完
  const forward = []
  let chunk = read(0, 'forward')
  forward.push(chunk)
  let guard = 0
  while (chunk.end < data.length && guard < 10000) {
    chunk = read(chunk.end, 'forward')
    forward.push(chunk)
    guard += 1
  }

  // 从末尾逐块往后走回来
  const backward = [chunk]
  guard = 0
  while (chunk.start > 0 && guard < 10000) {
    chunk = read(chunk.start, 'backward')
    backward.push(chunk)
    guard += 1
  }
  backward.reverse()

  const same = forward.length === backward.length
    && forward.every((c, i) => c.start === backward[i].start && c.end === backward[i].end)
  const tiles = forward[0].start === 0
    && forward[forward.length - 1].end === data.length
    && forward.every((c, i) => i === 0 || forward[i - 1].end === c.start)

  // anchor 正确性：
  // 1) 段落起点（目录/搜索的真实来源）——必须逐字符精确；
  // 2) 段内随机字节（进度条 seek 可能落在多字节字符中间）——anchor 落在
  //    同一段落内（允许不足 1 个字符的对齐误差）。
  let anchorOk = true
  const cases = []
  for (let i = 0; i < 400; i += 1) {
    const charIndex = Math.floor(rand() * book.length)
    const paraStart = book.lastIndexOf('\n', charIndex) + 1
    const paraByte = iconv.encode(book.slice(0, paraStart), encoding).length
    cases.push({ offset: paraByte, probe: book.slice(paraStart, paraStart + 30), strict: true })
    // 段内随机字节：取目标字符附近（往后 ≥12 字符处）的文本做探针
    const nl = book.indexOf('\n', paraStart)
    const paraText = book.slice(paraStart, nl === -1 ? book.length : nl)
    const paraBuf = iconv.encode(paraText, encoding)
    if (paraBuf.length > 40) {
      const inner = 5 + Math.floor(rand() * (paraBuf.length - 35))
      const charCount = iconv.decode(paraBuf.subarray(0, inner), encoding).replace(/�/g, '').length
      cases.push({ offset: paraByte + inner, probe: paraText.slice(Math.max(0, charCount - 1), charCount + 14), strict: false })
    }
  }
  for (const { offset, probe, strict } of cases) {
    const c = read(offset, 'exact')
    const contained = c.start <= offset && (offset < c.end || c.end === data.length)
    const window = c.content.slice(strict ? c.anchor : Math.max(0, c.anchor - 2), c.anchor + 60)
    if (window.length < 20) continue // 目标在块尾附近，样本太短无法判定，跳过
    const hit = strict ? window.startsWith(probe.slice(0, 20)) : window.includes(probe.slice(0, 12))
    if (!contained || !hit) {
      anchorOk = false
      console.error(`  anchor 失败: encoding=${encoding} offset=${offset} strict=${strict} contained=${contained}`)
      console.error(`  期望: ${JSON.stringify(probe.slice(0, 30))}`)
      console.error(`  实际: ${JSON.stringify(window)}`)
      break
    }
  }

  results.push({ encoding, chunks: forward.length, roundTrip: same, tiles, anchorOk })
}

let failed = false
for (const r of results) {
  const ok = r.roundTrip && r.tiles && r.anchorOk
  if (!ok) failed = true
  console.log(`${ok ? 'PASS' : 'FAIL'} [${r.encoding}] 分块数=${r.chunks} 往返一致=${r.roundTrip} 无缝平铺=${r.tiles} anchor正确=${r.anchorOk}`)
}
process.exit(failed ? 1 : 0)
