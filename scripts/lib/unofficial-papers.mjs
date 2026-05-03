import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { classifyText, normalizeText, slugify } from './paper-taxonomy.mjs'

export const UNCLASSIFIED_VENUE = '未分类 / Unclassified'
export const unofficialStatusRank = {
  ignored: 0,
  candidate: 1,
  accepted: 2,
  'officially-published': 3,
}

const NON_MAIN_VENUE_PATTERN =
  /\b(findings|workshop|tutorial|demo|challenge|shared task|short paper|industry track|system demo|poster session|competition|dataset track)\b/i

const VENUE_RULES = [
  { pattern: /\baaai(?:-?26|\s+2026)?\b/i, venue: 'AAAI', year: 2026 },
  { pattern: /\bacl(?:-?26|\s+2026)?\b/i, venue: 'ACL 2026', year: 2026 },
  { pattern: /\bemnlp(?:-?26|\s+2026)?\b/i, venue: 'EMNLP 2026', year: 2026 },
  { pattern: /\biccv(?:-?26|\s+2026)?\b/i, venue: 'ICCV 2026', year: 2026 },
  { pattern: /\biclr(?:-?26|\s+2026)?\b/i, venue: 'ICLR 2026', year: 2026 },
  { pattern: /\bicml(?:-?26|\s+2026)?\b/i, venue: 'ICML 2026', year: 2026 },
  { pattern: /\bijcai(?:-?26|\s+2026)?\b/i, venue: 'IJCAI 2026', year: 2026 },
  { pattern: /\bkdd(?:-?26|\s+2026)?\b/i, venue: 'KDD 2026', year: 2026 },
  { pattern: /\bcolm(?:-?26|\s+2026)?\b/i, venue: 'COLM 2026', year: 2026 },
  { pattern: /\bcvpr(?:-?26|\s+2026)?\b/i, venue: 'CVPR 2026', year: 2026 },
  { pattern: /\bmm(?:-?26|\s+2026)?\b/i, venue: 'MM 2026', year: 2026 },
  { pattern: /\bneurips?(?:-?26|\s+2026)?\b/i, venue: 'NeurIPS 2026', year: 2026 },
  { pattern: /\bsigir(?:-?26|\s+2026)?\b/i, venue: 'SIGIR 2026', year: 2026 },
  { pattern: /\bwww(?:-?26|\s+2026)?\b/i, venue: 'WWW 2026', year: 2026 },
]

export async function readUnofficialStore(path) {
  try {
    const payload = JSON.parse(await readFile(path, 'utf8'))
    return {
      version: 1,
      generatedAt: payload.generatedAt ?? '',
      papers: Array.isArray(payload.papers) ? payload.papers : [],
      notes: Array.isArray(payload.notes) ? payload.notes : [],
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error
    }

    return {
      version: 1,
      generatedAt: '',
      papers: [],
      notes: [],
    }
  }
}

export async function writeUnofficialStore(path, payload) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(
    path,
    `${JSON.stringify(
      {
        version: 1,
        generatedAt: payload.generatedAt ?? new Date().toISOString(),
        notes: payload.notes ?? [],
        papers: payload.papers ?? [],
      },
      null,
      2,
    )}\n`,
    'utf8',
  )
}

export function buildOfficialTitleIndex(papers) {
  const index = new Map()

  for (const paper of papers) {
    const key = normalizeTitleKey(paper.title)

    if (key && !index.has(key)) {
      index.set(key, paper)
    }
  }

  return index
}

export function normalizeTitleKey(title) {
  return normalizeText(title)
}

export function normalizeAcceptedVenue(...values) {
  const joined = normalizeText(values.filter(Boolean).join(' '))

  if (!joined || NON_MAIN_VENUE_PATTERN.test(joined)) {
    return null
  }

  for (const rule of VENUE_RULES) {
    if (rule.pattern.test(joined)) {
      return {
        venue: rule.venue,
        year: rule.year,
      }
    }
  }

  return null
}

