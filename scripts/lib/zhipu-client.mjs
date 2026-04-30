const DEFAULT_API_BASE = 'https://open.bigmodel.cn/api/paas/v4'

export function createZhipuClient(options = {}) {
  const apiKey = options.apiKey || process.env.ZHIPU_API_KEY

  if (!apiKey) {
    throw new Error('Missing ZHIPU_API_KEY for Zhipu discovery.')
  }

  return {
    apiBase: options.apiBase || process.env.ZHIPU_API_BASE || DEFAULT_API_BASE,
    apiKey,
    model: options.model || process.env.ZHIPU_MODEL || 'glm-4.5-flash',
    searchTool: options.searchTool || process.env.ZHIPU_SEARCH_TOOL || 'web-search-pro',
    readerTool: options.readerTool || process.env.ZHIPU_READER_TOOL || 'web-browser',
  }
}

export async function zhipuChat(client, body, retries = 3) {
  const url = `${client.apiBase}/chat/completions`
  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
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
      })

      if (!response.ok) {
        const details = await safeReadText(response)
        throw new Error(`Zhipu chat failed: ${response.status} ${response.statusText} ${details}`.trim())
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

export async function zhipuTool(client, tool, body = {}, retries = 3) {
  const url = `${client.apiBase}/tools`
  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${client.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tool,
          ...body,
        }),
      })

      if (!response.ok) {
        const details = await safeReadText(response)
        throw new Error(`Zhipu tool failed: ${response.status} ${response.statusText} ${details}`.trim())
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
  return zhipuTool(client, client.searchTool, {
    messages: [
      {
        role: 'user',
        content: query,
      },
    ],
    search_engine: options.searchEngine,
    search_domain_filter: options.domainFilter,
    search_recency_filter: options.recencyFilter,
    count: options.count,
  })
}

export async function zhipuWebReader(client, url, options = {}) {
  return zhipuTool(client, client.readerTool, {
    url,
    extract_level: options.extractLevel || 'deep',
    with_images: false,
  })
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

async function safeReadText(response) {
  try {
    return (await response.text()).slice(0, 500)
  } catch {
    return ''
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
