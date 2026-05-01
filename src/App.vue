<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import TopNavigation from './components/TopNavigation.vue'
import { categoryLabels, pageTabs } from './constants/appMetadata'
import { useDiscoveryFeed } from './composables/useDiscoveryFeed'
import { usePaperSearch } from './composables/usePaperSearch'
import BrainStormPage from './pages/BrainStormPage.vue'
import FinderPage from './pages/FinderPage.vue'
import NewFindingPage from './pages/NewFindingPage.vue'
import { usePaperCatalogData } from './composables/usePaperCatalogData'
import type {
  AppPage,
  BrainstormRelatedPaper,
  BrainstormStatus,
  DiscoveryEvidenceCard,
  DiscoveryTimelineItem,
  SearchMode,
  SemanticResult,
  SemanticStatus,
} from './types/app'
import type {
  CategoryKey,
  PaperCatalogIndexRecord,
  PaperRecord,
} from './types/paper'
import type { BrowserSemanticProgress } from './utils/browserSemanticSearch'
import { buildBrainstormQuery, buildLocalBrainstormPlan, rankPapersByTextQuery, type BrainstormDraft } from './utils/brainstorm'
import {
  clampNumber,
  humanizePlatform,
  humanizeWorkflowStatus,
  resolvePageFromHash,
  timestampValue,
  workflowTone,
} from './utils/display'
import { buildHybridRanking } from './utils/hybridRanking'
import type {
  BrainstormBackendStatus,
  BrainstormEnhancement,
} from './utils/brainstormApi'

const activePage = ref<AppPage>(resolvePageFromHash())

const draftQuery = ref('')
const maxResults = ref(100)
const perPage = ref(10)
const currentPage = ref(1)
const selectedVenueYears = ref(new Set<string>())
const selectedCategories = ref(new Set<CategoryKey>())
const openSections = ref(new Set<string>())

const semanticApiBase = import.meta.env.PROD
  ? '/api/semantic'
  : 'http://127.0.0.1:8765'
const brainstormApiBase = '/api/brainstorm'
const useBrowserSemantic = import.meta.env.PROD
const dataBaseUrl = import.meta.env.BASE_URL
const searchMode = ref<SearchMode>('semantic')
const semanticStatus = ref<SemanticStatus>('idle')
const semanticError = ref('')
const semanticModel = ref('all-MiniLM-L6-v2')
const semanticPaperCount = ref(0)
const semanticResults = ref<SemanticResult[]>([])
const lastSemanticQuery = ref('')
const semanticProgress = ref<BrowserSemanticProgress | null>(null)
const semanticRequestId = ref(0)
let detachSemanticProgress: (() => void) | undefined

const brainstormDraft = reactive<BrainstormDraft>({
  background: '',
  idea: '',
  constraints: '',
  maxPapers: 8,
})
const brainstormStatus = ref<BrainstormStatus>('idle')
const brainstormError = ref('')
const brainstormResults = ref<BrainstormRelatedPaper[]>([])
const brainstormPlan = ref<ReturnType<typeof buildLocalBrainstormPlan> | null>(null)
const brainstormEnhancement = ref<BrainstormEnhancement | null>(null)
const brainstormBackend = ref<BrainstormBackendStatus | null>(null)
const brainstormBackendLoading = ref(false)
const brainstormRequestedModel = ref('')
const brainstormEnhancing = ref(false)

const {
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
} = usePaperCatalogData(dataBaseUrl, maxResults)

const {
  unofficialStore,
  unofficialLoading,
  unofficialError,
  discoveryTrace,
  traceLoading,
  traceError,
  workflowRuns,
  workflowLoading,
  workflowError,
  loadUnofficialStore,
  loadDiscoveryTrace,
  loadDiscoveryRuns,
} = useDiscoveryFeed(dataBaseUrl)

const { query, outcome, searchLexical } = usePaperSearch(
  paperCatalog as unknown as import('vue').Ref<PaperRecord[]>,
)

const idleScheduler =
  typeof window !== 'undefined' && 'requestIdleCallback' in window
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

const categoryOptions = computed(() => {
  const counts = new Map<CategoryKey, number>()

  for (const paper of paperCatalog.value) {
    counts.set(paper.primaryCategory, (counts.get(paper.primaryCategory) ?? 0) + 1)
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) =>
      categoryLabels[left].localeCompare(categoryLabels[right]),
    )
    .map(([key, count]) => ({
      key,
      label: categoryLabels[key],
      count,
    }))
})

