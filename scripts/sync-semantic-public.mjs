#!/usr/bin/env node
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const args = parseArgs(process.argv.slice(2))
const sourceDir = args.from ?? 'data/semantic'
const targetDir = args.to ?? 'public/data/semantic'
const ignoredNames = new Set(['transformers-cache'])

await syncDirectory(sourceDir, targetDir)

console.log(`Synced semantic assets from ${sourceDir} to ${targetDir}.`)

async function syncDirectory(sourceDir, targetDir) {
  await mkdir(targetDir, { recursive: true })

  const [sourceEntries, targetEntries] = await Promise.all([
    readdir(sourceDir, { withFileTypes: true }),
    readdir(targetDir, { withFileTypes: true }).catch(() => []),
  ])

  const sourceNames = new Set(sourceEntries.map((entry) => entry.name))

  for (const entry of targetEntries) {
    if (sourceNames.has(entry.name) && !ignoredNames.has(entry.name)) {
      continue
    }

    await rm(join(targetDir, entry.name), {
      recursive: true,
      force: true,
    })
  }

  for (const entry of sourceEntries) {
    if (ignoredNames.has(entry.name)) {
      continue
    }

    const sourcePath = join(sourceDir, entry.name)
    const targetPath = join(targetDir, entry.name)

    if (entry.isDirectory()) {
      await syncDirectory(sourcePath, targetPath)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    await mkdir(targetDir, { recursive: true })
    await copyFile(sourcePath, targetPath)
  }
}

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
