#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import {
  buildOfficialTitleIndex,
  mergeUnofficialEntry,
  normalizeAcceptedVenue,
  readUnofficialStore,
  writeUnofficialStore,
} from './lib/unofficial-papers.mjs'
import {
  createZhipuClient,
  extractMessageText,
  tryParseJsonBlock,
  zhipuChat,
  zhipuWebReader,
  zhipuWebSearch,
} from './lib/zhipu-client.mjs'

const args = parseArgs(process.argv.slice(2))
const storePath = args.store ?? 'data/unofficial/unofficial-papers.json'
const officialCatalogPath = args.officialCatalog ?? 'data/papers.catalog.official.json'
const dryRun = Boolean(args.dryRun)
const maxChecks = Number(args.maxChecks ?? 30)
const forceChecks = Boolean(args.force)

const store = await readUnofficialStore(storePath)
const officialCatalog = await readCatalog(officialCatalogPath)
const officialIndex = buildOfficialTitleIndex(officialCatalog)

let client = null
let updated = 0
let promoted = 0
let officialized = 0

const papers = [...store.papers]
const candidatesToCheck = []

for (let index = 0; index < papers.length; index += 1) {
  const paper = papers[index]
  const official = officialIndex.get(normalizeTitleKey(paper.title))

  if (official) {
    papers[index] = mergeUnofficialEntry(paper, {
      status: 'officially-published',
      acceptedVenue: official.venue,
      acceptedYear: official.year,
      lastCheckedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptanceEvidence: {
        confidence: 1,
        url: official.openreviewUrl,
        title: official.title,
        venue: official.venue,
      },
    })
    updated += 1
    officialized += 1
    continue
  }

  if (shouldCheckCandidate(paper, forceChecks) && candidatesToCheck.length < maxChecks) {
    candidatesToCheck.push({ index, paper })
  }
}

if (candidatesToCheck.length > 0) {
  client = createZhipuClient({
    model: args.model,
  })
}

