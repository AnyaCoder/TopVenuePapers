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

const ZH_XIAOHONGSHU = '\u5c0f\u7ea2\u4e66'
const ZH_NEW_PAPER = '\u65b0\u8bba\u6587'
const ZH_PAPER_ACCEPTED = '\u8bba\u6587\u63a5\u6536'
const ZH_LLM = '\u5927\u6a21\u578b'
const ZH_MULTIMODAL = '\u591a\u6a21\u6001'
const ZH_AGENT = '\u667a\u80fd\u4f53'
const ZH_EMBODIED = '\u5177\u8eab'
const ZH_TOP_VENUE = '\u9876\u4f1a'
const ZH_OPEN_SOURCE = '\u5f00\u6e90'
const ZH_PREPRINT = '\u9884\u5370\u672c'
const ZH_ACCEPTED = '\u5f55\u7528'
const ZH_COURSE = '\u8bfe\u7a0b'
const ZH_RECRUITING = '\u62db\u8058'
const ZH_MINIAPP_PLATFORM = '\u5c0f\u7a0b\u5e8f\u5f00\u653e\u5e73\u53f0'
const DEFAULT_SEARCH_PLANS = buildDefaultSearchPlans()
const SEARCH_STAGE_PRIORITY = [
  'model-plan',
  'seed',
  'repository',
  'paper-index',
  'social',
  'homepage',
  'chinese',
  'broad',
  'follow-up',
  'custom',
]

const args = parseArgs(process.argv.slice(2))
const storePath = args.store ?? 'data/unofficial/unofficial-papers.json'
const tracePath = args.trace ?? 'data/unofficial/discovery-trace.json'
const officialCatalogPath = args.officialCatalog ?? 'data/papers.catalog.official.json'
const maxQueries = readPositiveInt(args.maxQueries ?? process.env.DISCOVERY_MAX_QUERIES, 16)
const maxResultsPerQuery = readPositiveInt(args.maxResults ?? process.env.DISCOVERY_MAX_RESULTS, 8)
const maxReaders = readPositiveInt(args.maxReaders ?? process.env.DISCOVERY_MAX_READERS, 24)
const minReaderCandidates = readPositiveInt(args.minReaders ?? process.env.DISCOVERY_MIN_READERS, 8)
const extractionBatchSize = readPositiveInt(args.batchSize ?? process.env.DISCOVERY_BATCH_SIZE, 4)
const maxExtractionBatches = readPositiveInt(args.maxBatches ?? process.env.DISCOVERY_MAX_BATCHES, 4)
const extractionDelayMs = readPositiveInt(args.extractionDelayMs ?? process.env.DISCOVERY_EXTRACTION_DELAY_MS, 8_000)
const apiRetries = readPositiveInt(args.retries ?? process.env.ZHIPU_RETRIES, 1)
const discoveryBudgetMs = readPositiveInt(args.budgetMs ?? process.env.DISCOVERY_BUDGET_MS, 20 * 60 * 1000)
const maxFollowUpQueries = readPositiveInt(
  args.maxFollowUpQueries ?? process.env.DISCOVERY_MAX_FOLLOW_UP_QUERIES,
  Math.max(4, Math.floor(maxQueries * 0.35)),
)
const modelPlanningEnabled = args.query.length === 0 &&
  readBoolean(args.modelPlanning ?? process.env.DISCOVERY_MODEL_PLANNING, true)
const maxModelPlannedQueries = readPositiveInt(
  args.maxModelQueries ?? process.env.DISCOVERY_MAX_MODEL_QUERIES,
  Math.max(6, Math.floor(maxQueries * 0.35)),
)
const dryRun = Boolean(args.dryRun)
const forceReader = Boolean(args.forceReader)
const discoveryStartedAt = Date.now()

const client = createZhipuClient({
  model: args.model,
})
const staticSearchPlans = args.query.length > 0
  ? args.query.map((query, index) => makeSearchPlan('custom', index, query, {
      platform: detectQueryPlatform(query),
      recencyFilter: args.recency,
      contentSize: 'high',
      intent: 'user-supplied query',
    }))
  : DEFAULT_SEARCH_PLANS
const modelPlanning = await buildModelSearchPlans(client, {
  enabled: modelPlanningEnabled,
  maxPlans: maxModelPlannedQueries,
  retries: apiRetries,
})
const rawSearchPlans = dedupeSearchPlans([
  ...modelPlanning.plans,
  ...staticSearchPlans,
])
const initialQueryBudget = args.query.length > 0
  ? maxQueries
  : Math.max(1, maxQueries - maxFollowUpQueries)
const initialSearchPlans = selectSearchPlans(rawSearchPlans, {
  maxQueries: initialQueryBudget,
  strategy: args.planStrategy ?? process.env.DISCOVERY_PLAN_STRATEGY,
  preserveOrder: args.query.length > 0,
})
let selectedSearchPlans = [...initialSearchPlans]
let followUpSearchPlans = []
let skippedFollowUpSearchPlans = 0

const existingStore = await readUnofficialStore(storePath)
const officialCatalog = await readCatalog(officialCatalogPath)
const officialIndex = buildOfficialTitleIndex(officialCatalog)
const trace = createTrace(client, {
  totalSearchPlans: rawSearchPlans.length,
  staticSearchPlans: staticSearchPlans.length,
  modelSearchPlans: modelPlanning.plans.length,
  maxQueries,
  initialQueryBudget,
  maxFollowUpQueries,
  maxModelPlannedQueries,
  skippedInitialSearchPlans: Math.max(0, rawSearchPlans.length - initialSearchPlans.length),
  selectedSearchPlanLabels: selectedSearchPlans.map((plan) => plan.label),
  planStrategy: args.planStrategy ?? process.env.DISCOVERY_PLAN_STRATEGY ?? 'balanced',
  maxResultsPerQuery,
  maxReaders,
  minReaderCandidates,
  extractionBatchSize,
  maxExtractionBatches,
  extractionDelayMs,
  apiRetries,
  discoveryBudgetMs,
  extractor: 'zhipu-only',
  modelPlanning,
})
const results = []
const rejectedEvidence = []

