import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { Preferences } from '@capacitor/preferences'

const CONFIG_KEY = 'moyu:ai-config-v1'
const keyName = (providerId) => `moyu:ai-key:${providerId}`

function defaultConfig() {
  return { version: 1, activeProviderId: '', providers: [] }
}

function publicConfig(config) {
  return {
    version: config.version || 1,
    activeProviderId: config.activeProviderId || '',
    providers: (config.providers || []).map(({ hasKey, ...provider }) => ({ ...provider, hasKey: Boolean(hasKey) })),
    encryptionAvailable: true,
    secureStorageLabel: 'Android 系统加密存储',
  }
}

async function loadConfig() {
  try {
    const { value } = await Preferences.get({ key: CONFIG_KEY })
    const parsed = value ? JSON.parse(value) : null
    return parsed && typeof parsed === 'object' ? { ...defaultConfig(), ...parsed } : defaultConfig()
  } catch {
    return defaultConfig()
  }
}

async function saveConfig(config) {
  await Preferences.set({ key: CONFIG_KEY, value: JSON.stringify(config) })
  return publicConfig(config)
}

function providerUrl(value) {
  let url
  try { url = new URL(String(value || '').trim()) } catch { throw new Error('供应商 URL 格式无效') }
  const loopback = ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('供应商 URL 必须使用 HTTPS；仅本机地址允许 HTTP')
  if (url.username || url.password) throw new Error('供应商 URL 不能包含用户名或密码')
  url.search = ''
  url.hash = ''
  url.pathname = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/i, '').replace(/\/+$/, '') || '/'
  return url.toString().replace(/\/$/, '')
}