export function materializeUnofficialCatalogRecords(entries, officialPapers = []) {
  const officialIndex = buildOfficialTitleIndex(
    officialPapers.filter((paper) => paper.sourceType !== 'unofficial'),
  )

  return entries
    .filter((entry) => unofficialStatusRank[entry.status] >= unofficialStatusRank.candidate)
    .filter((entry) => entry.status !== 'officially-published')
    .filter((entry) => !officialIndex.has(normalizeTitleKey(entry.title)))
    .map((entry) => buildUnofficialPaperRecord(entry))
}

export function buildUnofficialPaperRecord(entry) {
  const classification = classifyText([
    entry.title,
    entry.summary,
    entry.abstract,
    entry.reason,
    ...(entry.keywords ?? []),
    entry.acceptedVenue,
  ])

  const primaryCategory = classification.primaryCategory || 'mllm-foundations'
  const categories =
    classification.categories.length > 0
      ? classification.categories
      : [primaryCategory]
  const platforms = uniqueStrings([
    ...(entry.platforms ?? []),
    ...(entry.evidence ?? []).map((item) => item.platform),
  ])
  const openLink =
    entry.primaryUrl ||
    entry.canonicalUrl ||
    entry.acceptanceEvidence?.url ||
    entry.evidence?.find((item) => item.url)?.url

  if (!openLink) {
    throw new Error(`Unofficial paper "${entry.title}" is missing a primary URL.`)
  }

  const venue =
    entry.status === 'accepted' && entry.acceptedVenue
      ? entry.acceptedVenue
      : UNCLASSIFIED_VENUE

  const year =
    entry.status === 'accepted' && Number.isFinite(entry.acceptedYear)
      ? entry.acceptedYear
      : Number.isFinite(entry.year)
        ? entry.year
        : 2026

  return {
    id: entry.id ?? buildUnofficialId(entry.title),
    title: entry.title,
    titleZh: entry.titleZh || undefined,
    hookZh:
      entry.hookZh ||
      (entry.status === 'accepted'
        ? '社交媒体或个人主页已出现接收信号，正式会场页面尚未完全同步。'
        : '社交媒体或个人主页已出现论文信号，暂时还没有稳定的正式会议信息。'),
    venue,
    year,
    track:
      entry.status === 'accepted'
        ? 'Accepted signal pending official venue page'
        : 'Social/web discovery queue',
    primaryCategory,
    categories,
    keywords: uniqueStrings([
      ...(entry.keywords ?? []),
      ...(entry.acceptedVenue ? [entry.acceptedVenue] : []),
      ...platforms,
      'unofficial',
    ]).slice(0, 16),
    authors:
      Array.isArray(entry.authors) && entry.authors.length > 0
        ? entry.authors
        : ['Unknown authors'],
    openreviewUrl: openLink,
    pdfUrl: entry.pdfUrl || undefined,
    tldr: entry.summary || entry.reason || '',
    abstract:
      entry.abstract ||
      entry.summary ||
      entry.reason ||
      'Discovered from social or personal-page signals; a full abstract is not available yet.',
    aliases: uniqueStrings([
      entry.id,
      ...(entry.titleAliases ?? []),
      ...(entry.aliases ?? []),
    ]),
    source:
      entry.status === 'accepted'
        ? 'zhipu-social-accepted'
        : 'zhipu-social-candidate',
    sourceId: entry.sourceId ?? entry.id ?? buildUnofficialId(entry.title),
    guideStatus: 'pending',
    sourceType: 'unofficial',
    acceptanceStatus: entry.status === 'accepted' ? 'accepted' : 'candidate',
    acceptedVenue: entry.acceptedVenue || undefined,
    acceptedYear:
      Number.isFinite(entry.acceptedYear) ? entry.acceptedYear : undefined,
    discoveredAt: entry.discoveredAt || undefined,
    lastCheckedAt: entry.lastCheckedAt || undefined,
    evidenceCount:
      Number.isFinite(entry.evidenceCount)
        ? entry.evidenceCount
        : Array.isArray(entry.evidence)
          ? entry.evidence.length
          : 0,
    platforms,
  }
}