const guidedPaperCount = computed(
  () => paperCatalog.value.filter((paper) => paper.hasIntroZh).length,
)

const unofficialPapers = computed(() => unofficialStore.value?.papers ?? [])
const unofficialAcceptedCount = computed(
  () => unofficialPapers.value.filter((paper) => paper.status === 'accepted').length,
)
const unofficialCandidateCount = computed(
  () => unofficialPapers.value.filter((paper) => paper.status !== 'accepted').length,
)
const unofficialPlatformBreakdown = computed(() => {
  const counts = new Map<string, number>()

  for (const paper of unofficialPapers.value) {
    const platforms = paper.platforms?.length
      ? paper.platforms
      : paper.evidence?.map((item) => item.platform).filter(Boolean) ?? []

    for (const platform of platforms) {
      const label = humanizePlatform(platform)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
  }

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([platform, count]) => ({ platform, count }))
})

const latestUnofficialPapers = computed(() =>
  [...unofficialPapers.value]
    .sort((left, right) => timestampValue(right.updatedAt || right.discoveredAt) - timestampValue(left.updatedAt || left.discoveredAt))
    .slice(0, 8),
)

const latestEvidenceCards = computed<DiscoveryEvidenceCard[]>(() =>
  unofficialPapers.value
    .flatMap((paper) =>
      (paper.evidence ?? []).map((evidence, index) => ({
        id: `${paper.id}:${index}`,
        title:
          evidence.title ||
          evidence.readerTitle ||
          `${humanizePlatform(evidence.platform)} signal`,
        paperTitle: paper.title,
        platform: humanizePlatform(evidence.platform || 'web'),
        snippet:
          evidence.readerExcerpt ||
          evidence.snippet ||
          paper.summary ||
          paper.reason ||
          'No summary snippet yet.',
        timestamp:
          evidence.publishDate ||
          paper.updatedAt ||
          paper.discoveredAt ||
          unofficialStore.value?.generatedAt ||
          '',
        href: evidence.url || paper.primaryUrl,
        tone: paper.status === 'accepted' ? ('good' as const) : ('active' as const),
      })),
    )
    .sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp))
    .slice(0, 6),
)

const discoveryTimeline = computed<DiscoveryTimelineItem[]>(() => {
  const items: DiscoveryTimelineItem[] = []

  if (unofficialStore.value?.generatedAt) {
    items.push({
      id: `snapshot:${unofficialStore.value.generatedAt}`,
      kind: 'snapshot',
      title: 'Discovery snapshot refreshed',
      detail: `${unofficialPapers.value.length} unofficial papers in the latest exported queue.`,
      timestamp: unofficialStore.value.generatedAt,
      tone: 'good',
      href: `${dataBaseUrl}data/unofficial/unofficial-papers.json`,
    })
  }

  for (const run of workflowRuns.value.slice(0, 4)) {
    items.push({
      id: `workflow:${run.id}`,
      kind: 'workflow',
      title: run.display_title || `Workflow run #${run.run_number}`,
      detail: `${humanizeWorkflowStatus(run)} via ${run.event}.`,
      timestamp: run.updated_at || run.created_at,
      tone: workflowTone(run) as DiscoveryTimelineItem['tone'],
      href: run.html_url,
    })
  }

  for (const paper of latestUnofficialPapers.value.slice(0, 6)) {
    items.push({
      id: `paper:${paper.id}`,
      kind: 'paper',
      title: paper.title,
      detail:
        paper.summary ||
        paper.reason ||
        `${paper.status === 'accepted' ? 'Accepted signal' : 'Candidate signal'} from ${paper.platforms?.map(humanizePlatform).join(', ') || 'social discovery'}.`,
      timestamp:
        paper.updatedAt ||
        paper.discoveredAt ||
        unofficialStore.value?.generatedAt ||
        '',
      tone: paper.status === 'accepted' ? 'good' : 'active',
      href: paper.primaryUrl,
    })
  }

  return items
    .sort((left, right) => timestampValue(right.timestamp) - timestampValue(left.timestamp))
    .slice(0, 10)
})

const latestWorkflowRun = computed(() => workflowRuns.value[0] ?? null)

const hybridRanking = computed(() =>
  buildHybridRanking({
    papers: paperCatalog.value,
    semanticResults: semanticResults.value,
    lexicalResults: outcome.value.lexicalResults,
    semanticModel: semanticModel.value,
  }),
)

