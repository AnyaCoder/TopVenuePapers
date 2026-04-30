<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { usePaperSearch } from './composables/usePaperSearch'
import type {
  CategoryKey,
  PaperCatalogIndexPayload,
  PaperCatalogIndexRecord,
  PaperCatalogShardPayload,
  PaperRecord,
} from './types/paper'

type SearchMode = 'semantic' | 'keyword'
type SemanticStatus = 'idle' | 'checking' | 'ready' | 'searching' | 'offline' | 'error'

interface SemanticResult {
  id: string
  score: number
  title?: string
}

const categoryLabels: Record<CategoryKey, string> = {
  'evaluation-benchmarks': 'Evaluation',
  reasoning: 'Reasoning',
  'rl-post-training': 'RL / Post-training',
  'agents-tool-use': 'Agent / Tool Use',
  'rag-knowledge': 'RAG / Knowledge',
  'alignment-safety': 'Alignment / Safety',
  'efficiency-systems': 'Efficiency / Systems',
  'coding-formal-tasks': 'Coding / Formal',
  'mllm-foundations': 'MLLM Foundations',
  'vlm-understanding': 'VLM Understanding',
  'video-understanding': 'Video Understanding',
  'audio-speech': 'Audio / Speech',
  'three-d-world-modeling': '3D / World Model',
  'vla-embodied-learning': 'VLA / Embodied',
  'robotics-planning': 'Robotics / Planning',
  'scientific-discovery': 'Scientific Discovery',
  'data-synthesis-curation': 'Data / Curation',
  'multimodal-generation': 'Multimodal Generation',
}

const guideLabels = [
  ['motivation', '研究动机'],
  ['problem', '解决问题'],
  ['analysis', '现象分析'],
  ['method', '主要方法'],
  ['experiment', '数据与实验'],
  ['contribution', '主要贡献'],
] as const

const draftQuery = ref('')
const maxResults = ref(100)
const perPage = ref(10)
const currentPage = ref(1)
const catalogRequestId = ref(0)
const semanticRequestId = ref(0)
const selectedVenueYears = ref(new Set<string>())
const selectedCategories = ref(new Set<CategoryKey>())
const openSections = ref(new Set<string>())
const paperCatalog = ref<PaperCatalogIndexRecord[]>([])
const isLoadingPapers = ref(true)
const loadError = ref('')
const catalogUpdatedAt = ref('')
const detailRequestId = ref(0)
const detailShardCache = new Map<string, Promise<PaperCatalogShardPayload>>()
const detailedPapers = ref<Record<string, PaperRecord>>({})
const semanticApiBase = import.meta.env.PROD
  ? '/api/semantic'
  : 'http://127.0.0.1:8765'
const useBrowserSemantic = import.meta.env.PROD
const dataBaseUrl = import.meta.env.BASE_URL
const searchMode = ref<SearchMode>('semantic')
const semanticStatus = ref<SemanticStatus>('idle')
const semanticError = ref('')
const semanticModel = ref('all-MiniLM-L6-v2')
const semanticPaperCount = ref(0)
const semanticResults = ref<SemanticResult[]>([])
const lastSemanticQuery = ref('')

  const { query, outcome } = usePaperSearch(
  paperCatalog as unknown as import('vue').Ref<PaperRecord[]>,
)

const idleScheduler =
  typeof window !== 'undefined' &&
  'requestIdleCallback' in window
    ? window.requestIdleCallback.bind(window)
    : (callback: IdleRequestCallback) =>
        window.setTimeout(
          () =>
            callback({
              didTimeout: false,
              timeRemaining: () => 0,
            } as IdleDeadline),
          1200,
        )

const venueGroups = computed(() => {
  const groups = new Map<string, { years: Set<number>; counts: Map<number, number> }>()

  for (const paper of paperCatalog.value) {
    const venue = getVenueName(paper.venue)
    const group = groups.get(venue) ?? {
      years: new Set<number>(),
      counts: new Map<number, number>(),
    }
    group.years.add(paper.year)
    group.counts.set(paper.year, (group.counts.get(paper.year) ?? 0) + 1)
    groups.set(venue, group)
  }

  return Array.from(groups.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([venue, group]) => ({
      venue,
      years: Array.from(group.years)
        .sort((left, right) => right - left)
        .map((year) => ({
          value: year,
          count: group.counts.get(year) ?? 0,
        })),
    }))
})

