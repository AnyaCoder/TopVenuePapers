#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
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
  'site:xiaohongshu.com (Introducing OR "new work" OR "paper accepted") (LLM OR VLM OR VLA OR MLLM OR 多模态) 2026',
  'site:xiaohongshu.com ("论文 accepted" OR "中稿" OR "新 work") (推理 OR Agent OR 视频 OR 机器人 OR world model) 2026',
]

const args = parseArgs(process.argv.slice(2))
const storePath = args.store ?? 'data/unofficial/unofficial-papers.json'
const officialCatalogPath = args.officialCatalog ?? 'data/papers.catalog.official.json'
const cacheDir = args.cacheDir ?? 'data/unofficial/cache'
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

const results = []

for (const query of queryList) {
  const searchResponse = await zhipuWebSearch(client, query, {
    count: maxResultsPerQuery,
  })
  const items = collectSearchItems(searchResponse, query)
  results.push(...items)
}

const dedupedEvidence = dedupeEvidence(results).slice(0, Math.max(maxReaders, results.length))
const enrichedEvidence = []

for (const item of dedupedEvidence) {
  let readerTitle = ''
  let readerExcerpt = ''

  if (forceReader || isLikelyHelpfulReaderTarget(item.url)) {
    try {
      const readerResponse = await zhipuWebReader(client, item.url)
      const readerPayload = normalizeReaderPayload(readerResponse)
      readerTitle = readerPayload.title
      readerExcerpt = readerPayload.excerpt
    } catch (error) {
      readerExcerpt = `reader failed: ${error.message}`
    }
  }

  enrichedEvidence.push({
    ...item,
    readerTitle,
    readerExcerpt,
  })
}

const batches = chunk(enrichedEvidence, 6)
const extractedCandidates = []

for (const batch of batches) {
  const extraction = await extractCandidatesFromEvidence(client, batch)
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
  generatedAt: new Date().toISOString(),
  notes: [
    'Entries discovered by daily Zhipu web search + reader pipeline over X and Xiaohongshu style announcement posts.',
    'Only candidate/accepted unofficial papers are stored here; official catalog merge decides what still appears under 未分类 / Unclassified.',
  ],
  papers: mergedPapers.sort((left, right) => {
    const leftTime = left.updatedAt || left.discoveredAt || ''
    const rightTime = right.updatedAt || right.discoveredAt || ''
    return rightTime.localeCompare(leftTime) || left.title.localeCompare(right.title)
  }),
}

if (!dryRun) {
  await writeUnofficialStore(storePath, nextStore)
}

console.log(`Search evidence collected: ${results.length}`)
console.log(`Reader-enriched evidence: ${enrichedEvidence.length}`)
console.log(`Extracted unofficial candidates: ${extractedCandidates.length}`)
console.log(`Store additions: ${added}; updates: ${updated}`)
if (!dryRun) {
  console.log(`Wrote ${storePath}`)
}

async function extractCandidatesFromEvidence(client, evidenceBatch) {
  const prompt = `
你现在是论文发现助手。请根据下面的网页/帖子搜索证据，找出可能对应 2026 年 AI 顶会主会议论文的条目。

范围：
- 平台来源重点是 X / Xiaohongshu / 个人主页 / 实验室主页。
- 方向重点是 LLM, VLM, VLA, MLLM, Agent, reasoning, video understanding, 3D, robotics, embodied AI 等。
- 只保留“像论文”的项目。需要有论文标题或非常接近论文标题的项目。
- 若明显是 workshop/findings/demo/tutorial/challenge/课程/招聘/纯产品发布，不要收录。
- 如果帖子里出现 accepted / accepted to / AAAI / ACL / EMNLP / CVPR / ICCV / ICLR / ICML / NeurIPS 等信息，可以判定 acceptedVenue。

请输出 JSON，格式如下：
{
  "papers": [
    {
      "title": "paper title",
      "titleZh": "可选",
      "summary": "一句中文概括",
      "reason": "为什么认为这是一篇论文，以及接受/未接受判断依据",
      "status": "candidate 或 accepted",
      "confidence": 0.0,
      "acceptedVenue": "如 ACL 2026 / AAAI / CVPR 2026，没有就留空",
      "acceptedYear": 2026,
      "primaryUrl": "最主要证据链接",
      "canonicalUrl": "若有论文页或主页则填，没有就留空",
      "pdfUrl": "可选",
      "authors": ["作者1", "作者2"],
      "keywords": ["llm", "agent"],
      "platforms": ["x", "xiaohongshu", "homepage"],
      "evidence": [
        {
          "platform": "x",
          "url": "https://...",
          "title": "搜索结果标题",
          "author": "若能看出作者",
          "snippet": "检索摘要或正文摘要",
          "readerTitle": "reader 读到的标题",
          "readerExcerpt": "reader 读到的关键片段",
          "publishDate": "可选"
        }
      ]
    }
  ]
}

必须只返回 JSON。

证据如下：
${JSON.stringify(evidenceBatch, null, 2)}
`.trim()

  const response = await zhipuChat(client, {
    messages: [
      {
        role: 'system',
        content:
          '你是严谨的信息抽取器，只能根据提供的证据生成 JSON，不要编造缺失事实。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const text = extractMessageText(response)
  const parsed = tryParseJsonBlock(text)
  const papers = Array.isArray(parsed?.papers) ? parsed.papers : []

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

function parseArgs(argv) {
  const parsed = {
    query: [],
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--store') {
      parsed.store = argv[++index]
    } else if (arg === '--official-catalog') {
      parsed.officialCatalog = argv[++index]
    } else if (arg === '--cache-dir') {
      parsed.cacheDir = argv[++index]
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
