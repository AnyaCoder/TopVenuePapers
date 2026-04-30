#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { env, pipeline } from '@huggingface/transformers'
import {
  buildChunkedMeta,
  buildReusePlan,
  buildSemanticChunks,
  hashSemanticText,
  loadPreviousChunkManifest,
  loadPreviousSemanticArtifacts,
  removeSemanticLegacyArtifacts,
  paperToSemanticText,
  writeSemanticMeta,
  writeSemanticChunks,
} from './semantic-artifacts.mjs'

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const DEFAULT_CATALOG = 'data/papers.catalog.json'
const DEFAULT_OUT = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.f32.bin'
const DEFAULT_META = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.meta.json'
const DEFAULT_CHUNK_META = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.chunked.meta.json'

const args = parseArgs(process.argv.slice(2))
const modelName = args.model ?? DEFAULT_MODEL
const catalogPath = args.catalog ?? DEFAULT_CATALOG
const outPath = args.out ?? DEFAULT_OUT
const metaPath = args.metaOut ?? DEFAULT_META
const chunkMetaPath = args.chunkMetaOut ?? DEFAULT_CHUNK_META
const emitLegacy = args.emitLegacy === 'true'
const batchSize = Number(args.batchSize ?? 32)
env.cacheDir = args.cacheDir ?? 'data/semantic/transformers-cache'
if (args.remoteHost) {
  env.remoteHost = args.remoteHost
}

const payload = JSON.parse(await readFile(catalogPath, 'utf8'))
const papers = (Array.isArray(payload) ? payload : payload.papers ?? []).map((paper) => ({
  ...paper,
  shardKey: paper.shardKey ?? `${paper.year}-${paper.venue}`,
}))
const texts = papers.map(paperToSemanticText)
const fingerprints = texts.map(hashSemanticText)
papers.forEach((paper, index) => {
  paper.semanticFingerprint = fingerprints[index]
})
const previousArtifacts = await loadPreviousSemanticArtifacts({
  chunkMetaPath,
  metaPath,
  outPath,
})
const previousChunkMeta = await loadPreviousChunkManifest(chunkMetaPath)

const reuse = buildReusePlan({
  papers,
  texts,
  fingerprints,
  previousArtifacts,
  modelName,
})
let extractor = null
let dimensions = previousArtifacts?.meta?.dimensions ?? 0
const vectors = new Array(papers.length)

for (const item of reuse.reused) {
  vectors[item.index] = item.vector
}

if (reuse.pending.length > 0) {
  console.log(`Loading Transformers.js feature-extraction model: ${modelName}`)
  extractor = await pipeline('feature-extraction', modelName)
}

for (let start = 0; start < reuse.pending.length; start += batchSize) {
  const batchItems = reuse.pending.slice(start, start + batchSize)
  const batchTexts = batchItems.map((item) => item.text)
  const output = await extractor(batchTexts, {
    pooling: 'mean',
    normalize: true,
  })
  const dims = output.dims
  const data = Array.from(output.data)

  if (dims.length !== 2) {
    throw new Error(`Expected a 2D embedding tensor, got dims ${dims.join('x')}`)
  }

  dimensions = dims[1]

  for (let row = 0; row < dims[0]; row += 1) {
    const offset = row * dimensions
    vectors[batchItems[row].index] = data.slice(offset, offset + dimensions)
  }

  console.log(
    `Encoded ${Math.min(start + batchItems.length, reuse.pending.length)} / ${reuse.pending.length} changed paper(s)`,
  )
}

if (!dimensions) {
  dimensions = previousArtifacts?.meta?.dimensions ?? 0
}

const chunks = buildSemanticChunks({
  papers,
  vectors,
  dimensions,
})

const chunkedMeta = buildChunkedMeta({
  modelName,
  catalogPath,
  payload,
  papers,
  dimensions,
  chunks,
})

const chunkWriteStats = await writeSemanticChunks({
  chunks,
  chunkDir: join(dirname(chunkMetaPath), 'chunks'),
  previousMeta: previousChunkMeta,
})
await writeSemanticMeta(chunkMetaPath, chunkedMeta)

if (emitLegacy) {
  const { buildLegacyMeta, flattenVectors } = await import('./semantic-artifacts.mjs')
  const flat = flattenVectors(vectors, dimensions)
  const meta = buildLegacyMeta({
    modelName,
    catalogPath,
    payload,
    papers,
    dimensions,
    fingerprints,
  })
  const { mkdir, writeFile } = await import('node:fs/promises')
  await mkdir(dirname(outPath), { recursive: true })
  await mkdir(dirname(metaPath), { recursive: true })
  await writeFile(outPath, Buffer.from(flat.buffer))
  await writeSemanticMeta(metaPath, meta)
  console.log(`Wrote ${outPath}`)
  console.log(`Wrote ${metaPath}`)
} else {
  await removeSemanticLegacyArtifacts({ metaPath, outPath })
}

console.log(`Wrote ${chunkMetaPath}`)
console.log(
  `Chunk files: reused ${chunkWriteStats.reused}, wrote ${chunkWriteStats.written}, total ${chunkWriteStats.count}.`,
)
console.log(`Reused ${reuse.reused.length} embedding(s); encoded ${reuse.pending.length} changed embedding(s).`)

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--model') {
      parsed.model = argv[++index]
    } else if (arg === '--catalog') {
      parsed.catalog = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--meta-out') {
      parsed.metaOut = argv[++index]
    } else if (arg === '--chunk-meta-out') {
      parsed.chunkMetaOut = argv[++index]
    } else if (arg === '--emit-legacy') {
      parsed.emitLegacy = 'true'
    } else if (arg === '--batch-size') {
      parsed.batchSize = argv[++index]
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
  node scripts/semantic/build-embeddings.mjs [options]

Options:
  --model <name>       Transformers.js model. Default: Xenova/all-MiniLM-L6-v2.
  --catalog <path>     Paper catalog JSON. Default: data/papers.catalog.json.
  --out <path>         Float32 binary output.
  --meta-out <path>    Metadata JSON output.
  --chunk-meta-out <path> Chunked metadata JSON output.
  --emit-legacy        Also emit legacy monolithic binary/meta files.
  --batch-size <n>     Encoding batch size. Default: 32.
  --cache-dir <path>   Transformers.js cache directory.
  --remote-host <url>  Optional Hugging Face-compatible mirror.
`)
  process.exit(0)
}
