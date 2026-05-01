#!/usr/bin/env node
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  buildOfficialTitleIndex,
  buildUnofficialId,
  mergeUnofficialEntry,
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

const DEFAULT_QUERIES = [
  'site:x.com (introducing OR "new work" OR "our paper" OR accepted) (llm OR vlm OR vla OR mllm OR multimodal) 2026',
  'site:x.com ("new paper" OR "paper accepted" OR accepted) (agent OR reasoning OR video OR embodied OR robotics) 2026',
  'site:xiaohongshu.com (Introducing OR "new work" OR "paper accepted") (LLM OR VLM OR VLA OR MLLM OR multimodal) 2026',
  'site:xiaohongshu.com ("paper accepted" OR "new work" OR "new paper" OR "accepted to") (reasoning OR Agent OR video OR robotics OR world model) 2026',
]

const args = parseArgs(process.argv.slice(2))
const storePath = args.store ?? 'data/unofficial/unofficial-papers.json'
const tracePath = args.trace ?? 'data/unofficial/discovery-trace.json'
const officialCatalogPath = args.officialCatalog ?? 'data/papers.catalog.official.json'
const queryList = args.query.length > 0 ? args.query : DEFAULT_QUERIES
const maxResultsPerQuery = Number(args.maxResults ?? 8)
const maxReaders = Number(args.maxReaders ?? 18)
const dryRun = Boolean(args.dryRun)
const forceReader = Boolean(args.forceReader)

const client = createZhipuClient({
  model: args.model,
})

const existingStore = await readUnofficialStore(storePath)
const officialCatalog = await readCatalog(officialCatalogPath)
const officialIndex = buildOfficialTitleIndex(officialCatalog)
const trace = createTrace(client)
const results = []

for (const query of queryList) {
  const queryTrace = {
    query,
    requestedCount: maxResultsPerQuery,
    resultCount: 0,
    results: [],
  }

  try {
    const searchResponse = await zhipuWebSearch(client, query, {
      count: maxResultsPerQuery,
    })
    const items = collectSearchItems(searchResponse, query)
    queryTrace.resultCount = items.length
    queryTrace.results = items.map(summarizeEvidence)
    results.push(...items)
  } catch (error) {
    queryTrace.error = errorToMessage(error)
    trace.errors.push(`Search failed for query "${query}": ${queryTrace.error}`)
  }

  trace.queries.push(queryTrace)
}

const dedupedEvidence = dedupeEvidence(results).slice(0, Math.max(maxReaders, results.length))
const enrichedEvidence = []

for (const item of dedupedEvidence) {
  let readerTitle = ''
  let readerExcerpt = ''
  let readerError = ''

  if (forceReader || isLikelyHelpfulReaderTarget(item.url)) {
    try {
      const readerResponse = await zhipuWebReader(client, item.url)
      const readerPayload = normalizeReaderPayload(readerResponse)
      readerTitle = readerPayload.title
      readerExcerpt = readerPayload.excerpt
    } catch (error) {
      readerError = errorToMessage(error)
      readerExcerpt = `reader failed: ${readerError}`
    }
  }

  const enriched = {
    ...item,
    readerTitle,
    readerExcerpt,
  }

  enrichedEvidence.push(enriched)
  trace.readers.push(summarizeReaderEvidence(enriched, readerError))
}

const batches = chunk(enrichedEvidence, 6)
const extractedCandidates = []

for (const [batchIndex, batch] of batches.entries()) {
  const extraction = await extractCandidatesFromEvidence(client, batch, batchIndex, trace)
  extractedCandidates.push(...extraction)
}

const existingById = new Map(existingStore.papers.map((paper) => [paper.id, paper]))
const existingByTitle = new Map(
  existingStore.papers.map((paper) => [normalizeTitleKey(paper.title), paper]),
)
const mergedPapers = [...existingStore.papers]
let added = 0
let updated = 0

for (const candidate of extractedCandidates) {
  const titleKey = normalizeTitleKey(candidate.title)

  if (!titleKey || officialIndex.has(titleKey)) {
    continue
  }

  const existing =
    existingById.get(candidate.id) ||
    existingByTitle.get(titleKey)

  const merged = mergeUnofficialEntry(existing, candidate)

  if (existing) {
    const index = mergedPapers.findIndex((paper) => paper.id === existing.id)
    if (index >= 0) {
      mergedPapers[index] = merged
    }
    updated += 1
  } else {
    mergedPapers.push(merged)
    added += 1
  }

  existingById.set(merged.id, merged)
  existingByTitle.set(titleKey, merged)
}

