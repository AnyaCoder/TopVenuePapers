import { env, pipeline } from '@huggingface/transformers'

interface EmbeddingMeta {
  format?: string
  model: string
  count: number
  dimensions: number
  ids: string[]
  titles?: string[]
  fingerprints?: string[]
  catalogGeneratedAt?: string
  chunks?: Array<{
    key: string
    venue: string
    year: number
    part?: number
    offset?: number
    count: number
    dimensions: number
    file: string
    bytes: number
    fingerprint?: string
  }>
}

interface BrowserSemanticResult {
  id: string
  score: number
  title?: string
}

interface BrowserSemanticIndex {
  meta: EmbeddingMeta
  embeddings: Float32Array
  extractor: (
    text: string,
    options: { pooling: 'mean'; normalize: true },
  ) => Promise<{ data: Float32Array }>
}

interface BrowserSemanticProgressPayload {
  stage: 'index' | 'model'
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready'
  name?: string
  file?: string
  progress?: number
  loaded?: number
  total?: number
  message: string
}

interface InitMessage {
  id: number
  type: 'init'
}

interface WarmupMessage {
  id: number
  type: 'warmup'
  payload: { query: string }
}

interface SearchMessage {
  id: number
  type: 'search'
  payload: { query: string; topK: number }
}

type WorkerMessage = InitMessage | WarmupMessage | SearchMessage

const baseUrl = self.location.origin + import.meta.env.BASE_URL
const metaUrl = `${baseUrl}data/semantic/paper-embeddings-all-MiniLM-L6-v2.meta.json`
const chunkedMetaUrl = `${baseUrl}data/semantic/paper-embeddings-all-MiniLM-L6-v2.chunked.meta.json`
const embeddingsUrl = `${baseUrl}data/semantic/paper-embeddings-all-MiniLM-L6-v2.f32.bin`
const semanticCacheName = 'top-venue-papers-semantic-v1'

let indexPromise: Promise<BrowserSemanticIndex> | undefined

self.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  void handleMessage(event.data)
})

async function handleMessage(message: WorkerMessage) {
  try {
    if (message.type === 'init') {
      const index = await loadIndex()
      self.postMessage({
        id: message.id,
        type: 'init',
        payload: { meta: index.meta },
      })
      return
    }

    if (message.type === 'warmup') {
      const index = await loadIndex()
      await index.extractor(message.payload.query, {
        pooling: 'mean',
        normalize: true,
      })
      postProgress({
        stage: 'model',
        status: 'ready',
        message: 'Semantic model ready in browser cache.',
      })
      self.postMessage({
        id: message.id,
        type: 'warmup',
        payload: { ok: true },
      })
      return
    }

    const results = await searchIndex(message.payload.query, message.payload.topK)
    self.postMessage({
      id: message.id,
      type: 'search',
      payload: results,
    })
  } catch (error) {
    self.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : 'Semantic worker failed.',
    })
  }
}

async function loadIndex() {
  indexPromise ??= createBrowserSemanticIndex()
  return indexPromise
}

async function searchIndex(query: string, topK: number) {
  const index = await loadIndex()
  const output = await index.extractor(query, {
    pooling: 'mean',
    normalize: true,
  })
  const queryVector = output.data as Float32Array
  const limit = clamp(topK, 1, index.meta.count)
  const hits: Array<{ index: number; score: number }> = []

  for (let row = 0; row < index.meta.count; row += 1) {
    let score = 0
    const offset = row * index.meta.dimensions

    for (let col = 0; col < index.meta.dimensions; col += 1) {
      score += index.embeddings[offset + col] * queryVector[col]
    }

    pushTopK(hits, { index: row, score }, limit)
  }

  return hits
    .sort((left, right) => right.score - left.score)
    .map<BrowserSemanticResult>(({ index: row, score }) => ({
      id: index.meta.ids[row],
      score,
      title: index.meta.titles?.[row],
    }))
}

