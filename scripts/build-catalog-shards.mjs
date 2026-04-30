#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { slugify } from './lib/paper-taxonomy.mjs'

const args = parseArgs(process.argv.slice(2))
const inputFile = args.input ?? 'data/papers.catalog.json'
const outDir = args.outDir ?? 'public/data/catalog'
const mirrorOutDir = args.mirrorOutDir ?? 'data/catalog'

const payload = JSON.parse(await readFile(inputFile, 'utf8'))
const papers = Array.isArray(payload) ? payload : payload.papers ?? []

const shardMap = new Map()

for (const paper of papers) {
  const key = getShardKey(paper)
  const shard = shardMap.get(key) ?? {
    key,
    venue: paper.venue,
    year: paper.year,
    papers: [],
  }
  shard.papers.push(paper)
  shardMap.set(key, shard)
}

const shards = Array.from(shardMap.values())
  .sort(
    (left, right) =>
      right.year - left.year ||
      left.venue.localeCompare(right.venue) ||
      left.key.localeCompare(right.key),
  )
  .map((shard) => {
    shard.papers.sort((left, right) => left.title.localeCompare(right.title))
    return shard
  })

const indexPayload = {
  generatedAt: payload.generatedAt ?? new Date().toISOString(),
  count: papers.length,
  guidedCount:
    payload.guidedCount ??
    papers.filter((paper) => paper.introZh).length,
  venueYearCount: shards.length,
  sources: payload.sources ?? [],
  notes: [
    ...(payload.notes ?? []),
    'Index payload keeps list/search fields only; abstract and Chinese guide stay in venue/year shards.',
  ],
  shards: shards.map((shard) => ({
    key: shard.key,
    venue: shard.venue,
    year: shard.year,
    count: shard.papers.length,
    path: `data/catalog/shards/${shard.key}.json`,
  })),
  papers: shards.flatMap((shard) =>
    shard.papers.map((paper) => ({
      ...paper,
      abstract: undefined,
      introZh: undefined,
      shardKey: shard.key,
      hasIntroZh: Boolean(paper.introZh),
      hasAbstract: Boolean(paper.abstract?.trim()),
    })),
  ),
}

await writeJson(join(outDir, 'index.json'), indexPayload)
await writeJson(join(mirrorOutDir, 'index.json'), indexPayload)

for (const shard of shards) {
  const shardPayload = {
    key: shard.key,
    venue: shard.venue,
    year: shard.year,
    count: shard.papers.length,
    papers: shard.papers,
  }
  await writeJson(join(outDir, 'shards', `${shard.key}.json`), shardPayload)
  await writeJson(join(mirrorOutDir, 'shards', `${shard.key}.json`), shardPayload)
}

console.log(`Wrote shard index with ${indexPayload.count} records across ${shards.length} venue/year shards.`)

function getShardKey(paper) {
  return `${paper.year}-${slugify(paper.venue, 'venue')}`
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--input') {
      parsed.input = argv[++index]
    } else if (arg === '--out-dir') {
      parsed.outDir = argv[++index]
    } else if (arg === '--mirror-out-dir') {
      parsed.mirrorOutDir = argv[++index]
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
  node scripts/build-catalog-shards.mjs [options]

Options:
  --input <path>            Full catalog JSON. Default: data/papers.catalog.json.
  --out-dir <dir>           Public catalog output dir. Default: public/data/catalog.
  --mirror-out-dir <dir>    Workspace mirror output dir. Default: data/catalog.
`)
  process.exit(0)
}