const nextStore = {
  generatedAt: trace.generatedAt,
  notes: [
    'Entries discovered by daily Zhipu web search + reader pipeline over X and Xiaohongshu style announcement posts.',
    'Only candidate/accepted unofficial papers are stored here; official catalog merge decides what still appears under Unclassified.',
  ],
  papers: mergedPapers.sort((left, right) => {
    const leftTime = left.updatedAt || left.discoveredAt || ''
    const rightTime = right.updatedAt || right.discoveredAt || ''
    return rightTime.localeCompare(leftTime) || left.title.localeCompare(right.title)
  }),
}

trace.summary = {
  searchEvidenceCollected: results.length,
  readerEnrichedEvidence: enrichedEvidence.length,
  extractedCandidates: extractedCandidates.length,
  added,
  updated,
}

if (!dryRun) {
  await writeUnofficialStore(storePath, nextStore)
  await writeJson(tracePath, trace)
}

console.log(`Search evidence collected: ${results.length}`)
console.log(`Reader-enriched evidence: ${enrichedEvidence.length}`)
console.log(`Extracted unofficial candidates: ${extractedCandidates.length}`)
console.log(`Store additions: ${added}; updates: ${updated}`)
if (!dryRun) {
  console.log(`Wrote ${storePath}`)
  console.log(`Wrote ${tracePath}`)
}

async function extractCandidatesFromEvidence(client, evidenceBatch, batchIndex, trace) {
  const systemPrompt =
    'You are a strict evidence-based paper-discovery extractor. Return JSON only. Do not invent missing facts.'
  const prompt = buildExtractionPrompt(evidenceBatch)
  let text = ''
  let papers = []
  let errorMessage = ''

  try {
    const response = await zhipuChat(client, {
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    })

    text = extractMessageText(response)
    const parsed = tryParseJsonBlock(text)
    papers = Array.isArray(parsed?.papers) ? parsed.papers : []
  } catch (error) {
    errorMessage = errorToMessage(error)
    trace.errors.push(`Extraction failed for batch ${batchIndex + 1}: ${errorMessage}`)
  }

  trace.extractionBatches.push({
    index: batchIndex,
    evidenceCount: evidenceBatch.length,
    prompt,
    systemPrompt,
    model: client.model,
    responseText: text.slice(0, 12000),
    parsedCount: papers.length,
    error: errorMessage || undefined,
  })

  return papers
    .filter((paper) => paper?.title && paper?.primaryUrl)
    .map((paper) => ({
      id: buildUnofficialId(paper.title),
      title: paper.title,
      titleZh: paper.titleZh,
      summary: paper.summary,
      reason: paper.reason,
      status: paper.status === 'accepted' ? 'accepted' : 'candidate',
      confidence: Number(paper.confidence ?? 0),
      acceptedVenue: paper.acceptedVenue || undefined,
      acceptedYear:
        Number.isFinite(Number(paper.acceptedYear)) && Number(paper.acceptedYear) > 0
          ? Number(paper.acceptedYear)
          : 2026,
      primaryUrl: paper.primaryUrl,
      canonicalUrl: paper.canonicalUrl || undefined,
      pdfUrl: paper.pdfUrl || undefined,
      authors: normalizeStringArray(paper.authors),
      keywords: normalizeStringArray(paper.keywords),
      platforms: normalizeStringArray(paper.platforms),
      evidence: Array.isArray(paper.evidence)
        ? paper.evidence.map((item) => ({
            platform: item.platform || 'web',
            url: item.url,
            title: item.title || '',
            author: item.author || '',
            snippet: item.snippet || '',
            readerTitle: item.readerTitle || '',
            readerExcerpt: item.readerExcerpt || '',
            publishDate: item.publishDate || '',
          }))
        : [],
      discoveredAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }))
}

function buildExtractionPrompt(evidenceBatch) {
  return `
You are helping maintain a 2026 top-venue AI paper tracker.

Task:
- Inspect the search and reader evidence below.
- Extract only items that are likely to be real research papers or paper project pages.
- Focus areas: LLM, VLM, VLA, MLLM, agents, reasoning, video understanding, 3D, robotics, embodied AI, multimodal learning.
- Prefer announcements using phrases like "Introducing", "new work", "our paper", "accepted to", or venue names.
- Exclude workshop-only, findings/demo/tutorial/challenge/course/recruiting/product-only posts when the evidence is clear.
- If evidence mentions acceptance to AAAI, ACL, EMNLP, CVPR, ICCV, ICLR, ICML, NeurIPS, SIGGRAPH, KDD, WWW, or similar, fill acceptedVenue and acceptedYear.
- If acceptance is unclear, use status "candidate".

Return JSON only:
{
  "papers": [
    {
      "title": "paper title",
      "titleZh": "optional Chinese title",
      "summary": "one concise Chinese summary",
      "reason": "why this looks like a paper and what evidence supports acceptance or candidate status",
      "status": "candidate or accepted",
      "confidence": 0.0,
      "acceptedVenue": "ACL 2026 / AAAI / CVPR 2026, or empty",
      "acceptedYear": 2026,
      "primaryUrl": "main evidence URL",
      "canonicalUrl": "paper/project/homepage URL if available",
      "pdfUrl": "optional PDF URL",
      "authors": ["author"],
      "keywords": ["llm", "agent"],
      "platforms": ["x", "xiaohongshu", "homepage"],
      "evidence": [
        {
          "platform": "x",
          "url": "https://...",
          "title": "search result title",
          "author": "author if visible",
          "snippet": "search or page excerpt",
          "readerTitle": "reader title",
          "readerExcerpt": "reader excerpt",
          "publishDate": "optional"
        }
      ]
    }
  ]
}

Evidence:
${JSON.stringify(evidenceBatch, null, 2)}
`.trim()
}

