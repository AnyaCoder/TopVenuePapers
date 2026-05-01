import { ref } from 'vue'
import type {
  DiscoveryTracePayload,
  FeedLoadError,
  GitHubWorkflowRun,
} from '../types/app'
import type { UnofficialPaperStorePayload } from '../types/paper'

export function useDiscoveryFeed(dataBaseUrl: string) {
  const unofficialStore = ref<UnofficialPaperStorePayload | null>(null)
  const unofficialLoading = ref(true)
  const unofficialError = ref<FeedLoadError | null>(null)
  const discoveryTrace = ref<DiscoveryTracePayload | null>(null)
  const traceLoading = ref(false)
  const traceError = ref<FeedLoadError | null>(null)
  const workflowRuns = ref<GitHubWorkflowRun[]>([])
  const workflowLoading = ref(false)
  const workflowError = ref<FeedLoadError | null>(null)

  async function loadUnofficialStore() {
    unofficialLoading.value = true
    unofficialError.value = null

    try {
      const url = `${dataBaseUrl}data/unofficial/unofficial-papers.json`
      const response = await fetch(url, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw await createFeedError(response, 'Could not load unofficial discovery feed.')
      }

      unofficialStore.value = (await response.json()) as UnofficialPaperStorePayload
    } catch (error) {
      unofficialError.value = normalizeFeedError(
        error,
        'Could not load unofficial discovery feed.',
      )
    } finally {
      unofficialLoading.value = false
    }
  }

  async function loadDiscoveryRuns() {
    workflowLoading.value = true
    workflowError.value = null
    const url =
      'https://api.github.com/repos/AnyaCoder/TopVenuePapers/actions/workflows/discover-unofficial.yml/runs?per_page=5'

    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
        },
      })

      if (!response.ok) {
        throw await createFeedError(response, 'Could not load workflow status.')
      }

      const payload = (await response.json()) as { workflow_runs?: GitHubWorkflowRun[] }
      workflowRuns.value = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : []
    } catch (error) {
      workflowError.value = {
        ...normalizeFeedError(error, 'Could not load workflow status.'),
        url,
        hint:
          'GitHub may return 403 for unauthenticated API calls when rate-limited or blocked by Pages/CORS. Open Actions directly, or wait for the public static discovery trace below.',
      }
    } finally {
      workflowLoading.value = false
    }
  }

  async function loadDiscoveryTrace() {
    traceLoading.value = true
    traceError.value = null

    try {
      const url = `${dataBaseUrl}data/unofficial/discovery-trace.json`
      const response = await fetch(url, {
        cache: 'no-store',
      })

      if (response.status === 404) {
        discoveryTrace.value = null
        return
      }

      if (!response.ok) {
        throw await createFeedError(response, 'Could not load discovery trace.')
      }

      discoveryTrace.value = (await response.json()) as DiscoveryTracePayload
    } catch (error) {
      traceError.value = normalizeFeedError(error, 'Could not load discovery trace.')
    } finally {
      traceLoading.value = false
    }
  }

  return {
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
  }
}

async function createFeedError(response: Response, fallback: string) {
  const body = await safeReadResponseText(response)

  return {
    message: `${fallback} ${response.status} ${response.statusText}`.trim(),
    status: response.status,
    statusText: response.statusText,
    url: response.url,
    body,
  } satisfies FeedLoadError
}

function normalizeFeedError(error: unknown, fallback: string): FeedLoadError {
  if (isFeedLoadError(error)) {
    return error
  }

  return {
    message: error instanceof Error ? error.message : fallback,
  }
}

function isFeedLoadError(error: unknown): error is FeedLoadError {
  return Boolean(error && typeof error === 'object' && 'message' in error)
}

async function safeReadResponseText(response: Response) {
  try {
    return (await response.text()).slice(0, 1200)
  } catch {
    return ''
  }
}
