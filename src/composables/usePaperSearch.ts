import { computed, ref, type Ref } from 'vue'
import Fuse from 'fuse.js'
import { collectSemanticSignals } from '../data/semantic-dictionary'
import type { PaperRecord } from '../types/paper'
import { normalizeText, tokenize } from '../utils/normalize'

export interface PaperMatchMeta {
  score: number
  exactTitleMatch: boolean
  matchedSignals: string[]
}

export interface LexicalPaperResult {
  id: string
  score: number
  exactTitleMatch: boolean
  matchedSignals: string[]
}

interface SearchOutcome {
  papers: PaperRecord[]
  exactMatch?: PaperRecord
  semanticSignals: string[]
  matchesById: Record<string, PaperMatchMeta>
  lexicalResults: LexicalPaperResult[]
}

interface PreparedPaper {
  paper: PaperRecord
  index: number
  titleNorm: string
  titleZhNorm: string
  aliasNorms: string[]
  textBlobNorm: string
  keywordNorms: string[]
}

interface AcronymExpansion {
  acronym: string
  phrase: string
}

export function usePaperSearch(papers: Ref<PaperRecord[]>) {
  const query = ref('')

  const prepared = computed(() => preparePapers(papers.value))
  const acronymIndex = computed(() => buildAcronymIndex(prepared.value))
  const fuse = computed(() => buildFuse(prepared.value))

  const suggestionHints = [
    '3DGS',
    'Gaussian Splatting',
    'VLA embodied agent',
    'long context reasoning',
    'RAG memory',
  ]

  function searchLexical(rawQuery: string, limit = papers.value.length) {
    return rankPreparedPapers({
      rawQuery,
      papers: papers.value,
      prepared: prepared.value,
      fuse: fuse.value,
      acronymIndex: acronymIndex.value,
      limit,
    })
  }

  const outcome = computed<SearchOutcome>(() =>
    searchLexical(query.value, papers.value.length),
  )

  return {
    query,
    outcome,
    searchLexical,
    suggestionHints,
  }
}

function preparePapers(papers: PaperRecord[]) {
  return papers.map((paper, index): PreparedPaper => {
    const textBlob = [
      paper.title,
      paper.titleZh,
      paper.hookZh,
      paper.venue,
      (paper.keywords ?? []).join(' '),
      paper.aliases?.join(' '),
      Object.values(paper.introZh ?? {}).join(' '),
      paper.abstract,
      paper.tldr,
      (paper.categories ?? []).join(' '),
    ]
      .filter(Boolean)
      .join(' ')

    return {
      paper,
      index,
      titleNorm: normalizeText(paper.title),
      titleZhNorm: normalizeText(paper.titleZh ?? ''),
      aliasNorms: (paper.aliases ?? []).map((alias) => normalizeText(alias)),
      textBlobNorm: normalizeText(textBlob),
      keywordNorms: (paper.keywords ?? []).map((keyword) => normalizeText(keyword)),
    }
  })
}

function buildFuse(prepared: PreparedPaper[]) {
  return new Fuse(prepared, {
    includeScore: true,
    ignoreLocation: true,
    threshold: 0.34,
    keys: [
      { name: 'paper.title', weight: 4 },
      { name: 'paper.titleZh', weight: 3 },
      { name: 'paper.keywords', weight: 2 },
      { name: 'paper.aliases', weight: 2 },
      { name: 'paper.hookZh', weight: 1.4 },
      { name: 'paper.abstract', weight: 1 },
      { name: 'paper.tldr', weight: 1.2 },
    ],
  })
}