function collectSearchItems(response, query) {
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
      query,
    }))
    .filter((item) => item.url && item.title)
}

function normalizeReaderPayload(response) {
  const data = response?.data ?? response?.result ?? response ?? {}
  const title =
    data.title ||
    data.page_title ||
    data.name ||
    ''
  const excerpt =
    data.content ||
    data.text ||
    data.markdown ||
    data.summary ||
    ''

  return {
    title: String(title || '').trim(),
    excerpt: String(excerpt || '').replace(/\s+/g, ' ').slice(0, 2200).trim(),
  }
}

function createTrace(client) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: client.model,
    searchTool: client.searchTool,
    readerTool: client.readerTool,
    queries: [],
    readers: [],
    extractionBatches: [],
    summary: {
      searchEvidenceCollected: 0,
      readerEnrichedEvidence: 0,
      extractedCandidates: 0,
      added: 0,
      updated: 0,
    },
    errors: [],
  }
}

function summarizeEvidence(item) {
  return {
    platform: item.platform || 'web',
    url: item.url || '',
    title: item.title || '',
    snippet: String(item.snippet || '').slice(0, 700),
    publishDate: item.publishDate || '',
  }
}

function summarizeReaderEvidence(item, readerError) {
  const summary = {
    ...summarizeEvidence(item),
    readerTitle: item.readerTitle || '',
    readerExcerpt: readerError ? '' : String(item.readerExcerpt || '').slice(0, 1400),
  }

  if (readerError) {
    summary.readerError = readerError
  }

  return summary
}

function dedupeEvidence(items) {
  const byUrl = new Map()

  for (const item of items) {
    if (!item.url) {
      continue
    }
    byUrl.set(item.url, item)
  }

  return Array.from(byUrl.values())
}

function isLikelyHelpfulReaderTarget(url) {
  return /x\.com|twitter\.com|xiaohongshu\.com|arxiv\.org|github\.io|github\.com|\.edu|lab|homepage|personal/i.test(
    url,
  )
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

async function writeJson(path, payload) {
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, `${JSON.stringify(payload, null, 2)}\n`)
  await rm(path, { force: true })
  await writeFile(path, `${JSON.stringify(payload, null, 2)}\n`)
  await rm(tmpPath, { force: true })
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
  if (/arxiv\.org/i.test(url)) {
    return 'arxiv'
  }
  return 'web'
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return Array.from(
    new Set(
      value
        .map((item) => String(item ?? '').trim())
        .filter(Boolean),
    ),
  )
}

function chunk(items, size) {
  const output = []

  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size))
  }

  return output
}

function errorToMessage(error) {
  return error instanceof Error ? error.message : String(error)
}

function parseArgs(argv) {
  const parsed = {
    query: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--store') {
      parsed.store = argv[++index]
    } else if (arg === '--trace') {
      parsed.trace = argv[++index]
    } else if (arg === '--official-catalog') {
      parsed.officialCatalog = argv[++index]
    } else if (arg === '--query') {
      parsed.query.push(argv[++index])
    } else if (arg === '--max-results') {
      parsed.maxResults = argv[++index]
    } else if (arg === '--max-readers') {
      parsed.maxReaders = argv[++index]
    } else if (arg === '--model') {
      parsed.model = argv[++index]
    } else if (arg === '--force-reader') {
      parsed.forceReader = true
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
  node scripts/discover-unofficial-papers.mjs [options]

Options:
  --store <path>               Unofficial-paper store path.
  --trace <path>               Discovery trace output path.
  --official-catalog <path>    Official catalog mirror for dedupe.
  --query <text>               Search query. Repeatable.
  --max-results <n>            Search hits per query. Default: 8.
  --max-readers <n>            Reader-enriched link cap. Default: 18.
  --model <name>               Zhipu chat model.
  --force-reader               Always run the webpage reader for candidate links.
  --dry-run                    Do not persist results.
`)
  process.exit(0)
}
