import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const DEFAULT_CHUNK_DIR = 'chunks'
export const DEFAULT_CHUNK_PREFIX = 'paper-embeddings-all-MiniLM-L6-v2'
export const DEFAULT_CHUNK_ROWS = 512

export function paperToSemanticText(paper) {
  const fields = [
    paper.title,
    paper.titleZh,
    paper.venue,
    paper.track,
    (paper.keywords ?? []).join(' '),
    (paper.categories ?? []).join(' '),
    paper.tldr,
    paper.abstract,
    ...Object.values(paper.introZh ?? {}),
  ]

  return fields.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

export function hashSemanticText(text) {
  return createHash('sha1').update(text).digest('hex')
}

export function hashValues(values) {
  const hash = createHash('sha1')

  for (const value of values) {
    hash.update(String(value))
    hash.update('\n')
  }

  return hash.digest('hex')
}

export async function loadPreviousSemanticArtifacts({
  chunkMetaPath,
  metaPath,
  outPath,
}) {
  if (chunkMetaPath) {
    const chunked = await loadChunkedSemanticArtifacts(chunkMetaPath)

    if (chunked) {
      return chunked
    }
  }

  if (metaPath && outPath) {
    return loadLegacySemanticArtifacts(metaPath, outPath)
  }

  return null
}

export async function loadPreviousChunkManifest(path) {
  try {
    const text = await readFile(path, 'utf8')
    const meta = normalizeChunkedMeta(JSON.parse(text))

    if (meta?.format !== 'chunked-v1' || !Array.isArray(meta?.chunks)) {
      return null
    }

    return meta
  } catch {
    return null
  }
}

export async function loadSemanticSearchMatrix({
  chunkMetaPath,
  metaPath,
  outPath,
}) {
  const artifacts = await loadPreviousSemanticArtifacts({
    chunkMetaPath,
    metaPath,
    outPath,
  })

  if (!artifacts) {
    throw new Error('Semantic assets are missing. Build the semantic index first.')
  }

  return {
    meta: artifacts.meta,
    embeddings: artifacts.vectors,
  }
}

export function buildReusePlan({
  papers,
  texts,
  fingerprints,
  previousArtifacts,
  modelName,
}) {
  if (
    !previousArtifacts ||
    previousArtifacts.meta.model !== modelName ||
    !Array.isArray(previousArtifacts.meta.ids) ||
    !Array.isArray(previousArtifacts.meta.fingerprints)
  ) {
    return {
      reused: [],
      pending: papers.map((paper, index) => ({
        index,
        id: paper.id,
        text: texts[index],
      })),
    }
  }

  const previousIndex = new Map()
  const dimensions = previousArtifacts.meta.dimensions

  previousArtifacts.meta.ids.forEach((id, index) => {
    previousIndex.set(id, {
      index,
      fingerprint: previousArtifacts.meta.fingerprints[index],
    })
  })

  const reused = []
  const pending = []

  papers.forEach((paper, index) => {
    const previous = previousIndex.get(paper.id)

    if (previous && previous.fingerprint === fingerprints[index]) {
      const start = previous.index * dimensions
      const end = start + dimensions
      reused.push({
        index,
        vector: previousArtifacts.vectors.slice(start, end),
      })
      return
    }

    pending.push({
      index,
      id: paper.id,
      text: texts[index],
    })
  })

  return { reused, pending }
}

export function buildSemanticChunks({
  papers,
  vectors,
  dimensions,
  chunkPrefix = DEFAULT_CHUNK_PREFIX,
  chunkRows = DEFAULT_CHUNK_ROWS,
}) {
  const chunks = []
  const shardParts = new Map()
  let activeChunk = null

  for (let index = 0; index < papers.length; index += 1) {
    const paper = papers[index]
    const shardKey = paper.shardKey ?? `${paper.year}-${paper.venue}`

    if (
      !activeChunk ||
      activeChunk.key !== shardKey ||
      activeChunk.count >= chunkRows
    ) {
      const part = (shardParts.get(shardKey) ?? 0) + 1
      shardParts.set(shardKey, part)

      activeChunk = {
        key: shardKey,
        venue: paper.venue,
        year: paper.year,
        part,
        offset: index,
        count: 0,
        ids: [],
        fingerprints: [],
        rows: [],
      }
      chunks.push(activeChunk)
    }

    activeChunk.count += 1
    activeChunk.ids.push(paper.id)
    activeChunk.fingerprints.push(paper.semanticFingerprint)
    activeChunk.rows.push(vectors[index])
  }

  return chunks.map((chunk) => {
    const flat = new Float32Array(chunk.count * dimensions)
    chunk.rows.forEach((row, rowIndex) => {
      flat.set(row, rowIndex * dimensions)
    })

    const slug = slugifyChunkKey(chunk.key)
    const file = `${chunkPrefix}.${slug}.${String(chunk.part).padStart(3, '0')}.f32.bin`
    const fingerprint = hashValues([
      chunk.key,
      chunk.part,
      chunk.offset,
      chunk.count,
      dimensions,
      ...chunk.ids,
      ...chunk.fingerprints,
    ])

    return {
      key: chunk.key,
      venue: chunk.venue,
      year: chunk.year,
      part: chunk.part,
      offset: chunk.offset,
      count: chunk.count,
      dimensions,
      ids: chunk.ids,
      fingerprints: chunk.fingerprints,
      fingerprint,
      file,
      bytes: flat.byteLength,
      flat,
    }
  })
}

export async function writeSemanticChunks({
  chunks,
  chunkDir,
  previousMeta,
}) {
  await mkdir(chunkDir, { recursive: true })

  const keep = new Set(chunks.map((chunk) => chunk.file))
  const entries = await readdir(chunkDir, { withFileTypes: true }).catch(() => [])

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue
    }

    if (!keep.has(entry.name)) {
      await rm(join(chunkDir, entry.name), { force: true })
    }
  }

  const previousChunks = new Map(
    (previousMeta?.chunks ?? []).map((chunk) => [chunk.file, chunk]),
  )
  let written = 0
  let reused = 0

  for (const chunk of chunks) {
    const previous = previousChunks.get(chunk.file)
    const unchanged =
      previous &&
      previous.key === chunk.key &&
      previous.part === chunk.part &&
      previous.offset === chunk.offset &&
      previous.count === chunk.count &&
      previous.dimensions === chunk.dimensions &&
      previous.fingerprint === chunk.fingerprint

    if (unchanged) {
      reused += 1
      continue
    }

    await writeFile(join(chunkDir, chunk.file), Buffer.from(chunk.flat.buffer))
    written += 1
  }

  return { written, reused, count: chunks.length }
}