export function mergeUnofficialEntry(existing, incoming) {
  if (!existing) {
    return normalizeUnofficialEntry(incoming)
  }

  const nextStatus =
    unofficialStatusRank[incoming.status] > unofficialStatusRank[existing.status]
      ? incoming.status
      : existing.status

  const incomingVenueSignal = normalizeAcceptedVenue(
    incoming.acceptedVenue,
    incoming.reason,
    incoming.summary,
  )
  const shouldTrustIncomingAcceptance =
    !existing.acceptedVenue ||
    safeNumber(incoming.confidence) > safeNumber(existing.confidence) + 0.05 ||
    rankAcceptanceEvidence(incoming.acceptanceEvidence) >
      rankAcceptanceEvidence(existing.acceptanceEvidence)
  const acceptedVenue =
    shouldTrustIncomingAcceptance
      ? incoming.acceptedVenue || incomingVenueSignal?.venue || existing.acceptedVenue || undefined
      : existing.acceptedVenue || incoming.acceptedVenue || incomingVenueSignal?.venue || undefined

  const acceptedYear =
    shouldTrustIncomingAcceptance
      ? incoming.acceptedYear ?? incomingVenueSignal?.year ?? existing.acceptedYear ?? undefined
      : existing.acceptedYear ?? incoming.acceptedYear ?? incomingVenueSignal?.year ?? undefined

  return normalizeUnofficialEntry({
    ...existing,
    ...incoming,
    id: existing.id ?? incoming.id ?? buildUnofficialId(existing.title || incoming.title),
    title: pickBetterTitle(existing.title, incoming.title),
    titleZh: pickBetterText(existing.titleZh, incoming.titleZh),
    summary: pickBetterText(existing.summary, incoming.summary),
    abstract: pickBetterText(existing.abstract, incoming.abstract),
    reason: pickBetterText(existing.reason, incoming.reason),
    hookZh: pickBetterText(existing.hookZh, incoming.hookZh),
    canonicalUrl: incoming.canonicalUrl || existing.canonicalUrl,
    primaryUrl: incoming.primaryUrl || existing.primaryUrl,
    pdfUrl: incoming.pdfUrl || existing.pdfUrl,
    discoveredAt: existing.discoveredAt || incoming.discoveredAt,
    updatedAt: incoming.updatedAt || new Date().toISOString(),
    lastCheckedAt: incoming.lastCheckedAt || existing.lastCheckedAt,
    acceptedVenue,
    acceptedYear,
    status: nextStatus,
    confidence: Math.max(
      safeNumber(existing.confidence),
      safeNumber(incoming.confidence),
    ),
    keywords: uniqueStrings([...(existing.keywords ?? []), ...(incoming.keywords ?? [])]),
    titleAliases: uniqueStrings([
      ...(existing.titleAliases ?? []),
      ...(incoming.titleAliases ?? []),
    ]),
    aliases: uniqueStrings([...(existing.aliases ?? []), ...(incoming.aliases ?? [])]),
    authors: uniqueStrings([...(existing.authors ?? []), ...(incoming.authors ?? [])]),
    platforms: uniqueStrings([
      ...(existing.platforms ?? []),
      ...(incoming.platforms ?? []),
    ]),
    evidence: mergeEvidence(existing.evidence ?? [], incoming.evidence ?? []),
    evidenceCount: mergeEvidence(existing.evidence ?? [], incoming.evidence ?? []).length,
    acceptanceEvidence:
      rankAcceptanceEvidence(existing.acceptanceEvidence) >=
      rankAcceptanceEvidence(incoming.acceptanceEvidence)
        ? existing.acceptanceEvidence
        : incoming.acceptanceEvidence,
  })
}

