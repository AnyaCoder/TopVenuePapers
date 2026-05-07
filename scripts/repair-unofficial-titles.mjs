#!/usr/bin/env node
import { readUnofficialStore, writeUnofficialStore } from './lib/unofficial-papers.mjs'

const args = parseArgs(process.argv.slice(2))
const storePath = args.store ?? 'data/unofficial/unofficial-papers.json'

const store = await readUnofficialStore(storePath)
let touched = 0

for (const paper of store.papers) {
  const repaired = repairEntry(paper)

  if (!repaired) {
    continue
  }

  Object.assign(paper, repaired)
  touched += 1
}

await writeUnofficialStore(storePath, store)

console.log(`Repaired ${touched} unofficial paper entries.`)
console.log(`Wrote ${storePath}`)

function repairEntry(paper) {
  const title = deriveTitleFromEvidence(paper)
  const summary = deriveSummary(paper, title)
  const reason = deriveReason(paper, title)
  const patch = {}

  if (title && title !== paper.title) {
    patch.title = title
  }
  if (summary && summary !== paper.summary) {
    patch.summary = summary
  }
  if (reason && reason !== paper.reason) {
    patch.reason = reason
  }

  return Object.keys(patch).length > 0 ? patch : null
}

function deriveTitleFromEvidence(paper) {
  const evidence = Array.isArray(paper.evidence) ? paper.evidence : []

  for (const item of evidence) {
    for (const value of [item.readerTitle, item.title, item.snippet, item.readerExcerpt]) {
      const title = extractCleanTitle(value)
      if (title) {
        return title
      }
    }
  }

  return extractCleanTitle(paper.title) || ''
}

function extractCleanTitle(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()

  if (!text || /waiting for Zhipu enrichment|Discovery evidence found/i.test(text)) {
    return ''
  }

  const candidates = [
    text.match(/title=\{([^}]{8,220})\}/i)?.[1],
    text.match(/accepted paper\s*:\s*([^路\n]{8,220})/i)?.[1],
    text.match(/implementation of\s+"([^"\n]{8,220})"/i)?.[1],
    text.match(/implementation of\s+([A-Z][^.\n]{8,220})/i)?.[1],
    text.match(/([A-Z][A-Za-z0-9+_.-]{1,48}:\s*[^#\n]{8,220})/)?.[1],
    text.match(/GitHub\s+-\s+[^:]+:\s*\[[^\]]*(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)[^\]]*]\s*(?:The official code for |Official implementation for )?([^路\n]{8,220})/i)?.[1],
    text.match(/GitHub\s+-\s+[^:]+:\s*This is the official implementation for\s*([^路\n]{8,220})/i)?.[1],
    text.match(/(?:^| )([A-Z][A-Za-z0-9+_.-]{1,48}:\s*[^#\n]{8,220})\s+##\s+Abstract/i)?.[1],
    text.match(/(?:^| )([A-Z][A-Za-z0-9+_.-]{1,48}:\s*[^#\n]{8,220})\s+(?:This is the code repository|Abstract|As large language models|If you find our work useful)/i)?.[1],
  ]

  for (const candidate of candidates) {
    const cleaned = cleanCandidate(candidate)
    if (cleaned) {
      return cleaned
    }
  }

  return ''
}

function cleanCandidate(value) {
  const title = String(value ?? '')
    .replace(/\s*##.*$/g, '')
    .replace(/^\[?(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026\]?\s*/i, '')
    .replace(/^(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026\s+accepted paper\s*:\s*/i, '')
    .replace(/^accepted paper\s*:\s*/i, '')
    .replace(/^implementation of\s+/i, '')
    .replace(/^official implementation for\s*/i, '')
    .replace(/\s+(?:This is the code repository|This is the official implementation|If you find our work useful|Abstract|As large language models|Accepted by|Accepted to).*$/i, '')
    .replace(/^[A-Za-z0-9_-]+:\s*This is the official PyTorch implementation of\s*/i, '')
    .replace(/\s*;\s*waiting for Zhipu enrichment\.\s*$/i, '')
    .replace(/\s+[A-Z][A-Za-z.'-]+(?:\s+[A-Z][A-Za-z.'-]+){0,2},\s+[A-Z][A-Za-z.'-]+.*$/, '')
    .replace(/\s+\b(?:AAAI|ACL|EMNLP|CVPR|ICCV|ICLR|ICML|NeurIPS|SIGGRAPH|KDD|WWW|IJCAI|COLM|MM|SIGIR)\s*2026\b.*$/i, '')
    .replace(/\s+[?路|].*$/g, '')
    .replace(/[銆傦紱;锛?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (title.length < 8 || title.length > 220) {
    return ''
  }
  if (!/[A-Za-z]/.test(title)) {
    return ''
  }
  if (/^(?:GitHub|This is|From project|没有提供|该项目明确)/i.test(title)) {
    return ''
  }

  return title
}

function deriveSummary(paper, title) {
  if (!title) {
    return paper.summary
  }

  const venue = paper.acceptedVenue || '2026 top venue'
  return `Discovery evidence found an explicit ${venue} paper signal for ${title}; waiting for Zhipu enrichment.`
}

function deriveReason(paper, title) {
  if (!title) {
    return paper.reason
  }

  const venue = paper.acceptedVenue || '2026 top venue'
  return `Discovery evidence found an explicit ${venue} paper signal for ${title}; waiting for Zhipu enrichment.`
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--store') {
      parsed.store = argv[++index]
    } else if (arg === '--help') {
      console.log(`
Usage:
  node scripts/repair-unofficial-titles.mjs [options]

Options:
  --store <path>   Unofficial-paper store path.
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}
