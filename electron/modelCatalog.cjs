function modelValues(response) {
  const values = []
  for (const collection of [response?.data, response?.models, response?.items, response?.result?.data, response?.result?.models]) {
    if (!Array.isArray(collection)) continue
    collection.forEach((item) => values.push(typeof item === 'string' ? item : item?.id || item?.name || item?.model))
  }
  return values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().slice(0, 160))
}

function nextModelPage(response, seen = new Set()) {
  const explicitUrl = response?.next_page || response?.next || response?.links?.next || response?.pagination?.next
  if (typeof explicitUrl === 'string' && explicitUrl.trim() && !seen.has(explicitUrl)) return { type: 'url', value: explicitUrl.trim() }
  const candidates = [
    ['next_page_token', response?.next_page_token, 'page_token'],
    ['next_cursor', response?.next_cursor, 'cursor'],
    ['cursor', response?.cursor, 'cursor'],
    ['after', response?.after, 'after'],
    ['last_id', response?.last_id, 'after'],
  ]
  for (const [key, value, parameter] of candidates) {
    if (typeof value === 'string' && value.trim() && !seen.has(`${key}:${value}`)) return { type: 'cursor', key, parameter, value: value.trim() }
  }
  if (response?.has_more === true && Number.isFinite(Number(response?.page)) && Number(response?.total_pages) > Number(response.page)) {
    const page = Number(response.page) + 1
    if (!seen.has(`page:${page}`)) return { type: 'page', key: 'page', parameter: 'page', value: String(page) }
  }
  return null
}

module.exports = { modelValues, nextModelPage }
