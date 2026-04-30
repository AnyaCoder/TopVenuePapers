#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { normalizeOpenReviewNote } from './lib/paper-taxonomy.mjs'

const DEFAULT_VENUES = [
  'ICLR 2026 Oral',
  'ICLR 2026 Spotlight',
  'ICLR 2026 Poster',
]

const args = parseArgs(process.argv.slice(2))
const outFile = args.out ?? 'data/openreview/iclr-2026-candidates.json'
const venues = args.venue?.length ? args.venue : DEFAULT_VENUES
const apiBase = args.apiBase ?? 'https://api2.openreview.net'
const pageLimit = Number(args.limit ?? 500)
const maxPages = Number(args.maxPages ?? 20)
const includeAll = Boolean(args.includeAll)
const dryRun = Boolean(args.dryRun)
const invitation =
  args.invitation ?? 'ICLR.cc/2026/Conference/-/Submission'

if (!Number.isFinite(pageLimit) || pageLimit <= 0) {
  throw new Error('--limit must be a positive number')
}

const allCandidates = []

for (const venue of venues) {
  const notes = await fetchVenueNotes({
    apiBase,
    venue,
    invitation,
    pageLimit,
    maxPages,
  })

  for (const note of notes) {
    const candidate = normalizeOpenReviewNote(note)

    if (includeAll || candidate.relevanceScore > 0) {
      allCandidates.push(candidate)
    }
  }
}

const deduped = dedupeByOpenReviewId(allCandidates)
  .sort((left, right) => right.relevanceScore - left.relevanceScore || left.title.localeCompare(right.title))

const payload = {
  generatedAt: new Date().toISOString(),
  source: 'OpenReview API v2',
  venues,
  filters: {
    includeAll,
    invitation,
    topic: 'LLM/VLM/VLA/MLLM adjacent papers',
  },
  count: deduped.length,
  papers: deduped,
}

if (dryRun) {
  printSummary(payload)
} else {
  await mkdir(dirname(outFile), { recursive: true })
  await writeFile(outFile, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  printSummary(payload)
  console.log(`\nWrote ${outFile}`)
}

async function fetchVenueNotes({
  apiBase,
  venue,
  invitation,
  pageLimit,
  maxPages,
}) {
  const notes = []

  for (let page = 0; page < maxPages; page += 1) {
    const offset = page * pageLimit
    const url = new URL('/notes', apiBase)
    url.searchParams.set('content.venue', venue)
    url.searchParams.set('invitation', invitation)
    url.searchParams.set('limit', String(pageLimit))
    url.searchParams.set('offset', String(offset))

    const response = await fetchWithRetry(url)
    const body = await response.json()
    const pageNotes = body.notes ?? []
    notes.push(...pageNotes)

    if (pageNotes.length < pageLimit) {
      break
    }
  }

  console.log(`${venue}: ${notes.length} notes`)
  return notes
}

async function fetchWithRetry(url, retries = 3) {
  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'user-agent': 'ccfa-2026-paper-explorer/0.1',
        },
      })

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      return response
    } catch (error) {
      lastError = error

      if (attempt < retries) {
        await sleep(500 * attempt)
      }
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? lastError}`)
}

function dedupeByOpenReviewId(candidates) {
  const seen = new Map()

  for (const candidate of candidates) {
    seen.set(candidate.openreviewId, candidate)
  }

  return Array.from(seen.values())
}

function printSummary(payload) {
  console.log(`\nMatched ${payload.count} papers`)
  payload.papers.slice(0, 10).forEach((paper, index) => {
    console.log(`${String(index + 1).padStart(2, '0')}. [${paper.primaryCategory}] ${paper.title}`)
  })
}

function parseArgs(argv) {
  const parsed = {
    venue: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--venue') {
      parsed.venue.push(argv[++index])
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--api-base') {
      parsed.apiBase = argv[++index]
    } else if (arg === '--invitation') {
      parsed.invitation = argv[++index]
    } else if (arg === '--limit') {
      parsed.limit = argv[++index]
    } else if (arg === '--max-pages') {
      parsed.maxPages = argv[++index]
    } else if (arg === '--include-all') {
      parsed.includeAll = true
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
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
  node scripts/ingest-openreview.mjs [options]

Options:
  --venue <name>      OpenReview content.venue value. Repeatable.
  --out <path>        Output JSON path.
  --invitation <id>   OpenReview invitation. Default: ICLR.cc/2026/Conference/-/Submission.
  --limit <n>         Page size. Default: 500.
  --max-pages <n>     Max pages per venue. Default: 20.
  --include-all       Keep every accepted paper instead of topic filtering.
  --dry-run           Fetch and summarize without writing.
`)
  process.exit(0)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
