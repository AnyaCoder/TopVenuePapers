#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { env, pipeline } from '@huggingface/transformers'

const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2'
const DEFAULT_CATALOG = 'data/papers.catalog.json'
const DEFAULT_OUT = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.f32.bin'
const DEFAULT_META = 'data/semantic/paper-embeddings-all-MiniLM-L6-v2.meta.json'

const args = parseArgs(process.argv.slice(2))
const modelName = args.model ?? DEFAULT_MODEL
const catalogPath = args.catalog ?? DEFAULT_CATALOG
const outPath = args.out ?? DEFAULT_OUT
const metaPath = args.metaOut ?? DEFAULT_META
const batchSize = Number(args.batchSize ?? 32)
env.cacheDir = args.cacheDir ?? 'data/semantic/transformers-cache'
if (args.remoteHost) {
  env.remoteHost = args.remoteHost
}

const payload = JSON.parse(await readFile(catalogPath, 'utf8'))
const papers = Array.isArray(payload) ? payload : payload.papers ?? []
const texts = papers.map(paperToText)
const fingerprints = texts.map(hashText)
const previousArtifacts = await loadPreviousArtifacts(metaPath, outPath)

const reuse = buildReusePlan(papers, fingerprints, previousArtifacts)
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

const flat = new Float32Array(vectors.length * dimensions)
vectors.forEach((vector, row) => {
  flat.set(vector, row * dimensions)
})

const meta = {
  model: modelName,
  task: 'feature-extraction',
  catalog: catalogPath,
  catalogGeneratedAt: payload.generatedAt ?? null,
  count: papers.length,
  dimensions,
  normalized: true,
  ids: papers.map((paper) => paper.id),
  titles: papers.map((paper) => paper.title),
  fingerprints,
}

await mkdir(dirname(outPath), { recursive: true })
await mkdir(dirname(metaPath), { recursive: true })
await writeFile(outPath, Buffer.from(flat.buffer))
await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

console.log(`Wrote ${outPath}`)
console.log(`Wrote ${metaPath}`)
console.log(`Reused ${reuse.reused.length} embedding(s); encoded ${reuse.pending.length} changed embedding(s).`)

function paperToText(paper) {
  const fields = [
    paper.title,
    paper.titleZh,
    paper.venue,
    paper.track,
    (paper.keywords ?? []).join(' '),
    (paper.categories ?? []).join(' '),
    paper.tldr,
    paper.abstract,
    ...Object.values(paper.introZh ?? {}),
  ]

  return fields.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

async function loadPreviousArtifacts(metaPath, outPath) {
  try {
    const [metaText, binary] = await Promise.all([
      readFile(metaPath, 'utf8'),
      readFile(outPath),
    ])
    const meta = JSON.parse(metaText)

    if (!meta?.count || !meta?.dimensions) {
      return null
    }

    return {
      meta,
      vectors: new Float32Array(binary.buffer, binary.byteOffset, binary.byteLength / 4),
    }
  } catch {
    return null
  }
}

function buildReusePlan(papers, fingerprints, previousArtifacts) {
  if (
    !previousArtifacts ||
    previousArtifacts.meta.model !== modelName ||
    !Array.isArray(previousArtifacts.meta.ids) ||
    !Array.isArray(previousArtifacts.meta.fingerprints)
  ) {
    return {
      reused: [],
      pending: papers.map((paper, index) => ({
        index,
        id: paper.id,
        text: texts[index],
      })),
    }
  }

  const previousIndex = new Map()
  const dimensions = previousArtifacts.meta.dimensions

  previousArtifacts.meta.ids.forEach((id, index) => {
    previousIndex.set(id, {
      index,
      fingerprint: previousArtifacts.meta.fingerprints[index],
    })
  })

  const reused = []
  const pending = []

  papers.forEach((paper, index) => {
    const previous = previousIndex.get(paper.id)

    if (previous && previous.fingerprint === fingerprints[index]) {
      const start = previous.index * dimensions
      const end = start + dimensions
      reused.push({
        index,
        vector: Array.from(previousArtifacts.vectors.slice(start, end)),
      })
      return
    }

    pending.push({
      index,
      id: paper.id,
      text: texts[index],
    })
  })

  return { reused, pending }
}

function hashText(text) {
  return createHash('sha1').update(text).digest('hex')
}

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
  --batch-size <n>     Encoding batch size. Default: 32.
  --cache-dir <path>   Transformers.js cache directory.
  --remote-host <url>  Optional Hugging Face-compatible mirror.
`)
  process.exit(0)
}