async function createBrowserSemanticIndex(): Promise<BrowserSemanticIndex> {
  env.allowLocalModels = false
  env.useBrowserCache = true

  postProgress({
    stage: 'index',
    status: 'initiate',
    message: 'Checking semantic index cache...',
  })

  const meta = await loadSemanticMeta()
  const buffer = await loadSemanticEmbeddings(meta)
  const embeddings = new Float32Array(buffer)

  if (embeddings.length !== meta.count * meta.dimensions) {
    throw new Error(
      `Semantic index size mismatch: got ${embeddings.length}, expected ${
        meta.count * meta.dimensions
      }`,
    )
  }

  postProgress({
    stage: 'model',
    status: 'download',
    message: 'Preparing semantic model...',
  })

  const extractor = (await pipeline('feature-extraction', meta.model, {
    progress_callback: (data) => {
      if (
        data.status === 'initiate' ||
        data.status === 'download' ||
        data.status === 'progress' ||
        data.status === 'done' ||
        data.status === 'ready'
      ) {
        postProgress({
          stage: 'model',
          status: data.status,
          name: 'name' in data ? data.name : undefined,
          file: 'file' in data ? data.file : undefined,
          progress: 'progress' in data ? data.progress : undefined,
          loaded: 'loaded' in data ? data.loaded : undefined,
          total: 'total' in data ? data.total : undefined,
          message: describeModelProgress(data),
        })
      }
    },
  })) as unknown as BrowserSemanticIndex['extractor']

  postProgress({
    stage: 'model',
    status: 'ready',
    message: 'Semantic model ready in browser cache.',
  })

  return {
    meta,
    embeddings,
    extractor,
  }
}

async function loadSemanticMeta() {
  const cache = await openSemanticCache()
  const chunkedCacheKey = new Request(chunkedMetaUrl)
  const legacyCacheKey = new Request(metaUrl)

  try {
    const [chunkedResponse, legacyResponse] = await Promise.allSettled([
      fetch(chunkedMetaUrl, { cache: 'no-store' }),
      fetch(metaUrl, { cache: 'no-store' }),
    ])

    if (
      chunkedResponse.status === 'fulfilled' &&
      chunkedResponse.value.ok
    ) {
      await cache.put(chunkedCacheKey, chunkedResponse.value.clone())
      return normalizeChunkedMeta(await chunkedResponse.value.json() as EmbeddingMeta)
    }

    if (
      legacyResponse.status === 'fulfilled' &&
      legacyResponse.value.ok
    ) {
      await cache.put(legacyCacheKey, legacyResponse.value.clone())
      return (await legacyResponse.value.json()) as EmbeddingMeta
    }

    throw new Error('Could not load semantic metadata.')
  } catch (error) {
    const cached =
      (await cache.match(chunkedCacheKey)) ??
      (await cache.match(legacyCacheKey))

    if (cached) {
      postProgress({
        stage: 'index',
        status: 'done',
        message: 'Using cached semantic metadata.',
      })
      return normalizeChunkedMeta(await cached.json() as EmbeddingMeta)
    }

    throw error
  }
}

async function loadSemanticEmbeddings(meta: EmbeddingMeta) {
  if (meta.format === 'chunked-v1' && Array.isArray(meta.chunks) && meta.chunks.length > 0) {
    return loadChunkedSemanticEmbeddings(meta)
  }

  const cache = await openSemanticCache()
  const version = getSemanticVersion(meta)
  const cacheKey = new Request(`${embeddingsUrl}?semantic-cache=${encodeURIComponent(version)}`)
  const cached = await cache.match(cacheKey)

  if (cached) {
    const buffer = await cached.arrayBuffer()
    postProgress({
      stage: 'index',
      status: 'done',
      progress: 100,
      loaded: buffer.byteLength,
      total: buffer.byteLength,
      message: `Semantic index loaded from browser cache (${formatBytes(buffer.byteLength)}).`,
    })
    return buffer
  }

  postProgress({
    stage: 'index',
    status: 'download',
    message: 'Downloading semantic index...',
  })

  const response = await fetch(embeddingsUrl, { cache: 'no-store' })

  if (!response.ok) {
    throw new Error(`Could not load semantic index: ${response.status}`)
  }

  const buffer = await readEmbeddingsWithProgress(response)
  await pruneSemanticEmbeddingCache(cache, cacheKey.url)
  await cache.put(
    cacheKey,
    new Response(buffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
      },
    }),
  )

  return buffer
}

