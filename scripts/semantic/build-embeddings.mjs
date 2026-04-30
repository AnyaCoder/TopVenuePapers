#!/usr/bin/env node
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

console.log(`Loading Transformers.js feature-extraction model: ${modelName}`)
const extractor = await pipeline('feature-extraction', modelName)

const vectors = []
let dimensions = 0

for (let start = 0; start < texts.length; start += batchSize) {
  const batchTexts = texts.slice(start, start + batchSize)
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
    vectors.push(data.slice(offset, offset + dimensions))
  }

  console.log(`Encoded ${Math.min(start + batchSize, texts.length)} / ${texts.length}`)
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
}

await mkdir(dirname(outPath), { recursive: true })
await mkdir(dirname(metaPath), { recursive: true })
await writeFile(outPath, Buffer.from(flat.buffer))
await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')

console.log(`Wrote ${outPath}`)
console.log(`Wrote ${metaPath}`)

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
