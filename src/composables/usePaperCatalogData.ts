import { ref, type Ref } from 'vue'
import type {
  PaperAbstractPayload,
  PaperCatalogIndexPayload,
  PaperCatalogIndexRecord,
  PaperCatalogShardPayload,
  PaperRecord,
} from '../types/paper'

export function usePaperCatalogData(dataBaseUrl: string, maxResults: Ref<number>) {
  const paperCatalog = ref<PaperCatalogIndexRecord[]>([])
  const isLoadingPapers = ref(true)
  const loadError = ref('')
  const catalogUpdatedAt = ref('')
  const catalogRequestId = ref(0)

  const detailRequestId = ref(0)
  const detailShardCache = new Map<string, Promise<PaperCatalogShardPayload>>()
  const abstractShardCache = new Map<string, Promise<PaperAbstractPayload>>()
  const detailedPapers = ref<Record<string, PaperRecord>>({})
  const abstractLoadState = ref<Record<string, 'idle' | 'loading' | 'ready' | 'error'>>({})

  async function loadPaperCatalog() {
    const requestId = catalogRequestId.value + 1
    catalogRequestId.value = requestId
    isLoadingPapers.value = true
    loadError.value = ''

    try {
      const response = await fetch(`${dataBaseUrl}data/catalog/index.json`)

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      const payload = (await response.json()) as PaperCatalogIndexPayload
      const records = Array.isArray(payload) ? payload : payload.papers

      if (!Array.isArray(records)) {
        throw new Error('Catalog JSON must be an array or an object with papers.')
      }

      if (catalogRequestId.value !== requestId) {
        return
      }

      paperCatalog.value = records
      catalogUpdatedAt.value = payload.generatedAt ?? ''
      maxResults.value = Math.min(Math.max(maxResults.value, 100), records.length)
    } catch (error) {
      if (catalogRequestId.value !== requestId) {
        return
      }

      loadError.value =
        error instanceof Error ? error.message : 'Could not load paper catalog.'
    } finally {
      if (catalogRequestId.value === requestId) {
        isLoadingPapers.value = false
      }
    }
  }

  async function ensurePaperDetailsLoaded(paperId: string) {
    if (detailedPapers.value[paperId]) {
      return
    }

    const indexPaper = paperCatalog.value.find((paper) => paper.id === paperId)

    if (!indexPaper) {
      return
    }

    const requestId = detailRequestId.value + 1
    detailRequestId.value = requestId

    try {
      const shard = await loadShard(indexPaper.shardKey)

      if (detailRequestId.value < requestId) {
        return
      }

      const detailPaper = shard.papers.find((paper) => paper.id === paperId)

      if (!detailPaper) {
        return
      }

      detailedPapers.value = {
        ...detailedPapers.value,
        [paperId]: detailPaper,
      }
    } catch (error) {
      console.warn('Failed to load paper details', error)
    }
  }

  async function ensurePaperAbstractLoaded(paperId: string) {
    const existing = detailedPapers.value[paperId]

    if (existing?.abstract?.trim()) {
      abstractLoadState.value = {
        ...abstractLoadState.value,
        [paperId]: 'ready',
      }
      return
    }

    const indexPaper = paperCatalog.value.find((paper) => paper.id === paperId)

    if (!indexPaper) {
      return
    }

    abstractLoadState.value = {
      ...abstractLoadState.value,
      [paperId]: 'loading',
    }

    try {
      const payload = await loadAbstractShard(indexPaper.shardKey)
      const match = payload.papers.find((paper) => paper.id === paperId)

      if (!match) {
        abstractLoadState.value = {
          ...abstractLoadState.value,
          [paperId]: 'error',
        }
        return
      }

      detailedPapers.value = {
        ...detailedPapers.value,
        [paperId]: {
          ...(detailedPapers.value[paperId] ?? indexPaper),
          abstract: match.abstract,
        } as PaperRecord,
      }

      abstractLoadState.value = {
        ...abstractLoadState.value,
        [paperId]: 'ready',
      }
    } catch (error) {
      console.warn('Failed to load paper abstract', error)
      abstractLoadState.value = {
        ...abstractLoadState.value,
        [paperId]: 'error',
      }
    }
  }

  function getPaperDetail(paper: PaperCatalogIndexRecord) {
    return detailedPapers.value[paper.id] ?? paper
  }

  function getAbstractCopy(paper: PaperCatalogIndexRecord) {
    const abstract = getPaperDetail(paper).abstract?.trim()

    if (abstract) {
      return abstract
    }

    const state = abstractLoadState.value[paper.id] ?? 'idle'

    if (state === 'loading') {
      return 'Loading abstract...'
    }

    if (state === 'error') {
      return 'Abstract failed to load. Please try again.'
    }

    return 'Abstract is available but still loading...'
  }

  function buildBibtexForView(paper: PaperCatalogIndexRecord) {
    return buildBibtex(getPaperDetail(paper))
  }

  async function loadShard(shardKey: string) {
    let promise = detailShardCache.get(shardKey)

    if (!promise) {
      promise = fetch(`${dataBaseUrl}data/catalog/shards/${shardKey}.json`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`)
          }

          return (await response.json()) as PaperCatalogShardPayload
        })
      detailShardCache.set(shardKey, promise)
    }

    return promise
  }

  async function loadAbstractShard(shardKey: string) {
    let promise = abstractShardCache.get(shardKey)

    if (!promise) {
      promise = fetch(`${dataBaseUrl}data/catalog/abstracts/${shardKey}.json`)
        .then(async (response) => {
          if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`)
          }

          return (await response.json()) as PaperAbstractPayload
        })
      abstractShardCache.set(shardKey, promise)
    }

    return promise
  }

  return {
    paperCatalog,
    isLoadingPapers,
    loadError,
    catalogUpdatedAt,
    loadPaperCatalog,
    ensurePaperDetailsLoaded,
    ensurePaperAbstractLoaded,
    getPaperDetail,
    getAbstractCopy,
    buildBibtexForView,
  }
}

function buildBibtex(paper: Pick<PaperRecord, 'authors' | 'id' | 'openreviewUrl' | 'title' | 'venue' | 'year'>) {
  const key = `${paper.authors[0]?.split(' ').at(-1)?.toLowerCase() ?? 'paper'}${paper.year}${paper.id.slice(0, 8)}`

  return `@inproceedings{${key},
  title={${paper.title}},
  author={${paper.authors.join(' and ')}},
  booktitle={${paper.venue}},
  year={${paper.year}},
  url={${paper.openreviewUrl}}
}`
}
