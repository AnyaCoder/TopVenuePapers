#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { buildPaperRecordFromGenerated, categoryKeys, slugify } from './lib/paper-taxonomy.mjs'

const args = parseArgs(process.argv.slice(2))
const inputFile = args.input ?? 'data/openreview/iclr-2026-candidates.json'
const outFile = args.out ?? 'data/papers.generated.json'
const tsOutFile = args.tsOut
const count = Number(args.count ?? 100)
const titleZhPrefixes = {
  agent: '智能体论文导读',
  llm: '大语言模型论文导读',
  mllm: '多模态大模型论文导读',
  paper: '论文导读',
  reasoning: '推理论文导读',
  video: '视频理解论文导读',
  vla: 'VLA 论文导读',
  vlm: '视觉语言模型论文导读',
}

const payload = JSON.parse(await readFile(inputFile, 'utf8'))
const candidates = (payload.papers ?? payload)
  .filter((paper) => paper.title && paper.abstract)
  .slice(0, count)

const records = candidates.map((candidate) => {
  const generated = buildLocalGuide(candidate)
  return buildPaperRecordFromGenerated(candidate, generated)
})

await writeJson(outFile, records)
if (tsOutFile) {
  await writeTsModule(tsOutFile, records)
}

console.log(`Generated ${records.length} local Chinese guide records.`)
console.log(`Wrote ${outFile}`)
if (tsOutFile) {
  console.log(`Wrote ${tsOutFile}`)
}

function buildLocalGuide(candidate) {
  const topic = inferTopic(candidate)
  const category = normalizeCategory(candidate.primaryCategory)
  const secondaryCategories = normalizeCategories(candidate.categories, category)
  const methodName = inferMethodName(candidate.title)
  const methodVerb = inferMethodVerb(candidate)
  const problemFocus = inferProblemFocus(candidate)
  const experimentFocus = inferExperimentFocus(candidate)
  const dataScale = inferDataScale(candidate.abstract)
  const resultSignal = inferResultSignal(candidate.abstract)

  return {
    titleZh: buildTitleZh(candidate, topic),
    hookZh: buildHookZh(candidate, topic, category),
    primaryCategory: category,
    categories: secondaryCategories,
    keywords: buildKeywords(candidate, topic),
    aliases: buildAliases(candidate, methodName),
    introZh: {
      motivation: buildMotivation(candidate, topic, category),
      problem: `这篇论文要解决的是${problemFocus}：在真实任务里，模型不能只靠表面相关或固定流程完成工作，还需要在${topic}场景下保持可验证、可泛化的行为。`,
      analysis: buildAnalysis(candidate, topic),
      method: `主要方法围绕 ${methodName} 展开，作者用${methodVerb}把问题拆成更可控的训练、推理或评测过程，让模型行为更容易被观察和优化。`,
      experiment: `数据与实验部分重点覆盖${experimentFocus}${dataScale}。论文用跨模型、跨任务或跨环境的比较来验证方法是否真的改善了${topic}能力，而不是只在单一设置下有效。`,
      contribution: `${resultSignal}总体来看，它的贡献在于把${topic}里的一个具体瓶颈定义清楚，并给出可复用的方法、评测或数据资源，适合放进 2026 年大模型方向的快速阅读清单。`,
    },
  }
}

function buildTitleZh(candidate, topic) {
  const title = candidate.title
  const prefix = titleZhPrefixes[inferPrimaryFamily(candidate)] ?? `${topic}方向`
  return `${prefix}：${title}`
}

