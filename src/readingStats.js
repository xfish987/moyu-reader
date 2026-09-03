const dayKey = (timestamp) => new Date(timestamp).toLocaleDateString('sv-SE')

export function addReadingInterval(current, startMs, endMs, maximumGapMs = 60_000) {
  const durationMs = Math.max(0, Math.min(maximumGapMs, Number(endMs) - Number(startMs)))
  const seconds = Math.round(durationMs / 1000)
  if (!seconds) return current
  const days = { ...(current?.days || {}) }
  for (let index = 0; index < seconds; index += 1) {
    const key = dayKey(Number(startMs) + index * 1000)
    days[key] = (Number(days[key]) || 0) + 1
  }
  return { totalSeconds: (Number(current?.totalSeconds) || 0) + seconds, days }
}

export function formatReadingDuration(totalSeconds) {
  const totalMinutes = Math.max(0, Math.round((Number(totalSeconds) || 0) / 60))
  if (totalMinutes < 60) return { value: String(totalMinutes), unit: '分钟' }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return { value: String(hours), unit: minutes ? `小时 ${minutes} 分钟` : '小时' }
}
