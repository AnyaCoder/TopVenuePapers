import type { PaperCatalogIndexRecord } from '../types/paper'
import { normalizeText, tokenize } from './normalize'

export interface BrainstormDraft {
  background: string
  idea: string
  constraints: string
  maxPapers: number
}

export interface BrainstormPlan {
  query: string
  positioning: string[]
  methodBlueprint: string[]
  evaluationPlan: string[]
  noveltyAngles: string[]
  relatedSignals: string[]
}

export function buildBrainstormQuery(draft: BrainstormDraft) {
  return [draft.background, draft.idea, draft.constraints]
    .map((value) => value.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function rankPapersByTextQuery(
  papers: PaperCatalogIndexRecord[],
  query: string,
  maxPapers: number,
) {
  const normalizedQuery = normalizeText(query)
  const tokens = tokenize(query)

  return papers
    .map((paper, index) => {
      const text = normalizeText(
        [
          paper.title,
          paper.titleZh,
          paper.hookZh,
          paper.venue,
          paper.keywords.join(' '),
          paper.authors.join(' '),
        ]
          .filter(Boolean)
          .join(' '),
      )

      let score = 0

      if (text.includes(normalizedQuery)) {
        score += 160
      }

      score += tokens.filter((token) => token.length > 1 && text.includes(token)).length * 16

      if (paper.title && normalizeText(paper.title).includes(normalizedQuery)) {
        score += 40
      }

      return {
        paper,
        score,
        index,
      }
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, Math.max(1, maxPapers))
    .map((item) => item.paper)
}

export function buildLocalBrainstormPlan(
  draft: BrainstormDraft,
  papers: PaperCatalogIndexRecord[],
) {
  const topKeywords = topCounts(
    papers.flatMap((paper) => paper.keywords.slice(0, 6)),
    8,
  )
  const topVenues = topCounts(papers.map((paper) => paper.venue), 4)
  const anchorTitles = papers.slice(0, 3).map((paper) => paper.title)
  const categories = topCounts(papers.map((paper) => humanizeCategoryKey(paper.primaryCategory)), 5)

  return {
    query: buildBrainstormQuery(draft),
    positioning: [
      `Problem frame: ${draft.background.trim() || 'Define the practical setting and failure case clearly.'}`,
      `Core idea: ${draft.idea.trim() || 'State the central hypothesis in one sentence.'}`,
      `Closest literature cluster: ${anchorTitles.join(' | ') || 'No close papers yet.'}`,
      `Recurring neighborhoods: ${categories.join(', ') || 'mixed topics'}.`,
    ],
    methodBlueprint: [
      `Build a simple baseline first, then add one main mechanism around ${topKeywords[0] || 'reasoning'} to isolate gains.`,
      `Use the first related paper as an anchor baseline and the second or third paper as design inspiration for ablations.`,
      `Translate the idea into 3 modules: representation, inference/training, and verification; keep each module measurable.`,
      `Treat constraints as design guards: ${draft.constraints.trim() || 'latency, data, and annotation budget should stay explicit.'}`,
    ],
    evaluationPlan: [
      `Benchmark against papers from ${topVenues.join(', ') || 'the same venue cluster'} with one matched baseline and one stronger reference.`,
      `Report task quality, robustness, and cost together instead of only a single headline score.`,
      `Add 2-3 ablations around ${topKeywords.slice(0, 3).join(', ') || 'the core mechanism'} to show what actually matters.`,
      'Prepare one failure-analysis section before writing the final method story.',
    ],
    noveltyAngles: [
      `Novelty angle 1: tighten the scope around ${categories[0] || 'the main subfield'} instead of claiming a universal solution.`,
      `Novelty angle 2: connect ${topKeywords.slice(0, 2).join(' + ') || 'two recurring signals'} into one cleaner method contribution.`,
      'Novelty angle 3: emphasize evaluation protocol or deployment constraint if the modeling idea alone is too crowded.',
    ],
    relatedSignals: [...categories, ...topKeywords].slice(0, 8),
  }
}

function topCounts(values: string[], limit: number) {
  const counter = new Map<string, number>()

  for (const value of values) {
    const cleaned = String(value ?? '').trim()

    if (!cleaned) {
      continue
    }

    counter.set(cleaned, (counter.get(cleaned) ?? 0) + 1)
  }

  return Array.from(counter.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value)
}

function humanizeCategoryKey(value: string) {
  return value
    .split('-')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}
