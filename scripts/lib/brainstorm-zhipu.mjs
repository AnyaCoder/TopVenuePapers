import {
  createZhipuClient,
  extractMessageText,
  tryParseJsonBlock,
  zhipuChat,
} from './zhipu-client.mjs'

const DEFAULT_MODEL = 'glm-4.5-flash'

export function getBrainstormBackendStatus() {
  const available = Boolean(process.env.ZHIPU_API_KEY?.trim())
  const model = process.env.ZHIPU_MODEL || DEFAULT_MODEL

  return {
    available,
    model,
    message: available
      ? `Secure Zhipu refinement is ready on this server with ${model}.`
      : 'Secure AI refinement is offline here. Add ZHIPU_API_KEY on the server to enable it.',
  }
}

export async function enhanceBrainstormDraft(payload = {}) {
  const status = getBrainstormBackendStatus()

  if (!status.available) {
    throw new Error(status.message)
  }

  const draft = normalizeDraft(payload.draft)
  const papers = normalizePapers(payload.papers, draft.maxPapers)
  const requestedModel =
    typeof payload.model === 'string' && payload.model.trim()
      ? payload.model.trim()
      : status.model

  const client = createZhipuClient({ model: requestedModel })
  const response = await zhipuChat(client, {
    model: requestedModel,
    temperature: 0.2,
    messages: [
      {
        role: 'system',
        content:
          'You are a research copilot. Return JSON only. Ground your answer in the supplied idea and related papers. Do not invent citations beyond the provided list.',
      },
      {
        role: 'user',
        content: buildPrompt(draft, papers),
      },
    ],
  })

  const text = extractMessageText(response)
  const parsed = tryParseJsonBlock(text)

  if (!parsed) {
    throw new Error('Zhipu did not return valid JSON for the brainstorm refinement.')
  }

  return {
    refinedProblem: String(parsed.refinedProblem || '').trim(),
    methodModules: normalizeStringList(parsed.methodModules),
    experimentPlan: normalizeStringList(parsed.experimentPlan),
    noveltyAngles: normalizeStringList(parsed.noveltyAngles),
    risks: normalizeStringList(parsed.risks),
    model: requestedModel,
    generatedAt: new Date().toISOString(),
  }
}

function normalizeDraft(value) {
  const draft = value && typeof value === 'object' ? value : {}

  return {
    background: String(draft.background || '').trim(),
    idea: String(draft.idea || '').trim(),
    constraints: String(draft.constraints || '').trim(),
    maxPapers: clampNumber(draft.maxPapers, 1, 20),
  }
}

function normalizePapers(value, maxPapers) {
  if (!Array.isArray(value)) {
    return []
  }

  return value.slice(0, maxPapers).map((paper) => ({
    title: String(paper?.title || '').trim(),
    venue: String(paper?.venue || '').trim(),
    year: Number.isFinite(Number(paper?.year)) ? Number(paper.year) : undefined,
    keywords: Array.isArray(paper?.keywords)
      ? paper.keywords.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
      : [],
    abstract: String(paper?.abstract || '').trim(),
    hookZh: String(paper?.hookZh || '').trim(),
  }))
}

function buildPrompt(draft, papers) {
  return `
You are helping a researcher sharpen a paper idea.

Idea background:
${draft.background || 'Not provided.'}

Idea sketch:
${draft.idea || 'Not provided.'}

Constraints:
${draft.constraints || 'Not provided.'}

Related papers:
${JSON.stringify(papers, null, 2)}

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

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(Number(value))) {
    return min
  }

  return Math.min(Math.max(Math.trunc(Number(value)), min), max)
}
