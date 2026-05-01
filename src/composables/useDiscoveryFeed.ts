import { ref } from 'vue'
import type { GitHubWorkflowRun } from '../types/app'
import type { UnofficialPaperStorePayload } from '../types/paper'

export function useDiscoveryFeed(dataBaseUrl: string) {
  const unofficialStore = ref<UnofficialPaperStorePayload | null>(null)
  const unofficialLoading = ref(true)
  const unofficialError = ref('')
  const workflowRuns = ref<GitHubWorkflowRun[]>([])
  const workflowLoading = ref(false)
  const workflowError = ref('')

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

  return {
    unofficialStore,
    unofficialLoading,
    unofficialError,
    workflowRuns,
    workflowLoading,
    workflowError,
    loadUnofficialStore,
    loadDiscoveryRuns,
  }
}