function rankPreparedPapers({
  rawQuery,
  papers,
  prepared,
  fuse,
  acronymIndex,
  limit,
}: {
  rawQuery: string
  papers: PaperRecord[]
  prepared: PreparedPaper[]
  fuse: Fuse<PreparedPaper>
  acronymIndex: Map<string, Map<string, number>>
  limit: number
}): SearchOutcome {
  const trimmedQuery = rawQuery.trim()

  if (!trimmedQuery) {
    return {
      papers,
      semanticSignals: [],
      matchesById: Object.fromEntries(
        papers.map((paper) => [
          paper.id,
          {
            score: 0,
            exactTitleMatch: false,
            matchedSignals: [],
          },
        ]),
      ),
      lexicalResults: [],
    }
  }

  const normalizedQuery = normalizeText(trimmedQuery)
  const queryTokens = tokenize(trimmedQuery)
  const semantic = collectSemanticSignals(trimmedQuery)
  const acronymExpansions = collectAcronymExpansions(trimmedQuery, acronymIndex)
  const baseScores = new Map<string, number>()

  fuse.search(trimmedQuery, { limit: papers.length }).forEach((result) => {
    const score = 1 - (result.score ?? 1)
    baseScores.set(result.item.paper.id, score * 100)
  })

  const ranked = prepared
    .map((entry) => scorePreparedPaper({
      entry,
      normalizedQuery,
      queryTokens,
      semantic,
      acronymExpansions,
      baseScore: baseScores.get(entry.paper.id) ?? 0,
    }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.seedIndex - right.seedIndex)

  const exactRanked = ranked.filter((entry) => entry.exactTitleMatch)
  const finalRanked = (exactRanked.length > 0 ? exactRanked : ranked).slice(
    0,
    Math.max(1, limit),
  )

  const matchesById = Object.fromEntries(
    finalRanked.map((entry) => [
      entry.paper.id,
      {
        score: entry.score,
        exactTitleMatch: entry.exactTitleMatch,
        matchedSignals: entry.matchedSignals,
      },
    ]),
  )

  return {
    papers: finalRanked.map((entry) => entry.paper),
    exactMatch: exactRanked[0]?.paper,
    semanticSignals: [
      ...semantic.labels,
      ...acronymExpansions.map(
        (expansion) => `${expansion.acronym.toUpperCase()} -> ${expansion.phrase}`,
      ),
    ],
    matchesById,
    lexicalResults: finalRanked.map((entry) => ({
      id: entry.paper.id,
      score: entry.score,
      exactTitleMatch: entry.exactTitleMatch,
      matchedSignals: entry.matchedSignals,
    })),
  }
}

function scorePreparedPaper({
  entry,
  normalizedQuery,
  queryTokens,
  semantic,
  acronymExpansions,
  baseScore,
}: {
  entry: PreparedPaper
  normalizedQuery: string
  queryTokens: string[]
  semantic: ReturnType<typeof collectSemanticSignals>
  acronymExpansions: AcronymExpansion[]
  baseScore: number
}) {
  let score = baseScore
  let exactTitleMatch = false
  const matchedSignals = new Set<string>()

  if (
    entry.titleNorm === normalizedQuery ||
    entry.titleZhNorm === normalizedQuery ||
    entry.aliasNorms.includes(normalizedQuery)
  ) {
    score += 240
    exactTitleMatch = true
    matchedSignals.add('exact title')
  }

  if (normalizedQuery && entry.titleNorm.includes(normalizedQuery)) {
    score += 70
    matchedSignals.add('title contains query')
  }

  if (normalizedQuery && entry.textBlobNorm.includes(normalizedQuery)) {
    score += 42
    matchedSignals.add('exact phrase')
  }

  const tokenHits = queryTokens.filter(
    (token) => token.length > 1 && entry.textBlobNorm.includes(token),
  )

  if (tokenHits.length > 0) {
    score += tokenHits.length * 14
    if (tokenHits.some((token) => entry.titleNorm.includes(token))) {
      score += 28
      matchedSignals.add('title token')
    }
  }

  const keywordHits = entry.keywordNorms.filter((keyword) =>
    normalizedQuery.includes(keyword) || keyword.includes(normalizedQuery),
  )

  if (keywordHits.length > 0) {
    score += keywordHits.length * 18
    matchedSignals.add('keyword')
  }

  const acronymHits = acronymExpansions.filter((expansion) =>
    entry.textBlobNorm.includes(expansion.phrase),
  )

  if (acronymHits.length > 0) {
    const titleHits = acronymHits.filter((expansion) =>
      entry.titleNorm.includes(expansion.phrase),
    )
    score += acronymHits.length * 92 + titleHits.length * 72
    acronymHits.slice(0, 3).forEach((expansion) => {
      matchedSignals.add(`${expansion.acronym.toUpperCase()} -> ${expansion.phrase}`)
    })
  }

  const categoryHits = (entry.paper.categories ?? []).filter((category) =>
    semantic.categories.has(category),
  )

  if (categoryHits.length > 0) {
    score += categoryHits.length * 24
    matchedSignals.add('semantic category')
  }

  const semanticTermHits = semantic.terms.filter(
    (term) => term.length > 1 && entry.textBlobNorm.includes(term),
  )

  if (semanticTermHits.length > 0) {
    score += semanticTermHits.length * 8
  }

  semantic.labels.forEach((label) => {
    if (semanticTermHits.length > 0 || categoryHits.length > 0) {
      matchedSignals.add(label)
    }
  })

  return {
    paper: entry.paper,
    score,
    exactTitleMatch,
    matchedSignals: Array.from(matchedSignals),
    seedIndex: entry.index,
  }
}

function buildAcronymIndex(entries: PreparedPaper[]) {
  const index = new Map<string, Map<string, number>>()

  for (const entry of entries) {
    const titleLikeText = [
      entry.paper.title,
      entry.paper.titleZh,
      entry.paper.hookZh,
      entry.paper.tldr,
      (entry.paper.keywords ?? []).join(' '),
      (entry.paper.categories ?? []).join(' '),
    ]
      .filter(Boolean)
      .join(' ')

    addParentheticalAcronyms(index, titleLikeText)
    addNgramAcronyms(index, titleLikeText)

    if (entry.paper.abstract) {
      addParentheticalAcronyms(index, entry.paper.abstract)
    }
  }

  return index
}

function collectAcronymExpansions(
  query: string,
  acronymIndex: Map<string, Map<string, number>>,
) {
  const seen = new Set<string>()
  const expansions: AcronymExpansion[] = []

  for (const token of tokenize(query)) {
    const acronym = normalizeAcronym(token)

    if (!isSearchableAcronym(acronym) || seen.has(acronym)) {
      continue
    }

    seen.add(acronym)
    const phraseCounts = acronymIndex.get(acronym)

    if (!phraseCounts) {
      continue
    }

    Array.from(phraseCounts.entries())
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .forEach(([phrase]) => {
        expansions.push({ acronym, phrase })
      })
  }

  return expansions
}

function addParentheticalAcronyms(index: Map<string, Map<string, number>>, text: string) {
  const normalizedSource = text.replace(/\s+/g, ' ')
  const longThenShortPattern = /([A-Za-z0-9][A-Za-z0-9+\-/ ]{4,96}?)\s*\(([A-Za-z0-9][A-Za-z0-9-]{1,14})\)/g
  const shortThenLongPattern = /([A-Za-z0-9][A-Za-z0-9-]{1,14})\s*\(([A-Za-z0-9][A-Za-z0-9+\-/ ]{4,96}?)\)/g

  for (const match of normalizedSource.matchAll(longThenShortPattern)) {
    addAcronymPhrase(index, match[2], trimPhrase(match[1]), 4)
  }

  for (const match of normalizedSource.matchAll(shortThenLongPattern)) {
    addAcronymPhrase(index, match[1], trimPhrase(match[2]), 4)
  }
}

function addNgramAcronyms(index: Map<string, Map<string, number>>, text: string) {
  const tokens = tokenize(text).filter((token) => token.length > 1)

  for (let start = 0; start < tokens.length; start += 1) {
    for (let size = 2; size <= 5 && start + size <= tokens.length; size += 1) {
      const phraseTokens = tokens.slice(start, start + size)

      if (phraseTokens.every((token) => stopWords.has(token))) {
        continue
      }

      const acronym = phraseToAcronym(phraseTokens)

      if (!isIndexableAcronym(acronym)) {
        continue
      }

      addAcronymPhrase(index, acronym, phraseTokens.join(' '), 1)
    }
  }
}

function addAcronymPhrase(
  index: Map<string, Map<string, number>>,
  rawAcronym: string,
  rawPhrase: string,
  weight: number,
) {
  const acronym = normalizeAcronym(rawAcronym)
  const phrase = normalizeText(rawPhrase)

  if (!isIndexableAcronym(acronym) || !isUsefulPhrase(phrase)) {
    return
  }

  const generated = phraseToAcronym(phrase.split(' '))
  const looseMatch =
    generated === acronym ||
    generated.includes(acronym) ||
    acronym.includes(generated)

  if (!looseMatch && weight >= 4) {
    return
  }

  const phraseCounts = index.get(acronym) ?? new Map<string, number>()
  phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + weight)
  index.set(acronym, phraseCounts)
}

function trimPhrase(value: string) {
  return value
    .split(/\s+/)
    .slice(-6)
    .join(' ')
    .replace(/^[,;:.\s-]+|[,;:.\s-]+$/g, '')
}

function phraseToAcronym(tokens: string[]) {
  return tokens
    .filter((token) => !stopWords.has(token))
    .map((token) => {
      const normalized = normalizeAcronym(token)
      const digitPrefix = normalized.match(/^\d+[a-z]?/)
      return digitPrefix ? digitPrefix[0] : normalized[0] ?? ''
    })
    .join('')
}

function normalizeAcronym(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

function isSearchableAcronym(value: string) {
  return value.length >= 2 && value.length <= 12 && /[a-z]/.test(value)
}

function isIndexableAcronym(value: string) {
  return isSearchableAcronym(value) && !stopWords.has(value)
}

function isUsefulPhrase(value: string) {
  const tokens = value.split(' ').filter(Boolean)
  return tokens.length >= 2 && tokens.some((token) => token.length > 2 && !stopWords.has(token))
}

const stopWords = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'by',
  'for',
  'from',
  'in',
  'into',
  'is',
  'of',
  'on',
  'or',
  'the',
  'to',
  'via',
  'with',
  'without',
])
