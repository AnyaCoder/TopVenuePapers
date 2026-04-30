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
  const buffer = await embeddingsResponse.arrayBuffer()
  const embeddings = new Float32Array(buffer)

  if (embeddings.length !== meta.count * meta.dimensions) {
    throw new Error(
      `Semantic index size mismatch: got ${embeddings.length}, expected ${
        meta.count * meta.dimensions
      }`,
    )
  }

  const extractor = (await pipeline(
    'feature-extraction',
    meta.model,
  )) as unknown as BrowserSemanticIndex['extractor']

  return {
    meta,
    embeddings,
    extractor,
  }
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
