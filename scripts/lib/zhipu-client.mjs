const DEFAULT_API_BASE = 'https://open.bigmodel.cn/api/paas/v4'
const DEFAULT_SEARCH_TIMEOUT_MS = 20_000
const DEFAULT_READER_TIMEOUT_MS = 20_000
const DEFAULT_CHAT_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_BASE_DELAY_MS = 1_200
const DEFAULT_RATE_LIMIT_BASE_DELAY_MS = 30_000

export function createZhipuClient(options = {}) {
  const apiKey = options.apiKey || process.env.ZHIPU_API_KEY

  if (!apiKey) {
    throw new Error('Missing ZHIPU_API_KEY for Zhipu discovery.')
  }

  return {
    apiBase: options.apiBase || process.env.ZHIPU_API_BASE || DEFAULT_API_BASE,
    apiKey,
    model: options.model || process.env.ZHIPU_MODEL || 'glm-4.5-flash',
    searchTool: options.searchTool || process.env.ZHIPU_SEARCH_TOOL || 'search_pro',
    readerTool: options.readerTool || process.env.ZHIPU_READER_TOOL || 'reader',
  }
}

export async function zhipuChat(client, body, retries = 3, options = {}) {
  const url = `${client.apiBase}/chat/completions`
  let lastError
  const timeoutMs = readTimeoutMs(options.timeoutMs, 'ZHIPU_CHAT_TIMEOUT_MS', DEFAULT_CHAT_TIMEOUT_MS)
  const retryDelayMs = readTimeoutMs(
    options.retryDelayMs,
    'ZHIPU_RETRY_DELAY_MS',
    DEFAULT_RETRY_BASE_DELAY_MS,
  )
  const rateLimitDelayMs = readTimeoutMs(
    options.rateLimitDelayMs,
    'ZHIPU_RATE_LIMIT_DELAY_MS',
    DEFAULT_RATE_LIMIT_BASE_DELAY_MS,
  )

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: client.model,
          temperature: 0.1,
          ...body,
        }),
      }, timeoutMs)

      if (!response.ok) {
        const details = await safeReadText(response)
        throw createHttpError('chat', response.status, response.statusText, details)
      }

      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await sleep(getRetryDelay(error, attempt, { retryDelayMs, rateLimitDelayMs }))
      }
    }
  }

  throw lastError
}

export async function zhipuTool(client, tool, body = {}, retries = 3, options = {}) {
  const url = `${client.apiBase}/tools`
  let lastError
  const timeoutMs = readTimeoutMs(options.timeoutMs, 'ZHIPU_TOOL_TIMEOUT_MS', DEFAULT_CHAT_TIMEOUT_MS)

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool,
          ...body,
        }),
      }, timeoutMs)

      if (!response.ok) {
        const details = await safeReadText(response)
        throw createHttpError('tool', response.status, response.statusText, details)
      }

      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await sleep(700 * attempt)
      }
    }
  }

  throw lastError
}

export async function zhipuWebSearch(client, query, options = {}) {
  return zhipuPost(client, 'web_search', {
    search_query: query,
    search_engine: normalizeSearchEngine(options.searchEngine || client.searchTool),
    search_intent: false,
    search_domain_filter: options.domainFilter,
    search_recency_filter: options.recencyFilter || 'oneMonth',
    content_size: options.contentSize || 'medium',
    count: options.count,
  }, options.retries ?? 3, {
    timeoutMs: options.timeoutMs ?? readTimeoutMs(undefined, 'ZHIPU_SEARCH_TIMEOUT_MS', DEFAULT_SEARCH_TIMEOUT_MS),
  })
}

export async function zhipuWebReader(client, url, options = {}) {
  return zhipuPost(client, 'reader', {
    url,
    ...options.extraBody,
  }, options.retries ?? 2, {
    timeoutMs: options.timeoutMs ?? readTimeoutMs(undefined, 'ZHIPU_READER_TIMEOUT_MS', DEFAULT_READER_TIMEOUT_MS),
  })
}

export async function zhipuPost(client, endpoint, body = {}, retries = 3, options = {}) {
  const url = `${client.apiBase}/${endpoint}`
  let lastError
  const timeoutMs = readTimeoutMs(
    options.timeoutMs,
    endpoint === 'reader' ? 'ZHIPU_READER_TIMEOUT_MS' : 'ZHIPU_SEARCH_TIMEOUT_MS',
    endpoint === 'reader' ? DEFAULT_READER_TIMEOUT_MS : DEFAULT_SEARCH_TIMEOUT_MS,
  )

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(stripUndefined(body)),
      }, timeoutMs)

      if (!response.ok) {
        const details = await safeReadText(response)
        throw createHttpError(endpoint, response.status, response.statusText, details)
      }

      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await sleep(700 * attempt)
      }
    }
  }

  throw lastError
}

export function extractMessageText(response) {
  const content = response?.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }
        if (item?.type === 'text') {
          return item.text
        }
        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

export function tryParseJsonBlock(text) {
  const trimmed = String(text ?? '').trim()

  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]

    if (fenced) {
      return JSON.parse(fenced)
    }

    const objectSlice = trimmed.match(/\{[\s\S]*\}$/)?.[0]

    if (objectSlice) {
      return JSON.parse(objectSlice)
    }

    return null
  }
}

function normalizeSearchEngine(value) {
  const normalized = String(value || '').trim().toLowerCase()

  if (normalized === 'web-search-pro' || normalized === 'search_pro') {
    return 'search_pro'
  }

  if (normalized === 'web-search-std' || normalized === 'search_std') {
    return 'search_std'
  }

  if (normalized === 'search_pro_sogou' || normalized === 'sogou') {
    return 'search_pro_sogou'
  }

  if (normalized === 'search_pro_quark' || normalized === 'quark') {
    return 'search_pro_quark'
  }

  return 'search_pro'
}

function stripUndefined(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== ''),
  )
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function readTimeoutMs(value, envName, fallback) {
  const parsed = Number(value ?? process.env[envName])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function safeReadText(response) {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}

function createHttpError(endpoint, status, statusText, details) {
  const error = new Error(`Zhipu ${endpoint} failed: ${status} ${statusText} ${details}`.trim())
  error.status = status
  error.statusText = statusText
  error.details = details
  return error
}

function getRetryDelay(error, attempt, options) {
  if (error?.status === 429) {
    return options.rateLimitDelayMs * attempt
  }

  return options.retryDelayMs * attempt
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
