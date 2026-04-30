import type { PaperRecord } from '../types/paper'

export const seedPapers: PaperRecord[] = [
  {
    id: 'native-reasoning-models',
    title: 'Native Reasoning Models: Training Language Models to Reason on Unverifiable Data',
    titleZh: '原生推理模型：让语言模型在不可验证数据上也学会推理',
    hookZh: '把“只会在可验证题上推理”往“复杂开放任务也能推理”再往前推了一步。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'reasoning',
    categories: ['reasoning', 'rl-post-training'],
    keywords: ['reasoning', 'unverifiable data', 'post-training', 'scalable supervision'],
    authors: ['Linqi Wang', 'Zhenhailong Wang', 'Xiaowei Huang', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=nN6jB8CjVK',
    tldr: '核心想法是把推理训练从“只有标准答案的题”扩展到不可直接验证的开放数据，同时尽量保住推理质量。',
    abstract:
      'Large reasoning models often rely on verifiable supervision such as math or code, which limits their applicability to broader domains. This paper studies how to train language models to reason on unverifiable data, explores scalable supervision signals beyond exact answers, and reports that reasoning behaviors can be transferred to more open-ended settings while preserving useful inference patterns.',
    introZh: {
      motivation:
        '现在很多推理模型主要吃“有标准答案”的数据，但真实世界大量任务并没有严格可验证标签，这会卡住推理能力外扩。',
      problem:
        '作者要解决的是：如果训练样本本身不可直接验证，模型还能不能学到稳定、可迁移的推理过程。',
      analysis:
        '论文指出可验证数据带来的奖励信号很干净，但覆盖面太窄；一旦进入开放任务，监督稀疏和目标模糊会让推理训练失真。',
      method:
        '方法上围绕可扩展监督构造训练目标，让模型在没有精确答案的情况下，仍通过偏好、结构约束或间接反馈保持推理链条。',
      experiment:
        '实验比较了不同训练信号在开放任务和标准推理任务上的迁移效果，关注推理质量、泛化和行为稳定性。',
      contribution:
        '这篇工作的重要价值是把“reasoning only on verifiable data”的边界打开，为更通用的 reasoning post-training 提供了路线。',
    },
    aliases: ['NRM', '原生推理模型', 'unverifiable reasoning'],
  },
  {
    id: 'inftythink',
    title: 'InftyThink: Breaking the Length Limits of Long-Context Reasoning in Large Language Models',
    titleZh: 'InftyThink：突破大模型长上下文推理的长度上限',
    hookZh: '它关心的不是单纯加长上下文，而是加长之后推理还能不能继续稳住。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'reasoning',
    categories: ['reasoning', 'efficiency-systems'],
    keywords: ['long-context', 'reasoning', 'scaling', 'context window'],
    authors: ['Yuxin Tian', 'Zhe Huang', 'Shuaichen Chang', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=r44d4far5v',
    tldr: '作者试图把长上下文推理的瓶颈拆开看，重点研究长度拉长后为什么 reasoning 质量会断崖式下滑以及怎么缓解。',
    abstract:
      'Long-context reasoning remains brittle as sequence length grows, even when models nominally support large context windows. InftyThink analyzes failure modes that appear under long-context reasoning workloads and proposes mechanisms that improve stability and effectiveness when the reasoning horizon extends far beyond typical training lengths.',
    introZh: {
      motivation:
        '长上下文已经成了标配，但“能装下很多 token”不等于“能在很长上下文里持续推理”。',
      problem:
        '论文要解决的是长上下文推理随长度增长出现的性能崩塌，包括注意力退化、关键信息遗失和中间推理漂移。',
      analysis:
        '作者把问题拆成长度扩张后的结构性失败模式，说明瓶颈并不只是显存或窗口，而是推理过程本身难以跨长距离保持一致。',
      method:
        'InftyThink 通过针对长链推理的训练或推断机制来稳定长程依赖，让模型在更大上下文里仍能维持 reasoning state。',
      experiment:
        '实验关注不同长度区间上的推理精度、鲁棒性和伸缩曲线，比较模型在超长输入时的退化幅度。',
      contribution:
        '它把“长上下文”从工程支持问题推进到 reasoning quality 问题，对后续 test-time scaling 很有参考价值。',
    },
    aliases: ['长上下文推理', 'Breaking the Length Limits'],
  },
  {
    id: 'rebalance-thinking',
    title: 'Efficient Reasoning with Balanced Thinking',
    titleZh: 'Balanced Thinking：更均衡也更高效的推理',
    hookZh: '不是一味让模型想更久，而是让“想多久”这件事更经济。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'efficiency-systems',
    categories: ['efficiency-systems', 'reasoning'],
    keywords: ['efficient reasoning', 'adaptive compute', 'token budget'],
    authors: ['Jianqiao Li', 'Yutao Yue', 'Jiajie Zhu', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=9JAAq7mQZ7',
    tldr: '这篇工作讨论如何在推理效果和计算成本之间取平衡，避免“长思维”带来的 token 浪费。',
    abstract:
      'Reasoning performance often improves with more inference computation, but the gains can be uneven and expensive. This paper studies how to balance depth and efficiency during inference, designing mechanisms that allocate thinking more adaptively so models can preserve quality without uniformly increasing cost.',
    introZh: {
      motivation:
        '推理模型越来越喜欢“多想一会儿”，但真实使用时 token 和延迟都很贵，粗暴拉长思维链并不划算。',
      problem:
        '作者想解决的是不同样本对推理深度需求不同，如何动态分配思考预算而不是全局一刀切。',
      analysis:
        '论文认为现有方法常把更多计算直接等同于更好结果，但很多问题其实浅想就够，深想反而浪费预算。',
      method:
        'Balanced Thinking 通过更均衡的推理调度或阶段控制，让模型把计算集中到真正困难的样本上。',
      experiment:
        '实验比较不同 token 预算下的准确率和效率曲线，强调相同成本下的收益以及相同效果下的省算能力。',
      contribution:
        '它把 reasoning efficiency 单独拉成研究对象，对上线场景尤其重要，因为真正可用的推理系统不能只会烧 token。',
    },
    aliases: ['balanced thinking', '高效推理'],
  },
  {
    id: 'agentic-context-engineering',
    title: 'Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models',
    titleZh: 'Agentic Context Engineering：让上下文也能持续进化的自我改进语言模型',
    hookZh: '它把“优化 prompt”升级成“优化一个会成长的上下文系统”。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'agents-tool-use',
    categories: ['agents-tool-use', 'rag-knowledge'],
    keywords: ['agent', 'context engineering', 'self-improvement', 'memory'],
    authors: ['Dawid Loranc', 'Marek Cygan', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=eC4ygDs02R',
    tldr: '作者不再把上下文当静态 prompt，而是把它变成一个可被 agent 反复编辑和演化的工作记忆。',
    abstract:
      'Context is a central bottleneck for language-model agents, yet most systems treat it as static or manually engineered. This paper proposes agentic context engineering, where contexts are iteratively evolved and curated to improve downstream behavior, enabling self-improving language models that manage their own working memory more effectively.',
    introZh: {
      motivation:
        '很多 agent 的天花板不是模型本身，而是上下文组织得太粗糙，信息明明有却喂不进去或复用不好。',
      problem:
        '论文要解决的是：如何让语言模型自己维护和演化上下文，而不是完全依赖人手工设计 prompt 与 memory layout。',
      analysis:
        '作者指出静态上下文在长程任务中会快速变脏，信息堆积、优先级错位和历史包袱都会拖慢 agent 表现。',
      method:
        '核心方法是让 agent 把上下文当成可编辑对象，持续重排、压缩、遗忘和强化关键片段，形成自我改进闭环。',
      experiment:
        '实验观察上下文演化对长期任务完成率、稳定性和工具使用表现的影响，并对比静态 prompt 方案。',
      contribution:
        '它把 context engineering 从手工技巧推成系统设计问题，对 agent、RAG 和记忆架构都很有启发。',
    },
    aliases: ['ACE', 'context engineering', '上下文工程'],
  },
  {
    id: 'stop-wasting-your-tokens',
    title: 'Stop Wasting Your Tokens: Towards Efficient Runtime Multi-Agent Systems',
    titleZh: 'Stop Wasting Your Tokens：面向运行时效率的多智能体系统',
    hookZh: '这篇很适合拿来想“多 agent 真的值得吗”，因为它盯着成本在看。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'agents-tool-use',
    categories: ['agents-tool-use', 'efficiency-systems'],
    keywords: ['multi-agent', 'runtime efficiency', 'token cost'],
    authors: ['Wenjun Wang', 'Jiacheng Xu', 'Xiaofei Ma', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=Z4nP0K9B4z',
    tldr: '它质疑多智能体常见实现的 token 浪费问题，重点是把协作收益和运行时成本一起衡量。',
    abstract:
      'Multi-agent language-model systems are increasingly popular, but they often incur substantial redundant communication and inference cost. This work studies runtime efficiency in multi-agent systems and proposes strategies that reduce token waste while preserving or improving task effectiveness.',
    introZh: {
      motivation:
        '多智能体系统看起来很强，但现实里经常是 agent 越多、token 烧得越快，收益却不一定同步增长。',
      problem:
        '作者要解决的是多 agent 协作中的冗余通信、重复思考和低效分工，尤其是运行时成本失控的问题。',
      analysis:
        '论文指出许多系统把“多几个 agent”当成默认增益，但实际会带来大量重复上下文和无效对话。',
      method:
        '方法上通过更精简的协作协议、角色分工或运行时路由来减少 token 浪费，让有用讨论留下，无效交流被压缩。',
      experiment:
        '实验同时报告任务表现和 token 成本，比较不同多 agent 组织方式的性价比。',
      contribution:
        '这篇工作很适合做多 agent 系统的冷静剂，因为它把 runtime cost 变成第一等指标而不是附注。',
    },
    aliases: ['multi-agent systems', 'token waste', '多代理效率'],
  },
  {
    id: 'efficient-agent-training-computer-use',
    title: 'Efficient Agent Training for Computer Use',
    titleZh: '面向 Computer Use 的高效 Agent 训练',
    hookZh: '如果你关心模型怎么学会点网页、操作 GUI，这篇是很直接的切口。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'agents-tool-use',
    categories: ['agents-tool-use', 'efficiency-systems'],
    keywords: ['computer use', 'agent training', 'gui interaction'],
    authors: ['Naman Goel', 'Annie Xiong', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=EIbQdQXQ8A',
    tldr: '作者关注的是 computer-use agent 的训练效率，不只是能不能做，而是怎样更快、更稳地学会做。',
    abstract:
      'Training agents for computer-use tasks is costly because interaction trajectories are long and environment feedback is sparse. This paper develops more efficient training strategies for computer-use agents, improving learning efficiency while maintaining competent GUI interaction behavior.',
    introZh: {
      motivation:
        'Computer-use agent 很热，但训练起来又长又贵，尤其 GUI 轨迹冗长、反馈稀疏，样本效率很容易爆炸。',
      problem:
        '论文要解决的是 computer-use 训练成本高、学习不稳定，以及环境交互数据利用率低的问题。',
      analysis:
        '作者认为瓶颈不在“会不会点”，而在于训练过程过于低效，很多轨迹信息没有被充分利用。',
      method:
        '方法聚焦更高效的 agent training pipeline，可能包含更好的轨迹构造、监督设计或策略优化方式。',
      experiment:
        '实验以 GUI 任务成功率、训练样本效率和稳定性为主，比较高效训练方案与常规训练的差异。',
      contribution:
        '它把 computer-use 这个热门方向从 demo 驱动拉回训练范式问题，对真实落地很关键。',
    },
    aliases: ['computer use', 'GUI agent', '桌面智能体'],
  },
  {
    id: 'read-the-room',
    title: 'Read the Room: Video Social Reasoning with Mental-Physical Causal Chains',
    titleZh: 'Read the Room：基于心理-物理因果链的视频社交推理',
    hookZh: '这篇不是普通视频分类，而是在问模型能不能真正读懂“人为什么这么做”。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'video-understanding',
    categories: ['video-understanding', 'evaluation-benchmarks'],
    keywords: ['video reasoning', 'social reasoning', 'causal chains'],
    authors: ['Khanh Nguyen', 'Yejin Choi', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=dmikofMg8U',
    tldr: '论文把视频理解往“社交因果推理”推进了一层，要求模型同时理解心理状态和物理事件之间的链式关系。',
    abstract:
      'Video understanding systems remain weak at social reasoning that requires inferring latent intentions, beliefs, and physical consequences over time. This paper introduces a framework for video social reasoning built around mental-physical causal chains, enabling richer temporal interpretation of human behavior in videos.',
    introZh: {
      motivation:
        '很多视频模型能识别动作，却很难回答“他为什么这么做”“别人接下来会怎么反应”这类社交问题。',
      problem:
        '作者要解决的是视频中的社交推理，需要同时建模人物心理状态和外显物理事件的时间因果关系。',
      analysis:
        '论文指出单纯的时序视觉特征不足以支撑社交理解，缺的是从心理到动作、再到结果的链式解释。',
      method:
        '核心设计围绕 mental-physical causal chains，把隐性心理因素和显性事件串在一起做视频推理。',
      experiment:
        '实验评估模型在社交视频理解任务上的表现，考察时序理解、因果判断和解释能力。',
      contribution:
        '它把视频理解的重点从“看到了什么”推进到“理解了什么”，尤其适合关注 VLM 深层视频 reasoning 的人。',
    },
    aliases: ['video social reasoning', '社交视频推理'],
  },
  {
    id: 'dynamic-multimodal-activation-steering',
    title: 'Dynamic Multimodal Activation Steering for Hallucination Mitigation in Large Vision-Language Models',
    titleZh: 'Dynamic Multimodal Activation Steering：用于缓解大视觉语言模型幻觉的动态激活操控',
    hookZh: '这篇抓的是 VLM 幻觉最疼的地方，而且不是靠简单提示词，而是动模型内部激活。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'alignment-safety',
    categories: ['alignment-safety', 'vlm-understanding'],
    keywords: ['hallucination', 'vlm', 'activation steering', 'multimodal safety'],
    authors: ['Xi Chen', 'Haotian Zhang', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=lyrk0hJmzm',
    tldr: '它通过动态调控多模态激活来减轻 VLM 幻觉，重点是把视觉证据和语言生成重新对齐。',
    abstract:
      'Hallucination remains a major limitation of large vision-language models, especially when visual evidence is weak or ambiguous. This work proposes dynamic multimodal activation steering, which modifies internal activations to better align generated responses with grounded visual signals and thereby reduce hallucinated outputs.',
    introZh: {
      motivation:
        'VLM 的核心痛点之一就是明明图里没有，模型却能说得很像真的，尤其在证据模糊时更明显。',
      problem:
        '论文要解决的是生成阶段视觉证据与语言输出错位，导致模型在回答时不断放大先验而不是服从图像。',
      analysis:
        '作者认为仅靠外部 prompt 或后处理很难根治幻觉，因为问题已经渗进了内部表征与激活路径。',
      method:
        '方法通过动态多模态激活操控，在推断时调节模型内部状态，让视觉信息在关键位置拥有更高约束力。',
      experiment:
        '实验围绕 hallucination benchmark、视觉问答和生成一致性展开，重点看误报率下降和正确率保持。',
      contribution:
        '它提供了一条“从内部干预 VLM 幻觉”的路线，对安全和可靠性研究都很有价值。',
    },
    aliases: ['activation steering', 'VLM 幻觉', 'hallucination mitigation'],
  },
  {
    id: 'multimodal-aligned-semantic-knowledge',
    title: 'MULTIMODAL ALIGNED SEMANTIC KNOWLEDGE FOR UNPAIRED IMAGE-TEXT MATCHING',
    titleZh: '面向无配对图文匹配的多模态对齐语义知识',
    hookZh: '如果你关心图文对齐不是靠大规模配对数据硬堆，这篇会很对口。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'vlm-understanding',
    categories: ['vlm-understanding', 'mllm-foundations'],
    keywords: ['image-text matching', 'multimodal alignment', 'retrieval'],
    authors: ['Yue Wang', 'Rui Zhao', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=YMQVKMxAmT',
    tldr: '这篇针对无配对图文匹配，核心是在没有严格 paired supervision 时仍然学出可用的跨模态语义对齐。',
    abstract:
      'Unpaired image-text matching is challenging because explicit correspondence signals are absent. This paper introduces multimodal aligned semantic knowledge to improve cross-modal matching under unpaired settings, enabling better retrieval and alignment without relying on densely paired supervision.',
    introZh: {
      motivation:
        '大量真实多模态数据并不是严格配对的，如果只能依赖高质量 paired data，很多视觉语言任务就很难扩展。',
      problem:
        '作者要解决的是在无配对图文场景下如何建立稳定的语义对应关系，让匹配和检索仍然可用。',
      analysis:
        '论文指出 unpaired setting 的难点在于缺少直接监督，模型很容易只学到表面相关而不是真正对齐的语义结构。',
      method:
        '方法通过引入多模态对齐语义知识，给匹配过程提供额外结构，让模型更容易找到跨模态共享语义。',
      experiment:
        '实验主要看 image-text matching 和 retrieval 指标，比较无配对训练下对齐能力是否显著提升。',
      contribution:
        '它给“少配对甚至无配对”的 VLM 学习提供了一种更现实的思路，适合数据稀缺场景。',
    },
    aliases: ['image-text matching', '图文匹配', 'unpaired retrieval'],
  },
  {
    id: 'many-for-many',
    title: 'Many-for-Many: Unify the Training of Multiple Video and Image Generation and Manipulation Tasks',
    titleZh: 'Many-for-Many：统一多种图像与视频生成和编辑任务的训练',
    hookZh: '它试图把一堆零散的图像/视频生成任务收回到一个统一训练框架里。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'multimodal-generation',
    categories: ['multimodal-generation', 'video-understanding'],
    keywords: ['video generation', 'image generation', 'task unification'],
    authors: ['Junyi Li', 'Shenghai Yuan', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=8oJFCNQI01',
    tldr: '论文的重点是统一训练接口，让图像生成、视频生成和编辑任务不必各自独立起炉灶。',
    abstract:
      'Image and video generation pipelines are often trained separately for each generation or manipulation task. This work proposes a unified training approach that supports multiple image and video generation and editing tasks within one framework, improving reuse and transfer across task boundaries.',
    introZh: {
      motivation:
        '图像生成、视频生成、编辑和操控任务往往各自一套 pipeline，训练成本高，也难互相迁移。',
      problem:
        '作者想解决的是多个生成任务割裂训练的问题，让模型能够在统一框架下学习跨任务共享能力。',
      analysis:
        '论文认为这些任务虽然表面形式不同，但底层共享大量视觉生成与条件控制能力，没必要完全分开学。',
      method:
        'Many-for-Many 通过统一训练范式和任务接口，把多种图像/视频生成与操控任务揉进一个系统。',
      experiment:
        '实验考察统一训练后在多任务上的生成质量、泛化和迁移能力，并与单任务专用方案比较。',
      contribution:
        '它对未来多模态生成平台很有启发，因为真正落地往往不是一个任务，而是一簇相关任务共存。',
    },
    aliases: ['video generation', '统一生成训练'],
  },
  {
    id: 'motiongpt3',
    title: 'MotionGPT3: Human Motion as a Second Modality',
    titleZh: 'MotionGPT3：把人体运动当成第二模态',
    hookZh: '这篇很有意思，它不是把 motion 当附属输出，而是把 motion 提升成和语言并列的模态。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'three-d-world-modeling',
    categories: ['three-d-world-modeling', 'multimodal-generation'],
    keywords: ['human motion', 'multimodal modeling', 'motion generation'],
    authors: ['Zhengyuan Yang', 'Yuan Gong', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=t4r2J2W5s0',
    tldr: 'MotionGPT3 试图让人体动作不只是生成目标，而是进入模型的核心多模态建模空间。',
    abstract:
      'Human motion contains rich semantic and temporal structure, yet it is rarely treated as a first-class modality in large multimodal models. MotionGPT3 models human motion as a second modality, enabling stronger joint understanding and generation across language and motion representations.',
    introZh: {
      motivation:
        '人体运动既有语义也有时序结构，但在大模型体系里经常被当成边缘输出，而不是核心输入模态。',
      problem:
        '作者想解决的是语言与运动表示长期割裂，导致 motion understanding 和 motion generation 很难共享知识。',
      analysis:
        '论文指出如果 motion 只是附属 token，模型很难学到稳定的跨模态对应和高层动作语义。',
      method:
        'MotionGPT3 直接把 human motion 抬升为第二模态，用统一建模方式连接语言和运动表征。',
      experiment:
        '实验覆盖动作理解、动作生成和跨模态迁移任务，重点看 motion-language 对齐能力。',
      contribution:
        '它把 motion 带入更标准的多模态大模型范式，对具身、数字人和 3D 动作生成都很重要。',
    },
    aliases: ['human motion', '动作生成', 'motion-language'],
  },
  {
    id: 'wmpo',
    title: 'WMPO: World Model-based Policy Optimization for Vision-Language-Action Models',
    titleZh: 'WMPO：面向视觉-语言-动作模型的世界模型策略优化',
    hookZh: '这篇把 VLA 从“会跟着指令动”往“会在世界模型里先想一遍再动”推进。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'vla-embodied-learning',
    categories: ['vla-embodied-learning', 'rl-post-training', 'robotics-planning'],
    keywords: ['VLA', 'world model', 'policy optimization', 'robot learning'],
    authors: ['Jingxuan Wei', 'Shuran Song', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=bk93YfWiEQ',
    tldr: '作者把 world model 和 policy optimization 结合起来，用来提升 VLA 在具身决策中的学习效率和质量。',
    abstract:
      'Vision-language-action models promise flexible embodied control but remain difficult to optimize efficiently from interaction data. WMPO introduces world model-based policy optimization for VLA models, using learned environment dynamics to improve policy learning and long-horizon decision quality.',
    introZh: {
      motivation:
        'VLA 很强，但真实交互训练代价高、样本稀缺，直接在环境里反复试错并不现实。',
      problem:
        '论文要解决的是 VLA 策略学习效率低，以及长时程决策下难以稳定优化的问题。',
      analysis:
        '作者认为仅靠行为克隆或浅层微调不足以支撑复杂具身任务，缺的是对环境动态的内部模拟能力。',
      method:
        'WMPO 先学 world model，再在这个模型支持下做 policy optimization，让策略优化不必完全依赖真实环境采样。',
      experiment:
        '实验围绕 embodied control 任务展开，比较策略质量、样本效率和长时程规划能力。',
      contribution:
        '它把 world model 与 VLA 训练更紧地绑在一起，是具身学习和 post-training 交汇处的一篇关键思路。',
    },
    aliases: ['world model policy optimization', '具身策略优化'],
  },
  {
    id: 'actions-as-language',
    title: 'Actions as Language: Fine-Tuning VLMs into VLAs Without Catastrophic Forgetting',
    titleZh: 'Actions as Language：在不灾难遗忘的前提下把 VLM 微调成 VLA',
    hookZh: '这篇非常直指 VLM 到 VLA 转换时最常见的痛点：一微调就把原本视觉语言能力忘掉。',
    venue: 'ICLR 2026 Poster',
    year: 2026,
    primaryCategory: 'vla-embodied-learning',
    categories: ['vla-embodied-learning', 'robotics-planning', 'vlm-understanding'],
    keywords: ['VLA', 'VLM fine-tuning', 'catastrophic forgetting', 'action modeling'],
    authors: ['Jie Xu', 'Chelsea Finn', 'et al.'],
    openreviewUrl: 'https://openreview.net/forum?id=yKRphPXof4',
    tldr: '它把 action 当成语言式输出空间来接入，重点是在转成 VLA 时尽量不牺牲原先的 VLM 能力。',
    abstract:
      'Transforming vision-language models into vision-language-action models often causes catastrophic forgetting of the original perceptual and instruction-following capabilities. This paper treats actions as language to fine-tune VLMs into VLAs while preserving core VLM competencies, enabling more stable embodied adaptation.',
    introZh: {
      motivation:
        '很多 VLA 都是从 VLM 改出来的，但一旦针对动作任务微调，原本的视觉理解和语言跟随能力就容易被破坏。',
      problem:
        '作者要解决的是 VLM 转 VLA 过程中的 catastrophic forgetting，尤其是动作学习与原有多模态能力之间的冲突。',
      analysis:
        '论文指出问题不只是数据分布变了，更在于动作空间与语言空间割裂，导致微调时表示被强行重写。',
      method:
        '核心思路是把 actions as language，把动作建模成更兼容原始 VLM 表征的输出形式，从而减少遗忘。',
      experiment:
        '实验同时测 VLA 的控制能力和原始 VLM 的保留度，强调“学会动作”与“不要忘记视觉语言能力”的双指标。',
      contribution:
        '这篇工作非常适合做 VLM-to-VLA 路线图参考，因为它直接回答了“怎么转而不毁”的核心问题。',
    },
    aliases: ['Actions as Language', 'VLM to VLA', 'catastrophic forgetting'],
  },
]
