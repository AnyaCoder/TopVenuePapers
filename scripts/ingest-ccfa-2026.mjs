#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { classifyText, normalizeText, slugify } from './lib/paper-taxonomy.mjs'

const CVPR_PAPERS_URL = 'https://cvpr.thecvf.com/virtual/2026/papers.html'
const AAAI_ARCHIVE_URL = 'https://ojs.aaai.org/index.php/AAAI/issue/archive'
const OPENREVIEW_URL = 'https://openreview.net/group?id=ICLR.cc/2026/Conference'
const USER_AGENT = 'ccfa-2026-paper-explorer/0.2'

const args = parseArgs(process.argv.slice(2))
const cacheDir = args.cacheDir ?? 'data/cache'
const iclrInput = args.iclr ?? 'data/openreview/iclr-2026-candidates.json'
const guideInput = args.guides ?? 'data/papers.generated.json'
const outFile = args.out ?? 'public/data/papers.catalog.json'
const mirrorOutFile = args.mirrorOut ?? 'data/papers.catalog.json'
const concurrency = Number(args.concurrency ?? 12)
const maxCvprDetails = parseLimit(args.maxCvprDetails)
const maxAaaiDetails = parseLimit(args.maxAaaiDetails)
const useCache = !args.noCache

const guideRecords = await readJsonArray(guideInput).catch(() => [])
const guideIndex = buildGuideIndex(guideRecords)

const [iclr, cvpr, aaai] = await Promise.all([
  collectIclrPapers(),
  collectCvprPapers(),
  collectAaaiPapers(),
])

const merged = dedupeRecords([...iclr.records, ...cvpr.records, ...aaai.records])
  .map((record) => mergeGuide(record, guideIndex))
  .sort((left, right) => {
    const venueDiff = left.venue.localeCompare(right.venue)
    return venueDiff || left.title.localeCompare(right.title)
  })

const payload = {
  generatedAt: new Date().toISOString(),
  count: merged.length,
  guidedCount: merged.filter((paper) => paper.introZh).length,
  sources: [
    { name: 'ICLR 2026 OpenReview', url: OPENREVIEW_URL, count: iclr.records.length },
    { name: 'CVPR 2026 Virtual', url: CVPR_PAPERS_URL, count: cvpr.records.length },
    { name: 'AAAI OJS', url: AAAI_ARCHIVE_URL, count: aaai.records.length },
  ],
  notes: [
    'Newly ingested papers intentionally keep guideStatus=pending unless a prior Chinese guide exists.',
    'CVPR and AAAI are filtered by LLM/VLM/VLA/MLLM-adjacent title signals before detail-page fetching.',
  ],
  papers: merged,
}

await writeJson(outFile, payload)
await writeJson(mirrorOutFile, payload)

console.log(`Wrote ${merged.length} records.`)
console.log(`Guided records: ${payload.guidedCount}`)
console.log(`ICLR: ${iclr.records.length}; CVPR: ${cvpr.records.length}; AAAI: ${aaai.records.length}`)
console.log(`Output: ${outFile}`)

async function collectIclrPapers() {
  const payload = await readJson(iclrInput)
  const papers = Array.isArray(payload) ? payload : payload.papers ?? []

  const records = papers
    .filter((paper) => paper.title)
    .map((paper) =>
      normalizeRecord({
        id: paper.id,
        source: 'openreview',
        sourceId: paper.openreviewId,
        title: paper.title,
        venue: paper.venue || 'ICLR 2026',
        year: paper.year || 2026,
        track: paper.primaryArea,
        authors: paper.authors,
        openreviewUrl: paper.openreviewUrl,
        pdfUrl: paper.pdfUrl,
        tldr: paper.tldr,
        abstract: paper.abstract,
        keywords: paper.keywords,
        primaryCategory: paper.primaryCategory,
        categories: paper.categories,
        aliases: [paper.openreviewId, paper.id],
      }),
    )

  return { records }
}

