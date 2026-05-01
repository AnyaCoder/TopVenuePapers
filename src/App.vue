<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import { usePaperSearch } from './composables/usePaperSearch'
import type {
  CategoryKey,
  PaperAbstractPayload,
  PaperCatalogIndexPayload,
  PaperCatalogIndexRecord,
  PaperCatalogShardPayload,
  PaperRecord,
  UnofficialPaperEntry,
  UnofficialPaperStorePayload,
} from './types/paper'
import type { BrowserSemanticProgress } from './utils/browserSemanticSearch'
import { buildBrainstormQuery, buildLocalBrainstormPlan, rankPapersByTextQuery, type BrainstormDraft } from './utils/brainstorm'
import { getVenueBadge } from './utils/venue'
import type {
  BrainstormBackendStatus,
  BrainstormEnhancement,
} from './utils/brainstormApi'

type AppPage = 'finder' | 'new-finding' | 'brain-storm'
type SearchMode = 'semantic' | 'keyword'
type SemanticStatus = 'idle' | 'checking' | 'ready' | 'searching' | 'offline' | 'error'
type BrainstormStatus = 'idle' | 'searching' | 'ready' | 'error'

interface SemanticResult {
  id: string
  score: number
  title?: string
}

interface GitHubWorkflowRun {
  id: number
  html_url: string
  status: string
  conclusion: string | null
  created_at: string
  updated_at: string
  display_title: string
  event: string
  run_number: number
}

interface BrainstormRelatedPaper {
  paper: PaperCatalogIndexRecord
  score: number
}

interface DiscoveryTimelineItem {
  id: string
  kind: 'workflow' | 'snapshot' | 'paper'
  title: string
  detail: string
  timestamp: string
  tone: 'good' | 'active' | 'muted' | 'bad'
  href?: string
}

interface DiscoveryEvidenceCard {
  id: string
  title: string
  paperTitle: string
  platform: string
  snippet: string
  timestamp: string
  href: string
  tone: 'good' | 'active'
}

const pageTabs: Array<{ key: AppPage; label: string; blurb: string }> = [
  {
    key: 'finder',
    label: 'Home',
    blurb: 'Search official and unofficial 2026 papers.',
  },
  {
    key: 'new-finding',
    label: 'New Finding',
    blurb: 'Monitor the social-media discovery pipeline.',
  },
  {
    key: 'brain-storm',
    label: 'Brain Storm',
    blurb: 'Shape new paper ideas with semantic retrieval.',
  },
]

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
  ['motivation', 'Research Motivation'],
  ['problem', 'Problem'],
  ['analysis', 'Analysis'],
  ['method', 'Method'],
  ['experiment', 'Data & Experiments'],
  ['contribution', 'Contribution'],
] as const

const activePage = ref<AppPage>(resolvePageFromHash())

const draftQuery = ref('')
const maxResults = ref(100)
const perPage = ref(10)
const currentPage = ref(1)
const selectedVenueYears = ref(new Set<string>())
const selectedCategories = ref(new Set<CategoryKey>())
const openSections = ref(new Set<string>())

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

const unofficialStore = ref<UnofficialPaperStorePayload | null>(null)
const unofficialLoading = ref(true)
const unofficialError = ref('')
const workflowRuns = ref<GitHubWorkflowRun[]>([])
const workflowLoading = ref(false)
const workflowError = ref('')
let workflowIntervalId: number | undefined

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

const { query, outcome } = usePaperSearch(
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

const paperById = computed(
  () => new Map(paperCatalog.value.map((paper) => [paper.id, paper])),
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
    await Promise.all([loadUnofficialStore(), loadDiscoveryRuns()])
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
  void loadDiscoveryRuns()
  void loadBrainstormBackendStatus()

  if (typeof window !== 'undefined') {
    workflowIntervalId = window.setInterval(() => {
      if (activePage.value === 'new-finding') {
        void loadDiscoveryRuns()
        void loadUnofficialStore()
      }
    }, 60000)
  }
})

onUnmounted(() => {
  detachSemanticProgress?.()

  if (typeof window !== 'undefined') {
    window.removeEventListener('hashchange', syncPageFromHash)
  }

  if (workflowIntervalId !== undefined && typeof window !== 'undefined') {
    window.clearInterval(workflowIntervalId)
  }
})