const categoryOptions = computed(() =>
  Array.from(new Set(paperCatalog.value.map((paper) => paper.primaryCategory)))
    .sort((left, right) =>
      categoryLabels[left].localeCompare(categoryLabels[right]),
    )
    .map((key) => ({
      key,
      label: categoryLabels[key],
      count: paperCatalog.value.filter((paper) => paper.primaryCategory === key)
        .length,
    })),
)

const guidedPaperCount = computed(
  () => paperCatalog.value.filter((paper) => paper.hasIntroZh).length,
)

const paperById = computed(() =>
  new Map(paperCatalog.value.map((paper) => [paper.id, paper])),
)

const semanticRankedPapers = computed(() =>
  semanticResults.value
    .map((result) => paperById.value.get(result.id))
    .filter((paper): paper is PaperCatalogIndexRecord => Boolean(paper)),
)

const hasSemanticRanking = computed(
  () =>
    searchMode.value === 'semantic' &&
    Boolean(query.value.trim()) &&
    lastSemanticQuery.value === query.value.trim() &&
    semanticRankedPapers.value.length > 0,
)

const rankedPapers = computed<PaperCatalogIndexRecord[]>(() =>
  hasSemanticRanking.value
    ? semanticRankedPapers.value
    : (outcome.value.papers as PaperCatalogIndexRecord[]),
)

const semanticMatchesById = computed(() =>
  Object.fromEntries(
    semanticResults.value.map((result) => [
      result.id,
      {
        score: result.score,
        exactTitleMatch: false,
        matchedSignals: [semanticModel.value],
      },
    ]),
  ),
)

const semanticStatusLabel = computed(() => {
  if (semanticStatus.value === 'ready') {
    return `Semantic ready: ${semanticModel.value} (${semanticPaperCount.value || paperCatalog.value.length} papers)`
  }

  if (semanticStatus.value === 'searching') {
    return `Semantic searching with ${semanticModel.value}...`
  }

  if (semanticStatus.value === 'checking') {
    return useBrowserSemantic
      ? 'Loading browser semantic index...'
      : 'Checking local semantic server...'
  }

  if (semanticStatus.value === 'offline') {
    return useBrowserSemantic
      ? 'Browser semantic model unavailable; using keyword fallback.'
      : 'Semantic server offline; using keyword fallback.'
  }

  if (semanticStatus.value === 'error') {
    return `Semantic error: ${semanticError.value}`
  }

  return useBrowserSemantic
    ? `Semantic model downloads once and then reuses browser cache: ${semanticModel.value}`
    : `Semantic model: ${semanticModel.value}`
})

const filteredPapers = computed<PaperCatalogIndexRecord[]>(() => {
  const venueSet = selectedVenueYears.value
  const categorySet = selectedCategories.value

  return rankedPapers.value
    .filter((paper) => {
      if (venueSet.size === 0) {
        return true
      }

      return venueSet.has(getVenueYearKey(paper))
    })
    .filter((paper) => {
      if (categorySet.size === 0) {
        return true
      }

      return categorySet.has(paper.primaryCategory)
    })
    .slice(0, sanitizedMaxResults.value)
})

const sanitizedMaxResults = computed(() =>
  Math.min(
    Math.max(Number(maxResults.value) || 1, 1),
    Math.max(paperCatalog.value.length, 1),
  ),
)

const sanitizedPerPage = computed(() =>
  Math.min(Math.max(Number(perPage.value) || 10, 1), 50),
)

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredPapers.value.length / sanitizedPerPage.value)),
)

const visiblePapers = computed(() => {
  const start = (currentPage.value - 1) * sanitizedPerPage.value
  return filteredPapers.value.slice(start, start + sanitizedPerPage.value)
})

const activeFilterCount = computed(
  () => selectedVenueYears.value.size + selectedCategories.value.size,
)

watch([filteredPapers, sanitizedPerPage], () => {
  currentPage.value = 1
})