async function collectCvprPapers() {
  const html = await fetchTextCached(CVPR_PAPERS_URL, 'cvpr-2026-papers.html')
  const candidates = parseCvprList(html).filter((paper) => isRelevantTitle(paper.title))
  const selected = Number.isFinite(maxCvprDetails)
    ? candidates.slice(0, maxCvprDetails)
    : candidates

  console.log(`CVPR title candidates: ${candidates.length}; fetching details: ${selected.length}`)

  const records = await mapLimit(selected, concurrency, async (paper, index) => {
    try {
      const detailHtml = await fetchTextCached(paper.openreviewUrl, `cvpr-detail-${paper.sourceId}.html`)
      const detail = parseCvprDetail(detailHtml, paper)
      return normalizeRecord({
        ...paper,
        ...detail,
        source: 'cvpr',
        venue: 'CVPR 2026',
        year: 2026,
      })
    } catch (error) {
      console.warn(`CVPR detail failed (${index + 1}/${selected.length}): ${paper.title}`)
      return normalizeRecord({
        ...paper,
        source: 'cvpr',
        venue: 'CVPR 2026',
        year: 2026,
        abstract: '',
      })
    }
  })

  return { records: records.filter(Boolean) }
}

async function collectAaaiPapers() {
  const archiveHtml = await fetchTextCached(AAAI_ARCHIVE_URL, 'aaai-26-archive.html')
  const issueUrls = parseAaaiIssueUrls(archiveHtml)
  const issuePages = await mapLimit(issueUrls, Math.min(concurrency, 8), async (url) => {
    return fetchTextCached(url, `aaai-issue-${url.split('/').pop()}.html`)
  })

  const candidates = issuePages.flatMap(parseAaaiIssueArticles)
    .filter((paper) => isRelevantTitle(paper.title))
  const selected = Number.isFinite(maxAaaiDetails)
    ? candidates.slice(0, maxAaaiDetails)
    : candidates

  console.log(`AAAI title candidates: ${candidates.length}; fetching details: ${selected.length}`)

  const records = await mapLimit(selected, concurrency, async (paper, index) => {
    try {
      const detailHtml = await fetchTextCached(paper.openreviewUrl, `aaai-detail-${paper.sourceId}.html`)
      const detail = parseAaaiArticle(detailHtml, paper)
      return normalizeRecord({
        ...paper,
        ...detail,
        source: 'aaai',
      venue: 'AAAI',
        year: 2026,
      })
    } catch (error) {
      console.warn(`AAAI detail failed (${index + 1}/${selected.length}): ${paper.title}`)
      return normalizeRecord({
        ...paper,
        source: 'aaai',
        venue: 'AAAI',
        year: 2026,
        abstract: '',
      })
    }
  })

  return { records: records.filter(Boolean) }
}

function parseCvprList(html) {
  const seen = new Set()
  const rows = []
  const matches = html.matchAll(/<li><a href="([^"]*\/virtual\/2026\/(?:poster|oral|paper)\/([^"]+)|\/virtual\/2026\/(?:poster|oral|paper)\/([^"]+))"[^>]*>([\s\S]*?)<\/a><\/li>/g)

  for (const match of matches) {
    const href = decodeHtml(match[1])
    const title = cleanText(match[4])
    const sourceId = match[2] ?? match[3] ?? slugify(title)
    const url = new URL(href, 'https://cvpr.thecvf.com').toString()

    if (!title || seen.has(url)) {
      continue
    }

    seen.add(url)
    rows.push({
      id: `cvpr-${sourceId}`,
      sourceId,
      title,
      openreviewUrl: url,
      aliases: [sourceId],
    })
  }

  return rows
}

function parseCvprDetail(html, fallback) {
  const title =
    decodeHtml(html.match(/"name"\s*:\s*"([^"]+)"/)?.[1] ?? '') ||
    cleanText(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '') ||
    fallback.title
  const abstract = cleanText(
    html.match(/id="abstractText"[\s\S]*?<p>([\s\S]*?)<\/p>/i)?.[1] ?? '',
  )
  const authors = Array.from(
    new Set(
      [...html.matchAll(/"name"\s*:\s*"([^"]+)"/g)]
        .map((match) => decodeHtml(match[1]))
        .filter((name) => name && name !== title && !name.includes('CVPR')),
    ),
  ).slice(0, 40)
  const track = cleanText(html.match(/<title>CVPR\s+([^<]+?)\s+/i)?.[1] ?? '')

  return {
    title,
    abstract,
    authors,
    track,
  }
}

function parseAaaiIssueUrls(html) {
  return Array.from(
    new Set(
      [...html.matchAll(/https:\/\/ojs\.aaai\.org\/index\.php\/AAAI\/issue\/view\/(\d+)/g)]
        .map((match) => Number(match[1]))
        .filter((id) => id >= 683 && id <= 733),
    ),
  )
    .sort((left, right) => left - right)
    .map((id) => `https://ojs.aaai.org/index.php/AAAI/issue/view/${id}`)
}

