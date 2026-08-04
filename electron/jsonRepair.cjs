// Tolerant JSON extraction for AI profile responses.
// Models can truncate output at the token limit mid-string or mid-key;
// instead of failing the whole profile card we salvage the complete prefix
// and close any open strings/arrays/objects.

function scanJson(text) {
  let inString = false
  let escaped = false
  const stack = []
  let balancedEnd = -1
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{' || char === '[') stack.push(char)
    else if ((char === '}' && stack[stack.length - 1] === '{') || (char === ']' && stack[stack.length - 1] === '[')) {
      stack.pop()
      if (!stack.length && balancedEnd < 0) balancedEnd = index + 1
    }
  }
  return { stack, inString, balancedEnd }
}

function repairJson(text) {
  let work = text
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const state = scanJson(work)
    if (!state.stack.length && !state.inString) return null
    let candidate = work
    if (state.inString) {
      // Drop a dangling escape so the string can be closed cleanly.
      candidate = candidate.replace(/\\+$/, (match) => match.slice(0, match.length - (match.length % 2)))
      candidate += '"'
    }
    candidate = candidate.replace(/[\s,]+$/, '').replace(/:\s*$/, '')
    const closed = scanJson(candidate)
    if (closed.inString) return null
    if (!closed.stack.length) {
      try { JSON.parse(candidate); return candidate } catch { return null }
    }
    const sealed = candidate + closed.stack.slice().reverse().map((char) => (char === '{' ? '}' : ']')).join('')
    try { JSON.parse(sealed); return sealed } catch {}
    // Progressive backoff: drop the incomplete tail at the last comma.
    const lastComma = candidate.lastIndexOf(',')
    if (lastComma > 0) { work = candidate.slice(0, lastComma); continue }
    // Or drop a trailing dangling key without a comma before it.
    const dangling = candidate.match(/^(.*)"(?:[^"\\]|\\.)*"\s*:?\s*$/s)
    if (dangling && dangling[1]) { work = dangling[1]; continue }
    return null
  }
  return null
}

// Returns { value, repaired } or null when no JSON object can be recovered.
function parseProfileJson(raw) {
  let text = String(raw || '').trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim()
  const start = text.indexOf('{')
  if (start < 0) return null
  text = text.slice(start)
  try { return { value: JSON.parse(text), repaired: false } } catch {}
  const { balancedEnd } = scanJson(text)
  if (balancedEnd > 0) {
    try { return { value: JSON.parse(text.slice(0, balancedEnd)), repaired: false } } catch {}
  }
  const repaired = repairJson(text)
  if (!repaired) return null
  try { return { value: JSON.parse(repaired), repaired: true } } catch { return null }
}

module.exports = { parseProfileJson, repairJson }
