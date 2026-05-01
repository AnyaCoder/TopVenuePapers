import type { PaperCatalogIndexRecord } from '../types/paper'
import type { BrainstormDraft } from './brainstorm'

export interface BrainstormEnhancement {
  refinedProblem: string
  methodModules: string[]
  experimentPlan: string[]
  noveltyAngles: string[]
  risks: string[]
  model?: string
  generatedAt?: string
}

export interface BrainstormBackendStatus {
  available: boolean
  model: string
  message: string
}

export async function fetchBrainstormBackendStatus(apiBase: string) {
  const response = await fetch(`${trimTrailingSlash(apiBase)}/status`, {
    cache: 'no-store',
  })

  if (!response.ok) {
    const details = await safeReadJsonError(response)
    throw new Error(details || `Status request failed: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as BrainstormBackendStatus
}

export async function enhanceBrainstormWithBackend(options: {
  apiBase: string
  model?: string
  draft: BrainstormDraft
  papers: PaperCatalogIndexRecord[]
}) {
  const response = await fetch(`${trimTrailingSlash(options.apiBase)}/enhance`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: options.model || undefined,
      draft: options.draft,
      papers: options.papers,
    }),
  })

  if (!response.ok) {
    const details = await safeReadJsonError(response)
    throw new Error(
      details || `Brainstorm enhancement failed: ${response.status} ${response.statusText}`,
    )
  }

  return (await response.json()) as BrainstormEnhancement
}

async function safeReadJsonError(response: Response) {
  try {
    const payload = (await response.json()) as { error?: string; message?: string }
    return payload.error || payload.message || ''
  } catch {
    try {
      return await response.text()
    } catch {
      return ''
    }
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '')
}
