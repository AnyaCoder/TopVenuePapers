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
  'X Introducing new paper LLM VLM multimodal agent 2026',
  'X "our paper" "accepted to" LLM VLM MLLM VLA 2026',
  '"new work" video understanding 3D robotics embodied AI 2026',
  '小红书 新论文 大模型 多模态 智能体 具身 2026',
]

const ZH_XIAOHONGSHU = '\u5c0f\u7ea2\u4e66'
const ZH_NEW_PAPER = '\u65b0\u8bba\u6587'
const ZH_PAPER_ACCEPTED = '\u8bba\u6587\u63a5\u6536'
const ZH_LLM = '\u5927\u6a21\u578b'
const ZH_MULTIMODAL = '\u591a\u6a21\u6001'
const ZH_AGENT = '\u667a\u80fd\u4f53'
const ZH_EMBODIED = '\u5177\u8eab'
const ZH_TOP_VENUE = '\u9876\u4f1a'
const DEFAULT_SEARCH_PLANS = buildDefaultSearchPlans()

const args = parseArgs(process.argv.slice(2))
const storePath = args.store ?? 'data/unofficial/unofficial-papers.json'
const tracePath = args.trace ?? 'data/unofficial/discovery-trace.json'
const officialCatalogPath = args.officialCatalog ?? 'data/papers.catalog.official.json'
const rawSearchPlans = args.query.length > 0
  ? args.query.map((query, index) => ({
      label: `custom-${index + 1}`,
      query,
      platform: detectQueryPlatform(query),
      recencyFilter: args.recency,
    }))
  : DEFAULT_SEARCH_PLANS
const maxQueries = readPositiveInt(args.maxQueries ?? process.env.DISCOVERY_MAX_QUERIES, 16)
const searchPlans = selectSearchPlans(rawSearchPlans, {
  maxQueries,
  strategy: args.planStrategy ?? process.env.DISCOVERY_PLAN_STRATEGY,
  preserveOrder: args.query.length > 0,
})
const skippedSearchPlans = Math.max(0, rawSearchPlans.length - searchPlans.length)
const maxResultsPerQuery = readPositiveInt(args.maxResults ?? process.env.DISCOVERY_MAX_RESULTS, 8)
const maxReaders = readPositiveInt(args.maxReaders ?? process.env.DISCOVERY_MAX_READERS, 24)
const minReaderCandidates = readPositiveInt(args.minReaders ?? process.env.DISCOVERY_MIN_READERS, 8)
const extractionBatchSize = readPositiveInt(args.batchSize ?? process.env.DISCOVERY_BATCH_SIZE, 4)
const maxExtractionBatches = readPositiveInt(args.maxBatches ?? process.env.DISCOVERY_MAX_BATCHES, 4)
const extractionDelayMs = readPositiveInt(args.extractionDelayMs ?? process.env.DISCOVERY_EXTRACTION_DELAY_MS, 8_000)
const apiRetries = readPositiveInt(args.retries ?? process.env.ZHIPU_RETRIES, 1)
const discoveryBudgetMs = readPositiveInt(args.budgetMs ?? process.env.DISCOVERY_BUDGET_MS, 20 * 60 * 1000)
const dryRun = Boolean(args.dryRun)
const forceReader = Boolean(args.forceReader)
const discoveryStartedAt = Date.now()

const client = createZhipuClient({
  model: args.model,
})

const existingStore = await readUnofficialStore(storePath)
const officialCatalog = await readCatalog(officialCatalogPath)
const officialIndex = buildOfficialTitleIndex(officialCatalog)
const trace = createTrace(client, {
  totalSearchPlans: rawSearchPlans.length,
  maxQueries,
  skippedSearchPlans,
  selectedSearchPlanLabels: searchPlans.map((plan) => plan.label),
  planStrategy: args.planStrategy ?? process.env.DISCOVERY_PLAN_STRATEGY ?? 'balanced',
  maxResultsPerQuery,
  maxReaders,
  minReaderCandidates,
  extractionBatchSize,
  maxExtractionBatches,
  extractionDelayMs,
  apiRetries,
  discoveryBudgetMs,
})
const results = []
const rejectedEvidence = []

