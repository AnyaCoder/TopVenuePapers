import type { LexicalPaperResult, PaperMatchMeta } from '../composables/usePaperSearch'
import type { SemanticResult } from '../types/app'
import type { PaperCatalogIndexRecord } from '../types/paper'

interface HybridRankingOptions {
  papers: PaperCatalogIndexRecord[]
  semanticResults: SemanticResult[]
  lexicalResults: LexicalPaperResult[]
  semanticModel: string
}

export interface HybridPaperScore extends PaperMatchMeta {
  semanticScore?: number
  lexicalScore?: number
  rankScore: number
}

const RRF_K = 60

export function buildHybridRanking({
  papers,
  semanticResults,
  lexicalResults,
  semanticModel,
}: HybridRankingOptions) {
  const paperById = new Map(papers.map((paper) => [paper.id, paper]))
  const scores = new Map<string, HybridPaperScore>()

  semanticResults.forEach((result, index) => {
    if (!paperById.has(result.id)) {
      return
    }

    const score = ensureScore(scores, result.id)
    score.semanticScore = result.score
    score.rankScore += reciprocalRank(index)
    score.matchedSignals.push(semanticModel)
  })

  lexicalResults.forEach((result, index) => {
    if (!paperById.has(result.id)) {
      return
    }

    const score = ensureScore(scores, result.id)
    score.lexicalScore = result.score
    score.exactTitleMatch ||= result.exactTitleMatch
    score.rankScore += reciprocalRank(index) * lexicalWeight(result)

    for (const signal of result.matchedSignals) {
      if (!score.matchedSignals.includes(signal)) {
        score.matchedSignals.push(signal)
      }
    }
  })

  const ranked = Array.from(scores.entries())
    .map(([id, score]) => ({
      paper: paperById.get(id),
      score,
      seedIndex: papers.findIndex((paper) => paper.id === id),
    }))
    .filter((entry): entry is {
      paper: PaperCatalogIndexRecord
      score: HybridPaperScore
      seedIndex: number
    } => Boolean(entry.paper))
    .sort(
      (left, right) =>
        right.score.rankScore - left.score.rankScore ||
        (right.score.lexicalScore ?? 0) - (left.score.lexicalScore ?? 0) ||
        (right.score.semanticScore ?? 0) - (left.score.semanticScore ?? 0) ||
        left.seedIndex - right.seedIndex,
    )

  return {
    papers: ranked.map((entry) => entry.paper),
    matchesById: Object.fromEntries(
      ranked.map((entry) => [
        entry.paper.id,
        {
          score: entry.score.rankScore,
          exactTitleMatch: entry.score.exactTitleMatch,
          matchedSignals: entry.score.matchedSignals,
          semanticScore: entry.score.semanticScore,
          lexicalScore: entry.score.lexicalScore,
          rankScore: entry.score.rankScore,
        },
      ]),
    ) as Record<string, HybridPaperScore>,
  }
}

function ensureScore(scores: Map<string, HybridPaperScore>, id: string) {
  const existing = scores.get(id)

  if (existing) {
    return existing
  }

  const next: HybridPaperScore = {
    score: 0,
    rankScore: 0,
    exactTitleMatch: false,
    matchedSignals: [],
  }
  scores.set(id, next)
  return next
}

function reciprocalRank(index: number) {
  return 1 / (RRF_K + index + 1)
}

function lexicalWeight(result: LexicalPaperResult) {
  if (result.exactTitleMatch) {
    return 3.2
  }

  if (
    result.matchedSignals.some((signal) =>
      signal.includes('->') || signal === 'exact phrase' || signal === 'title contains query',
    )
  ) {
    return 2.6
  }

  if (result.score >= 80) {
    return 2
  }

  return 1.35
}
