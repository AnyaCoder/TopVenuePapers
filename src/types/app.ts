import type { PaperCatalogIndexRecord } from './paper'

export type AppPage = 'finder' | 'new-finding' | 'brain-storm'
export type SearchMode = 'semantic' | 'keyword'
export type SemanticStatus =
  | 'idle'
  | 'checking'
  | 'ready'
  | 'searching'
  | 'offline'
  | 'error'
export type BrainstormStatus = 'idle' | 'searching' | 'ready' | 'error'

export interface PageTab {
  key: AppPage
  label: string
  blurb: string
}

export interface SemanticResult {
  id: string
  score: number
  title?: string
}

export interface GitHubWorkflowRun {
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

export interface BrainstormRelatedPaper {
  paper: PaperCatalogIndexRecord
  score: number
  semanticScore?: number
  lexicalScore?: number
  signals?: string[]
}

export interface DiscoveryTimelineItem {
  id: string
  kind: 'workflow' | 'snapshot' | 'paper'
  title: string
  detail: string
  timestamp: string
  tone: 'good' | 'active' | 'muted' | 'bad'
  href?: string
}

export interface DiscoveryEvidenceCard {
  id: string
  title: string
  paperTitle: string
  platform: string
  snippet: string
  timestamp: string
  href: string
  tone: 'good' | 'active'
}