logProgress(
  trace,
  `Discovery started: ${searchPlans.length}/${rawSearchPlans.length} queries, max ${maxReaders} readers, max ${maxExtractionBatches} extraction batches.`,
)

for (const [planIndex, plan] of searchPlans.entries()) {
  if (isBudgetExpired(discoveryStartedAt, discoveryBudgetMs)) {
    trace.errors.push(`Discovery budget expired before search ${planIndex + 1}.`)
    logProgress(trace, `Discovery budget expired; skipping ${searchPlans.length - planIndex} remaining searches.`)
    break
  }

  const queryStartedAt = Date.now()
  const queryTrace = {
    label: plan.label,
    query: plan.query,
    platform: plan.platform,
    searchEngine: plan.searchEngine || client.searchTool,
    domainFilter: plan.domainFilter || '',
    recencyFilter: plan.recencyFilter || '',
    requestedCount: maxResultsPerQuery,
    rawResultCount: 0,
    resultCount: 0,
    rejectedCount: 0,
    startedAt: new Date().toISOString(),
    results: [],
    rejected: [],
  }

  try {
    logProgress(trace, `[search ${planIndex + 1}/${searchPlans.length}] ${plan.label}: ${plan.query}`)
    const searchResponse = await zhipuWebSearch(client, plan.query, {
      count: maxResultsPerQuery,
      domainFilter: plan.domainFilter,
      recencyFilter: plan.recencyFilter,
      searchEngine: plan.searchEngine,
      contentSize: plan.contentSize,
      retries: apiRetries,
    })
    const scored = collectSearchItems(searchResponse, plan).map(scoreEvidence)
    const accepted = scored.filter((item) => item.relevance.keep)
    const rejected = scored.filter((item) => !item.relevance.keep)

    queryTrace.responseKeys = Object.keys(searchResponse ?? {}).slice(0, 12)
    queryTrace.rawResultCount = scored.length
    queryTrace.resultCount = accepted.length
    queryTrace.rejectedCount = rejected.length
    queryTrace.results = accepted.map(summarizeEvidence)
    queryTrace.rejected = rejected.slice(0, 4).map(summarizeEvidence)
    results.push(...accepted)
    rejectedEvidence.push(...rejected)
  } catch (error) {
    queryTrace.error = errorToMessage(error)
    trace.errors.push(`Search failed for query "${plan.query}": ${queryTrace.error}`)
  }

  queryTrace.durationMs = Date.now() - queryStartedAt
  trace.queries.push(queryTrace)
  logProgress(
    trace,
    `[search ${planIndex + 1}/${searchPlans.length}] done raw=${queryTrace.rawResultCount} kept=${queryTrace.resultCount} rejected=${queryTrace.rejectedCount} in ${formatDuration(queryTrace.durationMs)}${queryTrace.error ? ` error=${queryTrace.error}` : ''}`,
  )
}

const dedupedAccepted = dedupeEvidence(results).sort(compareEvidenceRelevance)
const backfillEvidence = dedupeEvidence(rejectedEvidence)
  .filter((item) => item.relevance.score >= 0 && !item.relevance.strongReject)
  .sort(compareEvidenceRelevance)
const dedupedEvidence = fillReaderCandidates(dedupedAccepted, backfillEvidence, {
  maxReaders,
  minReaderCandidates,
})
const enrichedEvidence = []

logProgress(trace, `Reader stage started: ${dedupedEvidence.length} candidate links.`)