function endpoint(baseUrl, path) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`
}

function randomId() {
  return crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

async function secureGet(native, key) {
  if (Capacitor.isNativePlatform()) return (await native.secureGet({ key }))?.value || ''
  return (await Preferences.get({ key }))?.value || ''
}

async function secureSet(native, key, value) {
  if (Capacitor.isNativePlatform()) await native.secureSet({ key, value })
  else await Preferences.set({ key, value })
}

async function secureRemove(native, key) {
  if (Capacitor.isNativePlatform()) await native.secureRemove({ key })
  else await Preferences.remove({ key })
}

function aiError(stage, status, code, message) {
  return { stage, status: Number(status) || 0, code: String(code || 'UNKNOWN_ERROR'), message: String(message || '请求失败').slice(0, 1200) }
}

async function requestJson(url, options) {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      url,
      method: options.method || 'GET',
      headers: options.headers || {},
      data: options.data,
      connectTimeout: 30_000,
      readTimeout: 90_000,
      disableRedirects: true,
    })
    if (response.status < 200 || response.status >= 300) {
      const remote = response.data?.error || response.data
      throw Object.assign(new Error(remote?.message || `供应商请求失败（${response.status}）`), { status: response.status, code: remote?.code || remote?.type || `HTTP_${response.status}` })
    }
    return typeof response.data === 'string' ? JSON.parse(response.data) : response.data
  }
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.headers,
    body: options.data === undefined ? undefined : JSON.stringify(options.data),
    redirect: 'manual',
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(data?.error?.message || `供应商请求失败（${response.status}）`), { status: response.status, code: data?.error?.code || data?.error?.type || `HTTP_${response.status}` })
  return data
}

function responseText(response) {
  const content = response?.choices?.[0]?.message?.content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) return content.map((part) => part?.text || '').join('').trim()
  return ''
}

function parseJsonObject(text) {
  const cleaned = String(text || '').replace(/```(?:json)?/gi, '').replace(/```/g, '').trim()
  try { return JSON.parse(cleaned) } catch {}
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) } catch {}
  }
  return null
}

function normalizeProfile(parsed, name, fallbackText = '') {
  const source = parsed && typeof parsed === 'object' ? parsed : {}
  const canonicalName = String(source.canonicalName || source.name || name || '资料').slice(0, 80)
  const aliases = [...new Set((Array.isArray(source.aliases) ? source.aliases : []).map(String).filter(Boolean).map((value) => value.slice(0, 80)))]
  if (canonicalName !== name && name && !aliases.includes(name)) aliases.unshift(name)
  return {
    type: String(source.type || '未分类').slice(0, 20),
    canonicalName,
    aliases,
    summary: String(source.summary || fallbackText || '模型未给出摘要内容；请重试。').slice(0, 2000),
    details: source.details && typeof source.details === 'object' ? source.details : {},
    relations: Array.isArray(source.relations) ? source.relations : [],
    evidence: Array.isArray(source.evidence) ? source.evidence : [],
    identityConfidence: String(source.identityConfidence || 'medium'),
  }
}

function formatProfiles(items = []) {
  const lines = items.slice(0, 60).map((item) => `- ${item.name || item.canonicalName}【${item.type || '未分类'}】${item.summary || ''}`)
  return lines.length ? lines.join('\n') : '（暂无设定集资料）'
}

function dictionaryMessages(input, followup) {
  if (followup) {
    const history = (input.followUps || []).slice(-6).flatMap((item) => [
      { role: 'user', content: item.question },
      { role: 'assistant', content: item.answer },
    ])
    return [
      { role: 'system', content: '你是墨读阅读器的防剧透字典陪读。只能依据用户提供的已读章节、设定集和对话回答，不得使用外部剧情或透露后续内容。证据不足时明确说目前读到的内容还无法确定。使用自然、简洁的简体中文，300字以内。' },
      { role: 'user', content: `书名：《${input.bookTitle || '未知'}》\n章节：${input.chapterLabel || '未知'}\n选中文字：${input.selectedText}\n所在段落：${input.paragraph || ''}\n已读章节材料：${input.chapterText || ''}\n设定集：\n${formatProfiles(input.entityProfiles)}` },
      ...(input.explanation ? [{ role: 'assistant', content: input.explanation }] : []),
      ...history,
      { role: 'user', content: input.question },
    ]
  }
  return [
    { role: 'system', content: '你是墨读阅读器的防剧透字典百科。先用白话改写字面意思，再结合已提供的上下文解释真实含义、动机和因果。只能使用提供的材料，不能透露阅读位置之后的剧情。输出自然简体中文，最多400字，不加标题。' },
    { role: 'user', content: `书名：《${input.bookTitle || '未知'}》\n章节：${input.chapterLabel || '未知'}，读到约 ${Math.round((input.readPercent || 0) * 100)}%\n选中文字：${input.selectedText}\n完整段落：${input.paragraph || input.selectedText}\n前文：${input.contextBefore || '（无）'}\n后文：${input.contextAfter || '（无）'}\n设定集：\n${formatProfiles(input.entityProfiles)}` },
  ]
}

function companionSummaryMessages(input) {
  return [
    { role: 'system', content: '你是墨读阅读器的AI陪读。仅根据给出的本章正文和前序总结，返回一个完整JSON对象，键固定为 timePoint、location、characters、events、gains、openThreads、text。characters和events为数组，其余为字符串。全部使用简体中文，不得补充未提供或后续剧情。text不超过150字，events最多6条。只输出JSON。' },
    { role: 'user', content: `书名：《${input.bookTitle || '未知'}》${input.author ? `，作者：${input.author}` : ''}\n${input.coverageNote || ''}\n前序总结：\n${(input.previousSummaries || []).map((item) => `- ${item.label}：${item.text}`).join('\n') || '（无）'}\n\n本章：${input.chapterLabel || '未知章节'}\n${input.chapterText}` },
  ]
}

function companionChatMessages(input) {
  const history = (input.history || []).slice(-10).map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: item.content }))
  return [
    { role: 'system', content: '你是墨读阅读器的AI陪读。只能依据给出的已读剧情梳理、设定集和对话回答，绝不透露材料之后的情节。无证据时说“目前读到的部分还没有相关信息”。使用自然简体中文，500字以内。' },
    { role: 'user', content: `书名：《${input.bookTitle || '未知'}》\n已读剧情梳理：\n${(input.storyline || []).map((item) => `- ${item.label}：${item.text}`).join('\n') || '（无）'}\n设定集：\n${formatProfiles(input.entityProfiles)}` },
    ...history,
    { role: 'user', content: input.question },
  ]
}

export function createMobileAiApi(native) {
  async function activeProvider(input = {}) {
    const config = await loadConfig()
    const provider = config.providers.find((item) => item.id === (input.providerId || config.activeProviderId)) || config.providers[0]
    if (!provider) throw Object.assign(new Error('请先设置并选择 AI 供应商'), { aiError: aiError('setup', 0, 'PROVIDER_NOT_FOUND', '请先设置并选择 AI 供应商') })
    const model = String(input.model || provider.model || '').trim()
    if (!model) throw Object.assign(new Error('请选择或填写模型'), { aiError: aiError('setup', 0, 'MODEL_REQUIRED', '请选择或填写模型') })
    const apiKey = await secureGet(native, keyName(provider.id))
    if (!apiKey) throw Object.assign(new Error('该供应商尚未保存 API Key'), { aiError: aiError('setup', 0, 'API_KEY_REQUIRED', '该供应商尚未保存 API Key') })
    return { config, provider, model, apiKey }
  }

  async function chat(input, messages, stage) {
    try {
      const { provider, model, apiKey } = await activeProvider(input)
      const maxTokens = Math.max(256, Math.min(8192, Number(input.maxTokens ?? provider.maxTokens) || 4096))
      let parameter = provider.tokenParameter === 'max_tokens' ? 'max_tokens' : 'max_completion_tokens'
      const execute = () => requestJson(endpoint(provider.baseUrl, 'chat/completions'), {
        method: 'POST',
        headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        data: { model, [parameter]: maxTokens, stream: false, messages },
      })
      let response
      try { response = await execute() }
      catch (error) {
        if (provider.tokenParameter !== 'auto' || error.status !== 400 || !/max[_ -]?(completion[_ -]?)?tokens|unknown parameter|unsupported/i.test(`${error.code} ${error.message}`)) throw error
        parameter = parameter === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens'
        response = await execute()
      }
      const text = responseText(response)
      if (!text) throw Object.assign(new Error('供应商没有返回内容'), { status: 200, code: 'EMPTY_RESPONSE' })
      return { text, providerId: provider.id, providerName: provider.name, model, finishReason: response?.choices?.[0]?.finish_reason, usage: response?.usage || null }
    } catch (error) {
      throw Object.assign(error, { aiError: error.aiError || aiError(stage, error.status, error.code || 'NETWORK_ERROR', error.message) })
    }
  }

  return {
    getAiSettings: async () => publicConfig(await loadConfig()),
    saveAiProvider: async (input) => {
      const config = await loadConfig()
      const id = String(input?.id || randomId()).slice(0, 80)
      const existing = config.providers.find((item) => item.id === id)
      const name = String(input?.name || '').trim().slice(0, 80)
      if (!name) throw new Error('请填写供应商名称')
      const baseUrl = providerUrl(input?.baseUrl)
      const apiKey = String(input?.apiKey || '').trim()
      if (!apiKey && !existing?.hasKey) throw new Error('请填写 API Key')
      if (apiKey) await secureSet(native, keyName(id), apiKey)
      const provider = {
        ...existing,
        id,
        name,
        baseUrl,
        hasKey: true,
        model: String(input?.model ?? existing?.model ?? '').trim().slice(0, 160),
        maxTokens: Math.max(256, Math.min(8192, Number(input?.maxTokens ?? existing?.maxTokens) || 4096)),
        tokenParameter: ['auto', 'max_completion_tokens', 'max_tokens'].includes(input?.tokenParameter) ? input.tokenParameter : (existing?.tokenParameter || 'auto'),
        models: Array.isArray(input?.models) ? [...new Set(input.models.map(String).filter(Boolean))] : (existing?.models || []),
        updatedAt: Date.now(),
      }
      config.providers = [...config.providers.filter((item) => item.id !== id), provider]
      if (!config.activeProviderId) config.activeProviderId = id
      return saveConfig(config)
    },
    deleteAiProvider: async (providerId) => {
      const config = await loadConfig()
      config.providers = config.providers.filter((item) => item.id !== providerId)
      if (config.activeProviderId === providerId) config.activeProviderId = config.providers[0]?.id || ''
      await secureRemove(native, keyName(providerId))
      return saveConfig(config)
    },
    saveAiPreferences: async (input) => {
      const config = await loadConfig()
      if (config.providers.some((item) => item.id === input?.activeProviderId)) config.activeProviderId = input.activeProviderId
      const provider = config.providers.find((item) => item.id === (input?.providerId || config.activeProviderId))
      if (provider) {
        if (typeof input?.model === 'string') provider.model = input.model.trim().slice(0, 160)
        if (input?.maxTokens !== undefined) provider.maxTokens = Math.max(256, Math.min(8192, Number(input.maxTokens) || 4096))
        if (['auto', 'max_completion_tokens', 'max_tokens'].includes(input?.tokenParameter)) provider.tokenParameter = input.tokenParameter
      }
      return saveConfig(config)
    },
    refreshAiProvider: async (providerId) => {
      const config = await loadConfig()
      const provider = config.providers.find((item) => item.id === providerId)
      if (!provider) return { ok: false, error: aiError('models', 0, 'PROVIDER_NOT_FOUND', '没有找到该 AI 供应商') }
      try {
        const apiKey = await secureGet(native, keyName(provider.id))
        const response = await requestJson(endpoint(provider.baseUrl, 'models'), { headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` } })
        const models = [...new Set((Array.isArray(response?.data) ? response.data : []).map((item) => String(item?.id || item?.name || '')).filter(Boolean))].sort()
        provider.models = models.length ? models : provider.models || []
        provider.lastCheckedAt = Date.now()
        provider.lastStatus = models.length ? 'ok' : 'empty'
        if (!provider.model && provider.models.length) provider.model = provider.models[0]
        const settings = await saveConfig(config)
        return { ok: true, models: provider.models, fetchedModelCount: models.length, fetchedPages: 1, usedCachedModels: !models.length, settings }
      } catch (error) {
        provider.lastCheckedAt = Date.now()
        provider.lastStatus = 'error'
        const settings = await saveConfig(config)
        return { ok: false, error: aiError('models', error.status, error.code, error.message), settings }
      }
    },
    summarizeEntity: async (input) => {
      if (!String(input?.name || '').trim() || !input?.excerpts?.length) return { ok: false, error: aiError('search', 0, 'NO_PRIOR_EVIDENCE', '在当前阅读位置之前没有找到可用于总结的相关片段') }
      const excerpts = input.excerpts.slice(0, 48).map((item) => `[${item.chapter || item.order}] ${String(item.text || '').slice(0, 900)}`).join('\n')
      const messages = [
        { role: 'system', content: '你是墨读阅读器的防剧透设定集助手。只能根据用户提供的已读片段整理指定实体。返回完整JSON对象，键包括 type、canonicalName、aliases、summary、details、relations、evidence、identityConfidence。summary不超过500字，严禁补充后续剧情或外部知识。只输出JSON。' },
        { role: 'user', content: `书中实体：${input.name}\n已知实体：${(input.knownEntities || []).map((item) => `${item.name}（${(item.aliases || []).join('、')}）`).join('；')}\n${input.previousProfile ? `旧资料：${JSON.stringify(input.previousProfile)}` : ''}\n已读依据：\n${excerpts}` },
      ]
      try {
        const result = await chat(input, messages, 'summary')
        const parsed = parseJsonObject(result.text)
        return { ok: true, profile: normalizeProfile(parsed, input.name, parsed ? '' : result.text), summary: parsed?.summary || result.text, finishReason: result.finishReason, usage: result.usage, providerId: result.providerId, providerName: result.providerName, model: result.model }
      } catch (error) { return { ok: false, error: error.aiError } }
    },
    repairProfileJson: async (payload) => {
      const parsed = parseJsonObject(payload?.text)
      return parsed ? { ok: true, profile: normalizeProfile(parsed, payload?.name) } : { ok: false }
    },
    dictionaryChat: async (input) => {
      try {
        const result = await chat(input, dictionaryMessages(input, input?.mode === 'followup'), 'dictionary')
        return { ok: true, text: result.text.slice(0, 4000), providerId: result.providerId, providerName: result.providerName, model: result.model }
      } catch (error) { return { ok: false, error: error.aiError } }
    },
    companionSummary: async (input) => {
      if (!String(input?.chapterText || '').trim()) return { ok: false, error: aiError('companion', 0, 'EMPTY_CHAPTER', '章节内容为空') }
      try {
        const result = await chat(input, companionSummaryMessages(input), 'companion')
        const parsed = parseJsonObject(result.text)
        if (!parsed) return { ok: false, error: aiError('companion', 200, 'INVALID_JSON', '供应商返回的剧情总结不是有效 JSON，请重试') }
        const stringOf = (value, limit) => String(value || '').trim().slice(0, limit)
        const summary = { timePoint: stringOf(parsed.timePoint, 100), location: stringOf(parsed.location, 100), characters: (Array.isArray(parsed.characters) ? parsed.characters : []).slice(0, 20).map(String), events: (Array.isArray(parsed.events) ? parsed.events : []).slice(0, 6).map(String), gains: stringOf(parsed.gains, 500), openThreads: stringOf(parsed.openThreads, 500), text: stringOf(parsed.text, 500) }
        return { ok: true, summary, providerId: result.providerId, providerName: result.providerName, model: result.model, truncated: result.finishReason === 'length' }
      } catch (error) { return { ok: false, error: error.aiError } }
    },
    companionChat: async (input) => {
      try {
        const result = await chat(input, companionChatMessages(input), 'companion')
        return { ok: true, text: result.text.slice(0, 4000), providerId: result.providerId, providerName: result.providerName, model: result.model }
      } catch (error) { return { ok: false, error: error.aiError } }
    },
  }
}