watch(totalPages, (pages) => {
  if (currentPage.value > pages) {
    currentPage.value = pages
  }
})

onMounted(() => {
  void loadPaperCatalog()
  void scheduleSemanticWarmup()
})

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

function runSearch() {
  const nextQuery = draftQuery.value.trim()
  query.value = nextQuery
  currentPage.value = 1

  if (!nextQuery) {
    semanticResults.value = []
    lastSemanticQuery.value = ''
    return
  }

  if (searchMode.value === 'semantic') {
    void runSemanticSearch(nextQuery)
  }
}

function clearSearch() {
  draftQuery.value = ''
  query.value = ''
  semanticResults.value = []
  lastSemanticQuery.value = ''
  selectedVenueYears.value = new Set()
  selectedCategories.value = new Set()
  currentPage.value = 1
}

function setSearchMode(mode: SearchMode) {
  searchMode.value = mode

  if (
    mode === 'semantic' &&
    query.value.trim() &&
    lastSemanticQuery.value !== query.value.trim()
  ) {
    void runSemanticSearch(query.value.trim())
  }
}

async function checkSemanticHealth() {
  semanticStatus.value = 'checking'
  semanticError.value = ''

  try {
    if (useBrowserSemantic) {
      const { loadBrowserSemanticIndex } = await import(
        './utils/browserSemanticSearch'
      )
      const index = await loadBrowserSemanticIndex()
      semanticModel.value = index.meta.model
      semanticPaperCount.value = index.meta.count
      semanticStatus.value = 'ready'
      return
    }

    const response = await fetch(`${semanticApiBase}/health`)

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    const payload = await response.json()
    semanticModel.value = payload.model ?? semanticModel.value
    semanticPaperCount.value = payload.count ?? 0
    semanticStatus.value = 'ready'
  } catch (error) {
    semanticStatus.value = 'offline'
    semanticError.value =
      error instanceof Error ? error.message : 'Semantic server is offline.'
  }
}

async function scheduleSemanticWarmup() {
  if (!useBrowserSemantic) {
    await checkSemanticHealth()
    return
  }

  idleScheduler(async () => {
    try {
      const { preloadBrowserSemanticIndex, warmupBrowserSemanticModel } = await import(
        './utils/browserSemanticSearch'
      )
      await preloadBrowserSemanticIndex()
      const shouldMarkChecking = semanticStatus.value === 'idle'

      if (shouldMarkChecking) {
        semanticStatus.value = 'checking'
      }
      await warmupBrowserSemanticModel()
      if (shouldMarkChecking && semanticStatus.value === 'checking') {
        await checkSemanticHealth()
      }
    } catch {
      if (semanticStatus.value === 'idle') {
        semanticStatus.value = 'offline'
      }
    }
  })
}

async function runSemanticSearch(rawQuery: string) {
  const requestId = semanticRequestId.value + 1
  semanticRequestId.value = requestId
  semanticStatus.value = 'searching'
  semanticError.value = ''

  try {
    const topK = Math.min(
      Math.max((Number(maxResults.value) || 100) * 20, 500),
      Math.max(paperCatalog.value.length, 500),
    )

    if (useBrowserSemantic) {
      const { searchBrowserSemanticIndex } = await import(
        './utils/browserSemanticSearch'
      )
      if (semanticRequestId.value !== requestId) {
        return
      }
      semanticResults.value = await searchBrowserSemanticIndex(rawQuery, topK)

      if (semanticRequestId.value !== requestId || query.value.trim() !== rawQuery) {
        return
      }

      lastSemanticQuery.value = rawQuery
      semanticStatus.value = 'ready'
      return
    }

    const url = new URL('/search', semanticApiBase)
    url.searchParams.set('q', rawQuery)
    url.searchParams.set('top_k', String(topK))
    const response = await fetch(url)

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    const payload = await response.json()

    if (semanticRequestId.value !== requestId || query.value.trim() !== rawQuery) {
      return
    }

    semanticResults.value = Array.isArray(payload.results)
      ? payload.results
      : []
    lastSemanticQuery.value = rawQuery
    semanticStatus.value = 'ready'
  } catch (error) {
    if (semanticRequestId.value !== requestId) {
      return
    }

    semanticResults.value = []
    lastSemanticQuery.value = ''
    semanticStatus.value = 'error'
    semanticError.value =
      error instanceof Error ? error.message : 'Semantic search failed.'
  }
}

