export const introKeys = [
  'motivation',
  'problem',
  'analysis',
  'method',
  'experiment',
  'contribution',
]

export const categoryDefinitions = [
  {
    key: 'evaluation-benchmarks',
    name: '评测基准 / Evaluation',
    hints: ['benchmark', 'evaluation', 'eval', 'dataset', 'leaderboard', 'protocol', 'diagnostic'],
  },
  {
    key: 'reasoning',
    name: '推理 / Reasoning',
    hints: ['reasoning', 'chain-of-thought', 'cot', 'math', 'verifiable', 'test-time', 'inference-time'],
  },
  {
    key: 'rl-post-training',
    name: '推理 RL / Post-training',
    hints: ['reinforcement learning', 'rl', 'preference', 'reward', 'policy optimization', 'post-training', 'alignment tuning'],
  },
  {
    key: 'agents-tool-use',
    name: 'Agent / Tool Use',
    hints: ['agent', 'tool use', 'computer use', 'web agent', 'multi-agent', 'workflow', 'planner'],
  },
  {
    key: 'rag-knowledge',
    name: 'RAG / Knowledge',
    hints: ['rag', 'retrieval augmented', 'retrieval-augmented', 'knowledge', 'memory', 'context engineering'],
  },
  {
    key: 'alignment-safety',
    name: '对齐 / Safety',
    hints: ['safety', 'alignment', 'hallucination', 'jailbreak', 'toxicity', 'robustness', 'guardrail'],
  },
  {
    key: 'efficiency-systems',
    name: '效率 / Systems',
    hints: ['efficient', 'efficiency', 'token', 'latency', 'serving', 'runtime', 'compression', 'moe', 'routing'],
  },
  {
    key: 'coding-formal-tasks',
    name: '代码 / Formal Tasks',
    hints: ['code', 'coding', 'program', 'formal', 'theorem', 'proof', 'software engineering'],
  },
  {
    key: 'mllm-foundations',
    name: 'MLLM Foundations',
    hints: ['multimodal large language model', 'mllm', 'multi-modal', 'multimodal', 'foundation model'],
  },
  {
    key: 'vlm-understanding',
    name: 'VLM 理解 / Retrieval',
    hints: ['vision-language', 'vlm', 'image-text', 'visual question answering', 'vqa', 'caption', 'retrieval'],
  },
  {
    key: 'video-understanding',
    name: '视频理解 / Video',
    hints: ['video', 'temporal', 'long video', 'movie', 'frame', 'action recognition'],
  },
  {
    key: 'audio-speech',
    name: '音频语音 / Audio',
    hints: ['audio', 'speech', 'voice', 'asr', 'tts', 'sound'],
  },
  {
    key: 'three-d-world-modeling',
    name: '3D / World Model',
    hints: ['3d', 'three-dimensional', 'world model', 'scene', 'motion', 'spatial', 'geometry'],
  },
  {
    key: 'vla-embodied-learning',
    name: 'VLA / Embodied',
    hints: ['vision-language-action', 'vla', 'embodied', 'manipulation', 'control task', 'humanoid'],
  },
  {
    key: 'robotics-planning',
    name: 'Robotics / Planning',
    hints: ['robot', 'robotics', 'planning', 'control', 'trajectory', 'policy', 'navigation'],
  },
  {
    key: 'scientific-discovery',
    name: 'Science / Discovery',
    hints: ['science', 'scientific', 'biology', 'chemistry', 'molecule', 'protein', 'materials'],
  },
  {
    key: 'data-synthesis-curation',
    name: '数据 / Curation',
    hints: ['data synthesis', 'synthetic data', 'curation', 'augmentation', 'data cleaning', 'dataset construction'],
  },
  {
    key: 'multimodal-generation',
    name: '多模态生成 / Generation',
    hints: ['generation', 'diffusion', 'image generation', 'video generation', 'editing', 'text-to-image', 'text-to-video'],
  },
]

export const categoryKeys = new Set(categoryDefinitions.map((category) => category.key))

const focusHints = [
  'large language model',
  'language model',
  'llm',
  'vlm',
  'vla',
  'mllm',
  'multimodal',
  'multi-modal',
  'vision-language',
  'vision language',
  'agent',
  'reasoning',
  'retrieval',
  'hallucination',
  'video',
  'robot',
  'embodied',
  'world model',
  'computer use',
]

export function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function slugify(value, fallback = 'paper') {
  const slug = normalizeText(value)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

  return slug || fallback
}

export function getContentValue(content, key, fallback = '') {
  const value = content?.[key]

  if (value && typeof value === 'object' && 'value' in value) {
    return value.value ?? fallback
  }

  return value ?? fallback
}