async function loadChunkedSemanticEmbeddings(meta: EmbeddingMeta) {
  const cache = await openSemanticCache()
  const totalBytes = meta.chunks?.reduce((sum, chunk) => sum + (chunk.bytes ?? 0), 0) ?? 0
  const flat = new Float32Array(meta.count * meta.dimensions)
  let rowOffset = 0
  let loadedBytes = 0

  postProgress({
    stage: 'index',
    status: 'download',
    message: `Preparing ${meta.chunks?.length ?? 0} semantic chunks...`,
  })

  for (const chunk of meta.chunks ?? []) {
    const version = getChunkVersion(meta, chunk)
    const chunkUrl = `${baseUrl}data/semantic/chunks/${chunk.file}`
    const cacheKey = new Request(`${chunkUrl}?semantic-cache=${encodeURIComponent(version)}`)
    const cached = await cache.match(cacheKey)
    let buffer

    if (cached) {
      buffer = await cached.arrayBuffer()
    } else {
      const response = await fetch(chunkUrl, { cache: 'no-store' })

      if (!response.ok) {
        throw new Error(`Could not load semantic chunk ${chunk.file}: ${response.status}`)
      }

      buffer = await response.arrayBuffer()
      await pruneSemanticChunkCache(cache, chunkUrl, cacheKey.url)
      await cache.put(
        cacheKey,
        new Response(buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(buffer.byteLength),
          },
        }),
      )
    }

    const chunkArray = new Float32Array(buffer)
    const chunkOffset = typeof chunk.offset === 'number' ? chunk.offset : rowOffset
    flat.set(chunkArray, chunkOffset * meta.dimensions)
    rowOffset = chunkOffset + chunk.count
    loadedBytes += buffer.byteLength

    postProgress({
      stage: 'index',
      status: 'progress',
      progress: totalBytes > 0 ? (loadedBytes / totalBytes) * 100 : undefined,
      loaded: loadedBytes,
      total: totalBytes,
      message: `Loaded semantic chunk ${chunk.key} (${rowOffset} / ${meta.count} papers).`,
    })
  }

  postProgress({
    stage: 'index',
    status: 'done',
    progress: 100,
    loaded: loadedBytes,
    total: totalBytes || loadedBytes,
    message: `Semantic chunks ready (${formatBytes(loadedBytes)}).`,
  })

  return flat.buffer
}

async function readEmbeddingsWithProgress(response: Response) {
  const total = Number(response.headers.get('content-length') ?? 0)
  const reader = response.body?.getReader()

  if (!reader) {
    const fallback = await response.arrayBuffer()
    postProgress({
      stage: 'index',
      status: 'done',
      progress: 100,
      loaded: fallback.byteLength,
      total: fallback.byteLength,
      message: `Semantic index ready (${formatBytes(fallback.byteLength)}).`,
    })
    return fallback
  }

  const chunks: Uint8Array[] = []
  let loaded = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    if (!value) {
      continue
    }

    chunks.push(value)
    loaded += value.byteLength

    postProgress({
      stage: 'index',
      status: 'progress',
      progress: total > 0 ? (loaded / total) * 100 : undefined,
      loaded,
      total,
      message:
        total > 0
          ? `Downloading semantic index: ${Math.round((loaded / total) * 100)}% (${formatBytes(loaded)} / ${formatBytes(total)})`
          : `Downloading semantic index: ${formatBytes(loaded)}`,
    })
  }

  const merged = new Uint8Array(loaded)
  let offset = 0

  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }

  postProgress({
    stage: 'index',
    status: 'done',
    progress: 100,
    loaded,
    total: total || loaded,
    message: `Semantic index ready (${formatBytes(loaded)}).`,
  })

  return merged.buffer
}