function toggleVenueYear(venue: string, year: number) {
  const next = new Set(selectedVenueYears.value)
  const key = `${venue}:${year}`

  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }

  selectedVenueYears.value = next
}

function toggleVenueGroup(venue: string, years: number[]) {
  const next = new Set(selectedVenueYears.value)
  const keys = years.map((year) => `${venue}:${year}`)
  const allSelected = keys.every((key) => next.has(key))

  for (const key of keys) {
    if (allSelected) {
      next.delete(key)
    } else {
      next.add(key)
    }
  }

  selectedVenueYears.value = next
}

function clearVenueGroup(venue: string, years: number[]) {
  const next = new Set(selectedVenueYears.value)

  for (const year of years) {
    next.delete(`${venue}:${year}`)
  }

  selectedVenueYears.value = next
}

function toggleCategory(category: CategoryKey) {
  const next = new Set(selectedCategories.value)

  if (next.has(category)) {
    next.delete(category)
  } else {
    next.add(category)
  }

  selectedCategories.value = next
}

function toggleSection(paperId: string, section: string) {
  const next = new Set(openSections.value)
  const key = `${paperId}:${section}`
  const isOpening = !next.has(key)

  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }

  openSections.value = next

  if (isOpening && (section === 'abstract' || section === 'guide')) {
    void ensurePaperDetailsLoaded(paperId)
  }
}