export async function removeSemanticLegacyArtifacts({
  metaPath,
  outPath,
}) {
  await Promise.all([
    rm(metaPath, { force: true }).catch(() => undefined),
    rm(outPath, { force: true }).catch(() => undefined),
  ])
}

export async function writeSemanticMeta(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

export function flattenVectors(vectors, dimensions) {
  const flat = new Float32Array(vectors.length * dimensions)
  vectors.forEach((vector, row) => {
    flat.set(vector, row * dimensions)
  })
  return flat
}

export function buildLegacyMeta({
  modelName,
  catalogPath,
  payload,
  papers,
  dimensions,
  fingerprints,
}) {
  return {
    model: modelName,
    task: 'feature-extraction',
    catalog: catalogPath,
    catalogGeneratedAt: payload.generatedAt ?? null,
    count: papers.length,
    dimensions,
    normalized: true,
    ids: papers.map((paper) => paper.id),
    titles: papers.map((paper) => paper.title),
    fingerprints,
  }
}

export function buildChunkedMeta({
  modelName,
  catalogPath,
  payload,
  papers,
  dimensions,
  chunks,
  chunkRows = DEFAULT_CHUNK_ROWS,
}) {
  return {
    format: 'chunked-v1',
    model: modelName,
    task: 'feature-extraction',
    catalog: catalogPath,
    catalogGeneratedAt: payload.generatedAt ?? null,
    count: papers.length,
    dimensions,
    normalized: true,
    chunkRows,
    ids: papers.map((paper) => paper.id),
    fingerprints: papers.map((paper) => paper.semanticFingerprint),
    chunks: chunks.map((chunk) => ({
      key: chunk.key,
      venue: chunk.venue,
      year: chunk.year,
      part: chunk.part,
      offset: chunk.offset,
      count: chunk.count,
      dimensions: chunk.dimensions,
      file: chunk.file,
      bytes: chunk.bytes,
      fingerprint: chunk.fingerprint,
    })),
  }
}

export function normalizeChunkedMeta(meta) {
  if (meta?.format !== 'chunked-v1' || !Array.isArray(meta.chunks)) {
    return meta
  }

  const ids = []
  const fingerprints = []
  const titles = Array.isArray(meta.titles) ? meta.titles : undefined

  if (Array.isArray(meta.ids) && meta.ids.length > 0) {
    ids.push(...meta.ids)
  } else {
    for (const chunk of meta.chunks) {
      ids.push(...(chunk.ids ?? []))
    }
  }

  if (Array.isArray(meta.fingerprints) && meta.fingerprints.length > 0) {
    fingerprints.push(...meta.fingerprints)
  } else {
    for (const chunk of meta.chunks) {
      fingerprints.push(...(chunk.fingerprints ?? []))
    }
  }

  return {
    ...meta,
    ids,
    fingerprints,
    ...(titles ? { titles } : {}),
  }
}

async function loadLegacySemanticArtifacts(metaPath, outPath) {
  try {
    const [metaText, binary] = await Promise.all([
      readFile(metaPath, 'utf8'),
      readFile(outPath),
    ])
    const meta = JSON.parse(metaText)

    if (!meta?.count || !meta?.dimensions) {
      return null
    }

    return {
      meta,
      vectors: new Float32Array(
        binary.buffer,
        binary.byteOffset,
        binary.byteLength / Float32Array.BYTES_PER_ELEMENT,
      ),
    }
  } catch {
    return null
  }
}

async function loadChunkedSemanticArtifacts(chunkMetaPath) {
  const meta = await loadPreviousChunkManifest(chunkMetaPath)

  if (!meta) {
    return null
  }

  try {
    const vectors = await loadChunkedEmbeddings(meta, dirname(chunkMetaPath))
    return { meta, vectors }
  } catch {
    return null
  }
}

async function loadChunkedEmbeddings(meta, baseDir) {
  const embeddings = new Float32Array(meta.count * meta.dimensions)
  const chunkDir = join(baseDir, DEFAULT_CHUNK_DIR)

  for (const chunk of meta.chunks) {
    const buffer = await readFile(join(chunkDir, chunk.file))
    const chunkVectors = new Float32Array(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength / Float32Array.BYTES_PER_ELEMENT,
    )

    if (chunkVectors.length !== chunk.count * meta.dimensions) {
      throw new Error(
        `Chunk size mismatch for ${chunk.file}: got ${chunkVectors.length}, expected ${
          chunk.count * meta.dimensions
        }`,
      )
    }

    embeddings.set(chunkVectors, chunk.offset * meta.dimensions)
  }

  return embeddings
}

function slugifyChunkKey(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'chunk'
}
