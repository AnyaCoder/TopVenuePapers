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
      papers: Array.isArray(payload.papers)
        ? payload.papers.map((paper) => normalizeUnofficialEntry(paper))
        : [],
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
        papers: Array.isArray(payload.papers)
          ? payload.papers.map((paper) => normalizeUnofficialEntry(paper))
          : [],
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
    .filter((entry) => entry.enrichmentStatus !== 'provisional')
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

  const shouldPreferIncomingContent =
    (
      existing?.metadataSource === 'local-fallback' ||
      existing?.enrichmentStatus === 'provisional' ||
      isLegacyHeuristicEntry(existing)
    ) && (
      incoming?.metadataSource === 'zhipu-chat' ||
      !isLegacyHeuristicEntry(incoming)
    )
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
    title: shouldPreferIncomingContent
      ? incoming.title || existing.title
      : pickBetterTitle(existing.title, incoming.title),
    titleZh: shouldPreferIncomingContent
      ? incoming.titleZh || existing.titleZh
      : pickBetterText(existing.titleZh, incoming.titleZh),
    summary: shouldPreferIncomingContent
      ? incoming.summary || existing.summary
      : pickBetterText(existing.summary, incoming.summary),
    abstract: shouldPreferIncomingContent
      ? incoming.abstract || existing.abstract
      : pickBetterText(existing.abstract, incoming.abstract),
    reason: shouldPreferIncomingContent
      ? incoming.reason || existing.reason
      : pickBetterText(existing.reason, incoming.reason),
    hookZh: shouldPreferIncomingContent
      ? incoming.hookZh || existing.hookZh
      : pickBetterText(existing.hookZh, incoming.hookZh),
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
  const platforms = uniqueStrings([
    ...(entry.platforms ?? []),
    ...(entry.evidence ?? []).map((item) => item.platform),
  ])
  const evidence = mergeEvidence([], entry.evidence ?? [])
  const rawTitle = String(entry.title ?? '').trim()
  const title = pickCleanUnofficialTitle(entry, evidence) || rawTitle
  const id = entry.id || buildUnofficialId(title)
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
  const summary = sanitizeNarrativeText(entry.summary, {
    rawTitle,
    title,
    acceptedVenue,
  })
  const reason = sanitizeNarrativeText(entry.reason, {
    rawTitle,
    title,
    acceptedVenue,
  })
  const enrichmentStatus = inferEnrichmentStatus({
    ...entry,
    title,
    summary,
    reason,
  })
  const metadataSource = String(entry.metadataSource ?? '').trim() || (
    enrichmentStatus === 'provisional' ? 'legacy-repaired' : 'unknown'
  )

  return {
    id,
    title,
    titleZh: cleanOptionalText(entry.titleZh),
    summary: cleanOptionalText(summary),
    abstract: cleanOptionalText(entry.abstract),
    reason: cleanOptionalText(reason),
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
    enrichmentStatus,
    metadataSource,
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
  const leftText = cleanPaperTitleCandidate(left)
  const rightText = cleanPaperTitleCandidate(right)

  if (!leftText || !rightText) {
    return rightText || leftText || undefined
  }

  return titleQuality(rightText) >= titleQuality(leftText) ? rightText : leftText
}

