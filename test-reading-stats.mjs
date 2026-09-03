import assert from 'node:assert/strict'
import { addReadingInterval, formatReadingDuration } from './src/readingStats.js'

const ordinary = addReadingInterval({ totalSeconds: 0, days: {} }, new Date(2026, 8, 1, 12, 0, 0).getTime(), new Date(2026, 8, 1, 12, 0, 30).getTime())
assert.equal(ordinary.totalSeconds, 30)
assert.equal(Object.keys(ordinary.days).length, 1)
const beforeMidnight = new Date(2026, 8, 1, 23, 59, 50).getTime()
const acrossMidnight = addReadingInterval({ totalSeconds: 0, days: {} }, beforeMidnight, beforeMidnight + 20_000)
assert.equal(acrossMidnight.totalSeconds, 20)
assert.deepEqual(Object.values(acrossMidnight.days), [10, 10])
const afterSleep = addReadingInterval({ totalSeconds: 0, days: {} }, 0, 3_600_000)
assert.equal(afterSleep.totalSeconds, 60)
assert.deepEqual(formatReadingDuration(59 * 60), { value: '59', unit: '分钟' })
assert.deepEqual(formatReadingDuration(2 * 3600 + 17 * 60), { value: '2', unit: '小时 17 分钟' })
console.log('reading stats tests passed')