const semanticRankedPapers = computed(() =>
  hybridRanking.value.papers,
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
  hybridRanking.value.matchesById,
)

const sanitizedMaxResults = computed(() =>
  Math.min(
    Math.max(Number(maxResults.value) || 1, 1),
    Math.max(paperCatalog.value.length, 1),
  ),
)

const sanitizedPerPage = computed(() =>
  Math.min(Math.max(Number(perPage.value) || 10, 1), 50),
)

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

const semanticStatusLabel = computed(() => {
  if (semanticStatus.value === 'ready') {
    if (semanticProgress.value?.message?.includes('browser cache')) {
      return `Semantic ready from browser cache: ${semanticModel.value} (${semanticPaperCount.value || paperCatalog.value.length} papers)`
    }

    return `Semantic ready: ${semanticModel.value} (${semanticPaperCount.value || paperCatalog.value.length} papers)`
  }

  if (semanticStatus.value === 'searching') {
    return semanticProgress.value?.message
      ? `${semanticProgress.value.message} Searching with ${semanticModel.value}...`
      : `Semantic searching with ${semanticModel.value}...`
  }

  if (semanticStatus.value === 'checking') {
    if (semanticProgress.value?.message) {
      return semanticProgress.value.message
    }

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

const semanticProgressPercent = computed(() => {
  const value = semanticProgress.value?.progress

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  return Math.max(0, Math.min(100, Math.round(value)))
})

const semanticProgressMessage = computed(() => {
  if (semanticProgress.value?.message) {
    return semanticProgress.value.message
  }

  if (semanticStatus.value === 'searching') {
    return `Searching with ${semanticModel.value}...`
  }

  if (semanticStatus.value === 'checking') {
    return useBrowserSemantic
      ? 'Checking browser cache for semantic index...'
      : 'Checking local semantic server...'
  }

  return ''
})

const semanticProgressStageLabel = computed(() => {
  const stage = semanticProgress.value?.stage

  if (stage === 'model') {
    return 'Semantic model'
  }

  if (stage === 'index') {
    return 'Semantic index'
  }

  return semanticStatus.value === 'searching' ? 'Semantic search' : 'Semantic warmup'
})

const showSemanticProgress = computed(
  () =>
    Boolean(useBrowserSemantic) &&
    (semanticStatus.value === 'checking' || semanticStatus.value === 'searching'),
)

const brainstormBackendAvailable = computed(
  () => brainstormBackend.value?.available ?? false,
)

const brainstormBackendMessage = computed(() => {
  if (brainstormBackendLoading.value && !brainstormBackend.value) {
    return 'Checking whether secure AI refinement is available on this deployment...'
  }

  return (
    brainstormBackend.value?.message ||
    'Secure AI refinement is not available on this deployment yet.'
  )
})

const brainstormEnhancementStateLabel = computed(() => {
  if (brainstormEnhancement.value) {
    return 'Ready'
  }

  if (brainstormBackendAvailable.value) {
    return 'Available'
  }

  return 'Offline'
})

const brainstormModelLabel = computed(
  () =>
    brainstormEnhancement.value?.model ||
    brainstormBackend.value?.model ||
    'glm-4.5-flash',
)

watch([filteredPapers, sanitizedPerPage], () => {
  currentPage.value = 1
})

watch(totalPages, (pages) => {
  if (currentPage.value > pages) {
    currentPage.value = pages
  }
})

watch(activePage, async (page) => {
  if (typeof window === 'undefined') {
    return
  }

  const expectedHash = page === 'finder' ? '' : `#${page}`
  if (window.location.hash !== expectedHash) {
    window.location.hash = expectedHash
  }

  if (page === 'new-finding') {
    await Promise.all([loadUnofficialStore(), loadDiscoveryTrace()])
  }

  if (page === 'brain-storm') {
    await loadBrainstormBackendStatus()
  }
})

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('hashchange', syncPageFromHash)
  }

  void loadPaperCatalog()
  void initializeSemanticWarmup()
  void loadUnofficialStore()
  void loadDiscoveryTrace()
  void loadBrainstormBackendStatus()
})

onUnmounted(() => {
  detachSemanticProgress?.()

  if (typeof window !== 'undefined') {
    window.removeEventListener('hashchange', syncPageFromHash)
  }
})

function syncPageFromHash() {
  activePage.value = resolvePageFromHash()
}

