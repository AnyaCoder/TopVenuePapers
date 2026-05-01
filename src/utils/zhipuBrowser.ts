import type { PaperCatalogIndexRecord } from '../types/paper'
import type { BrainstormDraft } from './brainstorm'

export interface BrainstormEnhancement {
  refinedProblem: string
  methodModules: string[]
  experimentPlan: string[]
  noveltyAngles: string[]
  risks: string[]
}

const DEFAULT_API_BASE = 'https://open.bigmodel.cn/api/paas/v4'

export async function enhanceBrainstormWithZhipu(options: {
  apiKey: string
  model?: string
  apiBase?: string
  draft: BrainstormDraft
  papers: PaperCatalogIndexRecord[]
}) {
  const response = await fetch(`${options.apiBase || DEFAULT_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || 'glm-4.5-flash',
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            'You are a research copilot. Return JSON only. Ground your answer in the supplied idea and related papers. Do not invent citations beyond the provided list.',
        },
        {
          role: 'user',
          content: buildPrompt(options.draft, options.papers),
        },
      ],
    }),
  })

  if (!response.ok) {
    const details = await response.text().catch(() => '')
    throw new Error(`Zhipu request failed: ${response.status} ${response.statusText} ${details}`.trim())
  }

  const payload = await response.json()
  const text = extractMessageText(payload)
  const parsed = tryParseJsonBlock(text)

  if (!parsed) {
    throw new Error('Zhipu did not return valid JSON.')
  }

  return {
    refinedProblem: String(parsed.refinedProblem || '').trim(),
    methodModules: normalizeStringList(parsed.methodModules),
    experimentPlan: normalizeStringList(parsed.experimentPlan),
    noveltyAngles: normalizeStringList(parsed.noveltyAngles),
    risks: normalizeStringList(parsed.risks),
  } satisfies BrainstormEnhancement
}

function buildPrompt(draft: BrainstormDraft, papers: PaperCatalogIndexRecord[]) {
  const relatedPapers = papers.slice(0, draft.maxPapers).map((paper, index) => ({
    rank: index + 1,
    title: paper.title,
    venue: paper.venue,
    year: paper.year,
    keywords: paper.keywords.slice(0, 8),
    abstract: paper.abstract || '',
    hookZh: paper.hookZh || '',
  }))

  return `
You are helping a researcher sharpen a paper idea.

Idea background:
${draft.background || 'Not provided.'}

Idea sketch:
${draft.idea || 'Not provided.'}

Constraints:
${draft.constraints || 'Not provided.'}

Related papers:
${JSON.stringify(relatedPapers, null, 2)}

Return strict JSON:
{
  "refinedProblem": "one concise paragraph",
  "methodModules": ["module 1", "module 2", "module 3"],
  "experimentPlan": ["plan 1", "plan 2", "plan 3"],
  "noveltyAngles": ["angle 1", "angle 2", "angle 3"],
  "risks": ["risk 1", "risk 2", "risk 3"]
}
`.trim()
}

function extractMessageText(response: any) {
  const content = response?.choices?.[0]?.message?.content

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item
        }

        if (item?.type === 'text') {
          return item.text
        }

        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

function tryParseJsonBlock(text: string) {
  const trimmed = String(text ?? '').trim()

  if (!trimmed) {
    return null
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]

    if (fenced) {
      return JSON.parse(fenced)
    }

    const objectSlice = trimmed.match(/\{[\s\S]*\}$/)?.[0]
    if (objectSlice) {
      return JSON.parse(objectSlice)
    }

    return null
  }
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}
