#!/usr/bin/env node
import { rm } from 'node:fs/promises'

const target = process.argv[2] ?? 'dist'

try {
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 200,
  })
  console.log(`Cleaned ${target}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  throw new Error(
    `Could not clean ${target}. If a local preview is serving from this folder, stop it first. ${message}`,
  )
}
