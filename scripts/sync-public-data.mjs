#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

const jobs = [
  {
    from: 'data/unofficial/unofficial-papers.json',
    to: 'public/data/unofficial/unofficial-papers.json',
  },
]

for (const job of jobs) {
  await mkdir(dirname(job.to), { recursive: true })
  await copyFile(job.from, job.to)
  console.log(`Synced ${job.from} -> ${job.to}`)
}
