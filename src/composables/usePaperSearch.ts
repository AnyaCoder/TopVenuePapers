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

interface SearchOutcome {
  papers: PaperRecord[]
  exactMatch?: PaperRecord
  semanticSignals: string[]
  matchesById: Record<string, PaperMatchMeta>
}

export function usePaperSearch(papers: Ref<PaperRecord[]>) {
  const query = ref('')

  const prepared = computed(() => {
    return papers.value.map((paper, index) => {
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
  })

  const fuse = computed(() => {
    return new Fuse(prepared.value, {
      includeScore: true,
      ignoreLocation: true,
      threshold: 0.34,
      keys: [
        'paper.title',
        'paper.titleZh',
        'paper.keywords',
        'paper.aliases',
        'paper.hookZh',
        'paper.abstract',
        'paper.tldr',
      ],
    })
  })

  const suggestionHints = [
    '具身',
    '长上下文推理',
    'computer use',
    '视频社交推理',
    'VLM 幻觉',
  ]

  const outcome = computed<SearchOutcome>(() => {
    const rawQuery = query.value.trim()
    const currentPapers = papers.value

    if (!rawQuery) {
      return {
        papers: currentPapers,
        semanticSignals: [],
        matchesById: Object.fromEntries(
          currentPapers.map((paper) => [
            paper.id,
            {
              score: 0,
              exactTitleMatch: false,
              matchedSignals: [],
            },
          ]),
        ),
      }
    }

    const normalizedQuery = normalizeText(rawQuery)
    const queryTokens = tokenize(rawQuery)
    const semantic = collectSemanticSignals(rawQuery)
    const baseScores = new Map<string, number>()
    const matchedSignalsById = new Map<string, Set<string>>()

    fuse.value.search(rawQuery, { limit: currentPapers.length }).forEach((result) => {
      const score = 1 - (result.score ?? 1)
      baseScores.set(result.item.paper.id, score * 100)
    })

    const ranked = prepared.value
      .map((entry) => {
        let score = baseScores.get(entry.paper.id) ?? 0
        let exactTitleMatch = false
        const matchedSignals = matchedSignalsById.get(entry.paper.id) ?? new Set<string>()

        if (
          entry.titleNorm === normalizedQuery ||
          entry.titleZhNorm === normalizedQuery ||
          entry.aliasNorms.includes(normalizedQuery)
        ) {
          score += 240
          exactTitleMatch = true
          matchedSignals.add('精确标题')
        }

        if (entry.titleNorm.includes(normalizedQuery) || entry.titleZhNorm.includes(normalizedQuery)) {
          score += 55
          matchedSignals.add('标题相关')
        }

        const tokenHits = queryTokens.filter(
          (token) => token.length > 1 && entry.textBlobNorm.includes(token),
        ).length

        if (tokenHits > 0) {
          score += tokenHits * 14
        }

        const keywordHits = entry.keywordNorms.filter((keyword) =>
          normalizedQuery.includes(keyword) || keyword.includes(normalizedQuery),
        ).length

        if (keywordHits > 0) {
          score += keywordHits * 18
          matchedSignals.add('关键词命中')
        }

        const categoryHits = (entry.paper.categories ?? []).filter((category) =>
          semantic.categories.has(category),
        )

        if (categoryHits.length > 0) {
          score += categoryHits.length * 24
          matchedSignals.add('语义分类')
        }

        const semanticTermHits = semantic.terms.filter(
          (term) => term.length > 1 && entry.textBlobNorm.includes(term),
        ).length

        if (semanticTermHits > 0) {
          score += semanticTermHits * 8
        }

        semantic.labels.forEach((label) => {
          if (semanticTermHits > 0 || categoryHits.length > 0) {
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
      })
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.seedIndex - right.seedIndex)

    const exactRanked = ranked.filter((entry) => entry.exactTitleMatch)
    const finalRanked = exactRanked.length > 0 ? exactRanked : ranked

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
      semanticSignals: semantic.labels,
      matchesById,
    }
  })

  return {
    query,
    outcome,
    suggestionHints,
  }
}