for (const [readerIndex, item] of dedupedEvidence.entries()) {
  if (isBudgetExpired(discoveryStartedAt, discoveryBudgetMs)) {
    trace.errors.push(`Discovery budget expired before reader ${readerIndex + 1}.`)
    logProgress(trace, `Discovery budget expired; skipping ${dedupedEvidence.length - readerIndex} remaining readers.`)
    break
  }

  const readerStartedAt = Date.now()
  let readerTitle = ''
  let readerExcerpt = ''
  let readerError = ''
  const shouldRead = forceReader || isLikelyHelpfulReaderTarget(item.url)

  logProgress(
    trace,
    `[reader ${readerIndex + 1}/${dedupedEvidence.length}] ${shouldRead ? 'read' : 'skip'} ${shortenLogText(item.title || item.url, 90)}`,
  )

  if (shouldRead) {
    try {
      const readerResponse = await zhipuWebReader(client, item.url, {
        retries: apiRetries,
      })
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
  const readerTrace = summarizeReaderEvidence(enriched, readerError)
  readerTrace.durationMs = Date.now() - readerStartedAt
  readerTrace.skipped = !shouldRead
  trace.readers.push(readerTrace)
  logProgress(
    trace,
    `[reader ${readerIndex + 1}/${dedupedEvidence.length}] done in ${formatDuration(readerTrace.durationMs)}${readerError ? ` error=${readerError}` : ''}`,
  )
}

const allBatches = chunk(enrichedEvidence, extractionBatchSize)
const batches = allBatches.slice(0, maxExtractionBatches)
const skippedExtractionBatches = Math.max(0, allBatches.length - batches.length)
const extractedCandidates = []

logProgress(trace, `Extraction stage started: ${batches.length}/${allBatches.length} batches.`)

for (const [batchIndex, batch] of batches.entries()) {
  if (isBudgetExpired(discoveryStartedAt, discoveryBudgetMs)) {
    trace.errors.push(`Discovery budget expired before extraction batch ${batchIndex + 1}.`)
    logProgress(trace, `Discovery budget expired; skipping ${batches.length - batchIndex} remaining extraction batches.`)
    break
  }

  logProgress(trace, `[extract ${batchIndex + 1}/${batches.length}] ${batch.length} evidence items.`)
  if (batchIndex > 0 && extractionDelayMs > 0) {
    logProgress(trace, `[extract ${batchIndex + 1}/${batches.length}] waiting ${formatDuration(extractionDelayMs)} to avoid rate limits.`)
    await sleep(extractionDelayMs)
  }
  const extraction = await extractCandidatesFromEvidence(client, batch, batchIndex, trace)
  extractedCandidates.push(...extraction)
  logProgress(trace, `[extract ${batchIndex + 1}/${batches.length}] parsed=${extraction.length}`)
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
  searchQueriesRun: trace.queries.length,
  skippedSearchPlans,
  rawSearchEvidenceCollected: results.length + rejectedEvidence.length,
  searchEvidenceCollected: dedupedAccepted.length,
  rejectedSearchEvidence: rejectedEvidence.length,
  readerEnrichedEvidence: enrichedEvidence.length,
  extractionBatchesRun: batches.length,
  skippedExtractionBatches,
  extractedCandidates: extractedCandidates.length,
  added,
  updated,
  durationMs: Date.now() - discoveryStartedAt,
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
  const extractionStartedAt = Date.now()
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
    }, apiRetries, {
      timeoutMs: Number(process.env.ZHIPU_CHAT_TIMEOUT_MS) || undefined,
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
    durationMs: Date.now() - extractionStartedAt,
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

function buildDefaultSearchPlans() {
  const plans = [
    ...englishSocialPlans(),
    ...paperIndexPlans(),
    ...projectPagePlans(),
    ...chineseSocialPlans(),
  ]
  const seen = new Set()

  return plans.filter((plan) => {
    const key = `${plan.searchEngine || ''}:${plan.domainFilter || ''}:${plan.recencyFilter || ''}:${plan.query}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function selectSearchPlans(plans, options) {
  const maxQueries = Math.min(options.maxQueries, plans.length)

  if (options.preserveOrder || options.strategy === 'prefix') {
    return plans.slice(0, maxQueries)
  }

  const priority = ['homepage', 'arxiv', 'web', 'xiaohongshu', 'x']
  const groups = new Map()

  for (const plan of plans) {
    const key = plan.platform || 'web'
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(plan)
  }

  const selected = []
  const seen = new Set()

  // First pass: guarantee that low-volume high-signal sources are represented.
  for (const platform of priority) {
    const item = groups.get(platform)?.shift()
    if (item) {
      selected.push(item)
      seen.add(item.label)
    }
  }

  // Round-robin the remaining quota so no noisy source can monopolize the run.
  while (selected.length < maxQueries) {
    let added = false

    for (const platform of priority) {
      const item = groups.get(platform)?.shift()
      if (!item || seen.has(item.label)) {
        continue
      }

      selected.push(item)
      seen.add(item.label)
      added = true

      if (selected.length >= maxQueries) {
        break
      }
    }

    if (!added) {
      break
    }
  }

  if (selected.length < maxQueries) {
    for (const plan of plans) {
      if (seen.has(plan.label)) {
        continue
      }
      selected.push(plan)
      seen.add(plan.label)
      if (selected.length >= maxQueries) {
        break
      }
    }
  }

  return selected
}

function englishSocialPlans() {
  const themes = [
    'LLM VLM multimodal agent reasoning',
    'video understanding 3D Gaussian Splatting robotics embodied AI',
    'VLA vision language action world model',
    'MLLM benchmark evaluation post-training RL',
  ]
  const announcementPhrases = [
    'Introducing our paper',
    '"our new work"',
    '"accepted to" paper',
    '"paper accepted"',
  ]

  return announcementPhrases.flatMap((phrase) =>
    themes.map((theme, index) => ({
      label: `x-${slugForLabel(phrase)}-${index + 1}`,
      query: `${phrase} ${theme} 2026`,
      platform: 'x',
      domainFilter: 'x.com',
      recencyFilter: 'oneMonth',
      searchEngine: 'search_pro',
    })),
  )
}

function paperIndexPlans() {
  return [
    'LLM VLM agent reasoning accepted 2026 paper arXiv',
    'multimodal video understanding robotics embodied AI new paper arXiv 2026',
    '3D Gaussian Splatting VLM MLLM new paper 2026',
    'vision language action VLA world model paper 2026',
  ].map((query, index) => ({
    label: `arxiv-${index + 1}`,
    query,
    platform: 'arxiv',
    domainFilter: 'arxiv.org',
    recencyFilter: 'oneMonth',
    searchEngine: 'search_pro',
  }))
}

function projectPagePlans() {
  return [
    '"project page" "paper" LLM VLM MLLM 2026',
    '"project page" "accepted" multimodal agent robotics 2026',
    'site:github.io "paper" "LLM" "2026"',
    'site:github.io "multimodal" "paper" "2026"',
    'site:edu "our paper" "accepted to" "2026" "LLM"',
  ].map((query, index) => ({
    label: `homepage-${index + 1}`,
    query,
    platform: 'homepage',
    recencyFilter: 'oneMonth',
    searchEngine: 'search_pro',
  }))
}

function chineseSocialPlans() {
  const themes = [
    `${ZH_NEW_PAPER} ${ZH_LLM} ${ZH_MULTIMODAL}`,
    `${ZH_PAPER_ACCEPTED} ${ZH_TOP_VENUE} ${ZH_LLM}`,
    `${ZH_NEW_PAPER} ${ZH_AGENT} ${ZH_EMBODIED}`,
    `LLM VLM MLLM VLA ${ZH_NEW_PAPER}`,
  ]

  return themes.flatMap((theme, index) => [
    {
      label: `xiaohongshu-${index + 1}`,
      query: `${ZH_XIAOHONGSHU} ${theme} 2026`,
      platform: 'xiaohongshu',
      domainFilter: 'xiaohongshu.com',
      recencyFilter: 'oneMonth',
      searchEngine: 'search_pro',
    },
    {
      label: `cn-web-${index + 1}`,
      query: `${theme} AAAI ACL CVPR ICLR 2026`,
      platform: 'web',
      recencyFilter: 'oneMonth',
      searchEngine: 'search_pro',
    },
  ])
}

function collectSearchItems(response, plan) {
  const payloads = [
    ...(Array.isArray(response?.search_result) ? response.search_result : []),
    ...(Array.isArray(response?.data) ? response.data : []),
    ...(Array.isArray(response?.data?.search_result) ? response.data.search_result : []),
    ...(Array.isArray(response?.result?.search_result) ? response.result.search_result : []),
    ...(Array.isArray(response?.results) ? response.results : []),
    ...(Array.isArray(response?.items) ? response.items : []),
  ]

  return payloads
    .map((item) => ({
      platform: detectPlatform(item.link || item.url || '') || plan.platform || 'web',
      url: item.link || item.url || '',
      title: item.title || item.name || '',
      author: item.author || item.site_name || '',
      snippet: item.content || item.snippet || item.description || item.summary || '',
      publishDate: item.publish_date || item.publish_time || item.date || '',
      query: plan.query,
      queryLabel: plan.label,
    }))
    .filter((item) => item.url && item.title)
}

function scoreEvidence(item) {
  const text = normalizeForScoring([
    item.title,
    item.snippet,
    item.url,
  ].join(' '))
  const signals = []
  let score = 0

  score += addWeightedSignals(text, signals, 'paper', [
    ['paper', 3],
    ['preprint', 2],
    ['arxiv', 3],
    ['project page', 3],
    ['technical report', 2],
    ['论文', 3],
    ['预印本', 2],
  ])
  score += addWeightedSignals(text, signals, 'announcement', [
    ['introducing', 3],
    ['new work', 3],
    ['our work', 2],
    ['our paper', 4],
    ['accepted to', 4],
    ['paper accepted', 4],
    ['to appear', 3],
    ['开源', 1],
    ['新论文', 4],
    ['论文接收', 4],
    ['录用', 3],
  ])
  score += addWeightedSignals(text, signals, 'topic', [
    ['llm', 2],
    ['large language model', 2],
    ['vlm', 2],
    ['vision-language', 2],
    ['vision language', 2],
    ['mllm', 2],
    ['multimodal', 2],
    ['multi-modal', 2],
    ['vla', 2],
    ['agent', 2],
    ['reasoning', 2],
    ['robotics', 2],
    ['embodied', 2],
    ['video understanding', 2],
    ['3d gaussian', 2],
    ['3dgs', 2],
    ['world model', 2],
    ['大模型', 2],
    ['多模态', 2],
    ['智能体', 2],
    ['具身', 2],
  ])
  score += addWeightedSignals(text, signals, 'venue', [
    ['aaai', 2],
    ['acl', 2],
    ['emnlp', 2],
    ['cvpr', 2],
    ['iccv', 2],
    ['iclr', 2],
    ['icml', 2],
    ['neurips', 2],
    ['siggraph', 2],
    ['顶会', 2],
  ])

  const strongReject = [
    'miniapp',
    '小程序开放平台',
    '招聘',
    '课程',
    'tutorial',
    'challenge',
    'call for papers',
    'cfp',
    'workshop',
    'sponsor',
    'product',
    'documentation',
  ].some((term) => text.includes(term))

  if (strongReject) {
    score -= 5
    signals.push('reject:non-paper-page')
  }

  const keep = score >= 3 || (score >= 1 && /arxiv\.org|github\.io|x\.com|twitter\.com/i.test(item.url))

  return {
    ...item,
    relevance: {
      score,
      keep,
      strongReject,
      signals,
    },
  }
}

function addWeightedSignals(text, signals, prefix, terms) {
  let score = 0

  for (const [term, weight] of terms) {
    if (text.includes(term)) {
      score += weight
      signals.push(`${prefix}:${term}`)
    }
  }

  return score
}

function compareEvidenceRelevance(left, right) {
  return (right.relevance?.score ?? 0) - (left.relevance?.score ?? 0)
}

function fillReaderCandidates(accepted, backfill, options) {
  const output = []
  const seen = new Set()

  for (const item of [...accepted, ...backfill]) {
    if (!item.url || seen.has(item.url)) {
      continue
    }
    seen.add(item.url)
    output.push(item)

    if (output.length >= options.maxReaders) {
      break
    }
  }

  return output.slice(0, Math.max(options.minReaderCandidates, Math.min(options.maxReaders, output.length)))
}

function normalizeForScoring(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}

function detectQueryPlatform(query) {
  if (/xiaohongshu/i.test(query) || query.includes(ZH_XIAOHONGSHU)) {
    return 'xiaohongshu'
  }

  if (/\bx\b|twitter/i.test(query)) {
    return 'x'
  }

  if (/arxiv/i.test(query)) {
    return 'arxiv'
  }

  if (/github|project page|homepage|site:/i.test(query)) {
    return 'homepage'
  }

  return 'web'
}

function slugForLabel(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32) || 'query'
}

function normalizeReaderPayload(response) {
  const data =
    response?.reader_result ??
    response?.webpage_content ??
    response?.data?.reader_result ??
    response?.data ??
    response?.result ??
    response ??
    {}
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

function createTrace(client, controls = {}) {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    model: client.model,
    searchTool: client.searchTool,
    readerTool: client.readerTool,
    controls,
    progress: [],
    queries: [],
    readers: [],
    extractionBatches: [],
    summary: {
      searchQueriesRun: 0,
      rawSearchEvidenceCollected: 0,
      searchEvidenceCollected: 0,
      rejectedSearchEvidence: 0,
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
    relevanceScore: item.relevance?.score,
    relevanceSignals: item.relevance?.signals?.slice(0, 10) ?? [],
    queryLabel: item.queryLabel || '',
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

function logProgress(trace, message) {
  const entry = {
    at: new Date().toISOString(),
    message,
  }
  trace.progress.push(entry)
  console.log(message)
}

function readPositiveInt(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 1000) {
    return `${Math.max(0, Math.round(ms || 0))}ms`
  }

  return `${(ms / 1000).toFixed(1)}s`
}

function shortenLogText(value, maxLength) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}...` : text
}

function isBudgetExpired(startedAt, budgetMs) {
  return Date.now() - startedAt >= budgetMs
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    } else if (arg === '--max-queries') {
      parsed.maxQueries = argv[++index]
    } else if (arg === '--plan-strategy') {
      parsed.planStrategy = argv[++index]
    } else if (arg === '--max-results') {
      parsed.maxResults = argv[++index]
    } else if (arg === '--max-readers') {
      parsed.maxReaders = argv[++index]
    } else if (arg === '--min-readers') {
      parsed.minReaders = argv[++index]
    } else if (arg === '--max-batches') {
      parsed.maxBatches = argv[++index]
    } else if (arg === '--batch-size') {
      parsed.batchSize = argv[++index]
    } else if (arg === '--extraction-delay-ms') {
      parsed.extractionDelayMs = argv[++index]
    } else if (arg === '--retries') {
      parsed.retries = argv[++index]
    } else if (arg === '--budget-ms') {
      parsed.budgetMs = argv[++index]
    } else if (arg === '--recency') {
      parsed.recency = argv[++index]
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
  --max-queries <n>            Query-plan cap. Default: 16.
  --plan-strategy <name>       Plan selection strategy: balanced or prefix. Default: balanced.
  --max-results <n>            Search hits per query. Default: 8.
  --max-readers <n>            Reader-enriched link cap. Default: 24.
  --min-readers <n>            Backfill at least this many links when available. Default: 8.
  --max-batches <n>            LLM extraction-batch cap. Default: 4.
  --batch-size <n>             Evidence items per extraction batch. Default: 4.
  --extraction-delay-ms <n>    Delay between extraction batches. Default: 8000.
  --retries <n>                Zhipu retry count per request. Default: 1.
  --budget-ms <n>              Whole discovery soft budget. Default: 1200000.
  --recency <filter>           Zhipu recency filter for custom queries. Default: oneMonth.
  --model <name>               Zhipu chat model.
  --force-reader               Always run the webpage reader for candidate links.
  --dry-run                    Do not persist results.
`)
  process.exit(0)
}