for (const item of candidatesToCheck) {
  const verdict = await checkAcceptance(client, item.paper)
  const current = papers[item.index]

  const merged = mergeUnofficialEntry(current, {
    ...verdict,
    lastCheckedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  papers[item.index] = merged
  updated += 1

  if (current.status !== 'accepted' && merged.status === 'accepted') {
    promoted += 1
  }
}

const nextStore = {
  generatedAt: new Date().toISOString(),
  notes: [
    'Reconciliation first removes unofficial entries already present in the official catalog mirror.',
    'Remaining candidates are checked with Zhipu search evidence for main-conference acceptance signals.',
  ],
  papers,
}

if (!dryRun) {
  await writeUnofficialStore(storePath, nextStore)
}

console.log(`Unofficial store entries: ${papers.length}`)
console.log(`Officially published transitions: ${officialized}`)
console.log(`New accepted promotions: ${promoted}`)
console.log(`Entries touched: ${updated}`)
if (!dryRun) {
  console.log(`Wrote ${storePath}`)
}

async function checkAcceptance(client, paper) {
  const searchQuery = buildAcceptanceQuery(paper)
  const searchResponse = await zhipuWebSearch(client, searchQuery, {
    count: 6,
  })
  const evidence = collectSearchItems(searchResponse).slice(0, 6)
  const readerEvidence = []

  for (const item of evidence.slice(0, 4)) {
    let readerTitle = ''
    let readerExcerpt = ''

    try {
      const response = await zhipuWebReader(client, item.url)
      const normalized = normalizeReaderPayload(response)
      readerTitle = normalized.title
      readerExcerpt = normalized.excerpt
    } catch (error) {
      readerExcerpt = `reader failed: ${error.message}`
    }

    readerEvidence.push({
      ...item,
      readerTitle,
      readerExcerpt,
    })
  }

  const response = await zhipuChat(client, {
    messages: [
      {
        role: 'system',
        content:
          '你是严格的接收状态判定器。只能基于给定证据判断是否为 2026 主会议 accepted，不要编造。',
      },
      {
        role: 'user',
        content: `
请判断这篇论文当前是否已经有足够证据显示被 2026 主会议接收。

论文信息：
${JSON.stringify(
  {
    title: paper.title,
    authors: paper.authors,
    currentStatus: paper.status,
    currentAcceptedVenue: paper.acceptedVenue,
  },
  null,
  2,
)}

证据：
${JSON.stringify(readerEvidence, null, 2)}

只输出 JSON：
{
  "accepted": true,
  "acceptedVenue": "ACL 2026",
  "acceptedYear": 2026,
  "confidence": 0.0,
  "reason": "中文简述判断依据",
  "acceptanceEvidence": {
    "url": "https://...",
    "title": "evidence title",
    "venue": "ACL 2026",
    "snippet": "关键片段"
  }
}

如果无法确认 accepted，则输出 accepted=false，acceptedVenue 置空。
`.trim(),
      },
    ],
  })

  const text = extractMessageText(response)
  const parsed = tryParseJsonBlock(text) ?? {}
  const acceptedVenue =
    parsed.acceptedVenue ||
    normalizeAcceptedVenue(parsed.reason, parsed.acceptanceEvidence?.title)?.venue ||
    undefined
  const acceptedYear =
    Number.isFinite(Number(parsed.acceptedYear)) && Number(parsed.acceptedYear) > 0
      ? Number(parsed.acceptedYear)
      : 2026
  const accepted = Boolean(parsed.accepted && acceptedVenue)

  return {
    status: accepted ? 'accepted' : paper.status,
    acceptedVenue: accepted ? acceptedVenue : paper.acceptedVenue,
    acceptedYear: accepted ? acceptedYear : paper.acceptedYear,
    reason: parsed.reason || paper.reason,
    confidence: Math.max(Number(parsed.confidence ?? 0), Number(paper.confidence ?? 0)),
    acceptanceEvidence: accepted
      ? {
          confidence: Number(parsed.confidence ?? 0),
          url: parsed.acceptanceEvidence?.url || readerEvidence[0]?.url || '',
          title: parsed.acceptanceEvidence?.title || readerEvidence[0]?.title || '',
          venue: acceptedVenue,
          snippet:
            parsed.acceptanceEvidence?.snippet ||
            readerEvidence[0]?.readerExcerpt ||
            readerEvidence[0]?.snippet ||
            '',
        }
      : paper.acceptanceEvidence,
    evidence: mergeEvidence(paper.evidence ?? [], readerEvidence),
  }
}

async function readCatalog(path) {
  try {
    const payload = JSON.parse(await readFile(path, 'utf8'))
    return Array.isArray(payload) ? payload : payload.papers ?? []
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return []
    }
    throw error
  }
}

function shouldCheckCandidate(paper, forceChecks) {
  if (paper.status === 'officially-published') {
    return false
  }

  if (paper.status === 'accepted' && !forceChecks) {
    return false
  }

  if (forceChecks) {
    return true
  }

  if (!paper.lastCheckedAt) {
    return true
  }

  const lastChecked = Date.parse(paper.lastCheckedAt)
  if (!Number.isFinite(lastChecked)) {
    return true
  }

  return Date.now() - lastChecked > 1000 * 60 * 60 * 18
}

function buildAcceptanceQuery(paper) {
  const authorHint = Array.isArray(paper.authors) && paper.authors.length > 0
    ? ` "${paper.authors[0]}"`
    : ''

  return `"${paper.title}"${authorHint} accepted OR "paper accepted" OR ACL OR AAAI OR CVPR OR ICCV OR ICLR OR ICML OR NeurIPS OR EMNLP 2026`
}

function collectSearchItems(response) {
  const payloads = [
    ...(Array.isArray(response?.data) ? response.data : []),
    ...(Array.isArray(response?.results) ? response.results : []),
    ...(Array.isArray(response?.items) ? response.items : []),
  ]

  return payloads
    .map((item) => ({
      platform: detectPlatform(item.url || item.link || ''),
      url: item.url || item.link || '',
      title: item.title || item.name || '',
      author: item.author || item.site_name || '',
      snippet: item.content || item.snippet || item.description || '',
      publishDate: item.publish_time || item.date || '',
    }))
    .filter((item) => item.url)
}

function normalizeReaderPayload(response) {
  const data = response?.data ?? response?.result ?? response ?? {}
  const title = data.title || data.page_title || data.name || ''
  const excerpt = data.content || data.text || data.markdown || data.summary || ''

  return {
    title: String(title || '').trim(),
    excerpt: String(excerpt || '').replace(/\s+/g, ' ').slice(0, 2200).trim(),
  }
}

function normalizeTitleKey(title) {
  return String(title ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectPlatform(url) {
  if (/x\.com|twitter\.com/i.test(url)) {
    return 'x'
  }
  if (/xiaohongshu\.com/i.test(url)) {
    return 'xiaohongshu'
  }
  if (/openreview\.net|aaai\.org|thecvf\.com/i.test(url)) {
    return 'official'
  }
  return 'web'
}

function mergeEvidence(left, right) {
  const byKey = new Map()

  for (const item of [...left, ...right]) {
    if (!item?.url) {
      continue
    }

    byKey.set(`${item.platform ?? 'web'}:${item.url}`, item)
  }

  return Array.from(byKey.values())
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--store') {
      parsed.store = argv[++index]
    } else if (arg === '--official-catalog') {
      parsed.officialCatalog = argv[++index]
    } else if (arg === '--max-checks') {
      parsed.maxChecks = argv[++index]
    } else if (arg === '--model') {
      parsed.model = argv[++index]
    } else if (arg === '--force') {
      parsed.force = true
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
  node scripts/reconcile-unofficial-papers.mjs [options]

Options:
  --store <path>               Unofficial-paper store path.
  --official-catalog <path>    Official catalog mirror for exact-title reconciliation.
  --max-checks <n>             Maximum unofficial entries to re-check. Default: 30.
  --model <name>               Zhipu chat model.
  --force                      Re-check accepted entries too.
  --dry-run                    Do not persist results.
`)
  process.exit(0)
}