function syncPageFromHash() {
  activePage.value = resolvePageFromHash()
}

function navigateToPage(page: AppPage) {
  activePage.value = page
}

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

async function loadUnofficialStore() {
  unofficialLoading.value = true
  unofficialError.value = ''

  try {
    const response = await fetch(`${dataBaseUrl}data/unofficial/unofficial-papers.json`, {
      cache: 'no-store',
    })

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    unofficialStore.value = (await response.json()) as UnofficialPaperStorePayload
  } catch (error) {
    unofficialError.value =
      error instanceof Error ? error.message : 'Could not load unofficial discovery feed.'
  } finally {
    unofficialLoading.value = false
  }
}

async function loadDiscoveryRuns() {
  workflowLoading.value = true
  workflowError.value = ''

  try {
    const response = await fetch(
      'https://api.github.com/repos/AnyaCoder/TopVenuePapers/actions/workflows/discover-unofficial.yml/runs?per_page=5',
      {
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
        },
      },
    )

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`)
    }

    const payload = (await response.json()) as { workflow_runs?: GitHubWorkflowRun[] }
    workflowRuns.value = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : []
  } catch (error) {
    workflowError.value =
      error instanceof Error ? error.message : 'Could not load workflow status.'
  } finally {
    workflowLoading.value = false
  }
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
    let related: BrainstormRelatedPaper[] = []

    try {
      const { searchBrowserSemanticIndex } = await import('./utils/browserSemanticSearch')
      const semanticHits = await searchBrowserSemanticIndex(
        composedQuery,
        Math.min(Math.max(maxPapersForIdea * 6, 24), 120),
      )

      const semanticRelated: BrainstormRelatedPaper[] = []

      for (const item of semanticHits) {
        const paper = paperById.value.get(item.id)

        if (!paper) {
          continue
        }

        semanticRelated.push({
          paper,
          score: item.score,
        })

        if (semanticRelated.length >= maxPapersForIdea) {
          break
        }
      }

      related = semanticRelated
    } catch {
      related = rankPapersByTextQuery(
        paperCatalog.value,
        composedQuery,
        maxPapersForIdea,
      ).map((paper) => ({ paper, score: 0 }))
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

function formatDateTime(value?: string) {
  if (!value) {
    return 'Unknown'
  }

  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatRelativeTime(value?: string) {
  const date = value ? new Date(value) : null

  if (!date || Number.isNaN(date.getTime())) {
    return 'Unknown time'
  }

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.round(diffMs / 60000)

  if (Math.abs(diffMinutes) < 1) {
    return 'Just now'
  }

  if (Math.abs(diffMinutes) < 60) {
    return `${Math.abs(diffMinutes)} min ${diffMinutes >= 0 ? 'ago' : 'later'}`
  }

  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 48) {
    return `${Math.abs(diffHours)} hr ${diffHours >= 0 ? 'ago' : 'later'}`
  }

  const diffDays = Math.round(diffHours / 24)
  return `${Math.abs(diffDays)} day${Math.abs(diffDays) === 1 ? '' : 's'} ${diffDays >= 0 ? 'ago' : 'later'}`
}

function workflowTone(run: GitHubWorkflowRun | null) {
  if (!run) {
    return 'muted'
  }
  if (run.status === 'in_progress') {
    return 'active'
  }
  if (run.conclusion === 'success') {
    return 'good'
  }
  if (run.conclusion === 'failure' || run.conclusion === 'cancelled') {
    return 'bad'
  }
  return 'muted'
}

function humanizeWorkflowStatus(run: GitHubWorkflowRun | null) {
  if (!run) {
    return 'No workflow run yet.'
  }

  if (run.status === 'in_progress') {
    return 'Running'
  }

  if (run.conclusion === 'success') {
    return 'Healthy'
  }

  if (run.conclusion === 'failure') {
    return 'Failed'
  }

  if (run.conclusion === 'cancelled') {
    return 'Cancelled'
  }

  return run.status
}

function humanizePlatform(platform: string) {
  const normalized = platform.trim().toLowerCase()

  if (normalized === 'x') {
    return 'X'
  }
  if (normalized === 'xiaohongshu') {
    return 'Xiaohongshu'
  }
  if (normalized === 'web') {
    return 'Web / Homepage'
  }
  if (normalized === 'arxiv') {
    return 'arXiv'
  }

  return platform
}

function discoveryTone(entry: UnofficialPaperEntry) {
  if (entry.status === 'accepted') {
    return 'good'
  }

  return 'active'
}

function topEvidence(entry: UnofficialPaperEntry) {
  return entry.evidence?.[0] ?? null
}

function timestampValue(value?: string) {
  if (!value) {
    return 0
  }

  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
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

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(Math.max(Math.trunc(value), min), max)
}

function resolvePageFromHash(): AppPage {
  if (typeof window === 'undefined') {
    return 'finder'
  }

  const hash = window.location.hash.replace(/^#/, '').trim()

  if (hash === 'new-finding' || hash === 'brain-storm') {
    return hash
  }

  return 'finder'
}
</script>

<template>
  <main class="app-shell">
    <header class="topbar">
      <div class="topbar__inner">
        <nav class="topbar__nav" aria-label="Primary">
          <button
            v-for="tab in pageTabs"
            :key="tab.key"
            type="button"
            class="topbar__tab"
            :class="{ 'is-active': activePage === tab.key }"
            @click="navigateToPage(tab.key)"
          >
            <span>{{ tab.label }}</span>
            <small>{{ tab.blurb }}</small>
          </button>
        </nav>

      </div>
    </header>

    <section v-if="activePage === 'finder'" class="finder-shell">
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
            <span>CCF-A Papers</span>
            <a href="https://openreview.net" target="_blank" rel="noreferrer">
              OpenReview
            </a>
            <span>{{ paperCatalog.length }} papers loaded.</span>
            <span>{{ guidedPaperCount }} with Chinese guides.</span>
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

            <div v-if="showSemanticProgress" class="semantic-progress-card">
              <div class="semantic-progress-card__top">
                <strong>{{ semanticProgressStageLabel }}</strong>
                <span v-if="semanticProgressPercent !== null">{{ semanticProgressPercent }}%</span>
              </div>
              <div class="semantic-progress-bar" aria-hidden="true">
                <div
                  class="semantic-progress-bar__fill"
                  :style="{ width: `${semanticProgressPercent ?? 12}%` }"
                />
              </div>
              <p class="semantic-progress-card__copy">
                {{ semanticProgressMessage }}
              </p>
            </div>

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
                  <span class="venue-chip">{{ getVenueBadge(paper) }}</span>
                  <div class="result-card__titlegroup">
                    <h3>{{ paper.title }}</h3>
                    <p class="result-card__meta">
                      <span>{{ paper.venue }}</span>
                      <span v-if="paper.track">{{ paper.track }}</span>
                    </p>
                  </div>
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
                Open
                <br />
                Link
              </a>

              <div class="result-card__details">
                <button type="button" @click="toggleSection(paper.id, 'abstract')">
                  <span>{{ isSectionOpen(paper.id, 'abstract') ? '▾' : '▸' }}</span>
                  Show Abstract
                </button>
                <p v-if="isSectionOpen(paper.id, 'abstract')" class="detail-copy">
                  {{ getAbstractCopy(paper) }}
                </p>

                <button type="button" @click="toggleSection(paper.id, 'guide')">
                  <span>{{ isSectionOpen(paper.id, 'guide') ? '▾' : '▸' }}</span>
                  {{ paper.hasIntroZh ? 'Show Chinese Guide' : 'Chinese Guide Pending' }}
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
                  This paper is already indexed. The six-dimension Chinese guide can be generated later.
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
    </section>

    <section v-else-if="activePage === 'new-finding'" class="page-shell">
      <header class="page-hero page-hero--dashboard">
        <div class="page-hero__content">
          <p class="page-hero__eyebrow">Daily Social Discovery</p>
          <h1>New Finding</h1>
          <p>
            Track the scheduled Zhipu-based discovery job that scans X, Xiaohongshu,
            and personal homepages for fresh 2026 paper announcements.
          </p>
        </div>
        <div class="page-hero__meta-grid">
          <article class="hero-stat-card" :data-tone="workflowTone(latestWorkflowRun)">
            <span>Workflow</span>
            <strong>{{ humanizeWorkflowStatus(latestWorkflowRun) }}</strong>
            <small>
              {{ latestWorkflowRun ? formatDateTime(latestWorkflowRun.updated_at) : 'Waiting for the first run.' }}
            </small>
          </article>
          <article class="hero-stat-card" data-tone="good">
            <span>Unofficial Queue</span>
            <strong>{{ unofficialPapers.length }}</strong>
            <small>{{ unofficialAcceptedCount }} accepted-signal, {{ unofficialCandidateCount }} candidate</small>
          </article>
          <article class="hero-stat-card" data-tone="active">
            <span>Schedule</span>
            <strong>09:15 CST daily</strong>
            <small>GitHub Actions workflow with concurrency protection.</small>
          </article>
        </div>
      </header>

      <section class="page-grid page-grid--dashboard">
        <article class="page-card">
          <div class="page-card__head">
            <h2>Pipeline Status</h2>
            <a
              class="text-link"
              href="https://github.com/AnyaCoder/TopVenuePapers/actions/workflows/discover-unofficial.yml"
              target="_blank"
              rel="noreferrer"
            >
              Open Actions
            </a>
          </div>

          <div v-if="workflowLoading" class="empty-state">
            Loading workflow status...
          </div>
          <div v-else-if="workflowError" class="empty-state empty-state--error">
            {{ workflowError }}
          </div>
          <div v-else class="run-list">
            <article
              v-for="run in workflowRuns"
              :key="run.id"
              class="run-card"
              :data-tone="workflowTone(run)"
            >
              <div class="run-card__top">
                <strong>{{ run.display_title }}</strong>
                <span class="status-pill" :data-tone="workflowTone(run)">
                  {{ humanizeWorkflowStatus(run) }}
                </span>
              </div>
              <p>
                Run #{{ run.run_number }} · {{ run.event }} · Updated {{ formatDateTime(run.updated_at) }}
              </p>
              <a :href="run.html_url" target="_blank" rel="noreferrer">Open run</a>
            </article>
          </div>
        </article>

        <article class="page-card">
          <div class="page-card__head">
            <h2>Source Breakdown</h2>
            <a
              class="text-link"
              :href="`${dataBaseUrl}data/unofficial/unofficial-papers.json`"
              target="_blank"
              rel="noreferrer"
            >
              Raw JSON
            </a>
          </div>

          <div v-if="unofficialLoading" class="empty-state">
            Loading unofficial discovery queue...
          </div>
          <div v-else-if="unofficialError" class="empty-state empty-state--error">
            {{ unofficialError }}
          </div>
          <div v-else class="source-breakdown">
            <div class="feed-summary__row">
              <span>Last generated</span>
              <strong>{{ formatDateTime(unofficialStore?.generatedAt) }}</strong>
            </div>
            <div class="feed-summary__row">
              <span>Platform spread</span>
              <div class="tag-row">
                <span
                  v-for="item in unofficialPlatformBreakdown"
                  :key="item.platform"
                  class="tag"
                >
                  {{ item.platform }} · {{ item.count }}
                </span>
                <span v-if="unofficialPlatformBreakdown.length === 0" class="tag">No platform hits yet</span>
              </div>
            </div>
            <div v-if="unofficialPlatformBreakdown.length > 0" class="source-breakdown__list">
              <article
                v-for="item in unofficialPlatformBreakdown"
                :key="`breakdown:${item.platform}`"
                class="source-breakdown__item"
              >
                <div class="source-breakdown__head">
                  <strong>{{ item.platform }}</strong>
                  <span>{{ item.count }}</span>
                </div>
                <div class="source-breakdown__bar" aria-hidden="true">
                  <div
                    class="source-breakdown__fill"
                    :style="{ width: `${(item.count / (unofficialPlatformBreakdown[0]?.count || 1)) * 100}%` }"
                  />
                </div>
              </article>
            </div>
            <div class="feed-summary__row">
              <span>Notes</span>
              <ul class="notes-list">
                <li v-for="note in unofficialStore?.notes ?? []" :key="note">{{ note }}</li>
              </ul>
            </div>
          </div>
        </article>

        <article class="page-card page-card--wide">
          <div class="page-card__head">
            <h2>Discovered Papers</h2>
            <span>{{ unofficialPapers.length }} items</span>
          </div>

          <div v-if="!unofficialLoading && unofficialPapers.length === 0" class="empty-state">
            No unofficial papers are waiting in the queue right now.
          </div>
          <div v-else class="discovery-list">
            <article
              v-for="entry in unofficialPapers"
              :key="entry.id"
              class="discovery-card"
            >
              <div class="discovery-card__top">
                <div>
                  <div class="discovery-card__badges">
                    <span class="status-pill" :data-tone="discoveryTone(entry)">
                      {{ entry.status === 'accepted' ? 'Accepted signal' : 'Candidate signal' }}
                    </span>
                    <span class="status-pill" data-tone="muted">
                      {{ entry.acceptedVenue || 'Unclassified' }}
                    </span>
                    <span class="status-pill" data-tone="muted">
                      {{ entry.confidence ? `${Math.round(entry.confidence * 100)}% confidence` : 'No confidence score' }}
                    </span>
                  </div>
                  <h3>{{ entry.title }}</h3>
                  <p v-if="entry.titleZh" class="muted-copy">{{ entry.titleZh }}</p>
                </div>
                <a :href="entry.primaryUrl" target="_blank" rel="noreferrer">Open source</a>
              </div>

              <p class="discovery-card__summary">
                {{ entry.summary || entry.reason || 'No summary yet.' }}
              </p>

              <div class="tag-row">
                <span v-for="platform in entry.platforms ?? []" :key="platform" class="tag">
                  {{ humanizePlatform(platform) }}
                </span>
                <span v-for="keyword in (entry.keywords ?? []).slice(0, 5)" :key="keyword" class="tag">
                  {{ keyword }}
                </span>
              </div>

              <div class="discovery-card__foot">
                <span>Discovered {{ formatDateTime(entry.discoveredAt) }}</span>
                <span v-if="topEvidence(entry)">
                  Evidence: {{ topEvidence(entry)?.title || topEvidence(entry)?.readerTitle || humanizePlatform(topEvidence(entry)?.platform || 'web') }}
                </span>
              </div>
            </article>
          </div>
        </article>

        <article class="page-card page-card--wide">
          <div class="page-card__head">
            <h2>Live Timeline</h2>
            <span>{{ discoveryTimeline.length }} events</span>
          </div>

          <div v-if="discoveryTimeline.length === 0" class="empty-state">
            Timeline events will appear here after the crawler starts producing snapshots.
          </div>
          <div v-else class="timeline-list">
            <article
              v-for="item in discoveryTimeline"
              :key="item.id"
              class="timeline-card"
              :data-tone="item.tone"
            >
              <div class="timeline-card__dot" aria-hidden="true" />
              <div class="timeline-card__body">
                <div class="timeline-card__head">
                  <strong>{{ item.title }}</strong>
                  <span>{{ formatRelativeTime(item.timestamp) }}</span>
                </div>
                <p>{{ item.detail }}</p>
                <div class="timeline-card__meta">
                  <span>{{ formatDateTime(item.timestamp) }}</span>
                  <a v-if="item.href" :href="item.href" target="_blank" rel="noreferrer">
                    Open
                  </a>
                </div>
              </div>
            </article>
          </div>
        </article>

        <article class="page-card page-card--wide">
          <div class="page-card__head">
            <h2>Latest Evidence</h2>
            <span>{{ latestEvidenceCards.length }} cards</span>
          </div>

          <div v-if="latestEvidenceCards.length === 0" class="empty-state">
            Evidence cards will show the strongest snippets from X, Xiaohongshu, or homepages once discovered.
          </div>
          <div v-else class="evidence-list">
            <article
              v-for="card in latestEvidenceCards"
              :key="card.id"
              class="evidence-card"
              :data-tone="card.tone"
            >
              <div class="evidence-card__head">
                <span class="status-pill" :data-tone="card.tone">{{ card.platform }}</span>
                <span>{{ formatRelativeTime(card.timestamp) }}</span>
              </div>
              <h3>{{ card.title }}</h3>
              <p class="muted-copy">{{ card.paperTitle }}</p>
              <p class="evidence-card__snippet">{{ card.snippet }}</p>
              <a :href="card.href" target="_blank" rel="noreferrer">Open evidence</a>
            </article>
          </div>
        </article>
      </section>
    </section>

    <section v-else class="page-shell">
      <header class="page-hero page-hero--idea">
        <div class="page-hero__content">
          <p class="page-hero__eyebrow">Semantic Ideation Copilot</p>
          <h1>Brain Storm</h1>
          <p>
            Write the background, the rough idea, and your constraints. The page pulls
            semantically related papers first, then can refine the research plan with Zhipu.
          </p>
        </div>
        <div class="page-hero__meta-grid">
          <article class="hero-stat-card" data-tone="good">
            <span>Semantic Engine</span>
            <strong>{{ semanticModel }}</strong>
            <small>{{ semanticPaperCount || paperCatalog.length }} indexed papers</small>
          </article>
          <article class="hero-stat-card" data-tone="active">
            <span>Max Related Papers</span>
            <strong>{{ clampNumber(brainstormDraft.maxPapers, 1, 20) }}</strong>
            <small>Adjust how many references guide the idea.</small>
          </article>
          <article class="hero-stat-card" data-tone="muted">
            <span>Secure AI Refinement</span>
            <strong>{{ brainstormEnhancementStateLabel }}</strong>
            <small>{{ brainstormBackendAvailable ? brainstormModelLabel : 'Backend not enabled on this deployment.' }}</small>
          </article>
        </div>
      </header>

      <section class="page-grid page-grid--idea">
        <article class="page-card page-card--sticky">
          <div class="page-card__head">
            <h2>Idea Input</h2>
            <div class="header-actions">
              <button type="button" class="quiet-button" @click="loadBrainstormBackendStatus(true)">
                Refresh backend
              </button>
              <button type="button" class="quiet-button" @click="resetBrainstorm">
                Reset
              </button>
            </div>
          </div>

          <div class="form-stack">
            <label class="field-block">
              <span>Problem background</span>
              <textarea
                v-model="brainstormDraft.background"
                rows="5"
                placeholder="What setting, failure case, or user need are you trying to address?"
              />
            </label>

            <label class="field-block">
              <span>Core idea</span>
              <textarea
                v-model="brainstormDraft.idea"
                rows="6"
                placeholder="Describe the method intuition, architecture sketch, or hypothesis."
              />
            </label>

            <label class="field-block">
              <span>Constraints / desired properties</span>
              <textarea
                v-model="brainstormDraft.constraints"
                rows="4"
                placeholder="Latency, data limits, benchmark preference, interpretability, deployment, and so on."
              />
            </label>

            <label class="field-block">
              <span>Maximum related papers</span>
              <input v-model.number="brainstormDraft.maxPapers" type="number" min="1" max="20" />
            </label>

            <div class="action-row">
              <button
                type="button"
                class="primary-action"
                :disabled="brainstormStatus === 'searching'"
                @click="runBrainstormSearch"
              >
                {{ brainstormStatus === 'searching' ? 'Scanning papers...' : 'Find related papers' }}
              </button>
            </div>

            <div class="brainstorm-enhance">
              <div class="brainstorm-enhance__head">
                <h3>Secure AI Refinement</h3>
                <span>{{ brainstormEnhancementStateLabel }}</span>
              </div>
              <p class="muted-copy">
                {{ brainstormBackendMessage }}
              </p>
              <label class="field-block">
                <span>Preferred model (optional)</span>
                <input
                  v-model="brainstormRequestedModel"
                  type="text"
                  placeholder="glm-4.5-flash"
                />
              </label>
              <button
                type="button"
                class="secondary-action"
                :disabled="brainstormEnhancing || !brainstormBackendAvailable"
                @click="runBrainstormEnhancement"
              >
                {{ brainstormEnhancing ? 'Enhancing...' : 'Refine with Zhipu' }}
              </button>
            </div>
          </div>
        </article>

        <section class="idea-output">
          <article class="page-card">
            <div class="page-card__head">
              <h2>Drafted Research Plan</h2>
              <span>{{ brainstormResults.length }} related papers</span>
            </div>

            <div v-if="brainstormStatus === 'idle'" class="empty-state">
              Start with a background and idea sketch. The page will run semantic search first.
            </div>
            <div v-else-if="brainstormStatus === 'error'" class="empty-state empty-state--error">
              {{ brainstormError }}
            </div>
            <div v-else-if="brainstormPlan" class="plan-grid">
              <article class="plan-card">
                <h3>Positioning</h3>
                <ul>
                  <li v-for="item in brainstormPlan.positioning" :key="item">{{ item }}</li>
                </ul>
              </article>

              <article class="plan-card">
                <h3>Method Blueprint</h3>
                <ul>
                  <li v-for="item in brainstormPlan.methodBlueprint" :key="item">{{ item }}</li>
                </ul>
              </article>

              <article class="plan-card">
                <h3>Evaluation Plan</h3>
                <ul>
                  <li v-for="item in brainstormPlan.evaluationPlan" :key="item">{{ item }}</li>
                </ul>
              </article>

              <article class="plan-card">
                <h3>Novelty Angles</h3>
                <ul>
                  <li v-for="item in brainstormPlan.noveltyAngles" :key="item">{{ item }}</li>
                </ul>
              </article>
            </div>
          </article>

          <article v-if="brainstormEnhancement" class="page-card">
            <div class="page-card__head">
              <h2>Zhipu Refined Outline</h2>
              <span>{{ brainstormModelLabel }}</span>
            </div>

            <div class="plan-grid">
              <article class="plan-card plan-card--wide">
                <h3>Refined Problem</h3>
                <p>{{ brainstormEnhancement.refinedProblem }}</p>
              </article>
              <article class="plan-card">
                <h3>Method Modules</h3>
                <ul>
                  <li v-for="item in brainstormEnhancement.methodModules" :key="item">{{ item }}</li>
                </ul>
              </article>
              <article class="plan-card">
                <h3>Experiment Plan</h3>
                <ul>
                  <li v-for="item in brainstormEnhancement.experimentPlan" :key="item">{{ item }}</li>
                </ul>
              </article>
              <article class="plan-card">
                <h3>Novelty Angles</h3>
                <ul>
                  <li v-for="item in brainstormEnhancement.noveltyAngles" :key="item">{{ item }}</li>
                </ul>
              </article>
              <article class="plan-card">
                <h3>Risks</h3>
                <ul>
                  <li v-for="item in brainstormEnhancement.risks" :key="item">{{ item }}</li>
                </ul>
              </article>
            </div>
          </article>

          <article class="page-card">
            <div class="page-card__head">
              <h2>Related Papers</h2>
              <span>{{ brainstormResults.length }} matches</span>
            </div>

            <div v-if="brainstormResults.length === 0" class="empty-state">
              Related papers will appear here after semantic retrieval.
            </div>
            <div v-else class="brainstorm-paper-list">
              <article
                v-for="item in brainstormResults"
                :key="item.paper.id"
                class="brainstorm-paper-card"
              >
                <div class="brainstorm-paper-card__top">
                  <span class="venue-chip">{{ getVenueBadge(item.paper) }}</span>
                  <div>
                    <h3>{{ item.paper.title }}</h3>
                    <p class="muted-copy">
                      {{ item.paper.authors.join(', ') }}
                    </p>
                  </div>
                  <span v-if="item.score !== undefined" class="score-chip">
                    {{ item.score.toFixed(4) }}
                  </span>
                </div>
                <p class="brainstorm-paper-card__abstract">
                  {{ getPaperDetail(item.paper).abstract || item.paper.hookZh || 'Abstract will load on demand.' }}
                </p>
                <div class="tag-row">
                  <span
                    v-for="keyword in item.paper.keywords.slice(0, 6)"
                    :key="keyword"
                    class="tag"
                  >
                    {{ keyword }}
                  </span>
                </div>
                <a :href="item.paper.openreviewUrl" target="_blank" rel="noreferrer">
                  Open paper
                </a>
              </article>
            </div>
          </article>
        </section>
      </section>
    </section>
  </main>
</template>