async function openSemanticCache() {
  if (typeof caches === 'undefined') {
    throw new Error('Browser Cache API is unavailable for semantic assets.')
  }

  return caches.open(semanticCacheName)
}

async function pruneSemanticEmbeddingCache(cache: Cache, keepUrl: string) {
  const keys = await cache.keys()

  for (const key of keys) {
    if (key.url.startsWith(embeddingsUrl) && key.url !== keepUrl) {
      await cache.delete(key)
    }
  }
}

function getSemanticVersion(meta: EmbeddingMeta) {
  return [
    meta.model,
    meta.count,
    meta.dimensions,
    meta.catalogGeneratedAt ?? 'unknown',
  ].join(':')
}

function getChunkVersion(
  meta: EmbeddingMeta,
  chunk: NonNullable<EmbeddingMeta['chunks']>[number],
) {
  return [
    meta.model,
    meta.dimensions,
    meta.catalogGeneratedAt ?? 'unknown',
    chunk.key,
    chunk.part ?? 1,
    chunk.offset ?? 0,
    chunk.count,
    chunk.fingerprint ?? `${chunk.key}:${chunk.count}:${chunk.file}`,
  ].join(':')
}

async function pruneSemanticChunkCache(cache: Cache, chunkUrl: string, keepUrl: string) {
  const keys = await cache.keys()

  for (const key of keys) {
    if (key.url.startsWith(chunkUrl) && key.url !== keepUrl) {
      await cache.delete(key)
    }
  }
}

function postProgress(payload: BrowserSemanticProgressPayload) {
  self.postMessage({
    type: 'progress',
    payload,
  })
}

function describeModelProgress(data: {
  status: 'initiate' | 'download' | 'progress' | 'done' | 'ready'
  file?: string
  progress?: number
  loaded?: number
  total?: number
}) {
  const file = data.file ? simplifyFileName(data.file) : 'model files'

  if (data.status === 'ready') {
    return 'Semantic model ready in browser cache.'
  }

  if (data.status === 'done') {
    return `Prepared ${file}.`
  }

  if (data.status === 'progress') {
    if (typeof data.progress === 'number' && data.total) {
      return `Preparing model: ${Math.round(data.progress)}% (${formatBytes(
        data.loaded ?? 0,
      )} / ${formatBytes(data.total)})`
    }

    if (typeof data.progress === 'number') {
      return `Preparing model: ${Math.round(data.progress)}%`
    }
  }

  if (data.status === 'initiate') {
    return `Checking ${file}...`
  }

  return `Preparing ${file}...`
}

function simplifyFileName(file: string) {
  const parts = file.split(/[\\/]/)
  return parts[parts.length - 1] || file
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  let index = 0
  let size = value

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024
    index += 1
  }

  return `${size >= 10 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`
}

function pushTopK(
  hits: Array<{ index: number; score: number }>,
  item: { index: number; score: number },
  limit: number,
) {
  if (hits.length < limit) {
    hits.push(item)
    return
  }

  let minIndex = 0

  for (let index = 1; index < hits.length; index += 1) {
    if (hits[index].score < hits[minIndex].score) {
      minIndex = index
    }
  }

  if (item.score > hits[minIndex].score) {
    hits[minIndex] = item
  }
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(Math.max(Math.trunc(value), min), max)
}

function normalizeChunkedMeta(meta: EmbeddingMeta) {
  if (meta.format !== 'chunked-v1' || !Array.isArray(meta.chunks)) {
    return meta
  }

  return {
    ...meta,
    ids: Array.isArray(meta.ids) ? meta.ids : [],
    titles: Array.isArray(meta.titles) ? meta.titles : [],
    fingerprints: Array.isArray(meta.fingerprints) ? meta.fingerprints : [],
  }
}
