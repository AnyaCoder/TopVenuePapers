#!/usr/bin/env node
import { spawn } from 'node:child_process'

const args = parseArgs(process.argv.slice(2))

const steps = [
  ['npm', ['run', 'papers:ingest:ccfa']],
  ['npm', ['run', 'catalog:shards']],
  ['npm', ['run', 'semantic:build:mirror']],
  ['npm', ['run', 'semantic:sync-public']],
  ['npm', ['run', 'papers:validate']],
]

if (args.withDiscovery) {
  steps.unshift(
    ['npm', ['run', 'papers:unofficial:discover']],
    ['npm', ['run', 'papers:unofficial:reconcile']],
  )
}

for (const [command, commandArgs] of steps) {
  console.log(`\n> ${command} ${commandArgs.join(' ')}`)
  await run(command, commandArgs)
}

console.log('\nRefresh pipeline completed.')

function run(command, commandArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      shell: true,
    })

    child.on('exit', (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`))
      }
    })
  })
}

function parseArgs(argv) {
  const parsed = {
    withDiscovery: false,
  }

  for (const arg of argv) {
    if (arg === '--with-discovery') {
      parsed.withDiscovery = true
    } else if (arg === '--help') {
      console.log(`
Usage:
  node scripts/refresh-pipeline.mjs [options]

Options:
  --with-discovery   Run unofficial discovery + reconciliation before rebuild.
`)
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}
