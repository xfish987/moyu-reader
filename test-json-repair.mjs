import assert from 'node:assert/strict'
import { parseProfileJson, repairJson } from './electron/jsonRepair.cjs'

// 1. Complete JSON parses untouched.
const complete = JSON.stringify({ type: '人物', canonicalName: '方运', summary: '主角', details: { identity: '寒门学子' }, relations: [], evidence: [] })
const direct = parseProfileJson(complete)
assert.equal(direct.repaired, false)
assert.equal(direct.value.canonicalName, '方运')

// 2. Markdown fences and prose around the JSON are stripped.
const fenced = parseProfileJson('好的，以下是资料卡：\n```json\n' + complete + '\n```')
assert.equal(fenced.value.type, '人物')

// 3. Realistic truncated output (finish_reason=length): valid prefix must be salvaged.
const full = {
  type: '人物',
  canonicalName: '方运',
  aliases: [],
  summary: '方运是本书主角，本是地球人，图书馆失火跳楼逃生后还魂重生到圣元大陆景国江州大源府济县。',
  details: { protagonistRelation: '方运即本书主角本人。', identity: '圣元大陆景国江州大源府济县寒门学子。' },
  relations: [
    { relation: 'located_in', targetName: '济县', label: '居于', note: '第1章方运在济县小巷醒来' },
    { relation: 'related_to', targetName: '杨玉环', label: '童养媳', note: '玉环比方运大三岁' },
  ],
  evidence: [
    { chapter: '第1章 寒门子弟', text: '我明明记得图书馆里失火，然后我跳楼逃生' },
    { chapter: '第2章 危机', text: '就在昨夜，原来的方运在回家的路上，被四个蒙面人围殴致死' },
  ],
  identityConfidence: 'high',
}
const serialized = JSON.stringify(full)
// Cut at 78% — lands mid-string inside the evidence array.
const truncatedMidString = serialized.slice(0, Math.floor(serialized.length * 0.78))
const salvaged = parseProfileJson(truncatedMidString)
assert.ok(salvaged, 'truncated JSON must be salvageable')
assert.equal(salvaged.repaired, true)
assert.equal(salvaged.value.type, '人物')
assert.equal(salvaged.value.canonicalName, '方运')
assert.equal(salvaged.value.summary, full.summary)
assert.equal(salvaged.value.details.identity, full.details.identity)
assert.ok(salvaged.value.relations.length >= 1, 'complete relations survive truncation')
assert.ok(salvaged.value.evidence.length >= 0)

// 4. Cut mid-key inside a relations object.
const cutAt = serialized.indexOf('"targetName": "杨玉环"'.replace(' "', '"')) - 3
const truncatedMidKey = serialized.slice(0, cutAt)
const salvagedKey = parseProfileJson(truncatedMidKey)
assert.ok(salvagedKey, 'mid-key truncation must be salvageable')
assert.equal(salvagedKey.value.canonicalName, '方运')
assert.ok(salvagedKey.value.relations.every((item) => item && typeof item === 'object'))

// 5. Trailing garbage after a complete JSON object.
const withTail = parseProfileJson(complete + '\n（以上为依据生成）')
assert.equal(withTail.value.canonicalName, '方运')

// 6. Non-JSON output yields null so callers can fall back to a plain-text card.
assert.equal(parseProfileJson('模型拒绝了请求，没有输出任何 JSON'), null)
assert.equal(parseProfileJson(''), null)

// 7. repairJson closes open containers deterministically.
assert.equal(repairJson('{"a":[1,2'), '{"a":[1,2]}')
assert.equal(repairJson('{"a":"b","c":" incomplete'), '{"a":"b","c":" incomplete"}')

console.log('json repair tests passed')
