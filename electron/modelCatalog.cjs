function modelValues(response) {
  const values = []
  for (const collection of [response, response?.data, response?.data?.models, response?.data?.items, response?.models, response?.items, response?.result, response?.result?.data, response?.result?.models, response?.payload?.data, response?.payload?.models]) {
    if (!Array.isArray(collection)) continue
    collection.forEach((item) => values.push(typeof item === 'string' ? item : item?.id || item?.name || item?.model || item?.model_name))
  }
  return values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim().slice(0, 160))
}

function nextModelPage(response, seen = new Set()) {
  const meta = response?.pagination || response?.meta || response?.result?.pagination || response?.result?.meta || {}
  const nextLink = [response?.next_page, response?.next_page_url, response?.next, response?.links?.next, response?.pagination?.next, meta.next_page, meta.next_page_url, meta.next, response?.result?.links?.next].map((value) => typeof value === 'string' ? value : value?.href || value?.url).find(Boolean) || ''
  const explicitUrl = nextLink
  if (typeof explicitUrl === 'string' && explicitUrl.trim() && !seen.has(explicitUrl)) return { type: 'url', value: explicitUrl.trim() }
  const candidates = [
    ['next_page_token', response?.next_page_token ?? meta.next_page_token, 'page_token'],
    ['next_cursor', response?.next_cursor ?? meta.next_cursor, 'cursor'],
    ['cursor', response?.cursor ?? meta.cursor, 'cursor'],
    ['after', response?.after ?? meta.after, 'after'],
    ['last_id', response?.last_id ?? meta.last_id, 'after'],
  ]
  for (const [key, value, parameter] of candidates) {
    if (typeof value === 'string' && value.trim() && !seen.has(`${key}:${value}`)) return { type: 'cursor', key, parameter, value: value.trim() }
  }
  const hasMore = response?.has_more === true || response?.hasMore === true || meta.has_more === true || meta.hasMore === true
  if (hasMore && Number.isFinite(Number(response?.offset ?? meta.offset))) {
    const offset = Number(response?.offset ?? meta.offset) + Math.max(1, Number(response?.limit ?? meta.limit) || 0)
    if (!seen.has(`offset:${offset}`)) return { type: 'offset', key: 'offset', parameter: 'offset', value: String(offset) }
  }
  const currentPage = response?.page ?? meta.page
  const totalPages = response?.total_pages ?? meta.total_pages
  if (hasMore && Number.isFinite(Number(currentPage)) && (Number(totalPages) > Number(currentPage) || totalPages === undefined)) {
    const page = Number(currentPage) + 1
    if (!seen.has(`page:${page}`)) return { type: 'page', key: 'page', parameter: 'page', value: String(page) }
  }
  return null
}

async function collectModelCatalog({ request, maxPages = 100 }) {
  if (typeof request !== 'function') throw new TypeError('model catalog request must be a function')
  const models = []
  const seenPages = new Set()
  let endpoint = 'models'
  let pages = 0
  let partial = false
  for (; pages < maxPages; pages += 1) {
    const response = await request(endpoint)
    models.push(...modelValues(response))
    const next = nextModelPage(response, seenPages)
    if (!next) break
    const marker = next.type === 'url' ? next.value : `${next.key}:${next.value}`
    if (seenPages.has(marker)) { partial = true; break }
    seenPages.add(marker)
    endpoint = next.type === 'url' ? next.value : `models?${encodeURIComponent(next.parameter)}=${encodeURIComponent(next.value)}`
  }
  if (pages >= maxPages) partial = true
  return { models: [...new Set(models)].sort((a, b) => a.localeCompare(b)), pages: pages + 1, partial }
}

module.exports = { modelValues, nextModelPage, collectModelCatalog }
