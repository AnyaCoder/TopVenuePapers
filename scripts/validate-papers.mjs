#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { categoryKeys, introKeys } from './lib/paper-taxonomy.mjs'

const args = parseArgs(process.argv.slice(2))
const inputFile = args.input ?? 'public/data/papers.catalog.json'
const requireRecords = Boolean(args.requireRecords)
const strict = Boolean(args.strict)

const records = await readRecords(inputFile)
const errors = validateRecords(records, { requireRecords, strict })

if (errors.length > 0) {
  console.error(`Found ${errors.length} validation issue(s):`)
  errors.forEach((error) => console.error(`- ${error}`))
  process.exit(1)
}

console.log(`Validated ${records.length} paper record(s).`)

async function readRecords(path) {
  const text = await readFile(path, 'utf8')

  if (path.endsWith('.json')) {
    const parsed = JSON.parse(text)
    return parsed.papers ?? parsed
  }

  const match = text.match(/export\s+const\s+\w+\s*=\s*([\s\S]*?)\s+satisfies\s+PaperRecord\[\]/)

  if (!match?.[1]) {
    throw new Error(`Could not find generated PaperRecord array in ${path}`)
  }

  return JSON.parse(match[1])
}

function validateRecords(records, options) {
  const errors = []
  const seenIds = new Set()

  if (!Array.isArray(records)) {
    return ['Input must be an array or an object with a papers array.']
  }

  if (options.requireRecords && records.length === 0) {
    errors.push('Expected at least one paper record.')
  }

  records.forEach((paper, index) => {
    const label = paper.title ? `"${paper.title}"` : `record ${index}`

    for (const key of ['id', 'title', 'venue', 'primaryCategory', 'openreviewUrl', 'abstract']) {
      if (!paper[key] || typeof paper[key] !== 'string') {
        errors.push(`${label}: missing string field ${key}`)
      }
    }

    if (paper.id && seenIds.has(paper.id)) {
      errors.push(`${label}: duplicate id ${paper.id}`)
    }
    seenIds.add(paper.id)

    if (!categoryKeys.has(paper.primaryCategory)) {
      errors.push(`${label}: invalid primaryCategory ${paper.primaryCategory}`)
    }

    if (!Array.isArray(paper.categories) || paper.categories.length === 0) {
      errors.push(`${label}: categories must be a non-empty array`)
    } else {
      paper.categories.forEach((category) => {
        if (!categoryKeys.has(category)) {
          errors.push(`${label}: invalid category ${category}`)
        }
      })
    }

    if (!Array.isArray(paper.authors) || paper.authors.length === 0) {
      errors.push(`${label}: authors must be a non-empty array`)
    }

    if (!Array.isArray(paper.keywords) || paper.keywords.length === 0) {
      errors.push(`${label}: keywords must be a non-empty array`)
    }

    if (paper.introZh && typeof paper.introZh !== 'object') {
      errors.push(`${label}: introZh must be an object when present`)
    } else if (paper.introZh) {
      introKeys.forEach((key) => {
        if (!paper.introZh[key] || typeof paper.introZh[key] !== 'string') {
          errors.push(`${label}: missing introZh.${key}`)
        }
      })
    } else if (options.requireGuides) {
      errors.push(`${label}: introZh is required`)
    }

    for (const key of ['openreviewUrl', 'pdfUrl']) {
      if (paper[key] && !isValidUrl(paper[key])) {
        errors.push(`${label}: ${key} is not a valid URL`)
      }
    }

    if (options.strict) {
      const serialized = JSON.stringify(paper)
      if (serialized.includes('待生成') || serialized.includes('TODO')) {
        errors.push(`${label}: contains placeholder text`)
      }
    }
  })

  return errors
}

function isValidUrl(value) {
  try {
    new URL(value)
    return true
  } catch {
    return false
  }
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--input') {
      parsed.input = argv[++index]
    } else if (arg === '--require-records') {
      parsed.requireRecords = true
    } else if (arg === '--require-guides') {
      parsed.requireGuides = true
    } else if (arg === '--strict') {
      parsed.strict = true
    } else if (arg === '--help') {
      printHelpAndExit()
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}

function printHelpAndExit() {
  console.log(`
Usage:
  node scripts/validate-papers.mjs [options]

Options:
  --input <path>       JSON or generated TS module. Default: public/data/papers.catalog.json.
  --require-records    Fail when the input has no records.
  --require-guides     Fail when records do not have introZh guides.
  --strict             Fail on common placeholder text.
`)
  process.exit(0)
}