function buildHookZh(candidate, topic, category) {
  const templates = {
    'evaluation-benchmarks': `这篇适合先看，因为它把${topic}里的能力边界和失败模式摆到了评测台面上。`,
    reasoning: `这篇抓住的是${topic}里的深层推理问题，重点不只是答对，而是模型怎样一步步想清楚。`,
    'rl-post-training': `这篇把${topic}和强化学习/后训练连起来看，适合关注模型行为怎么被训练出来的人。`,
    'agents-tool-use': `这篇很适合看 agent 落地，因为它讨论的是模型在真实交互流程里怎样判断、行动和自我修正。`,
    'rag-knowledge': `这篇关心的是外部知识和上下文怎么真正帮到模型，而不是把更多文本简单塞进去。`,
    'alignment-safety': `这篇适合关注可靠性的读者，它把${topic}中的幻觉、偏差或风险问题具体化了。`,
    'efficiency-systems': `这篇的价值在于把效果和成本一起看，讨论${topic}能力怎样更高效地跑起来。`,
    'coding-formal-tasks': `这篇把大模型放进更结构化的任务里考察，适合看模型在代码、形式化或工程场景中的能力。`,
    'mllm-foundations': `这篇偏基础能力建设，适合快速理解多模态大模型在${topic}上的底层改进。`,
    'vlm-understanding': `这篇聚焦视觉语言理解，不只是看图说话，而是看模型能不能真正建立跨模态对应。`,
    'video-understanding': `这篇适合视频方向阅读，因为它把时间、事件和推理链条放在一起处理。`,
    'audio-speech': `这篇把语音/音频纳入大模型能力图谱，适合补多模态感知这一块。`,
    'three-d-world-modeling': `这篇关注空间、运动或世界模型，适合看模型如何从二维感知走向可推演的世界表示。`,
    'vla-embodied-learning': `这篇直接踩在 VLA 和具身学习交叉点上，关注模型如何把理解转成可执行动作。`,
    'robotics-planning': `这篇适合机器人和规划方向阅读，因为它讨论模型如何在长程任务里做可执行决策。`,
    'scientific-discovery': `这篇把大模型能力放进科学任务里检验，重点是它能不能帮助真实发现或实验流程。`,
    'data-synthesis-curation': `这篇适合关注数据的人看，因为它讨论训练数据怎么构造、筛选或合成才真的有用。`,
    'multimodal-generation': `这篇偏生成与编辑，适合看多模态模型如何统一处理图像、视频或动作生成。`,
  }

  return templates[category] ?? `这篇围绕${topic}展开，适合快速把握 2026 年相关方向的一个新切口。`
}

function buildMotivation(candidate, topic, category) {
  const base = {
    'evaluation-benchmarks': `现有模型在${topic}上经常给人一种“看起来会了”的错觉，但缺少细粒度评测时，很难知道它到底会在哪里失败。`,
    reasoning: `大模型的推理能力正在快速提升，但在${topic}场景里，长链条、多模态证据或开放式目标仍然会让推理过程变得不稳定。`,
    'rl-post-training': `后训练已经成为提升大模型行为的重要手段，但${topic}任务里的奖励、反馈和泛化仍然很难同时做好。`,
    'agents-tool-use': `Agent 系统越来越接近真实工具和网页环境，但${topic}里的长程交互、反馈稀疏和错误累积仍然限制了可用性。`,
    'rag-knowledge': `模型并不总能把外部知识转化为可靠答案，${topic}场景尤其需要更清楚地管理检索、上下文和记忆。`,
    'alignment-safety': `随着 VLM/MLLM 被用于更真实的场景，${topic}中的幻觉、误判和过度自信会直接影响系统可信度。`,
    'efficiency-systems': `更强的大模型能力往往伴随更高推理成本，${topic}场景需要在效果、延迟和 token 预算之间找到平衡。`,
    'coding-formal-tasks': `代码和形式化任务能检验模型是否真的理解规则与结构，${topic}正好暴露了通用语言能力的边界。`,
    'mllm-foundations': `多模态大模型需要在视觉、语言和行动之间建立稳定表示，${topic}是检验基础能力是否扎实的关键场景。`,
    'vlm-understanding': `视觉语言模型已经能处理很多图文任务，但${topic}仍要求模型把视觉证据、语义关系和语言回答对齐起来。`,
    'video-understanding': `视频任务不只是多看几帧，${topic}要求模型理解时间顺序、事件变化和跨片段因果关系。`,
    'audio-speech': `音频与语音信息包含大量时间和语义线索，${topic}要求模型把听觉信号纳入统一推理框架。`,
    'three-d-world-modeling': `真实世界任务需要空间、运动和物理关系，${topic}推动模型从静态识别走向世界建模。`,
    'vla-embodied-learning': `具身模型最终要把感知和语言指令转成动作，${topic}里的决策质量直接决定系统能不能落地。`,
    'robotics-planning': `机器人和规划任务容错率低，${topic}要求模型不仅理解目标，还要生成可执行、可验证的行动序列。`,
    'scientific-discovery': `科学任务需要模型处理复杂证据与专业约束，${topic}能检验大模型是否真的能辅助发现而不是只做文本复述。`,
    'data-synthesis-curation': `数据质量决定模型上限，${topic}里的核心动机是用更可控的数据构造方式提升训练收益。`,
    'multimodal-generation': `多模态生成正在从单一任务走向统一系统，${topic}要求模型同时处理条件控制、质量和泛化。`,
  }

  return base[category] ?? `这篇工作的动机来自${topic}在真实任务中的能力缺口，作者希望把问题从经验现象推进到可分析、可改进的系统。`
}

