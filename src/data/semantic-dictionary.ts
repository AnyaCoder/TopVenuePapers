import type { CategoryKey } from '../types/paper'
import { normalizeText, tokenize } from '../utils/normalize'

interface SemanticEntry {
  label: string
  aliases: string[]
  boostCategories: CategoryKey[]
  boostTerms: string[]
}

const semanticDictionary: SemanticEntry[] = [
  {
    label: '长上下文推理',
    aliases: ['长上下文', '长 context', 'long context', '长思维', 'test-time scaling'],
    boostCategories: ['reasoning', 'efficiency-systems'],
    boostTerms: ['context', 'long-context', 'scaling', 'reasoning'],
  },
  {
    label: '推理',
    aliases: ['推理', 'reasoning', 'cot', 'chain of thought', '数学'],
    boostCategories: ['reasoning', 'rl-post-training', 'coding-formal-tasks'],
    boostTerms: ['reasoning', 'chain-of-thought', 'math'],
  },
  {
    label: '强化学习',
    aliases: ['rl', '强化学习', 'post training', '后训练', 'policy optimization'],
    boostCategories: ['rl-post-training', 'vla-embodied-learning'],
    boostTerms: ['reinforcement learning', 'policy', 'optimization'],
  },
  {
    label: 'Agent',
    aliases: ['agent', '智能体', 'tool use', '工具调用', 'computer use', '多代理'],
    boostCategories: ['agents-tool-use', 'efficiency-systems'],
    boostTerms: ['agent', 'tool', 'computer use', 'multi-agent'],
  },
  {
    label: 'RAG / Memory',
    aliases: ['rag', '检索增强', '知识库', '记忆', 'context engineering'],
    boostCategories: ['rag-knowledge', 'agents-tool-use'],
    boostTerms: ['retrieval', 'knowledge', 'memory', 'context'],
  },
  {
    label: '幻觉与对齐',
    aliases: ['幻觉', 'hallucination', 'safety', '对齐', 'mitigation'],
    boostCategories: ['alignment-safety', 'vlm-understanding'],
    boostTerms: ['hallucination', 'safety', 'alignment', 'mitigation'],
  },
  {
    label: '视频理解',
    aliases: ['视频', 'video', '长视频', 'temporal', 'social reasoning'],
    boostCategories: ['video-understanding', 'multimodal-generation'],
    boostTerms: ['video', 'temporal', 'social', 'causal'],
  },
  {
    label: '图文检索',
    aliases: ['图文', 'image-text', 'retrieval', 'matching', '对齐'],
    boostCategories: ['vlm-understanding', 'mllm-foundations'],
    boostTerms: ['image-text', 'matching', 'retrieval', 'semantic'],
  },
  {
    label: '3D / Motion',
    aliases: ['3d', '三维', 'motion', '动作生成', '世界模型', 'world model'],
    boostCategories: ['three-d-world-modeling', 'multimodal-generation'],
    boostTerms: ['3d', 'motion', 'world model', 'scene'],
  },
  {
    label: '具身',
    aliases: ['具身', 'embodied', 'vla', 'robot', 'policy'],
    boostCategories: ['vla-embodied-learning', 'robotics-planning'],
    boostTerms: ['vision-language-action', 'policy', 'robot', 'embodied'],
  },
]

export function collectSemanticSignals(query: string) {
  const normalized = normalizeText(query)
  const expandedTerms = new Set(tokenize(query))
  const matchedLabels: string[] = []
  const matchedCategories = new Set<CategoryKey>()

  semanticDictionary.forEach((entry) => {
    const hit = entry.aliases.some((alias) =>
      normalized.includes(normalizeText(alias)),
    )

    if (!hit) {
      return
    }

    matchedLabels.push(entry.label)
    entry.boostTerms.forEach((term) => expandedTerms.add(normalizeText(term)))
    entry.boostCategories.forEach((category) => matchedCategories.add(category))
  })

  return {
    labels: matchedLabels,
    terms: Array.from(expandedTerms),
    categories: matchedCategories,
  }
}
