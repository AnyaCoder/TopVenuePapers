import type { UnofficialPaperEntry, UnofficialPaperStorePayload } from '../types/paper'

const WAITING_ZHIPU_PATTERN = /waiting for Zhipu enrichment|Discovery evidence found/i
const VENUE_PREFIX_PATTERN =
  /(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026/i

export function normalizeUnofficialStorePayload(
  payload: UnofficialPaperStorePayload | null,
): UnofficialPaperStorePayload | null {
  if (!payload) {
    return null
  }

  return {
    ...payload,
    papers: Array.isArray(payload.papers)
      ? payload.papers.map((paper) => normalizeUnofficialEntryForView(paper))
      : [],
  }
}

export function normalizeUnofficialEntryForView(entry: UnofficialPaperEntry): UnofficialPaperEntry {
  const metadataSource = normalizeMetadataSource(entry.metadataSource)
  const enrichmentStatus = inferUnofficialEnrichmentStatus({
    ...entry,
    metadataSource,
  })

  return {
    ...entry,
    metadataSource,
    enrichmentStatus,
  }
}

export function inferUnofficialEnrichmentStatus(
  entry: Pick<
    UnofficialPaperEntry,
    'title' | 'titleZh' | 'summary' | 'reason' | 'metadataSource' | 'enrichmentStatus'
  >,
) {
  const metadataSource = normalizeMetadataSource(entry.metadataSource)
  const joined = [entry.title, entry.titleZh, entry.summary, entry.reason]
    .filter(Boolean)
    .join(' ')

  if (WAITING_ZHIPU_PATTERN.test(joined)) {
    return 'provisional' as const
  }

  if (metadataSource === 'zhipu-chat') {
    return 'cleaned' as const
  }

  if (
    !metadataSource ||
    metadataSource === 'unknown' ||
    metadataSource === 'legacy-repaired' ||
    metadataSource === 'local-fallback'
  ) {
    return 'provisional' as const
  }

  return entry.enrichmentStatus === 'cleaned' ? 'cleaned' as const : 'provisional' as const
}

export function cleanDiscoveryTitle(value?: string) {
  const raw = String(value ?? '').trim()

  if (!raw) {
    return ''
  }

  const extracted =
    extractDiscoveryTitle(raw, /(?:accepted paper\s*:\s*|implementation of (?:Google'?s|Google)\s+)([A-Z][A-Za-z0-9+_.-]{2,100}(?::\s*[^.\n]{6,220})?)/i) ||
    extractDiscoveryTitle(raw, /\b([A-Z][A-Za-z0-9+_.-]{1,60}\s*\([^)]{6,180}\))/) ||
    extractDiscoveryTitle(raw, /\b([A-Z][A-Za-z0-9+_.-]{1,60}:\s*[^.\n]{8,220})/)

  const text = (extracted || raw)
    .replace(/^GitHub\s+-\s+[^:]+:\s*/i, '')
    .replace(/^\[?(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026\]?\s*/i, '')
    .replace(/^(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026\s+accepted paper\s*:\s*/i, '')
    .replace(/^code of\s+(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026\s+accepted paper\s*:\s*/i, '')
    .replace(/^(?:the\s+)?(?:official\s+)?(?:code|repository|repo|implementation)\s+(?:for|of)?\s*/i, '')
    .replace(/^this is the official implementation for\s*/i, '')
    .replace(/^this is the code repository for our paper\s*:?\s*/i, '')
    .replace(/^[A-Za-z0-9_-]+:\s*This is the official PyTorch implementation of\s*/i, '')
    .replace(/\s*##.*$/g, '')
    .replace(/\s+(?:This is the code repository|This is the official implementation|If you find our work useful|Please consider giving us|Abstract|As large language models|Accepted by|Accepted to)\b.*$/i, '')
    .replace(/\s+(?:we introduce|we propose|we present|we release)\b.*$/i, '')
    .replace(/\s+\b(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026\b.*$/i, '')
    .replace(/(?:;\s*)?waiting for Zhipu enrichment\.?$/i, '')
    .replace(/[?路|].*$/g, '')
    .replace(/[銆傦紱;锛?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!text || text.length < 4 || text.length > 220) {
    return ''
  }

  if (
    /^(?:GitHub|This is|Discovery evidence found|从项目页|该项目明确|没有提供)/i.test(text) ||
    /waiting for Zhipu enrichment|repository files navigation|go to file|table of contents/i.test(text)
  ) {
    return ''
  }

  if (!/[A-Za-z]/.test(text) && !/[\u4e00-\u9fff]/.test(text)) {
    return ''
  }

  if (text.length < 12 && !/^[A-Z][A-Za-z0-9+_.-]{2,40}$/.test(text)) {
    return ''
  }

  return text
}

export function isDisplayCleanUnofficialEntry(entry: UnofficialPaperEntry) {
  return inferUnofficialEnrichmentStatus(entry) === 'cleaned'
}

function extractDiscoveryTitle(value: string, pattern: RegExp) {
  const match = value.match(pattern)
  return match?.[1]?.trim() ?? ''
}

function normalizeMetadataSource(value?: string) {
  const normalized = String(value ?? '').trim()

  if (
    normalized === 'zhipu-chat' ||
    normalized === 'local-fallback' ||
    normalized === 'legacy-repaired' ||
    normalized === 'unknown'
  ) {
    return normalized
  }

  if (normalized && VENUE_PREFIX_PATTERN.test(normalized)) {
    return 'unknown'
  }

  return normalized ? 'unknown' : 'unknown'
}
