const fs = require('fs')
const iconv = require('iconv-lite')

const mainSource = fs.readFileSync('electron/main.cjs', 'utf8')

function extract(name) {
  const match = mainSource.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}`))
  if (!match) throw new Error(`未找到函数 ${name}`)
  return match[0]
}

const buildToc = new Function('iconv', `
  ${extract('isChapterTitle')}
  ${extract('newlineLengthAt')}
  ${extract('buildTextToc')}
  return buildTextToc
`)(iconv)

const paragraphBoundary = new Function(`
  ${extract('newlineLengthAt')}
  ${extract('paragraphBoundary')}
  return paragraphBoundary
`)()

async function run() {
  const paragraphs = []
  const expected = []
  let characterCount = 0
  for (let index = 1; characterCount < 650_000; index += 1) {
    const chapter = `第${index}章 UTF 编码测试`
    const body = `正文${'天地玄黄宇宙洪荒'.repeat(80)}`
    expected.push(chapter)
    paragraphs.push(chapter, body)
    characterCount += chapter.length + body.length + 2
  }
  const text = paragraphs.join('\n')
  let failed = false

  for (const encoding of ['utf8', 'gbk', 'utf16-le', 'utf16-be']) {
    const data = iconv.encode(text, encoding)
    const toc = await buildToc({ data, encoding })
    const labelsOk = toc.length === expected.length && toc.every((item, index) => item.label === expected[index])
    const offsetsOk = toc.every((item) => iconv.decode(data.subarray(item.offset, item.offset + 100), encoding).startsWith(item.label))
    const sample = toc[Math.floor(toc.length / 2)]
    const probeOffset = sample.offset + iconv.encode(sample.label.slice(0, 3), encoding).length
    const start = paragraphBoundary(data, probeOffset, 'backward', encoding)
    const end = paragraphBoundary(data, probeOffset, 'forward', encoding)
    const searchLabelOk = iconv.decode(data.subarray(start, end), encoding).replace(/[\r\n\u0000]+/g, ' ').trim() === sample.label
    const ok = labelsOk && offsetsOk && searchLabelOk
    if (!ok) failed = true
    console.log(`${ok ? 'PASS' : 'FAIL'} [${encoding}] 目录=${toc.length}/${expected.length} 标签=${labelsOk} 偏移=${offsetsOk} 搜索摘要=${searchLabelOk}`)
  }

  process.exitCode = failed ? 1 : 0
}

run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