function buildAnalysis(candidate, topic) {
  const limitation = findSentence(candidate.abstract, [
    'however',
    'challenge',
    'limitation',
    'difficult',
    'fail',
    'bias',
    'suffer',
    'remain',
  ])

  if (limitation) {
    return `现象分析上，摘要明确把现有系统的挑战或局限作为切入点。它说明${topic}的难点不是单点能力不足，而是评测、数据、推理路径或环境反馈之间存在结构性错位。`
  }

  return `现象分析上，这类问题通常不是单纯把模型做大就能解决；${topic}会同时牵涉数据覆盖、推理过程、跨模态对齐和任务反馈，任何一环不稳都会影响最终表现。`
}

function inferMethodVerb(candidate) {
  const abstract = candidate.abstract
  const methodSentence = findSentence(abstract, [
    'we introduce',
    'we propose',
    'we present',
    'we develop',
    'we design',
    'we construct',
    'we build',
  ])

  if (methodSentence) {
    return '新的框架、训练流程或推理机制'
  }

  if (candidate.primaryCategory === 'evaluation-benchmarks') {
    return '新的 benchmark、评测协议和错误分析'
  }

  if (candidate.primaryCategory === 'agents-tool-use') {
    return '任务轨迹、工具反馈和智能体决策流程'
  }

  if (candidate.primaryCategory === 'rl-post-training') {
    return '奖励建模、策略优化或后训练信号'
  }

  return '围绕任务结构设计的模型、数据或推理流程'
}

function inferProblemFocus(candidate) {
  const category = candidate.primaryCategory
  const mapping = {
    'evaluation-benchmarks': '现有评测覆盖不足、指标过粗或难以定位真实失败模式',
    reasoning: '复杂推理中证据链不稳、步骤容易漂移或答案缺少可验证支撑',
    'rl-post-training': '奖励信号和训练目标难以精确刻画模型应该形成的行为',
    'agents-tool-use': '长程工具使用中状态跟踪、错误恢复和任务完成率不稳定',
    'rag-knowledge': '检索到的信息和模型生成之间缺少可靠的选择与整合机制',
    'alignment-safety': '模型容易产生幻觉、偏差、过度认可或不安全输出',
    'efficiency-systems': '推理成本、模型规模和实际收益之间不够匹配',
    'coding-formal-tasks': '模型在结构化约束、程序语义或形式规则下容易出错',
    'mllm-foundations': '多模态表示尚未稳定连接感知、语言和推理能力',
    'vlm-understanding': '视觉证据和语言判断之间的对齐仍然不够可靠',
    'video-understanding': '长视频中的时间依赖、关键帧选择和事件推理难以兼顾',
    'audio-speech': '音频信号和语言语义之间的时序对齐与推理不够稳',
    'three-d-world-modeling': '空间结构、运动状态和世界动态难以被统一建模',
    'vla-embodied-learning': '视觉语言理解到动作策略之间的转换不稳定',
    'robotics-planning': '规划结果难以同时满足目标、环境约束和执行可行性',
    'scientific-discovery': '专业任务中的证据整合、假设生成和验证流程不够自动化',
    'data-synthesis-curation': '训练数据的覆盖、质量和有效性难以系统控制',
    'multimodal-generation': '生成任务之间割裂，条件控制和跨任务泛化不够统一',
  }

  return mapping[category] ?? '模型在复杂任务中的能力边界不清楚'
}

function inferExperimentFocus(candidate) {
  const abstract = candidate.abstract
  const numbers = Array.from(new Set((abstract.match(/\b\d+(?:\.\d+)?\+?x?\b|\b\d+\+?\b/g) ?? []).slice(0, 4)))
  const benchmarkSentence = findSentence(abstract, ['benchmark', 'evaluate', 'experiments', 'results', 'demonstrate', 'show'])

  if (benchmarkSentence) {
    return '论文摘要提到的 benchmark、模型对比和任务评估'
  }

  if (numbers.length > 0) {
    return `包含 ${numbers.join('、')} 等规模或指标线索的实验设置`
  }

  return '作者构造的任务集、模型基线和消融/对比实验'
}

function inferDataScale(abstract) {
  const scale = abstract.match(/(?:\b\d+(?:\.\d+)?\s*(?:k|K|m|M|b|B)?\b|\b\d+\+?\b)\s+(?:models?|tasks?|benchmarks?|datasets?|trajectories|templates|environments|samples|examples|questions|videos|images|agents?)/)
  return scale ? `，其中可以看到 ${scale[0]} 这样的规模线索` : ''
}