function navigateToPage(page: AppPage) {
  activePage.value = page
}

async function loadBrainstormBackendStatus(force = false) {
  if (brainstormBackendLoading.value && !force) {
    return
  }

  brainstormBackendLoading.value = true

  try {
    const { fetchBrainstormBackendStatus } = await import('./utils/brainstormApi')
    brainstormBackend.value = await fetchBrainstormBackendStatus(brainstormApiBase)
  } catch (error) {
    brainstormBackend.value = {
      available: false,
      model: 'glm-4.5-flash',
      message: resolveBrainstormBackendMessage(error),
    }
  } finally {
    brainstormBackendLoading.value = false
  }
}

async function refreshWorkflowRuns() {
  await loadDiscoveryRuns()
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

  if (useBrowserSemantic && !semanticProgress.value) {
    semanticProgress.value = {
      stage: 'index',
      status: 'download',
      message: 'Starting browser semantic warmup and cache check...',
    }
  }

  try {
    if (useBrowserSemantic) {
      const { loadBrowserSemanticIndex } = await import('./utils/browserSemanticSearch')
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

async function setupSemanticProgress() {
  if (!useBrowserSemantic || detachSemanticProgress) {
    return
  }

  const { subscribeBrowserSemanticProgress } = await import(
    './utils/browserSemanticSearch'
  )

  detachSemanticProgress = subscribeBrowserSemanticProgress((progress) => {
    semanticProgress.value = progress
  })
}

async function initializeSemanticWarmup() {
  await setupSemanticProgress()
  await scheduleSemanticWarmup()
}

async function scheduleSemanticWarmup() {
  if (!useBrowserSemantic) {
    await checkSemanticHealth()
    return
  }

  idleScheduler(async () => {
    const shouldMarkChecking = semanticStatus.value === 'idle'

    if (shouldMarkChecking) {
      semanticStatus.value = 'checking'
      if (!semanticProgress.value) {
        semanticProgress.value = {
          stage: 'index',
          status: 'initiate',
          message: 'Checking browser cache for semantic index...',
        }
      }
    }

    try {
      const { preloadBrowserSemanticIndex, warmupBrowserSemanticModel } = await import(
        './utils/browserSemanticSearch'
      )
      await preloadBrowserSemanticIndex()
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

  if (useBrowserSemantic) {
    semanticProgress.value = {
      stage: 'model',
      status: 'progress',
      message: `Searching with ${semanticModel.value}...`,
    }
  }

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
      semanticProgress.value = {
        stage: 'model',
        status: 'ready',
        message: 'Semantic search ready. Cached for future visits.',
      }
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

    semanticResults.value = Array.isArray(payload.results) ? payload.results : []
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

async function runBrainstormSearch() {
  const composedQuery = buildBrainstormQuery(brainstormDraft)

  if (!composedQuery) {
    brainstormStatus.value = 'error'
    brainstormError.value = 'Describe the background or idea first.'
    return
  }

  brainstormStatus.value = 'searching'
  brainstormError.value = ''
  brainstormEnhancement.value = null

  try {
    const maxPapersForIdea = clampNumber(brainstormDraft.maxPapers, 1, 20)
    const lexicalOutcome = searchLexical(
      composedQuery,
      Math.min(Math.max(maxPapersForIdea * 8, 40), 160),
    )
    let related: BrainstormRelatedPaper[] = []

    try {
      const { searchBrowserSemanticIndex } = await import('./utils/browserSemanticSearch')
      const semanticHits = await searchBrowserSemanticIndex(
        composedQuery,
        Math.min(Math.max(maxPapersForIdea * 6, 24), 120),
      )
      const hybrid = buildHybridRanking({
        papers: paperCatalog.value,
        semanticResults: semanticHits,
        lexicalResults: lexicalOutcome.lexicalResults,
        semanticModel: semanticModel.value,
      })

      related = hybrid.papers
        .slice(0, maxPapersForIdea)
        .map((paper) => {
          const match = hybrid.matchesById[paper.id]

          return {
            paper,
            score: match?.rankScore ?? match?.semanticScore ?? match?.lexicalScore ?? 0,
            semanticScore: match?.semanticScore,
            lexicalScore: match?.lexicalScore,
            signals: match?.matchedSignals ?? [],
          }
        })
    } catch {
      const lexicalPapers = lexicalOutcome.papers.length > 0
        ? lexicalOutcome.papers
        : rankPapersByTextQuery(
          paperCatalog.value,
          composedQuery,
          maxPapersForIdea,
        )

      related = lexicalPapers.slice(0, maxPapersForIdea).map((paper) => {
        const match = lexicalOutcome.matchesById[paper.id]

        return {
          paper: paper as PaperCatalogIndexRecord,
          score: match?.score ?? 0,
          lexicalScore: match?.score,
          signals: match?.matchedSignals ?? [],
        }
      })
    }

    if (related.length === 0) {
      throw new Error('No related papers found for this idea yet.')
    }

    await Promise.all(
      related.map((item) => ensurePaperAbstractLoaded(item.paper.id)),
    )

    const hydrated = related.map((item) => {
      const detail = getPaperDetail(item.paper)
      return {
        ...item.paper,
        abstract: detail.abstract,
      }
    })

    brainstormResults.value = related
    brainstormPlan.value = buildLocalBrainstormPlan(brainstormDraft, hydrated)
    brainstormStatus.value = 'ready'
  } catch (error) {
    brainstormStatus.value = 'error'
    brainstormError.value =
      error instanceof Error ? error.message : 'Brain storm search failed.'
  }
}

async function runBrainstormEnhancement() {
  if (!brainstormBackendAvailable.value) {
    await loadBrainstormBackendStatus(true)

    if (!brainstormBackendAvailable.value) {
      brainstormError.value = brainstormBackendMessage.value
      return
    }
  }

  if (!brainstormDraft.background.trim() && !brainstormDraft.idea.trim()) {
    brainstormError.value = 'Describe the background or idea first.'
    return
  }

  if (brainstormResults.value.length === 0) {
    await runBrainstormSearch()
    if (brainstormResults.value.length === 0) {
      return
    }
  }

  brainstormEnhancing.value = true
  brainstormError.value = ''

  try {
    const { enhanceBrainstormWithBackend } = await import('./utils/brainstormApi')

    const papers = brainstormResults.value.map(({ paper }) => {
      const detail = getPaperDetail(paper)
      return {
        ...paper,
        abstract: detail.abstract || paper.abstract || '',
      }
    })

    brainstormEnhancement.value = await enhanceBrainstormWithBackend({
      apiBase: brainstormApiBase,
      model: brainstormRequestedModel.value.trim() || undefined,
      draft: {
        ...brainstormDraft,
        maxPapers: clampNumber(brainstormDraft.maxPapers, 1, 20),
      },
      papers,
    })
  } catch (error) {
    brainstormError.value =
      error instanceof Error ? error.message : 'Zhipu enhancement failed.'
  } finally {
    brainstormEnhancing.value = false
  }
}

function resetBrainstorm() {
  brainstormDraft.background = ''
  brainstormDraft.idea = ''
  brainstormDraft.constraints = ''
  brainstormDraft.maxPapers = 8
  brainstormStatus.value = 'idle'
  brainstormError.value = ''
  brainstormResults.value = []
  brainstormPlan.value = null
  brainstormEnhancement.value = null
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

  if (isOpening && section === 'abstract') {
    void ensurePaperAbstractLoaded(paperId)
  }

  if (isOpening && section === 'guide') {
    void ensurePaperDetailsLoaded(paperId)
  }
}

function isSectionOpen(paperId: string, section: string) {
  return openSections.value.has(`${paperId}:${section}`)
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
  if (/unclassified/i.test(venue)) {
    return 'Unclassified'
  }

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
    const match = semanticMatchesById.value[paper.id]

    if (match?.lexicalScore !== undefined) {
      return `L${Math.round(match.lexicalScore)}`
    }

    if (match?.semanticScore !== undefined) {
      return match.semanticScore.toFixed(4)
    }

    if (match?.rankScore !== undefined) {
      return `H${match.rankScore.toFixed(4)}`
    }
  }

  const score = outcome.value.matchesById[paper.id]?.score

  if (!query.value.trim() || score === undefined) {
    return '1.0000'
  }

  return Math.min(score / 100, 0.9999).toFixed(4)
}

function resolveBrainstormBackendMessage(error: unknown) {
  const message = error instanceof Error ? error.message : 'Could not reach the brainstorm backend.'

  if (typeof window !== 'undefined' && /github\.io$/i.test(window.location.hostname)) {
    return 'This public Pages site keeps semantic search local in your browser. Secure Zhipu refinement is available only when the project is opened through a server deployment with ZHIPU_API_KEY configured.'
  }

  if (message.includes('404')) {
    return 'Secure AI refinement endpoint is not enabled on this local preview yet. Start the bundled preview server or deploy the project with the backend route enabled.'
  }

  return message
}
</script>

<template>
  <main class="app-shell">
    <TopNavigation
      :active-page="activePage"
      :tabs="pageTabs"
      @navigate="navigateToPage"
    />

    <FinderPage
      v-if="activePage === 'finder'"
      v-model:draft-query="draftQuery"
      v-model:max-results="maxResults"
      v-model:per-page="perPage"
      :paper-count="paperCatalog.length"
      :guided-paper-count="guidedPaperCount"
      :catalog-updated-at="catalogUpdatedAt"
      :is-loading-papers="isLoadingPapers"
      :load-error="loadError"
      :search-mode="searchMode"
      :semantic-status="semanticStatus"
      :semantic-status-label="semanticStatusLabel"
      :show-semantic-progress="showSemanticProgress"
      :semantic-progress-stage-label="semanticProgressStageLabel"
      :semantic-progress-percent="semanticProgressPercent"
      :semantic-progress-message="semanticProgressMessage"
      :active-filter-count="activeFilterCount"
      :venue-groups="venueGroups"
      :category-options="categoryOptions"
      :selected-venue-years="selectedVenueYears"
      :selected-categories="selectedCategories"
      :has-semantic-ranking="hasSemanticRanking"
      :current-page="currentPage"
      :total-pages="totalPages"
      :visible-papers="visiblePapers"
      :selected-year-count="selectedYearCount"
      :is-section-open="isSectionOpen"
      :get-paper-detail="getPaperDetail"
      :get-abstract-copy="getAbstractCopy"
      :format-affinity="formatAffinity"
      :build-bibtex-for-view="buildBibtexForView"
      @export-results="exportResults"
      @clear-search="clearSearch"
      @run-search="runSearch"
      @set-search-mode="setSearchMode"
      @check-semantic-health="checkSemanticHealth"
      @toggle-venue-group="toggleVenueGroup"
      @clear-venue-group="clearVenueGroup"
      @toggle-venue-year="toggleVenueYear"
      @toggle-category="toggleCategory"
      @previous-page="previousPage"
      @next-page="nextPage"
      @toggle-section="toggleSection"
    />

    <NewFindingPage
      v-else-if="activePage === 'new-finding'"
      :latest-workflow-run="latestWorkflowRun"
      :workflow-runs="workflowRuns"
      :workflow-loading="workflowLoading"
      :workflow-error="workflowError"
      :discovery-trace="discoveryTrace"
      :trace-loading="traceLoading"
      :trace-error="traceError"
      :unofficial-store="unofficialStore"
      :unofficial-loading="unofficialLoading"
      :unofficial-error="unofficialError"
      :unofficial-papers="unofficialPapers"
      :unofficial-accepted-count="unofficialAcceptedCount"
      :unofficial-candidate-count="unofficialCandidateCount"
      :unofficial-platform-breakdown="unofficialPlatformBreakdown"
      :discovery-timeline="discoveryTimeline"
      :latest-evidence-cards="latestEvidenceCards"
      :data-base-url="dataBaseUrl"
      @refresh-workflow-runs="refreshWorkflowRuns"
    />

    <BrainStormPage
      v-else
      v-model:requested-model="brainstormRequestedModel"
      :semantic-model="semanticModel"
      :semantic-paper-count="semanticPaperCount"
      :paper-count="paperCatalog.length"
      :brainstorm-draft="brainstormDraft"
      :brainstorm-status="brainstormStatus"
      :brainstorm-error="brainstormError"
      :brainstorm-results="brainstormResults"
      :brainstorm-plan="brainstormPlan"
      :brainstorm-enhancement="brainstormEnhancement"
      :brainstorm-backend-available="brainstormBackendAvailable"
      :brainstorm-backend-message="brainstormBackendMessage"
      :brainstorm-enhancement-state-label="brainstormEnhancementStateLabel"
      :brainstorm-model-label="brainstormModelLabel"
      :brainstorm-enhancing="brainstormEnhancing"
      :get-paper-detail="getPaperDetail"
      @refresh-backend="loadBrainstormBackendStatus(true)"
      @reset="resetBrainstorm"
      @search="runBrainstormSearch"
      @enhance="runBrainstormEnhancement"
    />
  </main>
</template>