function titleQuality(value) {
  const text = String(value ?? '').trim()
  let score = Math.min(text.length, 180)

  if (hasDirtyPaperTitleShape(text) || /github|official repo|official code/i.test(text)) {
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

function isLegacyHeuristicEntry(entry) {
  return /local high-confidence extraction/i.test(entry?.reason || '') ||
    /^bibtex\s+@/i.test(entry?.title || '') ||
    /\s##\s*$/.test(entry?.title || '')
}

function pickCleanUnofficialTitle(entry, evidence) {
  const rawTitle = String(entry?.title ?? '').trim()
  const directSources = [
    ...(evidence ?? []).flatMap((item) => [
      item.readerTitle,
      item.title,
    ]),
    rawTitle,
  ]
  const extractionSources = [
    rawTitle,
    entry?.reason,
    entry?.summary,
    ...(evidence ?? []).flatMap((item) => [
      item.readerTitle,
      item.title,
      item.snippet,
      item.readerExcerpt,
    ]),
  ]
  const candidates = []

  for (const value of directSources) {
    const text = String(value ?? '').trim()
    if (!text || /waiting for Zhipu enrichment|Discovery evidence found/i.test(text)) {
      continue
    }

    candidates.push(cleanPaperTitleCandidate(text))
  }

  for (const value of extractionSources) {
    const text = String(value ?? '').trim()
    if (!text || /waiting for Zhipu enrichment|Discovery evidence found/i.test(text)) {
      continue
    }

    candidates.push(...extractPaperTitleCandidates(text))
  }

  return uniqueStrings(candidates)
    .filter((title) => !hasDirtyPaperTitleShape(title))
    .sort((left, right) => titleQuality(right) - titleQuality(left))[0] || ''
}

function extractPaperTitleCandidates(value) {
  const text = stripTitleSourceNoise(value)
  const candidates = []
  const patterns = [
    /title\s*=\s*[{"]([^}"]{8,240})[}"]/gi,
    /标题为\s*([^。；;\n]{8,240})/g,
    /(?:^|\s)([A-Z][A-Za-z0-9+_.-]{1,48}:\s*[^#\n]{8,240})/g,
    /(?:paper|work|repository|repo|project page)(?:\s+(?:for|of|called|named))?\s*[:：]\s*([^#\n]{8,240})/gi,
    /^#{1,3}\s*([^#\n]{8,240})/gm,
    /GitHub\s+-\s+[^:]+:\s*([^·\n]{8,240})/gi,
  ]

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const title = cleanPaperTitleCandidate(match[1])
      if (title) {
        candidates.push(title)
      }
    }
  }

  return uniqueStrings(candidates)
}

function cleanPaperTitleCandidate(value) {
  const title = stripTitleSourceNoise(value)
    .replace(/^GitHub\s+-\s+[^:]+:\s*/i, '')
    .replace(/\[[^\]]*\b(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)[^\]]*\]\s*/gi, '')
    .replace(/\((?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)[-\s']*(?:2026|26)(?:\s+Main(?:\s+Conference)?)?\)\s*/gi, ' ')
    .replace(/^(?:the\s+)?(?:official\s+)?(?:code|repository|repo|implementation|project page)\s+(?:for|of)?\s*(?:our\s+)?(?:paper)?\s*:?\s*/i, '')
    .replace(/^this is the code repository for our paper\s*:?\s*/i, '')
    .replace(/^code of\s+(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)[-\s']*(?:2026|26)\s+accepted paper\s*:?\s*/i, '')
    .replace(/\s*[-|·]\s*GitHub\s*$/i, '')
    .replace(/\s*##.*$/g, '')
    .replace(/\s+\b(?:Abstract|Overview|Installation|Quickstart|Citation|News|Highlights)\b.*$/i, '')
    .replace(/\s+(?:This is the (?:code )?repository|This is the repo|If you find our work useful|Please consider giving us|The paper has been accepted|This work has been accepted)\b.*$/i, '')
    .replace(/\s+(?:We introduce|We propose|We present|We release|Accepted by|Accepted to)\b.*$/i, '')
    .replace(/\s+[πβ][^\x00-\x7F\S]*.*$/u, '')
    .replace(/\s+\p{Extended_Pictographic}.*$/u, '')
    .replace(/^this is the official implementation for\s*/i, '')
    .replace(/\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2},\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2}.*$/, '')
    .replace(/\s+\b(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)[-\s']*(?:2026|26)\b.*$/i, '')
    .replace(/[。；;，,]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (title.length < 8 || title.length > 220) {
    return ''
  }

  if (!/[a-zA-Z]/.test(title) || /^[^\p{L}\p{N}]*$/u.test(title)) {
    return ''
  }

  if (/^(?:the|this|official|code|repository|repo|paper|project page|accepted|main conference|conference|findings|poster|oral|pages?|figures?|subjects?)\b/i.test(title)) {
    return ''
  }

  if (/\b(?:for|via|with|and|of|the|from|to)$/i.test(title)) {
    return ''
  }

  return title
}

function stripTitleSourceNoise(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]+]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^[#>\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasDirtyPaperTitleShape(value) {
  const title = String(value ?? '').trim()

  if (!title || title.length > 260) {
    return true
  }

  return [
    /^github\s+-/i,
    /^bibtex\s+@/i,
    /\b(?:title|author|booktitle)\s*=\s*\{/i,
    /\s##\s*/i,
    /\b(?:repository files navigation|go to file|last commit|table of contents)\b/i,
    /\b(?:abstract|installation|quickstart|citation)\b/i,
    /\b(?:this is the (?:code )?repository|if you find our work useful|please consider giving us)\b/i,
    /\b(?:we introduce|we propose|we present|we release)\b/i,
    /waiting for Zhipu enrichment|Discovery evidence found/i,
    /\b(?:识别到|接收信号|标题为|被.*接收|是一个|通过.*提供|没有提供.*证据)\b/i,
    /^[\p{Script=Han}\s，。；：:]+$/u,
    /github\.io|github\.com|https?:\/\//i,
    /\p{Extended_Pictographic}/u,
  ].some((pattern) => pattern.test(title))
}

function sanitizeNarrativeText(value, context) {
  const text = String(value ?? '').trim()

  if (!text) {
    return undefined
  }

  const rawTitle = String(context.rawTitle ?? '').trim()
  const cleanTitle = String(context.title ?? '').trim()
  const hasCleanReplacement = cleanTitle && rawTitle && cleanTitle !== rawTitle

  if (hasCleanReplacement && text.includes(rawTitle)) {
    const updated = text.replaceAll(rawTitle, cleanTitle)
    return hasDirtyPaperTitleShape(updated)
      ? fallbackCleanNarrative(context)
      : updated
  }

  if (hasDirtyPaperTitleShape(text)) {
    return fallbackCleanNarrative(context)
  }

  return text
}

function fallbackCleanNarrative(context) {
  const title = String(context.title ?? '').trim()
  const venue = String(context.acceptedVenue ?? '').trim() || 'a 2026 top venue'

  if (!title) {
    return undefined
  }

  return `Discovery evidence found an explicit ${venue} paper signal for ${title}; waiting for Zhipu enrichment.`
}

function inferEnrichmentStatus(entry) {
  const metadataSource = String(entry.metadataSource ?? '').trim()
  const joined = [
    entry.title,
    entry.summary,
    entry.reason,
    entry.titleZh,
  ].filter(Boolean).join(' ')

  if (/waiting for Zhipu enrichment|Discovery evidence found/i.test(joined)) {
    return 'provisional'
  }

  if (metadataSource === 'zhipu-chat') {
    return 'cleaned'
  }

  return 'provisional'
}

function safeNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}
