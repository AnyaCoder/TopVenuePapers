#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  buildPaperRecordFromGenerated,
  categoryDefinitions,
  introKeys,
} from './lib/paper-taxonomy.mjs'

const args = parseArgs(process.argv.slice(2))
const inputFile = args.input ?? 'data/openreview/iclr-2026-candidates.json'
const outFile = args.out ?? 'data/papers.generated.json'
const tsOutFile = args.tsOut
const model = args.model ?? process.env.OPENAI_MODEL ?? 'gpt-5'
const apiBase = (args.apiBase ?? process.env.OPENAI_API_BASE ?? 'https://api.openai.com/v1').replace(/\/$/, '')
const max = args.max ? Number(args.max) : Number.POSITIVE_INFINITY
const sleepMs = Number(args.sleep ?? 700)
const dryRun = Boolean(args.dryRun)
const apiKey = process.env.OPENAI_API_KEY

const candidatesPayload = JSON.parse(await readFile(inputFile, 'utf8'))
const candidates = (candidatesPayload.papers ?? candidatesPayload).slice(0, max)

if (dryRun) {
  console.log(buildPrompt(candidates[0]))
  process.exit(0)
}

if (!apiKey) {
  throw new Error('OPENAI_API_KEY is required. Use --dry-run to inspect the prompt without calling the API.')
}

const existingRecords = await readExistingRecords(outFile)
const recordsByTitle = new Map(existingRecords.map((record) => [record.title, record]))

for (const [index, candidate] of candidates.entries()) {
  if (recordsByTitle.has(candidate.title) && !args.force) {
    console.log(`${index + 1}/${candidates.length} skip existing: ${candidate.title}`)
    continue
  }

  console.log(`${index + 1}/${candidates.length} generating: ${candidate.title}`)
  const generated = await generateIntro(candidate)
  const record = buildPaperRecordFromGenerated(candidate, generated)
  recordsByTitle.set(candidate.title, record)

  const records = Array.from(recordsByTitle.values())
  await writeJson(outFile, records)
  if (tsOutFile) {
    await writeTsModule(tsOutFile, records)
  }
  await sleep(sleepMs)
}

console.log(`\nWrote ${outFile}`)
if (tsOutFile) {
  console.log(`Wrote ${tsOutFile}`)
}

async function generateIntro(candidate) {
  const response = await fetch(`${apiBase}/responses`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'system',
          content:
            '你是严谨的中文论文导读编辑。只基于用户提供的标题、摘要、TL;DR、关键词和分类信息写作，不编造论文中没有出现的实验结论。',
        },
        {
          role: 'user',
          content: buildPrompt(candidate),
        },
      ],
    }),
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`)
  }

  const body = await response.json()
  const text = extractResponseText(body)
  const parsed = parseJsonObject(text)
  validateGeneratedIntro(parsed)
  return parsed
}

function buildPrompt(candidate) {
  return `
请把下面这篇论文整理成网站可用的中文导读 JSON。

要求：
- 输出严格 JSON，不要 Markdown，不要解释。
- titleZh 要自然，不要逐词硬翻。
- hookZh 用一句中文说明这篇论文为什么值得点开。
- introZh 六个字段每个 1-2 句中文，避免空泛套话。
- 如果摘要没有明说，不要编造实验数字、方法细节或结论。
- primaryCategory 和 categories 必须从给定分类 key 中选择。

可选分类：
${categoryDefinitions.map((category) => `- ${category.key}: ${category.name}`).join('\n')}

输出 schema：
{
  "titleZh": "string",
  "hookZh": "string",
  "primaryCategory": "category-key",
  "categories": ["category-key"],
  "keywords": ["string"],
  "aliases": ["string"],
  "introZh": {
    "motivation": "string",
    "problem": "string",
    "analysis": "string",
    "method": "string",
    "experiment": "string",
    "contribution": "string"
  }
}

论文信息：
Title: ${candidate.title}
Venue: ${candidate.venue}
Primary area: ${candidate.primaryArea ?? ''}
OpenReview ID: ${candidate.openreviewId}
Authors: ${(candidate.authors ?? []).join(', ')}
Keywords: ${(candidate.keywords ?? []).join(', ')}
TL;DR: ${candidate.tldr ?? ''}
Abstract: ${candidate.abstract ?? ''}
Current category guess: ${candidate.primaryCategory}
`
}

function extractResponseText(body) {
  if (body.output_text) {
    return body.output_text
  }

  return (body.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((part) => part.text ?? part.content ?? '')
    .join('\n')
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text)
  } catch {
    const match = text.match(/\{[\s\S]*\}/)

    if (!match) {
      throw new Error(`Could not find JSON object in model output: ${text.slice(0, 240)}`)
    }

    return JSON.parse(match[0])
  }
}

function validateGeneratedIntro(value) {
  const missing = [
    'titleZh',
    'hookZh',
    'primaryCategory',
    'categories',
    'keywords',
    'introZh',
  ].filter((key) => value[key] === undefined)

  if (missing.length > 0) {
    throw new Error(`Generated JSON is missing keys: ${missing.join(', ')}`)
  }

  const missingIntro = introKeys.filter((key) => !value.introZh?.[key])

  if (missingIntro.length > 0) {
    throw new Error(`Generated introZh is missing keys: ${missingIntro.join(', ')}`)
  }
}

async function readExistingRecords(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      return []
    }

    throw error
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeTsModule(path, records) {
  await mkdir(dirname(path), { recursive: true })
  const source = `import type { PaperRecord } from '../types/paper'\n\nexport const generatedPapers = ${JSON.stringify(records, null, 2)} satisfies PaperRecord[]\n`
  await writeFile(path, source, 'utf8')
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--input') {
      parsed.input = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--ts-out') {
      parsed.tsOut = argv[++index]
    } else if (arg === '--model') {
      parsed.model = argv[++index]
    } else if (arg === '--api-base') {
      parsed.apiBase = argv[++index]
    } else if (arg === '--max') {
      parsed.max = argv[++index]
    } else if (arg === '--sleep') {
      parsed.sleep = argv[++index]
    } else if (arg === '--force') {
      parsed.force = true
    } else if (arg === '--dry-run') {
      parsed.dryRun = true
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
  OPENAI_API_KEY=... node scripts/generate-paper-intros.mjs [options]

Options:
  --input <path>      Ingested candidate JSON. Default: data/openreview/iclr-2026-candidates.json.
  --out <path>        Generated PaperRecord JSON. Default: data/papers.generated.json.
  --ts-out <path>     Optional legacy TS module output.
  --model <name>      OpenAI model. Default: OPENAI_MODEL or gpt-5.
  --max <n>           Generate only the first n candidates.
  --force             Regenerate existing records.
  --dry-run           Print the first prompt without calling the API.
`)
  process.exit(0)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
