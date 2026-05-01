import type { PageTab } from '../types/app'
import type { CategoryKey } from '../types/paper'

export const pageTabs: PageTab[] = [
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

export const categoryLabels: Record<CategoryKey, string> = {
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

export const guideLabels = [
  ['motivation', 'Research Motivation'],
  ['problem', 'Problem'],
  ['analysis', 'Analysis'],
  ['method', 'Method'],
  ['experiment', 'Data & Experiments'],
  ['contribution', 'Contribution'],
] as const