logProgress(
  trace,
  `Discovery started: ${selectedSearchPlans.length}/${rawSearchPlans.length} initial queries, max ${maxFollowUpQueries} follow-up queries, max ${maxReaders} readers, max ${maxExtractionBatches} extraction batches.`,
)

await runSearchPlans(selectedSearchPlans, {
  phase: 'initial',
  client,
  trace,
  results,
  rejectedEvidence,
  maxResultsPerQuery,
  apiRetries,
  startedAt: discoveryStartedAt,
  budgetMs: discoveryBudgetMs,
})

const allFollowUpSearchPlans = buildFollowUpSearchPlans(dedupeEvidence([...results, ...rejectedEvidence]))
followUpSearchPlans = selectFollowUpSearchPlans(
  allFollowUpSearchPlans,
  {
    maxQueries: Math.max(0, maxQueries - trace.queries.length),
    existingPlans: selectedSearchPlans,
  },
)
skippedFollowUpSearchPlans = Math.max(0, allFollowUpSearchPlans.length - followUpSearchPlans.length)

if (followUpSearchPlans.length > 0) {
  selectedSearchPlans = [...selectedSearchPlans, ...followUpSearchPlans]
  trace.controls.followUpSearchPlans = followUpSearchPlans.length
  trace.controls.skippedFollowUpSearchPlans = skippedFollowUpSearchPlans
  trace.controls.selectedSearchPlanLabels = selectedSearchPlans.map((plan) => plan.label)
  logProgress(trace, `Follow-up search started: ${followUpSearchPlans.length} evidence-derived queries.`)
  await runSearchPlans(followUpSearchPlans, {
    phase: 'follow-up',
    client,
    trace,
    results,
    rejectedEvidence,
    maxResultsPerQuery,
    apiRetries,
    startedAt: discoveryStartedAt,
    budgetMs: discoveryBudgetMs,
  })
} else {
  trace.controls.followUpSearchPlans = 0
  trace.controls.skippedFollowUpSearchPlans = skippedFollowUpSearchPlans
  logProgress(trace, 'Follow-up search skipped: no remaining budget or no evidence-derived queries.')
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
  let githubReadmeTrace = null
  let githubReadmeError = ''
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

  if (isGitHubRepositoryUrl(item.url)) {
    try {
      const githubReadme = await fetchGitHubReadmeEvidence(item.url)

      if (githubReadme) {
        readerTitle = pickLongerEvidenceText(readerTitle, githubReadme.title)
        readerExcerpt = mergeReaderExcerpts(readerExcerpt, githubReadme.excerpt)
        githubReadmeTrace = {
          title: githubReadme.title,
          excerptLength: githubReadme.excerpt.length,
        }
      }
    } catch (error) {
      githubReadmeError = errorToMessage(error)
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
  if (githubReadmeTrace) {
    readerTrace.githubReadme = githubReadmeTrace
  }
  if (githubReadmeError) {
    readerTrace.githubReadmeError = githubReadmeError
  }
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
const rejectedCandidates = []

logProgress(trace, 'Zhipu-only extraction enabled; local code will only reject malformed candidates before storage.')
logProgress(trace, `Zhipu extraction stage started: ${batches.length}/${allBatches.length} batches.`)

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
const existingByUrl = new Map(
  existingStore.papers
    .flatMap((paper) => [
      [paper.primaryUrl, paper],
      [paper.canonicalUrl, paper],
      ...(paper.evidence ?? []).map((item) => [item.url, paper]),
    ])
    .filter(([url]) => Boolean(url)),
)
const mergedPapers = [...existingStore.papers]
let added = 0
let updated = 0

for (const rawCandidate of extractedCandidates) {
  const candidate = normalizeDiscoveredCandidate(rawCandidate, { rejectedCandidates })

  if (!candidate) {
    continue
  }

  const titleKey = normalizeTitleKey(candidate.title)

  if (!titleKey || officialIndex.has(titleKey)) {
    rejectedCandidates.push({
      title: candidate.title || rawCandidate?.title || '',
      primaryUrl: candidate.primaryUrl || rawCandidate?.primaryUrl || '',
      reason: officialIndex.has(titleKey) ? 'already-in-official-catalog' : 'missing-title-key',
    })
    continue
  }

  const existing =
    existingById.get(candidate.id) ||
    existingByTitle.get(titleKey) ||
    existingByUrl.get(candidate.primaryUrl) ||
    existingByUrl.get(candidate.canonicalUrl)

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
  existingByUrl.set(merged.primaryUrl, merged)
  existingByUrl.set(merged.canonicalUrl, merged)
  for (const item of merged.evidence ?? []) {
    existingByUrl.set(item.url, merged)
  }
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
  skippedSearchPlans: Math.max(0, rawSearchPlans.length - initialSearchPlans.length) + skippedFollowUpSearchPlans,
  selectedSearchPlans: selectedSearchPlans.length,
  modelSearchPlans: modelPlanning.plans.length,
  followUpSearchPlans: followUpSearchPlans.length,
  searchStageBreakdown: summarizeSearchStages(trace.queries),
  rawSearchEvidenceCollected: results.length + rejectedEvidence.length,
  searchEvidenceCollected: dedupedAccepted.length,
  rejectedSearchEvidence: rejectedEvidence.length,
  readerEnrichedEvidence: enrichedEvidence.length,
  extractionBatchesRun: batches.length,
  skippedExtractionBatches,
  extractedCandidates: extractedCandidates.length,
  rejectedCandidates: rejectedCandidates.length,
  added,
  updated,
  durationMs: Date.now() - discoveryStartedAt,
}
trace.rejectedCandidates = rejectedCandidates.slice(0, 80)

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

function normalizeDiscoveredCandidate(candidate, options = {}) {
  const rejectedCandidates = options.rejectedCandidates
  const title = normalizeCandidateText(candidate?.title)
  const primaryUrl = normalizeCandidateUrl(candidate?.primaryUrl)

  if (!title || !primaryUrl) {
    recordRejectedCandidate(rejectedCandidates, candidate, 'missing-title-or-primary-url')
    return null
  }

  if (hasBrokenTitleShape(title)) {
    recordRejectedCandidate(rejectedCandidates, { ...candidate, title, primaryUrl }, 'broken-title-shape')
    return null
  }

  if (isGenericHomepageCandidate(candidate, title)) {
    recordRejectedCandidate(rejectedCandidates, { ...candidate, title, primaryUrl }, 'generic-homepage-or-topic')
    return null
  }

  return {
    ...candidate,
    title,
    primaryUrl,
    canonicalUrl: normalizeCandidateUrl(candidate.canonicalUrl) || undefined,
  }
}

function isGenericHomepageCandidate(candidate, title) {
  const url = candidate.primaryUrl || candidate.canonicalUrl || ''

  if (/github\.com\/topics\//i.test(url)) {
    return true
  }

  if (isPersonalGithubHomepageRepository(url)) {
    return true
  }

  return /\b(research interests?|selected research)\b/i.test(title)
}

function normalizeCandidateText(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeCandidateUrl(value) {
  const url = String(value ?? '').trim()

  return /^https?:\/\//i.test(url) ? url : ''
}

function hasBrokenTitleShape(title) {
  const normalized = normalizeForScoring(title)

  if (title.length < 4 || title.length > 300) {
    return true
  }

  return [
    /^github\s+-/i,
    /\bgithub topics\b/i,
    /\brepository files navigation\b/i,
    /\bgo to file\b/i,
    /\btable of contents\b/i,
    /\bpersonal homepage\b/i,
    /\bcall for papers\b/i,
    /github\.io|github\.com|https?:\/\//i,
  ].some((pattern) => pattern.test(title)) ||
    /\b(research interests?|selected research)$/.test(normalized)
}

function recordRejectedCandidate(rejectedCandidates, candidate, reason) {
  if (!Array.isArray(rejectedCandidates)) {
    return
  }

  rejectedCandidates.push({
    title: candidate?.title || '',
    primaryUrl: candidate?.primaryUrl || '',
    reason,
  })
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
    extractor: 'zhipu-chat',
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
- Inspect the search and reader evidence below and decide whether each item is a real research paper, preprint, accepted-paper announcement, or paper project page.
- You are the primary extractor. The local pipeline will not infer missing titles or venues from heuristics.
- Focus areas: LLM, VLM, VLA, MLLM, agents, reasoning, video understanding, 3D, robotics, embodied AI, multimodal learning.
- Prefer announcements using phrases like "Introducing", "new work", "our paper", "accepted to", or venue names.
- Exclude workshop-only, findings/demo/tutorial/challenge/course/recruiting/product-only posts when the evidence is clear.
- Extract the clean paper title only. Never include GitHub UI text such as "Go to file", "Repository files navigation", branch names, README navigation, website titles, URLs, or social-media boilerplate in title.
- If the clean paper title is not explicitly supported by the evidence, return no paper for that item instead of guessing.
- If evidence explicitly says the paper is accepted to the main conference of AAAI, ACL, EMNLP, CVPR, ICCV, ICLR, ICML, NeurIPS, SIGGRAPH, KDD, WWW, or similar, fill acceptedVenue and acceptedYear.
- Use status "accepted" only for explicit main-conference acceptance evidence. If acceptance is unclear, use status "candidate".
- Put a short exact evidence quote or close paraphrase in "reason", including the source that supports the title/status.
- Use primaryUrl as the best paper/project/social announcement URL from the evidence. It must be an http(s) URL.
- Return an empty papers array if the batch has no confidently identifiable papers.

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

async function buildModelSearchPlans(client, options) {
  const trace = {
    enabled: Boolean(options.enabled),
    requestedPlans: options.maxPlans,
    prompt: '',
    responseText: '',
    parsedPlans: 0,
    error: '',
  }

  if (!options.enabled || options.maxPlans <= 0) {
    return {
      ...trace,
      plans: [],
    }
  }

  const prompt = buildSearchPlanningPrompt(options.maxPlans)
  trace.prompt = prompt

  try {
    const response = await zhipuChat(client, {
      messages: [
        {
          role: 'system',
          content: 'You plan high-recall web searches for newly announced AI research papers. Return JSON only.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }, options.retries, {
      timeoutMs: Number(process.env.ZHIPU_CHAT_TIMEOUT_MS) || undefined,
    })
    const text = extractMessageText(response)
    const parsed = tryParseJsonBlock(text)
    const rawPlans = Array.isArray(parsed?.queries) ? parsed.queries : []
    const plans = rawPlans
      .map((item, index) => normalizeModelSearchPlan(item, index))
      .filter(Boolean)
      .slice(0, options.maxPlans)

    return {
      ...trace,
      responseText: text.slice(0, 8000),
      parsedPlans: plans.length,
      plans,
    }
  } catch (error) {
    return {
      ...trace,
      error: errorToMessage(error),
      plans: [],
    }
  }
}

function buildSearchPlanningPrompt(maxPlans) {
  return `
Design ${maxPlans} high-recall web-search queries for finding newly announced or unofficial 2026 top-venue AI papers before official proceedings pages are complete.

Use a Codex-style search strategy:
- Mix exact phrases, venue/year anchors, source-specific probes, and broad exploratory queries.
- Search likely first-public places: X/Twitter posts, GitHub repositories, GitHub Pages project pages, lab/personal homepages, arXiv pages, OpenReview, Chinese web/social pages, and news mirrors.
- Focus on LLM, VLM, VLA, MLLM, agents, reasoning, video understanding, 3D/3DGS, robotics, embodied AI, multimodal benchmarks, post-training/RL, RAG, document understanding, and world models.
- Include queries for "Introducing", "happy to share", "our paper", "accepted to", "official code", "project page", "paper accepted", and venue names.
- Avoid workshop-only or CFP queries.

Return JSON only:
{
  "queries": [
    {
      "query": "search query text",
      "stage": "model-plan",
      "platform": "x | github | arxiv | homepage | xiaohongshu | web",
      "domainFilter": "optional domain like x.com, github.com, arxiv.org, github.io, openreview.net",
      "recencyFilter": "oneWeek | oneMonth | oneYear",
      "contentSize": "medium | high",
      "intent": "why this query should find new papers"
    }
  ]
}
`.trim()
}

function normalizeModelSearchPlan(item, index) {
  const query = normalizeCandidateText(item?.query)

  if (!query || query.length < 8) {
    return null
  }

  const platform = normalizeCandidateText(item.platform) || detectQueryPlatform(query)

  return makeSearchPlan('model-plan', index, query, {
    platform,
    domainFilter: normalizeDomainFilter(item.domainFilter),
    recencyFilter: normalizeRecencyFilter(item.recencyFilter),
    contentSize: normalizeContentSize(item.contentSize),
    intent: normalizeCandidateText(item.intent),
  })
}

function dedupeSearchPlans(plans) {
  const seen = new Set()
  const output = []

  for (const plan of plans) {
    const key = searchPlanKey(plan)

    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    output.push(plan)
  }

  return output
}

function buildDefaultSearchPlans() {
  const plans = [
    ...seedVenuePlans(),
    ...repositoryPlans(),
    ...paperIndexPlans(),
    ...socialAnnouncementPlans(),
    ...labHomepagePlans(),
    ...chineseDiscoveryPlans(),
    ...broadRecallPlans(),
  ]

  return dedupeSearchPlans(plans)
}

function selectSearchPlans(plans, options) {
  const maxQueries = Math.min(options.maxQueries, plans.length)

  if (options.preserveOrder || options.strategy === 'prefix') {
    return plans.slice(0, maxQueries)
  }

  const groups = new Map()

  for (const plan of plans) {
    const key = plan.stage || plan.platform || 'broad'
    if (!groups.has(key)) {
      groups.set(key, [])
    }
    groups.get(key).push(plan)
  }

  const selected = []
  const seen = new Set()

  // First pass: guarantee that low-volume high-signal sources are represented.
  for (const platform of SEARCH_STAGE_PRIORITY) {
    const item = groups.get(platform)?.shift()
    if (item) {
      selected.push(item)
      seen.add(item.label)
    }
  }

  // Round-robin the remaining quota so no noisy source can monopolize the run.
  while (selected.length < maxQueries) {
    let added = false

    for (const platform of SEARCH_STAGE_PRIORITY) {
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

function seedVenuePlans() {
  return [
    '"accepted to" "AAAI 2026" "official code"',
    '"accepted to" "ACL 2026" "official code"',
    '"accepted to" "ICLR 2026" "project page"',
    '"accepted to" "CVPR 2026" "multimodal"',
    '"accepted at" "AAAI 2026" "LLM"',
    '"accepted at" "ACL 2026" "VLM"',
    '"to appear at" "ICLR 2026" "multimodal"',
    '"main conference" "ACL 2026" "paper"',
    '"AAAI 2026" "our paper" "large language model"',
    '"ACL 2026" "our paper" "multimodal"',
    '"ICLR 2026" "our paper" "agent"',
    '"CVPR 2026" "our paper" "3D Gaussian Splatting"',
  ].map((query, index) => makeSearchPlan('seed', index, query, {
    platform: 'web',
    contentSize: 'high',
  }))
}

function repositoryPlans() {
  return [
    'site:github.com "AAAI 2026" "official code" "LLM"',
    'site:github.com "ACL 2026" "accepted" "multimodal"',
    'site:github.com "ICLR 2026" "official repo" "agent"',
    'site:github.com "CVPR 2026" "project page" "3D"',
    'site:github.com "EMNLP 2026" "paper" "VLM"',
    'site:github.com "NeurIPS 2026" "paper" "VLA"',
    'site:github.com "[AAAI 2026]" "This is the code repository for our paper"',
    'site:github.com "[ACL 2026]" "official implementation"',
    'site:github.com "[ICLR 2026]" "accepted"',
    'site:github.com "2026" "This work has been accepted" "multimodal"',
  ].map((query, index) => makeSearchPlan('repository', index, query, {
    platform: 'github',
    domainFilter: 'github.com',
    contentSize: 'high',
  }))
}

function paperIndexPlans() {
  return [
    'arxiv "accepted to" "2026" "large language model"',
    'arxiv "project page" "2026" "vision language model"',
    'arxiv "3D Gaussian Splatting" "VLM" "2026"',
    'arxiv "vision language action" VLA "2026"',
    'arxiv "multimodal benchmark" "2026" "LLM"',
    'arxiv "agent" "reasoning" "accepted" "2026"',
    'site:arxiv.org/abs "2026" "LLM" "accepted"',
    'site:arxiv.org/abs "2026" "multimodal" "project page"',
    'site:openreview.net/forum "ICLR 2026" "LLM"',
    'site:openreview.net/forum "2026" "vision language"',
  ].map((query, index) => makeSearchPlan('paper-index', index, query, {
    platform: query.includes('openreview') ? 'openreview' : 'arxiv',
    domainFilter: query.includes('openreview') ? 'openreview.net' : 'arxiv.org',
    contentSize: 'high',
  }))
}

function socialAnnouncementPlans() {
  const themes = [
    'LLM VLM multimodal agent reasoning',
    'video understanding 3D Gaussian Splatting robotics embodied AI',
    'VLA vision language action world model',
    'MLLM benchmark evaluation post-training RL',
    'multimodal RAG document understanding',
  ]
  const announcementPhrases = [
    '"Introducing"',
    '"Introducing our paper"',
    '"our new work"',
    '"accepted to" "paper"',
    '"paper accepted"',
    '"happy to share" "accepted"',
    '"thrilled to share" "paper"',
    '"we release" "paper"',
  ]

  return announcementPhrases.flatMap((phrase) =>
    themes.map((theme, index) => makeSearchPlan('social', `${slugForLabel(phrase)}-${index + 1}`, `${phrase} ${theme} 2026`, {
      platform: 'x',
      domainFilter: 'x.com',
      contentSize: 'medium',
    })),
  )
}

function labHomepagePlans() {
  return [
    'site:github.io "accepted to" "2026" "LLM"',
    'site:github.io "paper" "multimodal" "2026"',
    'site:github.io "project page" "vision-language" "2026"',
    'site:github.io "This work has been accepted" "2026"',
    'site:github.io "official code" "AAAI 2026"',
    'site:github.io "official code" "ACL 2026"',
    'site:edu "accepted to" "2026" "large language model"',
    'site:edu "our paper" "2026" "multimodal"',
    'site:edu "publication" "AAAI 2026" "LLM"',
    'site:edu "news" "accepted to ACL 2026"',
    'site:edu "publications" "ICLR 2026" "multimodal"',
  ].map((query, index) => makeSearchPlan('homepage', index, query, {
    platform: 'homepage',
    contentSize: 'high',
  }))
}

function chineseDiscoveryPlans() {
  const queries = [
    `${ZH_PAPER_ACCEPTED} ${ZH_TOP_VENUE} ${ZH_LLM} AAAI ACL ICLR 2026`,
    `${ZH_NEW_PAPER} ${ZH_MULTIMODAL} CVPR ICLR 2026`,
    `${ZH_NEW_PAPER} ${ZH_AGENT} ${ZH_EMBODIED} 2026`,
    `${ZH_XIAOHONGSHU} ${ZH_PAPER_ACCEPTED} ${ZH_TOP_VENUE} ${ZH_LLM} 2026`,
    `${ZH_XIAOHONGSHU} ${ZH_NEW_PAPER} VLM MLLM VLA 2026`,
  ]

  return queries.map((query, index) => makeSearchPlan('chinese', index, query, {
    platform: query.includes(ZH_XIAOHONGSHU) ? 'xiaohongshu' : 'web',
    domainFilter: query.includes(ZH_XIAOHONGSHU) ? 'xiaohongshu.com' : undefined,
    contentSize: 'medium',
  }))
}

function broadRecallPlans() {
  return [
    '"2026" "official repo" "multimodal"',
    '"2026" "project page" "large language model"',
    '"2026" "paper" "vision language action"',
    '"2026" "paper" "3D Gaussian Splatting"',
    '"2026" "paper" "multimodal RAG"',
    '"2026" "paper" "reasoning" "RL"',
    '"AAAI 2026" "GitHub" "large language models"',
    '"ACL 2026" "GitHub" "multimodal"',
    '"ICLR 2026" "GitHub" "agent"',
    '"CVPR 2026" "project" "3DGS"',
  ].map((query, index) => makeSearchPlan('broad', index, query, {
    platform: 'web',
    contentSize: 'medium',
  }))
}

function makeSearchPlan(stage, index, query, options = {}) {
  return {
    label: `${stage}-${index + 1}`,
    query,
    stage,
    platform: options.platform || 'web',
    domainFilter: options.domainFilter,
    recencyFilter: options.recencyFilter || 'oneMonth',
    searchEngine: options.searchEngine || 'search_pro',
    contentSize: options.contentSize || 'medium',
    intent: options.intent || '',
    parentUrl: options.parentUrl || '',
  }
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
      stage: plan.stage || '',
      url: item.link || item.url || '',
      title: item.title || item.name || '',
      author: item.author || item.site_name || '',
      snippet: item.content || item.snippet || item.description || item.summary || '',
      publishDate: item.publish_date || item.publish_time || item.date || '',
      query: plan.query,
      queryLabel: plan.label,
      queryIntent: plan.intent || '',
      parentUrl: plan.parentUrl || '',
    }))
    .filter((item) => item.url && item.title)
}

async function runSearchPlans(plans, options) {
  for (const [planIndex, plan] of plans.entries()) {
    if (isBudgetExpired(options.startedAt, options.budgetMs)) {
      options.trace.errors.push(`Discovery budget expired before ${options.phase} search ${planIndex + 1}.`)
      logProgress(options.trace, `Discovery budget expired; skipping ${plans.length - planIndex} remaining ${options.phase} searches.`)
      break
    }

    const queryStartedAt = Date.now()
    const queryTrace = {
      label: plan.label,
      query: plan.query,
      stage: plan.stage || '',
      phase: options.phase,
      platform: plan.platform,
      searchEngine: plan.searchEngine || options.client.searchTool,
      domainFilter: plan.domainFilter || '',
      recencyFilter: plan.recencyFilter || '',
      contentSize: plan.contentSize || '',
      intent: plan.intent || '',
      parentUrl: plan.parentUrl || '',
      requestedCount: options.maxResultsPerQuery,
      rawResultCount: 0,
      resultCount: 0,
      rejectedCount: 0,
      startedAt: new Date().toISOString(),
      results: [],
      rejected: [],
    }

    try {
      logProgress(options.trace, `[${options.phase} search ${planIndex + 1}/${plans.length}] ${plan.label}: ${plan.query}`)
      const searchResponse = await zhipuWebSearch(options.client, plan.query, {
        count: options.maxResultsPerQuery,
        domainFilter: plan.domainFilter,
        recencyFilter: plan.recencyFilter,
        searchEngine: plan.searchEngine,
        contentSize: plan.contentSize,
        retries: options.apiRetries,
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
      options.results.push(...accepted)
      options.rejectedEvidence.push(...rejected)
    } catch (error) {
      queryTrace.error = errorToMessage(error)
      options.trace.errors.push(`Search failed for query "${plan.query}": ${queryTrace.error}`)
    }

    queryTrace.durationMs = Date.now() - queryStartedAt
    options.trace.queries.push(queryTrace)
    logProgress(
      options.trace,
      `[${options.phase} search ${planIndex + 1}/${plans.length}] done raw=${queryTrace.rawResultCount} kept=${queryTrace.resultCount} rejected=${queryTrace.rejectedCount} in ${formatDuration(queryTrace.durationMs)}${queryTrace.error ? ` error=${queryTrace.error}` : ''}`,
    )
  }
}

function buildFollowUpSearchPlans(evidenceItems) {
  const plans = []

  for (const item of evidenceItems.sort(compareEvidenceRelevance)) {
    if (!isFollowUpSeed(item)) {
      continue
    }

    const terms = extractFollowUpTerms(item)

    for (const term of terms) {
      plans.push(makeSearchPlan('follow-up', plans.length, term.query, {
        platform: term.platform,
        domainFilter: term.domainFilter,
        recencyFilter: term.recencyFilter,
        contentSize: 'high',
        parentUrl: item.url,
        intent: term.intent,
      }))
    }
  }

  return dedupeSearchPlans(plans)
}

function selectFollowUpSearchPlans(plans, options) {
  if (options.maxQueries <= 0) {
    return []
  }

  const existingKeys = new Set(options.existingPlans.map(searchPlanKey))
  const grouped = new Map()

  for (const plan of plans) {
    if (existingKeys.has(searchPlanKey(plan))) {
      continue
    }

    const key = plan.platform || 'web'
    if (!grouped.has(key)) {
      grouped.set(key, [])
    }
    grouped.get(key).push(plan)
  }

  const selected = []
  const platformPriority = ['github', 'homepage', 'arxiv', 'openreview', 'x', 'xiaohongshu', 'web']

  while (selected.length < options.maxQueries) {
    let added = false

    for (const platform of platformPriority) {
      const item = grouped.get(platform)?.shift()

      if (!item) {
        continue
      }

      selected.push(item)
      added = true

      if (selected.length >= options.maxQueries) {
        break
      }
    }

    if (!added) {
      break
    }
  }

  return selected
}

function isFollowUpSeed(item) {
  if (!item?.url) {
    return false
  }

  if (item.relevance?.strongReject) {
    return false
  }

  return item.relevance?.score >= 2 || isHighSignalUrl(item.url)
}

function extractFollowUpTerms(item) {
  const text = stripMarkupForEvidence([
    item.title,
    item.snippet,
    item.readerTitle,
    item.readerExcerpt,
  ].filter(Boolean).join(' '))
  const terms = []
  const repo = parseGitHubRepository(item.url)
  const titleCandidates = extractLikelyPaperTitles(text)
  const venue = extractVenueYear(text)
  const topics = extractTopicTerms(text).slice(0, 3).join(' ')

  if (repo && !isPersonalGithubHomepageRepository(item.url)) {
    terms.push({
      query: `"${repo.owner}/${repo.name}" paper accepted 2026`,
      platform: 'web',
      intent: 'trace GitHub repository name across announcements and project pages',
    })
    terms.push({
      query: `site:x.com "${repo.name}" paper`,
      platform: 'x',
      domainFilter: 'x.com',
      intent: 'find social announcement for GitHub repository',
    })
  }

  for (const title of titleCandidates.slice(0, 2)) {
    terms.push({
      query: `"${title}"`,
      platform: 'web',
      intent: 'exact title verification across web',
    })
    terms.push({
      query: `site:github.com "${title}"`,
      platform: 'github',
      domainFilter: 'github.com',
      intent: 'exact title GitHub verification',
    })
    terms.push({
      query: `site:x.com "${title}"`,
      platform: 'x',
      domainFilter: 'x.com',
      intent: 'exact title social announcement',
    })
  }

  if (venue) {
    terms.push({
      query: `"${venue}" "${topics || 'paper'}" "official code"`,
      platform: 'web',
      intent: 'expand from venue-year signal to sibling papers',
    })
    terms.push({
      query: `site:github.com "${venue}" "${topics || 'paper'}"`,
      platform: 'github',
      domainFilter: 'github.com',
      intent: 'venue-year GitHub sibling search',
    })
  }

  return terms
}

function scoreEvidence(item) {
  const text = normalizeForScoring([
    item.title,
    item.snippet,
    item.url,
  ].join(' '))
  const signals = []
  let score = stageWeight(item.stage)

  score += addWeightedSignals(text, signals, 'paper', [
    ['paper', 3],
    ['preprint', 2],
    ['arxiv', 3],
    ['project page', 4],
    ['technical report', 2],
    [ZH_NEW_PAPER.replace('\u65b0', ''), 3],
    [ZH_PREPRINT, 2],
  ])
  score += addWeightedSignals(text, signals, 'announcement', [
    ['introducing', 3],
    ['new work', 3],
    ['our work', 2],
    ['our paper', 4],
    ['accepted to', 5],
    ['accepted by', 4],
    ['paper accepted', 5],
    ['to appear', 3],
    ['official code', 4],
    ['official repo', 4],
    ['official implementation', 3],
    [ZH_OPEN_SOURCE, 1],
    [ZH_NEW_PAPER, 4],
    [ZH_PAPER_ACCEPTED, 5],
    [ZH_ACCEPTED, 4],
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
    ['gaussian splatting', 2],
    ['world model', 2],
    ['rag', 2],
    ['post-training', 2],
    ['reinforcement learning', 2],
    [ZH_LLM, 2],
    [ZH_MULTIMODAL, 2],
    [ZH_AGENT, 2],
    [ZH_EMBODIED, 2],
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
    ['ijcai', 2],
    ['colm', 2],
    ['kdd', 2],
    ['www', 2],
    [ZH_TOP_VENUE, 2],
  ])

  const strongReject = [
    'miniapp',
    ZH_MINIAPP_PLATFORM,
    ZH_RECRUITING,
    ZH_COURSE,
    'tutorial',
    'challenge',
    'call for papers',
    'cfp',
    'workshop',
    'sponsor',
    'product',
    'documentation',
    'presentation generator',
    'awesome',
    'curated list',
    'reading list',
    'survey list',
    'leaderboard',
  ].some((term) => text.includes(term))

  if (strongReject) {
    score -= 5
    signals.push('reject:non-paper-page')
  }

  if (isHighSignalUrl(item.url)) {
    score += 2
    signals.push('source:high-signal-url')
  }

  if (item.stage === 'model-plan') {
    score += 1
    signals.push('source:model-planned-query')
  }

  if (item.stage === 'follow-up') {
    score += 2
    signals.push('source:evidence-follow-up')
  }

  const keep = !strongReject && (
    score >= 3 ||
    (score >= 1 && isHighSignalUrl(item.url)) ||
    (item.stage === 'follow-up' && score >= 1)
  )

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

function stageWeight(stage) {
  if (stage === 'model-plan' || stage === 'follow-up') {
    return 2
  }

  if (stage === 'seed' || stage === 'repository') {
    return 2
  }
  if (stage === 'paper-index' || stage === 'homepage') {
    return 1
  }
  return 0
}

function isHighSignalUrl(url) {
  return /arxiv\.org|github\.com|github\.io|openreview\.net|x\.com|twitter\.com|\.edu/i.test(url || '')
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
  return evidencePriority(right) - evidencePriority(left)
}

function evidencePriority(item) {
  let score = item.relevance?.score ?? 0
  const text = [
    item.title,
    item.snippet,
    item.readerTitle,
    item.readerExcerpt,
    item.url,
  ].filter(Boolean).join(' ')

  score += stageWeight(item.stage)
  if (/github\.com|github\.io/i.test(item.url || '')) {
    score += 4
  }
  if (hasVenueYearSignal(text)) {
    score += 8
  }
  if (/arxiv\.org\/list\//i.test(item.url || '')) {
    score -= 8
  }
  if (/\bawesome\b|curated list|reading list|survey list|leaderboard/i.test(normalizeForScoring(text))) {
    score -= 8
  }

  return score
}

function hasVenueYearSignal(text) {
  return /\b(aaai|acl|emnlp|cvpr|iccv|iclr|icml|neurips|siggraph|kdd|www|ijcai|colm|mm|sigir)[-\s]?(?:2026|26)\b/i.test(text)
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

  if (/github/i.test(query)) {
    return 'github'
  }

  if (/arxiv/i.test(query)) {
    return 'arxiv'
  }

  if (/openreview/i.test(query)) {
    return 'openreview'
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

function searchPlanKey(plan) {
  const domain = normalizeDomainFilter(plan.domainFilter)
  const recency = normalizeRecencyFilter(plan.recencyFilter)
  const engine = normalizeCandidateText(plan.searchEngine || 'search_pro').toLowerCase()
  const query = normalizeForScoring(plan.query)

  return query ? `${engine}:${domain}:${recency}:${query}` : ''
}

function normalizeDomainFilter(value) {
  const domain = normalizeCandidateText(value)
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()

  if (!domain || /[^a-z0-9.-]/i.test(domain)) {
    return undefined
  }

  return domain
}

function normalizeRecencyFilter(value) {
  const normalized = normalizeCandidateText(value)

  return ['noLimit', 'oneDay', 'oneWeek', 'oneMonth', 'oneYear'].includes(normalized)
    ? normalized
    : 'oneMonth'
}

function normalizeContentSize(value) {
  const normalized = normalizeCandidateText(value)

  return ['low', 'medium', 'high'].includes(normalized) ? normalized : 'medium'
}

function extractLikelyPaperTitles(text) {
  const normalized = stripMarkupForEvidence(text)
  const candidates = []
  const patterns = [
    /\[[A-Z]{2,12}\s*2026\]\s*([^:\n]{2,120}:\s*[^.\n]{8,180})/gi,
    /(?:paper|work|repo(?:sitory)?)(?:\s+for)?[:\uFF1A]\s*([^.\n]{8,220})/gi,
    /(?:title\s*=\s*\{)([^}]{8,220})(?:\})/gi,
    /#\s*([^#\n]{8,220})/g,
  ]

  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const title = cleanTitleCandidate(match[1])

      if (title) {
        candidates.push(title)
      }
    }
  }

  return Array.from(new Set(candidates)).slice(0, 5)
}

function cleanTitleCandidate(value) {
  const title = normalizeCandidateText(value)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/\s*[-|]\s*GitHub$/i, '')
    .replace(/\s*##.*$/g, '')
    .replace(/\s*\bbibtex\b.*$/i, '')
    .trim()

  if (title.length < 8 || title.length > 220) {
    return ''
  }

  if (/go to file|repository files navigation|github topics|https?:\/\//i.test(title)) {
    return ''
  }

  if (!/[a-zA-Z]/.test(title)) {
    return ''
  }

  return title
}

function extractVenueYear(text) {
  const match = String(text ?? '').match(/\b(AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)[-\s]?(2026|26)\b/i)

  if (!match) {
    return ''
  }

  return `${match[1].toUpperCase()} ${match[2] === '26' ? '2026' : match[2]}`
}

function extractTopicTerms(text) {
  const normalized = normalizeForScoring(text)
  const topics = [
    'large language model',
    'llm',
    'vision language model',
    'vlm',
    'multimodal',
    'mllm',
    'vision language action',
    'vla',
    'agent',
    'reasoning',
    'video understanding',
    '3d gaussian splatting',
    '3dgs',
    'robotics',
    'embodied ai',
    'rag',
    'benchmark',
    'post-training',
    'reinforcement learning',
    'world model',
    'document understanding',
  ]

  return topics.filter((topic) => normalized.includes(topic))
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
    rejectedCandidates: [],
    summary: {
      searchQueriesRun: 0,
      rawSearchEvidenceCollected: 0,
      searchEvidenceCollected: 0,
      searchStageBreakdown: {},
      rejectedSearchEvidence: 0,
      readerEnrichedEvidence: 0,
      extractedCandidates: 0,
      rejectedCandidates: 0,
      added: 0,
      updated: 0,
    },
    errors: [],
  }
}

function summarizeEvidence(item) {
  return {
    platform: item.platform || 'web',
    stage: item.stage || '',
    url: item.url || '',
    title: item.title || '',
    snippet: String(item.snippet || '').slice(0, 700),
    publishDate: item.publishDate || '',
    relevanceScore: item.relevance?.score,
    relevanceSignals: item.relevance?.signals?.slice(0, 10) ?? [],
    queryLabel: item.queryLabel || '',
    queryIntent: item.queryIntent || '',
    parentUrl: item.parentUrl || '',
  }
}

function summarizeReaderEvidence(item, readerError) {
  const summary = {
    ...summarizeEvidence(item),
    readerTitle: item.readerTitle || '',
    readerExcerpt: String(item.readerExcerpt || '').slice(0, 1400),
  }

  if (readerError) {
    summary.readerError = readerError
  }

  return summary
}

function summarizeSearchStages(queries) {
  const summary = {}

  for (const query of queries) {
    const stage = query.stage || 'unknown'
    const current = summary[stage] ?? {
      queries: 0,
      raw: 0,
      kept: 0,
      rejected: 0,
    }

    current.queries += 1
    current.raw += query.rawResultCount || 0
    current.kept += query.resultCount || 0
    current.rejected += query.rejectedCount || 0
    summary[stage] = current
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

function isGitHubRepositoryUrl(url) {
  return parseGitHubRepository(url) !== null
}

function isPersonalGithubHomepageRepository(url) {
  const repo = parseGitHubRepository(url)

  if (!repo) {
    return false
  }

  return repo.name.toLowerCase() === `${repo.owner.toLowerCase()}.github.io`
}

function parseGitHubRepository(url) {
  const match = String(url ?? '').match(/^https?:\/\/github\.com\/([^/\s?#]+)\/([^/\s?#]+)/i)

  if (!match || match[2].toLowerCase() === 'topics') {
    return null
  }

  return {
    owner: match[1],
    name: match[2].replace(/\.git$/i, ''),
  }
}

async function fetchGitHubReadmeEvidence(url) {
  const repo = parseGitHubRepository(url)

  if (!repo || isPersonalGithubHomepageRepository(url)) {
    return null
  }

  const candidates = [
    {
      url: `https://api.github.com/repos/${repo.owner}/${repo.name}/readme`,
      headers: {
        accept: 'application/vnd.github.raw',
      },
    },
    {
      url: `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/HEAD/README.md`,
      headers: {
        accept: 'text/plain',
      },
    },
    {
      url: `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/main/README.md`,
      headers: {
        accept: 'text/plain',
      },
    },
    {
      url: `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/master/README.md`,
      headers: {
        accept: 'text/plain',
      },
    },
  ]
  let lastError

  for (const candidate of candidates) {
    try {
      const response = await fetchWithTimeout(candidate.url, {
        headers: {
          'user-agent': 'TopVenuePapers-discovery',
          ...candidate.headers,
        },
      }, 8_000)

      if (!response.ok) {
        lastError = new Error(`${response.status} ${response.statusText}`)
        continue
      }

      const text = await response.text()
      const excerpt = stripMarkupForEvidence(text).slice(0, 3000).trim()

      if (!excerpt) {
        continue
      }

      return {
        title: `${repo.owner}/${repo.name} README`,
        excerpt,
      }
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }

  return null
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

function stripMarkupForEvidence(value) {
  return String(value ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\[([^\]]{2,220})\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function pickLongerEvidenceText(left, right) {
  const leftText = String(left ?? '').trim()
  const rightText = String(right ?? '').trim()

  if (!leftText) {
    return rightText
  }

  if (!rightText) {
    return leftText
  }

  return rightText.length > leftText.length ? rightText : leftText
}

function mergeReaderExcerpts(left, right) {
  const leftText = String(left ?? '').trim()
  const rightText = String(right ?? '').trim()

  if (!leftText || leftText.startsWith('reader failed:')) {
    return rightText || leftText
  }

  if (!rightText || leftText.includes(rightText.slice(0, 120))) {
    return leftText
  }

  return `${leftText}\n\n${rightText}`.slice(0, 5000)
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

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') {
    return fallback
  }

  if (typeof value === 'boolean') {
    return value
  }

  const normalized = String(value).trim().toLowerCase()

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return fallback
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
    } else if (arg === '--max-follow-up-queries') {
      parsed.maxFollowUpQueries = argv[++index]
    } else if (arg === '--max-model-queries') {
      parsed.maxModelQueries = argv[++index]
    } else if (arg === '--model-planning') {
      parsed.modelPlanning = argv[++index]
    } else if (arg === '--no-model-planning') {
      parsed.modelPlanning = false
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
  --max-follow-up-queries <n>   Evidence-derived follow-up query cap. Default: 35% of max queries.
  --max-model-queries <n>       Zhipu planned query cap. Default: 35% of max queries.
  --model-planning <bool>       Let Zhipu plan search queries before static probes. Default: true.
  --no-model-planning           Disable Zhipu search-query planning.
  --force-reader               Always run the webpage reader for candidate links.
  --dry-run                    Do not persist results.
`)
  process.exit(0)
}
