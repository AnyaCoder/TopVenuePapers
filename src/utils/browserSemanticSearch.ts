export interface BrowserSemanticResult {
  id: string
  score: number
  title?: string
}

export interface BrowserSemanticMeta {
  model: string
  count: number
  dimensions: number
  ids: string[]
  titles: string[]
}

export interface BrowserSemanticIndexHandle {
  meta: BrowserSemanticMeta
}

interface BrowserSemanticWorkerRequestMap {
  init: undefined
  warmup: { query: string }
  search: { query: string; topK: number }
}

interface BrowserSemanticWorkerResponseMap {
  init: BrowserSemanticIndexHandle
  warmup: { ok: true }
  search: BrowserSemanticResult[]
}

interface WorkerResponseEnvelope<T extends keyof BrowserSemanticWorkerResponseMap> {
  id: number
  type: T
  payload: BrowserSemanticWorkerResponseMap[T]
}

interface WorkerErrorEnvelope {
  id: number
  error: string
}

type WorkerEnvelope<T extends keyof BrowserSemanticWorkerResponseMap> =
  | WorkerResponseEnvelope<T>
  | WorkerErrorEnvelope

let workerPromise: Promise<Worker> | undefined
let initPromise: Promise<BrowserSemanticIndexHandle> | undefined
let requestCounter = 0
const pendingRequests = new Map<
  number,
  {
    resolve: (value: unknown) => void
    reject: (reason?: unknown) => void
  }
>()

export async function loadBrowserSemanticIndex() {
  initPromise ??= callWorker('init', undefined)
  return initPromise
}

export async function preloadBrowserSemanticIndex() {
  if (initPromise) {
    return initPromise
  }

  initPromise = loadBrowserSemanticIndex().catch((error) => {
    initPromise = undefined
    throw error
  })

  return initPromise
}

export async function warmupBrowserSemanticModel(query = 'video understanding') {
  await loadBrowserSemanticIndex()
  return callWorker('warmup', { query })
}

export async function searchBrowserSemanticIndex(query: string, topK: number) {
  await loadBrowserSemanticIndex()
  return callWorker('search', { query, topK })
}

function getWorker() {
  workerPromise ??= Promise.resolve(
    new Worker(new URL('./browserSemanticWorker.ts', import.meta.url), {
      type: 'module',
    }),
  ).then((worker) => {
    worker.addEventListener('message', handleWorkerMessage)
    worker.addEventListener('error', (event) => {
      rejectAllPending(event.message || 'Browser semantic worker crashed.')
      workerPromise = undefined
      initPromise = undefined
    })

    return worker
  })

  return workerPromise
}

async function callWorker<T extends keyof BrowserSemanticWorkerResponseMap>(
  type: T,
  payload: BrowserSemanticWorkerRequestMap[T],
) {
  const worker = await getWorker()
  const id = requestCounter++

  return new Promise<BrowserSemanticWorkerResponseMap[T]>((resolve, reject) => {
    pendingRequests.set(id, {
      resolve: (value) => resolve(value as BrowserSemanticWorkerResponseMap[T]),
      reject,
    })
    worker.postMessage({ id, type, payload })
  })
}

function handleWorkerMessage(
  event: MessageEvent<WorkerEnvelope<keyof BrowserSemanticWorkerResponseMap>>,
) {
  const message = event.data
  const pending = pendingRequests.get(message.id)

  if (!pending) {
    return
  }

  pendingRequests.delete(message.id)

  if ('error' in message) {
    pending.reject(new Error(message.error))
    return
  }

  pending.resolve(message.payload)
}

function rejectAllPending(message: string) {
  for (const pending of pendingRequests.values()) {
    pending.reject(new Error(message))
  }

  pendingRequests.clear()
}