export function normalizeUnofficialEntry(entry) {
  const id = entry.id || buildUnofficialId(entry.title)
  const platforms = uniqueStrings([
    ...(entry.platforms ?? []),
    ...(entry.evidence ?? []).map((item) => item.platform),
  ])
  const evidence = mergeEvidence([], entry.evidence ?? [])
  const normalizedVenue = normalizeAcceptedVenue(
    entry.acceptedVenue,
    entry.reason,
    entry.summary,
  )
  const acceptedVenue = entry.acceptedVenue || normalizedVenue?.venue || undefined
  const acceptedYear =
    Number.isFinite(entry.acceptedYear) && entry.acceptedYear > 0
      ? entry.acceptedYear
      : normalizedVenue?.year

  return {
    id,
    title: String(entry.title ?? '').trim(),
    titleZh: cleanOptionalText(entry.titleZh),
    summary: cleanOptionalText(entry.summary),
    abstract: cleanOptionalText(entry.abstract),
    reason: cleanOptionalText(entry.reason),
    hookZh: cleanOptionalText(entry.hookZh),
    primaryUrl: entry.primaryUrl || entry.canonicalUrl || evidence[0]?.url || '',
    canonicalUrl: entry.canonicalUrl || '',
    pdfUrl: entry.pdfUrl || '',
    sourceId: entry.sourceId || id,
    year: Number.isFinite(entry.year) ? entry.year : 2026,
    status:
      entry.status && Object.hasOwn(unofficialStatusRank, entry.status)
        ? entry.status
        : acceptedVenue
          ? 'accepted'
          : 'candidate',
    confidence: safeNumber(entry.confidence),
    acceptedVenue,
    acceptedYear,
    discoveredAt: entry.discoveredAt || new Date().toISOString(),
    updatedAt: entry.updatedAt || new Date().toISOString(),
    lastCheckedAt: entry.lastCheckedAt || '',
    authors: uniqueStrings(entry.authors ?? []),
    keywords: uniqueStrings(entry.keywords ?? []),
    titleAliases: uniqueStrings(entry.titleAliases ?? []),
    aliases: uniqueStrings(entry.aliases ?? []),
    platforms,
    evidence,
    evidenceCount: evidence.length,
    acceptanceEvidence: entry.acceptanceEvidence || undefined,
  }
}

export function buildUnofficialId(title) {
  const titleKey = normalizeTitleKey(title) || slugify(title, 'paper')
  const hash = createHash('sha1').update(titleKey).digest('hex').slice(0, 12)
  return `unofficial-${hash}`
}

function mergeEvidence(left, right) {
  const byKey = new Map()

  for (const item of [...left, ...right]) {
    if (!item?.url) {
      continue
    }

    const key = `${item.platform ?? 'web'}:${item.url}`
    const existing = byKey.get(key)

    byKey.set(key, {
      ...existing,
      ...item,
      platform: item.platform ?? existing?.platform ?? 'web',
      url: item.url,
      title: pickBetterText(existing?.title, item.title),
      author: pickBetterText(existing?.author, item.author),
      snippet: pickBetterText(existing?.snippet, item.snippet),
      readerTitle: pickBetterText(existing?.readerTitle, item.readerTitle),
      readerExcerpt: pickBetterText(existing?.readerExcerpt, item.readerExcerpt),
      publishDate: item.publishDate || existing?.publishDate || '',
      query: item.query || existing?.query || '',
    })
  }

  return Array.from(byKey.values())
}

function rankAcceptanceEvidence(value) {
  return safeNumber(value?.confidence)
}

function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter(Boolean)
        .map((value) => String(value).trim())
        .filter(Boolean),
    ),
  )
}

function cleanOptionalText(value) {
  const text = String(value ?? '').trim()
  return text || undefined
}

function pickBetterText(left, right) {
  const leftText = String(left ?? '').trim()
  const rightText = String(right ?? '').trim()

  if (!leftText) {
    return rightText || undefined
  }

  if (!rightText) {
    return leftText || undefined
  }

  return rightText.length > leftText.length ? rightText : leftText
}

function pickBetterTitle(left, right) {
  const leftText = String(left ?? '').trim()
  const rightText = String(right ?? '').trim()

  if (!leftText || !rightText) {
    return rightText || leftText || undefined
  }

  return titleQuality(rightText) >= titleQuality(leftText) ? rightText : leftText
}

function titleQuality(value) {
  const text = String(value ?? '').trim()
  let score = Math.min(text.length, 180)

  if (/github|official repo|official code/i.test(text)) {
    score -= 60
  }
  if (/^[`"“”‘’']|[`"“”‘’']$/.test(text)) {
    score -= 20
  }
  if (/for$|via$|with$|and$|of$|the$/i.test(text)) {
    score -= 80
  }
  if (/[.:?]$/.test(text)) {
    score += 6
  }

  return score
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}
