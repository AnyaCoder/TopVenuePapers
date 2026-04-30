#!/usr/bin/env node
import { copyFile, mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const sourceDir = args.from ?? 'data/semantic'
const targetDir = args.to ?? 'public/data/semantic'

await mkdir(targetDir, { recursive: true })
const entries = await readdir(sourceDir, { withFileTypes: true })

for (const entry of entries) {
  if (!entry.isFile()) {
    continue
  }

  await copyFile(join(sourceDir, entry.name), join(targetDir, entry.name))
}

console.log(`Synced semantic assets from ${sourceDir} to ${targetDir}.`)

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--from') {
      parsed.from = argv[++index]
    } else if (arg === '--to') {
      parsed.to = argv[++index]
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
  node scripts/sync-semantic-public.mjs [options]

Options:
  --from <dir>   Source semantic dir. Default: data/semantic.
  --to <dir>     Public semantic dir. Default: public/data/semantic.
`)
  process.exit(0)
}