function inferResultSignal(abstract) {
  const text = String(abstract ?? '').toLowerCase()

  if (text.includes('state of the art') || text.includes('sota')) {
    return '摘要给出的结果信号是方法达到了新的领先水平。'
  }

  if (text.includes('outperform') || text.includes('surpass')) {
    return '摘要给出的结果信号是方法超过了若干已有基线。'
  }

  if (text.includes('improve') || text.includes('boost') || text.includes('increase')) {
    return '摘要给出的结果信号是方法在关键指标上带来了提升。'
  }

  if (text.includes('reduce') || text.includes('faster') || text.includes('efficient')) {
    return '摘要给出的结果信号是方法降低了成本或提升了效率。'
  }

  if (text.includes('achieve')) {
    return '摘要给出的结果信号是方法在目标任务上取得了稳定效果。'
  }

  return ''
}

function inferTopic(candidate) {
  const text = `${candidate.title} ${(candidate.keywords ?? []).join(' ')} ${candidate.abstract}`.toLowerCase()
  const rules = [
    ['computer use', 'computer-use agent'],
    ['web agent', '网页智能体'],
    ['gui agent', 'GUI 智能体'],
    ['vision-language-action', 'VLA 与具身动作'],
    ['vla', 'VLA 与具身动作'],
    ['robot', '机器人规划'],
    ['video', '视频理解'],
    ['hallucination', '幻觉缓解'],
    ['retrieval', '检索增强'],
    ['benchmark', '评测基准'],
    ['reasoning', '复杂推理'],
    ['world model', '世界模型'],
    ['multimodal', '多模态理解'],
    ['mllm', '多模态大模型'],
    ['vision-language', '视觉语言理解'],
    ['audio', '音频多模态'],
    ['speech', '语音多模态'],
    ['generation', '多模态生成'],
  ]

  return rules.find(([needle]) => text.includes(needle))?.[1] ?? '大模型能力'
}

function inferPrimaryFamily(candidate) {
  const text = `${candidate.title} ${(candidate.keywords ?? []).join(' ')} ${candidate.abstract}`.toLowerCase()

  if (text.includes('vision-language-action') || text.includes('vla') || text.includes('embodied')) return 'vla'
  if (text.includes('video')) return 'video'
  if (text.includes('vision-language') || text.includes('vlm')) return 'vlm'
  if (text.includes('multimodal') || text.includes('mllm')) return 'mllm'
  if (text.includes('agent')) return 'agent'
  if (text.includes('reasoning')) return 'reasoning'
  if (text.includes('llm') || text.includes('language model')) return 'llm'
  return 'paper'
}

function inferMethodName(title) {
  const beforeColon = title.split(':')[0]?.trim()

  if (beforeColon && beforeColon.length <= 80) {
    return beforeColon
  }

  const acronym = title.match(/\b[A-Z][A-Z0-9-]{2,}\b/)
  return acronym?.[0] ?? '该方法'
}

function buildKeywords(candidate, topic) {
  const extra = [topic, candidate.primaryCategory, candidate.primaryArea]
    .filter(Boolean)
    .map(String)

  return Array.from(new Set([...(candidate.keywords ?? []), ...extra]))
    .map((keyword) => keyword.trim())
    .filter(Boolean)
    .slice(0, 12)
}

function buildAliases(candidate, methodName) {
  return Array.from(
    new Set(
      [candidate.openreviewId, methodName, slugify(candidate.title)]
        .filter(Boolean)
        .map(String),
    ),
  )
}

function normalizeCategory(category) {
  return categoryKeys.has(category) ? category : 'mllm-foundations'
}

function normalizeCategories(categories, primaryCategory) {
  const normalized = Array.from(
    new Set([primaryCategory, ...(categories ?? [])].filter((category) => categoryKeys.has(category))),
  )

  return normalized.length > 0 ? normalized : [primaryCategory]
}

function findSentence(text, needles) {
  const sentences = String(text ?? '')
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.length > 30)

  return sentences.find((sentence) =>
    needles.some((needle) => sentence.toLowerCase().includes(needle)),
  )
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function writeTsModule(path, records) {
  await mkdir(dirname(path), { recursive: true })
  const source = `import type { PaperRecord } from '../types/paper'\n\nexport const generatedPapers = ${JSON.stringify(records, null, 2)} satisfies PaperRecord[]\n`
  await writeFile(path, source, 'utf8')
}

function parseArgs(argv) {
  const parsed = {}

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--input') {
      parsed.input = argv[++index]
    } else if (arg === '--count') {
      parsed.count = argv[++index]
    } else if (arg === '--out') {
      parsed.out = argv[++index]
    } else if (arg === '--ts-out') {
      parsed.tsOut = argv[++index]
    } else if (arg === '--help') {
      console.log('Usage: node scripts/generate-local-guides.mjs --count 100')
      process.exit(0)
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  return parsed
}