function parseAaaiIssueArticles(html) {
  return [...html.matchAll(/<div class="obj_article_summary">([\s\S]*?)<\/div>\s*<\/li>/g)]
    .map((match) => {
      const block = match[1]
      const linkMatch = block.match(/<a[^>]+id="article-(\d+)"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
      const sourceId = linkMatch?.[1]
      const title = cleanText(linkMatch?.[3] ?? '')
      const pdfUrl = decodeHtml(block.match(/<a class="obj_galley_link pdf" href="([^"]+)"/)?.[1] ?? '')
      const authors = cleanText(block.match(/<div class="authors">([\s\S]*?)<\/div>/)?.[1] ?? '')
        .split(',')
        .map((author) => author.trim())
        .filter(Boolean)

      if (!sourceId || !title) {
        return undefined
      }

      return {
        id: `aaai-${sourceId}`,
        sourceId,
        title,
        authors,
        pdfUrl,
        openreviewUrl: decodeHtml(linkMatch[2]),
        aliases: [sourceId],
      }
    })
    .filter(Boolean)
}

function parseAaaiArticle(html, fallback) {
  const meta = (name) => getMetaContent(html, name)
  const title = meta('citation_title') || meta('DC.Title') || fallback.title
  const abstract = meta('DC.Description') || cleanText(
    html.match(/<section class="item abstract">[\s\S]*?<h2[^>]*>Abstract<\/h2>([\s\S]*?)<\/section>/i)?.[1] ?? '',
  )
  const authors = [...html.matchAll(/<meta\s+name="citation_author"\s+content="([^"]*)"/gi)]
    .map((match) => decodeHtml(match[1]))
    .filter(Boolean)
  const pdfUrl = meta('citation_pdf_url') || fallback.pdfUrl
  const track = meta('DC.Type.articleType') || 'AAAI'

  return {
    title,
    abstract,
    authors: authors.length > 0 ? authors : fallback.authors,
    pdfUrl,
    track,
  }
}

function getMetaContent(html, name) {
  const tag = html.match(new RegExp(`<meta\\b(?=[^>]*\\bname="${escapeRegExp(name)}")[^>]*>`, 'i'))?.[0]

  if (!tag) {
    return ''
  }

  return decodeHtml(tag.match(/\bcontent="([^"]*)"/i)?.[1] ?? '')
}

function normalizeRecord(input) {
  const classification = classifyText([
    input.title,
    input.abstract,
    input.tldr,
    ...(input.keywords ?? []),
    input.track,
  ])
  const primaryCategory = classification.primaryCategory || 'mllm-foundations'
  const categories = classification.categories.length > 0
    ? classification.categories
    : [primaryCategory]
  const keywords = normalizeKeywords([
    ...(input.keywords ?? []),
    input.track,
    ...categories,
    input.source,
  ])

  return {
    id: input.id || `${input.source}-${slugify(input.title, input.sourceId ?? 'paper')}`,
    title: input.title,
    hookZh: input.hookZh,
    venue: input.venue,
    year: input.year ?? 2026,
    track: input.track || undefined,
    primaryCategory,
    categories,
    keywords,
    authors: normalizeAuthors(input.authors),
    openreviewUrl: input.openreviewUrl || input.url,
    pdfUrl: input.pdfUrl || undefined,
    tldr: input.tldr || '',
    abstract: input.abstract || '',
    aliases: Array.from(new Set((input.aliases ?? []).filter(Boolean).map(String))),
    source: input.source,
    sourceId: input.sourceId,
    guideStatus: input.introZh ? 'ready' : 'pending',
  }
}

function isRelevantTitle(title) {
  const normalized = normalizeText(title)
  const classification = classifyText([title])

  if (classification.focusScore > 0) {
    return true
  }

  return [
    'large language',
    'language model',
    'vision-language',
    'vision language',
    'multimodal',
    'multi-modal',
    'mllm',
    'vllm',
    'lv lm',
    'vla',
    'embodied',
    'world model',
  ].some((term) => normalized.includes(normalizeText(term)))
}

function mergeGuide(record, guideIndex) {
  const guide =
    guideIndex.byId.get(record.id) ??
    guideIndex.byTitle.get(normalizeText(record.title)) ??
    guideIndex.byUrl.get(record.openreviewUrl)

  if (!guide) {
    return record
  }

  return {
    ...record,
    titleZh: guide.titleZh,
    hookZh: guide.hookZh,
    introZh: guide.introZh,
    aliases: Array.from(new Set([...(record.aliases ?? []), ...(guide.aliases ?? [])])),
    guideStatus: 'ready',
  }
}

function buildGuideIndex(records) {
  const byId = new Map()
  const byTitle = new Map()
  const byUrl = new Map()

  for (const record of records) {
    if (record.id) byId.set(record.id, record)
    if (record.title) byTitle.set(normalizeText(record.title), record)
    if (record.openreviewUrl) byUrl.set(record.openreviewUrl, record)
  }

  return { byId, byTitle, byUrl }
}

function dedupeRecords(records) {
  const byKey = new Map()
  const usedIds = new Map()

  for (const record of records) {
    const key = `${record.venue}:${normalizeText(record.title)}`

    if (!record.title || byKey.has(key)) {
      continue
    }

    const count = usedIds.get(record.id) ?? 0
    usedIds.set(record.id, count + 1)
    byKey.set(key, {
      ...record,
      id: count === 0 ? record.id : `${record.id}-${count + 1}`,
    })
  }

  return Array.from(byKey.values())
}

async function fetchTextCached(url, cacheName) {
  const cachePath = join(cacheDir, cacheName)

  if (useCache) {
    try {
      return await readFile(cachePath, 'utf8')
    } catch {
      // Cache miss; fetch below.
    }
  }

  const text = await fetchText(url)
  await mkdir(dirname(cachePath), { recursive: true })
  await writeFile(cachePath, text, 'utf8')
  return text
}

async function fetchText(url, retries = 3) {
  let lastError

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'user-agent': USER_AGENT,
        },
      })

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      return await response.text()
    } catch (error) {
      lastError = error
      await sleep(600 * attempt)
    }
  }

  throw new Error(`Failed to fetch ${url}: ${lastError?.message ?? lastError}`)
}