export function splitKeywords(value) {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean)
  }

  const text = String(value ?? '').trim()

  if (!text) {
    return []
  }

  const separatorSplit = text
    .split(/[;,|]/)
    .map((item) => item.trim())
    .filter(Boolean)

  return separatorSplit.length > 1 ? separatorSplit : [text]
}

export function parseAuthors(content) {
  const bibtex = String(getContentValue(content, '_bibtex', ''))
  const authorMatch = bibtex.match(/author\s*=\s*\{([^}]+)\}/i)

  if (authorMatch?.[1]) {
    return authorMatch[1]
      .split(/\s+and\s+/i)
      .map((author) => author.trim())
      .filter(Boolean)
  }

  const authors = getContentValue(content, 'authors', [])

  if (Array.isArray(authors)) {
    return authors.map(String).map((author) => author.trim()).filter(Boolean)
  }

  const text = String(authors ?? '').trim()

  if (!text) {
    return ['Unknown authors']
  }

  return text.includes(';') || text.includes(',')
    ? text.split(/[;,]/).map((author) => author.trim()).filter(Boolean)
    : [text]
}

export function classifyText(parts) {
  const haystack = normalizeText(parts.filter(Boolean).join(' '))
  const scored = categoryDefinitions.map((category) => {
    const matched = category.hints.filter((hint) => haystack.includes(normalizeText(hint)))
    return {
      key: category.key,
      score: matched.length,
      matched,
    }
  })

  const focusScore = focusHints.filter((hint) => haystack.includes(normalizeText(hint))).length
  const ranked = scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)

  return {
    focusScore,
    primaryCategory: ranked[0]?.key ?? 'mllm-foundations',
    categories: ranked.slice(0, 4).map((item) => item.key),
    matchedRules: Object.fromEntries(ranked.map((item) => [item.key, item.matched])),
  }
}

export function normalizeOpenReviewNote(note) {
  const content = note.content ?? {}
  const title = String(getContentValue(content, 'title', '')).trim()
  const venue = String(getContentValue(content, 'venue', '')).trim()
  const abstract = String(getContentValue(content, 'abstract', '')).trim()
  const tldr = String(getContentValue(content, 'TLDR', getContentValue(content, 'tldr', ''))).trim()
  const keywords = splitKeywords(getContentValue(content, 'keywords', []))
  const primaryArea = String(getContentValue(content, 'primary_area', '')).trim()
  const openreviewId = note.forum || note.id
  const pdfPath = String(getContentValue(content, 'pdf', '')).trim()
  const classification = classifyText([title, abstract, tldr, keywords.join(' '), primaryArea])

  return {
    source: 'openreview',
    id: slugify(title, openreviewId),
    openreviewId,
    title,
    venue,
    year: Number(venue.match(/\b(20\d{2})\b/)?.[1] ?? 2026),
    authors: parseAuthors(content),
    keywords,
    primaryArea,
    tldr,
    abstract,
    openreviewUrl: `https://openreview.net/forum?id=${openreviewId}`,
    pdfUrl: pdfPath ? new URL(pdfPath, 'https://openreview.net').toString() : undefined,
    primaryCategory: classification.primaryCategory,
    categories: classification.categories.length > 0
      ? classification.categories
      : [classification.primaryCategory],
    relevanceScore: classification.focusScore + classification.categories.length,
    matchedRules: classification.matchedRules,
  }
}

export function buildPaperRecordFromGenerated(candidate, generated) {
  const primaryCategory = categoryKeys.has(generated.primaryCategory)
    ? generated.primaryCategory
    : candidate.primaryCategory

  const categories = Array.from(
    new Set(
      [primaryCategory, ...(generated.categories ?? candidate.categories ?? [])]
        .filter((category) => categoryKeys.has(category)),
    ),
  )

  return {
    id: candidate.id,
    title: candidate.title,
    titleZh: generated.titleZh,
    hookZh: generated.hookZh,
    venue: candidate.venue,
    year: candidate.year,
    track: candidate.primaryArea || undefined,
    primaryCategory,
    categories: categories.length > 0 ? categories : [primaryCategory],
    keywords: normalizeGeneratedKeywords(candidate, generated),
    authors: candidate.authors,
    openreviewUrl: candidate.openreviewUrl,
    pdfUrl: candidate.pdfUrl,
    tldr: candidate.tldr,
    abstract: candidate.abstract,
    introZh: generated.introZh,
    aliases: Array.from(new Set([...(generated.aliases ?? []), candidate.openreviewId].filter(Boolean))),
  }
}

function normalizeGeneratedKeywords(candidate, generated) {
  const merged = [...(generated.keywords ?? []), ...(candidate.keywords ?? [])]

  return Array.from(
    new Set(
      merged
        .map((keyword) => String(keyword).trim())
        .filter(Boolean),
    ),
  ).slice(0, 12)
}
