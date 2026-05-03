import type { AppPage, GitHubWorkflowRun } from '../types/app'
import type { UnofficialPaperEntry } from '../types/paper'

export function formatDateTime(value?: string) {
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

export function formatRelativeTime(value?: string) {
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

export function workflowTone(run: GitHubWorkflowRun | null) {
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

export function humanizeWorkflowStatus(run: GitHubWorkflowRun | null) {
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

export function humanizePlatform(platform: string) {
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

export function discoveryTone(entry: UnofficialPaperEntry) {
  if (entry.status === 'officially-published') {
    return 'muted'
  }

  if (entry.status === 'accepted') {
    return 'good'
  }

  return 'active'
}

export function discoveryStatusLabel(entry: UnofficialPaperEntry) {
  if (entry.status === 'officially-published') {
    return 'Officially published'
  }

  if (entry.status === 'accepted') {
    return 'Accepted signal'
  }

  return 'Candidate signal'
}

export function topEvidence(entry: UnofficialPaperEntry) {
  return entry.evidence?.[0] ?? null
}

export function timestampValue(value?: string) {
  if (!value) {
    return 0
  }

  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

export function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min
  }

  return Math.min(Math.max(Math.trunc(value), min), max)
}

export function resolvePageFromHash(): AppPage {
  if (typeof window === 'undefined') {
    return 'finder'
  }

  const hash = window.location.hash.replace(/^#/, '').trim()

  if (hash === 'new-finding' || hash === 'brain-storm') {
    return hash
  }

  return 'finder'
}
