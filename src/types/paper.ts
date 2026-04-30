export type CategoryKey =
  | 'evaluation-benchmarks'
  | 'reasoning'
  | 'rl-post-training'
  | 'agents-tool-use'
  | 'rag-knowledge'
  | 'alignment-safety'
  | 'efficiency-systems'
  | 'coding-formal-tasks'
  | 'mllm-foundations'
  | 'vlm-understanding'
  | 'video-understanding'
  | 'audio-speech'
  | 'three-d-world-modeling'
  | 'vla-embodied-learning'
  | 'robotics-planning'
  | 'scientific-discovery'
  | 'data-synthesis-curation'
  | 'multimodal-generation'

export interface CategoryMeta {
  key: CategoryKey
  index: number
  name: string
  description: string
  accent: string
}

export interface PaperIntroZh {
  motivation: string
  problem: string
  analysis: string
  method: string
  experiment: string
  contribution: string
}

export interface PaperRecord {
  id: string
  title: string
  titleZh?: string
  hookZh?: string
  venue: string
  year: number
  track?: string
  primaryCategory: CategoryKey
  categories: CategoryKey[]
  keywords: string[]
  authors: string[]
  openreviewUrl: string
  pdfUrl?: string
  tldr?: string
  abstract: string
  introZh?: PaperIntroZh
  aliases?: string[]
  source?: string
  sourceId?: string
  guideStatus?: 'ready' | 'pending'
}

export interface PaperCatalogShardRef {
  key: string
  venue: string
  year: number
  path: string
  count: number
}

export interface PaperCatalogIndexRecord
  extends Omit<PaperRecord, 'abstract' | 'introZh'> {
  abstract?: string
  shardKey: string
  hasIntroZh: boolean
  hasAbstract: boolean
}

export interface PaperCatalogShardPayload {
  key: string
  venue: string
  year: number
  count: number
  papers: PaperRecord[]
}

export interface PaperCatalogIndexPayload {
  generatedAt: string
  count: number
  guidedCount: number
  venueYearCount: number
  sources?: Array<{ name: string; url: string; count: number }>
  notes?: string[]
  shards: PaperCatalogShardRef[]
  papers: PaperCatalogIndexRecord[]
}