async function mapLimit(items, limit, worker) {
  const output = new Array(items.length)
  let cursor = 0

  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      output[index] = await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return output
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function readJsonArray(path) {
  const payload = await readJson(path)
  return Array.isArray(payload) ? payload : payload.papers ?? []
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function normalizeKeywords(values) {
  return Array.from(
    new Set(
      values
        .filter(Boolean)
        .flatMap((value) => String(value).split(/[;,|]/))
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ).slice(0, 14)
}

function normalizeAuthors(authors) {
  if (Array.isArray(authors) && authors.length > 0) {
    return authors.map(String).map((author) => author.trim()).filter(Boolean)
  }

  if (typeof authors === 'string' && authors.trim()) {
    return authors.split(/[;,]/).map((author) => author.trim()).filter(Boolean)
  }

  return ['Unknown authors']
}

function cleanText(value = '') {
  return decodeHtml(String(value).replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeHtml(value = '') {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&ndash;/g, '-')
    .replace(/&mdash;/g, '-')
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&ldquo;/g, '"')
    .replace(/&rdquo;/g, '"')
    .replace(/&hellip;/g, '...')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function parseLimit(value) {
  if (value === undefined || value === 'all') {
    return Number.POSITIVE_INFINITY
  }

  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? number : Number.POSITIVE_INFINITY
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--mirror-out') {
      parsed.mirrorOut = argv[++index]
    } else if (arg === '--iclr') {
      parsed.iclr = argv[++index]
    } else if (arg === '--guides') {
      parsed.guides = argv[++index]
    } else if (arg === '--cache-dir') {
      parsed.cacheDir = argv[++index]
    } else if (arg === '--concurrency') {
      parsed.concurrency = argv[++index]
    } else if (arg === '--max-cvpr-details') {
      parsed.maxCvprDetails = argv[++index]
    } else if (arg === '--max-aaai-details') {
      parsed.maxAaaiDetails = argv[++index]
    } else if (arg === '--no-cache') {
      parsed.noCache = true
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
  node scripts/ingest-ccfa-2026.mjs [options]

Options:
  --out <path>                Public lazy JSON output. Default: public/data/papers.catalog.json.
  --mirror-out <path>         Workspace mirror output. Default: data/papers.catalog.json.
  --max-cvpr-details <n|all>  Cap CVPR detail-page fetches. Default: all title candidates.
  --max-aaai-details <n|all>  Cap AAAI detail-page fetches. Default: all title candidates.
  --concurrency <n>           Detail fetch concurrency. Default: 12.
  --no-cache                  Ignore cached HTML and refetch.
`)
  process.exit(0)
}