function isSectionOpen(paperId: string, section: string) {
  return openSections.value.has(`${paperId}:${section}`)
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

function previousPage() {
  currentPage.value = Math.max(1, currentPage.value - 1)
}

function nextPage() {
  currentPage.value = Math.min(totalPages.value, currentPage.value + 1)
}

function exportResults() {
  const payload = JSON.stringify(filteredPapers.value, null, 2)
  const blob = new Blob([payload], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ccfa-2026-paper-results.json'
  link.click()
  URL.revokeObjectURL(url)
}

function getVenueName(venue: string) {
  return venue.split(/\s+/)[0] || venue
}

function getVenueYearKey(paper: Pick<PaperRecord, 'venue' | 'year'>) {
  return `${getVenueName(paper.venue)}:${paper.year}`
}

function selectedYearCount(venue: string, years: number[]) {
  return years.filter((year) => selectedVenueYears.value.has(`${venue}:${year}`))
    .length
}

function formatAffinity(paper: PaperCatalogIndexRecord) {
  if (hasSemanticRanking.value) {
    const semanticScore = semanticMatchesById.value[paper.id]?.score

    if (semanticScore !== undefined) {
      return semanticScore.toFixed(4)
    }
  }

  const score = outcome.value.matchesById[paper.id]?.score

  if (!query.value.trim() || score === undefined) {
    return '1.0000'
  }

  return Math.min(score / 100, 0.9999).toFixed(4)
}

function buildBibtex(paper: PaperRecord) {
  const key = `${paper.authors[0]?.split(' ').at(-1)?.toLowerCase() ?? 'paper'}${paper.year}${paper.id.slice(0, 8)}`

  return `@inproceedings{${key},
  title={${paper.title}},
  author={${paper.authors.join(' and ')}},
  booktitle={${paper.venue}},
  year={${paper.year}},
  url={${paper.openreviewUrl}}
}`
}

function getPaperDetail(paper: PaperCatalogIndexRecord) {
  return detailedPapers.value[paper.id] ?? paper
}

function buildBibtexForView(paper: PaperCatalogIndexRecord) {
  return buildBibtex(getPaperDetail(paper))
}
</script>

<template>
  <main class="finder-shell">
    <header class="finder-hero">
      <div class="finder-hero__cloud" aria-hidden="true">
        <span>ICLR</span>
        <span>CCF-A</span>
        <span>VLM</span>
        <span>Agent</span>
        <span>VLA</span>
        <span>Reasoning</span>
        <span>MLLM</span>
        <span>RAG</span>
      </div>

      <div class="finder-hero__content">
        <h1>AI Paper Finder</h1>
        <p>Discover relevant 2026 AI papers across selected top venues.</p>
        <div class="finder-hero__meta">
          <span>CCF-A / ICLR 2026</span>
          <a href="https://openreview.net" target="_blank" rel="noreferrer">
            OpenReview
          </a>
          <span>{{ paperCatalog.length }} papers loaded.</span>
          <span>{{ guidedPaperCount }} with Chinese guides.</span>
          <span>{{ semanticStatusLabel }}</span>
          <span v-if="catalogUpdatedAt">Updated {{ catalogUpdatedAt.slice(0, 10) }}</span>
        </div>
      </div>
    </header>

    <section class="finder-workspace">
      <aside class="finder-panel finder-panel--search">
        <div class="panel-heading">
          <h2>Search</h2>
          <div class="panel-actions">
            <button type="button" @click="exportResults">Export Results</button>
            <button type="button" @click="clearSearch">Clear</button>
          </div>
        </div>

        <div class="filter-body">
          <div v-if="isLoadingPapers" class="catalog-status">
            Loading lazy paper catalog...
          </div>
          <div v-else-if="loadError" class="catalog-status catalog-status--error">
            Catalog failed to load: {{ loadError }}
          </div>

          <label class="field-block">
            <span>Query (best: paste an abstract)</span>
            <textarea
              v-model="draftQuery"
              rows="5"
              placeholder="vlm, video, embodied agent, long-context reasoning..."
              @keydown.ctrl.enter.prevent="runSearch"
            />
          </label>

          <div class="semantic-controls">
            <button
              type="button"
              :class="{ 'is-active': searchMode === 'semantic' }"
              @click="setSearchMode('semantic')"
            >
              Semantic local
            </button>
            <button
              type="button"
              :class="{ 'is-active': searchMode === 'keyword' }"
              @click="setSearchMode('keyword')"
            >
              Keyword / fuzzy
            </button>
            <button type="button" @click="checkSemanticHealth">
              Check model
            </button>
          </div>

          <p
            class="semantic-hint"
            :class="{ 'semantic-hint--error': semanticStatus === 'error' }"
          >
            {{ semanticStatusLabel }}
          </p>

          <div class="compact-grid">
            <label class="field-block">
              <span>Number of results</span>
              <input v-model.number="maxResults" type="number" min="1" />
            </label>
            <label class="field-block">
              <span>Per page</span>
              <input v-model.number="perPage" type="number" min="1" max="50" />
            </label>
            <button
              class="primary-action"
              type="button"
              :disabled="semanticStatus === 'searching'"
              @click="runSearch"
            >
              {{ semanticStatus === 'searching' ? 'Searching...' : 'Search' }}
            </button>
          </div>

          <div class="filter-section">
            <div class="filter-section__heading">
              <h3>Select Venues & Years</h3>
              <span>{{ activeFilterCount }} active</span>
            </div>

            <div class="venue-list">
              <article
                v-for="group in venueGroups"
                :key="group.venue"
                class="venue-row"
              >
                <div class="venue-row__top">
                  <strong>{{ group.venue }}</strong>
                  <span>
                    {{ selectedYearCount(group.venue, group.years.map((item) => item.value)) }}/{{
                      group.years.length
                    }}
                    selected
                  </span>
                  <button
                    type="button"
                    @click="toggleVenueGroup(group.venue, group.years.map((item) => item.value))"
                  >
                    Select all years
                  </button>
                  <button
                    type="button"
                    @click="clearVenueGroup(group.venue, group.years.map((item) => item.value))"
                  >
                    Clear
                  </button>
                </div>
                <div class="year-pills">
                  <button
                    v-for="year in group.years"
                    :key="year.value"
                    type="button"
                    :class="{
                      'is-active': selectedVenueYears.has(`${group.venue}:${year.value}`),
                    }"
                    @click="toggleVenueYear(group.venue, year.value)"
                  >
                    {{ year.value }} ({{ year.count }})
                  </button>
                </div>
              </article>
            </div>
          </div>

          <div class="filter-section">
            <div class="filter-section__heading">
              <h3>Subfields</h3>
              <span>{{ selectedCategories.size }} selected</span>
            </div>
            <div class="category-filter-list">
              <button
                v-for="category in categoryOptions"
                :key="category.key"
                type="button"
                :class="{ 'is-active': selectedCategories.has(category.key) }"
                @click="toggleCategory(category.key)"
              >
                <span>{{ category.label }}</span>
                <small>{{ category.count }}</small>
              </button>
            </div>
          </div>
        </div>
      </aside>

      <section class="finder-panel finder-panel--results">
        <div class="results-heading">
          <h2>
            Results
            <small>{{ hasSemanticRanking ? 'Semantic ranking' : 'Keyword ranking' }}</small>
          </h2>
          <div class="pager">
            <button
              type="button"
              :disabled="currentPage === 1"
              @click="previousPage"
            >
              Previous
            </button>
            <strong>Page {{ currentPage }} / {{ totalPages }}</strong>
            <button
              type="button"
              :disabled="currentPage === totalPages"
              @click="nextPage"
            >
              Next
            </button>
          </div>
        </div>

        <div class="results-list" aria-live="polite">
          <article
            v-for="paper in visiblePapers"
            :key="paper.id"
            class="result-card"
          >
            <div class="result-card__main">
              <div class="result-card__titleline">
                <span class="venue-chip">{{ paper.venue }}</span>
                <h3>{{ paper.title }}</h3>
              </div>
              <p v-if="paper.titleZh" class="result-card__zh">
                {{ paper.titleZh }}
              </p>
              <p class="result-card__authors">
                <strong>Authors:</strong> {{ paper.authors.join(', ') }}
              </p>
              <p class="result-card__score">
                <strong>{{ hasSemanticRanking ? 'Semantic Score:' : 'Affinity Score:' }}</strong>
                {{ formatAffinity(paper) }}
              </p>
              <p v-if="paper.hookZh" class="result-card__hook">{{ paper.hookZh }}</p>
              <p v-else class="result-card__hook">
                Metadata collected. Chinese guide is pending.
              </p>
            </div>

            <a
              class="open-link"
              :href="paper.openreviewUrl"
              target="_blank"
              rel="noreferrer"
            >
              Open Link
            </a>

            <div class="result-card__details">
              <button type="button" @click="toggleSection(paper.id, 'abstract')">
                <span>{{ isSectionOpen(paper.id, 'abstract') ? '▾' : '▸' }}</span>
                Show Abstract
              </button>
              <p v-if="isSectionOpen(paper.id, 'abstract')" class="detail-copy">
                {{
                  getPaperDetail(paper).abstract ||
                  'Abstract is loading or was not exposed by the source page.'
                }}
              </p>

              <button type="button" @click="toggleSection(paper.id, 'guide')">
                <span>{{ isSectionOpen(paper.id, 'guide') ? '▾' : '▸' }}</span>
                {{ paper.hasIntroZh ? 'Show 中文导读' : '中文导读待补充' }}
              </button>
              <div
                v-if="isSectionOpen(paper.id, 'guide') && getPaperDetail(paper).introZh"
                class="guide-grid"
              >
                <article
                  v-for="[key, label] in guideLabels"
                  :key="key"
                  class="guide-cell"
                >
                  <strong>{{ label }}</strong>
                  <p>{{ getPaperDetail(paper).introZh?.[key] }}</p>
                </article>
              </div>
              <p
                v-else-if="isSectionOpen(paper.id, 'guide')"
                class="detail-copy"
              >
                这篇论文已先收录进库，六维中文导读后续再生成。
              </p>

              <button type="button" @click="toggleSection(paper.id, 'bibtex')">
                <span>{{ isSectionOpen(paper.id, 'bibtex') ? '▾' : '▸' }}</span>
                Show BibTeX
              </button>
              <pre v-if="isSectionOpen(paper.id, 'bibtex')" class="bibtex">{{
                buildBibtexForView(paper)
              }}</pre>
            </div>
          </article>

          <article v-if="visiblePapers.length === 0" class="empty-results">
            <h3>No matching papers</h3>
            <p>Try a broader query, clear a venue filter, or remove a subfield.</p>
          </article>
        </div>
      </section>
    </section>
  </main>
</template>
