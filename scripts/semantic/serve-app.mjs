#!/usr/bin/env node
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { env, pipeline } from '@huggingface/transformers'
import { loadSemanticSearchMatrix } from './semantic-artifacts.mjs'

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const DEFAULT_EMBEDDINGS = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.f32.bin'
const DEFAULT_META = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.meta.json'
const DEFAULT_CHUNK_META = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.chunked.meta.json'
const DEFAULT_DIST = 'dist'

const args = parseArgs(process.argv.slice(2))
const host = args.host ?? '127.0.0.1'
const port = Number(args.port ?? 4174)
const modelName = args.model ?? DEFAULT_MODEL
const embeddingsPath = args.embeddings ?? DEFAULT_EMBEDDINGS
const metaPath = args.meta ?? DEFAULT_META
const chunkMetaPath = args.chunkMeta ?? DEFAULT_CHUNK_META
const distDir = resolve(args.dist ?? DEFAULT_DIST)

env.cacheDir = args.cacheDir ?? 'data/semantic/transformers-cache'
if (args.remoteHost) {
  env.remoteHost = args.remoteHost
}

const { meta, embeddings } = await loadSemanticSearchMatrix({
  metaPath,
  chunkMetaPath,
  outPath: embeddingsPath,
})
const dimensions = meta.dimensions
const count = meta.count

if (embeddings.length !== count * dimensions) {
  throw new Error(
    `Embedding size mismatch: got ${embeddings.length}, expected ${count * dimensions}`,
  )
}

console.log(`Loading Transformers.js feature-extraction model: ${modelName}`)
const extractor = await pipeline('feature-extraction', modelName)
console.log(`Semantic index ready: ${count} papers x ${dimensions} dims`)

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', `http://${host}:${port}`)

    if (request.method === 'GET' && url.pathname === '/api/semantic/health') {
      writeJson(response, {
        ok: true,
        model: modelName,
        count,
        dimensions,
      })
      return
    }

    if (request.method === 'GET' && url.pathname === '/api/semantic/search') {
      const query = (url.searchParams.get('q') ?? '').trim()
      const topK = clamp(Number(url.searchParams.get('top_k') ?? 500), 1, count)

      if (!query) {
        writeJson(response, { query, results: [] })
        return
      }

      const results = await search(query, topK)
      writeJson(response, { query, results })
      return
    }

    if (request.method === 'GET' || request.method === 'HEAD') {
      await serveStatic(url.pathname, response, request.method === 'HEAD')
      return
    }

    response.writeHead(405)
    response.end()
  } catch (error) {
    console.error(error)
    writeJson(
      response,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      500,
    )
  }
})

server.listen(port, host, () => {
  console.log(`CCFA paper finder listening on http://${host}:${port}`)
})

async function search(query, topK) {
  const output = await extractor(query, {
    pooling: 'mean',
    normalize: true,
  })
  const queryVector = output.data
  const heap = []

  for (let row = 0; row < count; row += 1) {
    let score = 0
    const offset = row * dimensions

    for (let col = 0; col < dimensions; col += 1) {
      score += embeddings[offset + col] * queryVector[col]
    }

    pushTopK(heap, { index: row, score }, topK)
  }

  return heap
    .sort((left, right) => right.score - left.score)
    .map(({ index, score }) => ({
      id: meta.ids[index],
      score,
      title: meta.titles?.[index],
    }))
}

function pushTopK(heap, item, limit) {
  if (heap.length < limit) {
    heap.push(item)
    return
  }

  let minIndex = 0
  for (let index = 1; index < heap.length; index += 1) {
    if (heap[index].score < heap[minIndex].score) {
      minIndex = index
    }
  }

  if (item.score > heap[minIndex].score) {
    heap[minIndex] = item
  }
}

async function serveStatic(pathname, response, headOnly) {
  const decodedPath = decodeURIComponent(pathname)
  const normalizedPath = normalize(decodedPath).replace(/^(\.\.(?:\/|\\|$))+/, '')
  const relativePath = normalizedPath === sep || normalizedPath === '/'
    ? 'index.html'
    : normalizedPath.replace(/^[/\\]+/, '')
  let filePath = resolve(join(distDir, relativePath))

  if (!filePath.startsWith(`${distDir}${sep}`) && filePath !== distDir) {
    response.writeHead(403)
    response.end()
    return
  }

  try {
    const body = await readFile(filePath)
    response.writeHead(200, {
      'Content-Type': getContentType(filePath),
      'Content-Length': body.length,
      'Cache-Control': filePath.endsWith('index.html')
        ? 'no-cache'
        : 'public, max-age=31536000, immutable',
    })
    if (!headOnly) {
      response.end(body)
    } else {
      response.end()
    }
  } catch {
    filePath = join(distDir, 'index.html')
    const stream = createReadStream(filePath)
    response.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache',
    })
    if (!headOnly) {
      stream.pipe(response)
    } else {
      response.end()
    }
  }
}

function writeJson(response, payload, status = 200) {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  })
  response.end(body)
}

function getContentType(filePath) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
  }

  return types[extname(filePath)] ?? 'application/octet-stream'
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(Math.max(Math.trunc(value), min), max)
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--model') {
      parsed.model = argv[++index]
    } else if (arg === '--embeddings') {
      parsed.embeddings = argv[++index]
    } else if (arg === '--meta') {
      parsed.meta = argv[++index]
    } else if (arg === '--chunk-meta') {
      parsed.chunkMeta = argv[++index]
    } else if (arg === '--dist') {
      parsed.dist = argv[++index]
    } else if (arg === '--host') {
      parsed.host = argv[++index]
    } else if (arg === '--port') {
      parsed.port = argv[++index]
    } else if (arg === '--cache-dir') {
      parsed.cacheDir = argv[++index]
    } else if (arg === '--remote-host') {
      parsed.remoteHost = argv[++index]
    } else if (arg === '--help') {
      printHelpAndExit()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelpAndExit() {
  console.log(`
Usage:
  node scripts/semantic/serve-app.mjs [options]

Options:
  --host <host>        Default: 127.0.0.1.
  --port <port>        Default: 4174.
  --dist <path>        Static dist directory. Default: dist.
  --model <name>       Transformers.js model. Default: Xenova/all-MiniLM-L6-v2.
  --embeddings <path>  Float32 embedding binary.
  --meta <path>        Metadata JSON.
  --chunk-meta <path>  Chunked metadata JSON.
  --cache-dir <path>   Transformers.js cache directory.
  --remote-host <url>  Optional Hugging Face-compatible mirror.
`)
  process.exit(0)
}
