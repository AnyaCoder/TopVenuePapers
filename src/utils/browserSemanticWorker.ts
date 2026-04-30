import { env, pipeline } from '@huggingface/transformers'

interface EmbeddingMeta {
  model: string
  count: number
  dimensions: number
  ids: string[]
  titles: string[]
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
const embeddingsUrl = `${baseUrl}data/semantic/paper-embeddings-all-MiniLM-L6-v2.f32.bin`

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
      title: index.meta.titles[row],
    }))
}

async function createBrowserSemanticIndex(): Promise<BrowserSemanticIndex> {
  env.allowLocalModels = false
  env.useBrowserCache = true

  postProgress({
    stage: 'index',
    status: 'download',
    message: 'Downloading semantic index...',
  })

  const [metaResponse, embeddingsResponse] = await Promise.all([
    fetch(metaUrl),
    fetch(embeddingsUrl),
  ])

  if (!metaResponse.ok) {
    throw new Error(`Could not load semantic metadata: ${metaResponse.status}`)
  }

  if (!embeddingsResponse.ok) {
    throw new Error(`Could not load semantic index: ${embeddingsResponse.status}`)
  }

  const meta = (await metaResponse.json()) as EmbeddingMeta
  const buffer = await readEmbeddingsWithProgress(embeddingsResponse)
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
