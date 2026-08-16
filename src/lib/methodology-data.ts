/**
 * 方法论常量数据
 * 源自 AI_Networking_Research_Methodology.md
 * 6 个模块的全部结构化数据
 */

// ============ 模块1: AI for Wireless 三层架构 ============

export type LayerInfo = {
  id: string
  name: string
  nameEn: string
  color: string
  icon: string
  problems: { name: string; ai: string }[]
  metrics: string[]
  courseLink: string
}

export const LAYER_ARCHITECTURE: LayerInfo[] = [
  {
    id: 'physical',
    name: '物理层',
    nameEn: 'Physical Layer',
    color: '#10b981', // emerald
    icon: 'Radio',
    problems: [
      { name: '信道估计', ai: 'LSTM/Transformer' },
      { name: '信号检测', ai: 'NN检测器' },
      { name: '编解码/波束成形', ai: 'DL波束管理' },
    ],
    metrics: ['BER', 'BLER', 'MSE', '频谱效率'],
    courseLink: 'LSTM信道预测、NN检测',
  },
  {
    id: 'mac',
    name: 'MAC/链路层',
    nameEn: 'MAC Layer',
    color: '#f59e0b', // amber
    icon: 'Network',
    problems: [
      { name: '资源分配', ai: 'DRL功率控制' },
      { name: '频谱接入', ai: '认知无线电' },
      { name: '信道接入协议', ai: 'DRL-ALOHA' },
    ],
    metrics: ['吞吐量', '干扰水平', '公平性'],
    courseLink: 'Q-learning、DQN',
  },
  {
    id: 'network',
    name: '网络层',
    nameEn: 'Network Layer',
    color: '#ef4444', // red
    icon: 'Share2',
    problems: [
      { name: '路由优化', ai: 'DRL路由' },
      { name: '网络切片', ai: '资源编排' },
      { name: '流量预测/调度', ai: 'LSTM流量预测' },
    ],
    metrics: ['端到端时延', '吞吐量', 'QoS'],
    courseLink: 'LSTM预测、DRL决策',
  },
]

// ============ 关键词矩阵（场景×方法×问题）============

export const KEYWORDS = {
  scenario: [
    'mmWave communication',
    'massive MIMO',
    'URLLC',
    'V2X',
    'IoT / massive IoT',
    'Non-terrestrial network',
    'semantic communication',
    'RIS / intelligent reflecting surface',
    'cell-free massive MIMO',
  ],
  method: [
    'deep reinforcement learning / DRL',
    'deep Q-network / DQN',
    'proximal policy optimization / PPO',
    'multi-agent reinforcement learning / MARL',
    'long short-term memory / LSTM',
    'transformer / attention',
    'graph neural network / GNN',
    'federated learning',
    'meta-learning / few-shot learning',
    'diffusion model',
  ],
  problem: [
    'channel estimation',
    'resource allocation / resource management',
    'power control',
    'beam management / beamforming',
    'routing optimization',
    'network slicing',
    'spectrum sharing / spectrum sensing',
    'interference management',
    'mobility management / handover',
  ],
}

// ============ 顶会顶刊追踪清单 ============

export type Venue = {
  name: string
  type: 'conference' | 'journal'
  level: string
  deadline: string
  reviewCycle: string
  acceptanceRate: string
  impactFactor?: string
  note: string
  month: number
}

export const VENUES: Venue[] = [
  { name: 'IEEE ICC', type: 'conference', level: '旗舰会议', deadline: '10-15', reviewCycle: '3个月', acceptanceRate: '~35%', note: '硕士第一篇文章首选——周期短、认可度高', month: 10 },
  { name: 'IEEE GLOBECOM', type: 'conference', level: '旗舰会议', deadline: '04-01', reviewCycle: '3个月', acceptanceRate: '~38%', note: 'ICC的姊妹会，年中投稿', month: 4 },
  { name: 'IEEE WCNC', type: 'conference', level: '重要会议', deadline: '09-15', reviewCycle: '3个月', acceptanceRate: '~45%', note: '适合练手，录取率较高', month: 9 },
  { name: 'IEEE VTC', type: 'conference', level: '重要会议', deadline: '01-15', reviewCycle: '2个月', acceptanceRate: '~50%', note: '偏车辆通信/移动性', month: 1 },
  { name: 'IEEE INFOCOM', type: 'conference', level: '网络顶会', deadline: '07-31', reviewCycle: '3个月', acceptanceRate: '~20%', note: '通信网络顶会（偏网络层）', month: 7 },
  { name: 'IEEE TCOM', type: 'journal', level: '顶刊', deadline: '-', reviewCycle: '4-8个月', acceptanceRate: '-', impactFactor: '5.5', note: '硕士毕业前冲刺目标', month: 0 },
  { name: 'IEEE TWC', type: 'journal', level: '顶刊', deadline: '-', reviewCycle: '4-8个月', acceptanceRate: '-', impactFactor: '6.0', note: '无线通信领域首选期刊', month: 0 },
  { name: 'IEEE TVT', type: 'journal', level: '重要期刊', deadline: '-', reviewCycle: '3-6个月', acceptanceRate: '-', impactFactor: '4.5', note: '审稿相对较快', month: 0 },
  { name: 'IEEE CL', type: 'journal', level: '快报', deadline: '-', reviewCycle: '2-3个月', acceptanceRate: '-', impactFactor: '3.0', note: '短文(4-5页)，适合快速发表', month: 0 },
  { name: 'IEEE ACCESS', type: 'journal', level: 'OA期刊', deadline: '-', reviewCycle: '1-2个月', acceptanceRate: '-', impactFactor: '3.5', note: '审稿快但费用高', month: 0 },
]

// ============ 学者追踪清单 ============

export const SCHOLARS = [
  { name: 'Zhu Han', institution: 'U of Houston', direction: 'DRL for wireless, 资源分配' },
  { name: 'Deniz Gunduz', institution: 'Imperial College', direction: '语义通信、分布式学习' },
  { name: 'Andrea Goldsmith', institution: 'Princeton', direction: '无线通信理论、AI for PHY' },
  { name: 'Walid Saad', institution: 'Virginia Tech', direction: '网络切片、DRL' },
  { name: 'Geoffrey Ye Li', institution: 'Imperial College', direction: 'DL for 信道估计/检测' },
  { name: 'Mischa Dohler', institution: "King's College", direction: 'IoT、AI网络' },
  { name: 'Osvaldo Simeone', institution: "King's College", direction: '信息论+学习理论' },
  { name: 'Taylan Cemgil', institution: 'DeepMind', direction: '时序模型在通信中的应用' },
]

// ============ 选题评估维度（topic_scorer.py）============

export const TOPIC_CRITERIA = {
  '创新性': {
    weight: 0.30,
    subItems: {
      '问题新颖度': 0.4,
      '方法创新性': 0.3,
      '与现有工作的区分度': 0.3,
    },
  },
  '可行性': {
    weight: 0.25,
    subItems: {
      '数据/仿真平台可得性': 0.35,
      '基线可复现程度': 0.30,
      '计算资源需求': 0.20,
      '个人能力匹配度': 0.15,
    },
  },
  '发表价值': {
    weight: 0.25,
    subItems: {
      '目标会议/期刊匹配度': 0.40,
      '预期贡献的显著性': 0.35,
      '竞争激烈程度': 0.25,
    },
  },
  '可持续性': {
    weight: 0.20,
    subItems: {
      '能否扩展为多篇论文': 0.35,
      '是否与毕业论文方向一致': 0.35,
      '后续研究空间': 0.30,
    },
  },
}

// ============ 经典课题方向（4个对比）============

export const TOPIC_DIRECTIONS = [
  {
    name: 'A: DRL资源分配',
    courseLink: 5,
    publishSpace: '大（热门赛道）',
    competition: '激烈',
    codeReuse: 'Stable-Baselines3',
    simChain: 'MATLAB+Python',
    rating: 5,
  },
  {
    name: 'B: LSTM信道预测',
    courseLink: 5,
    publishSpace: '中（成熟方向）',
    competition: '一般',
    codeReuse: 'PyTorch LSTM',
    simChain: 'MATLAB信道',
    rating: 4,
  },
  {
    name: 'C: GNN网络优化',
    courseLink: 3,
    publishSpace: '大（新兴方向）',
    competition: '较激烈',
    codeReuse: 'PyG',
    simChain: '网络仿真器',
    rating: 4,
  },
  {
    name: 'D: 联邦学习通信',
    courseLink: 3,
    publishSpace: '大',
    competition: '较激烈',
    codeReuse: 'Flower框架',
    simChain: '需分布式',
    rating: 3,
  },
]

// ============ 性能指标（模块3.4.1）============

export const METRICS = [
  { name: 'BER', fullName: 'Bit Error Rate', scene: '物理层信号检测', formula: '误比特数/总比特数' },
  { name: 'BLER', fullName: 'Block Error Rate', scene: '链路自适应', formula: '误块数/总块数' },
  { name: 'NMSE', fullName: 'Normalized MSE', scene: '信道估计', formula: 'E[‖H-Ĥ‖²]/E[‖H‖²]' },
  { name: 'Spectral Eff.', fullName: '频谱效率', scene: '资源分配', formula: 'log₂(1+SINR) bps/Hz' },
  { name: 'Sum Rate', fullName: '总吞吐量', scene: '多用户系统', formula: 'ΣR_i bps' },
  { name: 'Delay', fullName: '端到端时延', scene: '网络切片/路由', formula: 'ms' },
  { name: 'Fairness', fullName: 'Jain指数', scene: '资源分配', formula: '(Σx_i)²/(n·Σx_i²)' },
]

// ============ 基线层级（模块3.1.1）============

export const BASELINE_LEVELS = [
  { level: 'traditional', name: '传统方法', desc: '通信领域经典算法（MMSE估计器、WMMSE功率控制）', required: true },
  { level: 'simple_ai', name: '简单AI基线', desc: '简单的MLP/LSTM替代方案', required: true },
  { level: 'sota', name: 'SOTA方法', desc: '直接复现相关论文的结果', required: true },
]

// ============ 论文结构（paper_structure_check.py）============

export const PAPER_SECTIONS = {
  Abstract: [
    '背景句',
    '问题句',
    '方法句',
    '结果句',
    '每个句子不超过25个词',
  ],
  Introduction: [
    '大背景→具体问题过渡自然',
    'Related work分类有逻辑',
    'Research Gap明确',
    'Contributions以1-2-3列出',
    '论文组织指引',
  ],
  'Related Work': [
    '分类维度一致（按方法/按场景）',
    '对比表（至少一个维度）',
    '每段以gap结尾，引出本文',
  ],
  'System Model': [
    '系统模型图',
    '每个符号有定义',
    '关键假设明确列出',
  ],
  'Proposed Method': [
    '方法流程图/网络结构图',
    '核心公式完整推导',
    '算法伪代码',
    '复杂度分析',
  ],
  Experiments: [
    '仿真参数表',
    '至少3个基线方法',
    '消融实验',
    '收敛曲线',
    '统计显著性检验',
  ],
  Conclusion: [
    '总结本文工作',
    '明确limitation',
    '未来工作方向',
  ],
}

// ============ Gantt 任务模板（gantt_chart.py）============

export const GANTT_TEMPLATE = [
  { name: '文献调研', start: 0, end: 8, color: '#3b82f6', category: 'survey' },
  { name: '基线复现', start: 4, end: 12, color: '#10b981', category: 'baseline' },
  { name: '方法设计', start: 8, end: 20, color: '#ef4444', category: 'method' },
  { name: '仿真平台搭建', start: 6, end: 14, color: '#f59e0b', category: 'simulation' },
  { name: '实验调试', start: 14, end: 24, color: '#8b5cf6', category: 'experiment' },
  { name: '结果分析', start: 20, end: 28, color: '#06b6d4', category: 'analysis' },
  { name: '论文撰写', start: 24, end: 32, color: '#6366f1', category: 'writing' },
  { name: '投稿修稿', start: 30, end: 36, color: '#ec4899', category: 'submission' },
  { name: '答辩准备', start: 34, end: 40, color: '#6b7280', category: 'defense' },
]

// ============ 写作时间线（writing_timeline.py）============

export const WRITING_MILESTONES = [
  { name: '实验数据完整', daysBefore: 42, hours: 20 },
  { name: 'Method + Experiments 初稿', daysBefore: 35, hours: 15 },
  { name: 'Introduction + Related Work', daysBefore: 28, hours: 10 },
  { name: '全篇初稿完成', daysBefore: 21, hours: 10 },
  { name: '内部评审与修改', daysBefore: 14, hours: 10 },
  { name: '英文语言润色', daysBefore: 7, hours: 8 },
  { name: '格式检查与提交', daysBefore: 2, hours: 5 },
]

// ============ 学术句式模板 ============

export const ACADEMIC_PHRASES = {
  '表达贡献': [
    'To the best of our knowledge, this is the first work to ...',
    'We propose a novel framework that ...',
    'Our method achieves ... without sacrificing ...',
  ],
  '表达优势': [
    'Compared to ... our method achieves X% improvement in ...',
    'Extensive experiments demonstrate that ...',
    'The results clearly show the superiority of ...',
  ],
  '表达局限性': [
    'One limitation of our work is that ...',
    'The proposed method assumes ... which may not hold in ...',
    'Extending our approach to ... scenarios is left for future work.',
  ],
  '连接词-对比': ['however', 'in contrast', 'on the other hand', 'while'],
  '连接词-递进': ['furthermore', 'moreover', 'in addition', 'beyond that'],
  '连接词-因果': ['therefore', 'consequently', 'as a result', 'thus'],
  '连接词-举例': ['for instance', 'for example', 'such as', 'specifically'],
}

// ============ 审稿回复句式（review response）============

export const REVIEW_RESPONSE_PHRASES = {
  '同意并修改': [
    'We thank the reviewer for this insightful suggestion.',
    'We have revised [...] accordingly.',
    "Following the reviewer's advice, we have added [...]",
  ],
  '解释但不修改': [
    'We appreciate the reviewer\'s concern. However, we would like to clarify that [...]',
    'We agree this is an important point. In our current framework, [...] Therefore, we believe the current approach is appropriate for this setting.',
  ],
  '不同意但尊重': [
    'We respectfully disagree with the reviewer on this point. Our reasoning is as follows: [...]',
    'While we understand the reviewer\'s perspective, we believe that [...] We have added a discussion of this limitation in the revised manuscript.',
  ],
  '补充实验': [
    'We have conducted additional experiments to address this concern. The results are shown in the new Table II.',
    'Following this suggestion, we added a comparison with [...]',
  ],
}

// ============ 投稿检查清单 ============

export const SUBMISSION_CHECKLIST = [
  { category: '格式检查', items: [
    'PDF via IEEE PDF eXpress',
    '页数合规（会议6页含参考文献，期刊15页内）',
    '所有字体已嵌入PDF',
    '页码（如需要）',
  ]},
  { category: '内容检查', items: [
    'Abstract 符合四句话模板',
    '所有图表清晰可读（600dpi）',
    '所有引用在正文中有对应标注',
    '所有公式编号正确',
    '符号定义在首次出现时给出',
  ]},
  { category: '学术诚信', items: [
    '重复率检查（< 20%）',
    '所有引用已标注来源',
    '自引合理',
  ]},
  { category: '投稿系统', items: [
    'EDAS / Manuscript Central 注册',
    '作者信息完整（姓名/单位/邮箱/ORCID）',
    '推荐/回避审稿人已填写',
    'Cover Letter 已准备',
  ]},
]

// ============ 6个模块的方法论结构 ============

export type MethodologyModule = {
  id: number
  title: string
  goal: string
  sections: { id: string; title: string; summary: string }[]
  scripts: { name: string; desc: string; code?: string }[]
  deliverables: string[]
}

export const METHODOLOGY_MODULES: MethodologyModule[] = [
  {
    id: 1,
    title: '领域认知与选题',
    goal: '建立领域全景认知，系统化追踪前沿，完成选题评估',
    sections: [
      { id: '1.1', title: '领域全景梳理', summary: 'AI for Wireless 三层架构（物理层/MAC层/网络层），三个经典切入案例' },
      { id: '1.2', title: '前沿热点追踪', summary: '三维关键词矩阵、顶会顶刊清单、学者追踪、arXiv预印本监控、文献雪球法' },
      { id: '1.3', title: '选题评估矩阵', summary: '创新性三维模型、可行性四要素、量化打分表、4个典型方向对比' },
      { id: '1.4', title: '核心产出', summary: '课题说明书、技术路线Gantt图、基线论文清单、关键词体系、预印本监控、选题评估报告' },
    ],
    scripts: [
      { name: 'keyword_matrix.py', desc: '关键词矩阵生成与检索式构建', code: `# 三维关键词矩阵
SCENARIO = ["mmWave communication", "massive MIMO", "URLLC", "V2X", "RIS"]
METHOD = ["deep reinforcement learning", "DQN", "PPO", "LSTM", "transformer"]
PROBLEM = ["channel estimation", "resource allocation", "power control", "beamforming"]

def generate_query(s, m, p):
    return f'("{s}") AND ("{m}") AND ("{p}")'

# 5×5×4 = 100 种检索组合
for s in SCENARIO:
    for m in METHOD:
        for p in PROBLEM:
            print(generate_query(s, m, p))` },
      { name: 'arxiv_monitor.py', desc: 'arXiv论文自动监控', code: `import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta

def search_arxiv(keywords, max_results=20, days_back=7):
    query = f"search_query=all:{keywords.replace(' ', '+')}"
    url = f"http://export.arxiv.org/api/query?{query}&max_results={max_results}"
    response = urllib.request.urlopen(url)
    root = ET.fromstring(response.read().decode("utf-8"))
    ns = {"atom": "http://www.w3.org/2005/Atom"}
    papers = []
    for entry in root.findall("atom:entry", ns):
        title = entry.find("atom:title", ns).text.strip()
        published = entry.find("atom:published", ns).text[:10]
        papers.append({"title": title, "date": published})
    return papers

# 每周一早上运行
for q in ["DRL resource allocation wireless", "LSTM channel estimation"]:
    print(search_arxiv(q))` },
      { name: 'snowball_search.py', desc: '文献雪球法辅助管理', code: `class LiteratureTree:
    def __init__(self):
        self.papers = {}  # id → paper dict
        self.tags = {}    # tag → [paper_ids]

    def add_paper(self, paper):
        pid = paper["id"]
        self.papers[pid] = paper
        for kw in paper.get("keywords", []):
            self.tags.setdefault(kw, []).append(pid)

    def forward_snowball(self, pid, depth=2):
        """向后雪球: 找引用了这篇的论文 (最新进展)"""
        if depth == 0: return []
        result = []
        for cid in self.papers[pid].get("citations", []):
            result.append(cid)
            result.extend(self.forward_snowball(cid, depth - 1))
        return result` },
      { name: 'topic_scorer.py', desc: '课题方向量化评估', code: `CRITERIA = {
    "创新性": {"weight": 0.30, "subs": {"问题新颖度": 0.4, "方法创新性": 0.3, "区分度": 0.3}},
    "可行性": {"weight": 0.25, "subs": {"数据可得性": 0.35, "基线可复现": 0.30, "计算资源": 0.20, "能力匹配": 0.15}},
    "发表价值": {"weight": 0.25, "subs": {"会议匹配度": 0.40, "贡献显著性": 0.35, "竞争程度": 0.25}},
    "可持续性": {"weight": 0.20, "subs": {"扩展为多篇": 0.35, "毕业方向一致": 0.35, "后续空间": 0.30}},
}

def compute_total(scores):
    total = 0
    for crit, info in CRITERIA.items():
        crit_score = sum(scores[crit][s] * w for s, w in info["subs"].items())
        total += crit_score * info["weight"]
    return round(total, 2)` },
      { name: 'gantt_chart.py', desc: '技术路线Gantt图绘制' },
      { name: 'baseline_papers.py', desc: '基线论文清单管理' },
    ],
    deliverables: [
      '课题说明书 (1-2页)',
      '技术路线图 Gantt图',
      '基线论文清单 (10-15篇)',
      '关键词体系 三维矩阵',
      '预印本监控脚本',
      '选题评估报告',
    ],
  },
  {
    id: 2,
    title: '文献阅读与综述',
    goal: '建立系统化的文献检索→管理→精读→综述工作流',
    sections: [
      { id: '2.1', title: '文献检索策略', summary: '6大数据库对比、布尔检索式构建、三层递进检索、雪球法工程化' },
      { id: '2.2', title: '文献管理流程', summary: 'Zotero+Zotfile+BetterBibTeX+Obsidian工具链、双向链接笔记、阅读进度跟踪' },
      { id: '2.3', title: '论文精读方法', summary: '三遍阅读法（5min/30-60min/1-2h）、精读模板、公式推导、优先级排序' },
      { id: '2.4', title: '文献综述产出', summary: '综述写作三原则、对比表自动生成、4周综述写作计划' },
    ],
    scripts: [
      { name: 'search_query_builder.py', desc: '检索式生成 + 三层检索策略' },
      { name: 'snowball_crawler.py', desc: '雪球法文献网络扩展' },
      { name: 'reading_tracker.py', desc: '阅读进度跟踪 + 周报' },
      { name: 'reading_priority.py', desc: '阅读优先级排序' },
      { name: 'comparison_table.py', desc: '对比表(Markdown+LaTeX)生成' },
    ],
    deliverables: [
      'Zotero工具链部署',
      '文献数据库 (50+篇)',
      '精读笔记 (15-20篇)',
      '文献综述草稿',
    ],
  },
  {
    id: 3,
    title: '实验设计与仿真',
    goal: '建立规范化的实验设计→仿真搭建→结果分析全流程',
    sections: [
      { id: '3.1', title: '实验设计方法论', summary: '基线三层对比、控制变量法、消融实验、统计显著性检验' },
      { id: '3.2', title: '仿真平台搭建', summary: '通信AI仿真链路、MATLAB+Python混合仿真、自定义Gym环境、DeepMIMO数据集' },
      { id: '3.3', title: '实验记录规范', summary: '实验记录卡、超参数统一管理、WandB跟踪' },
      { id: '3.4', title: '结果分析方法', summary: '7大性能指标、可视化模板（收敛曲线/柱状对比/热力图）、分析检查清单' },
    ],
    scripts: [
      { name: 'baseline_checklist.py', desc: '基线完整性检查' },
      { name: 'significance_test.py', desc: '统计显著性检验' },
      { name: 'custom_wireless_env.py', desc: '自定义Gym环境' },
      { name: 'deepmimo_loader.py', desc: 'DeepMIMO数据加载' },
      { name: 'hyperparam_manager.py', desc: '超参数管理与实验调度' },
      { name: 'result_visualization.py', desc: '结果可视化' },
    ],
    deliverables: [
      '完整实验设计',
      '可运行仿真平台',
      '实验记录规范',
      '结果分析报告',
    ],
  },
  {
    id: 4,
    title: '工具链与生态',
    goal: '构建完整的科研工具链，覆盖仿真→分析→写作全流程',
    sections: [
      { id: '4.1', title: 'Python生态', summary: 'PyTorch/SB3/Sionna/CommPy/DeepMIMO工具栈、训练模板' },
      { id: '4.2', title: 'MATLAB生态', summary: '5G/LTE/Phased Array工具箱、MATLAB+Python混编、5G NR PDSCH仿真' },
      { id: '4.3', title: '写作与排版', summary: 'IEEE LaTeX模板、TikZ系统模型图、BibTeX管理' },
      { id: '4.4', title: '效率工具', summary: 'Git+GitHub工作流、Obsidian笔记系统、科研周计划生成' },
    ],
    scripts: [
      { name: 'pytorch_wireless_template.py', desc: 'PyTorch通信AI训练模板' },
      { name: 'sb3_wireless_template.py', desc: 'SB3强化学习训练模板' },
      { name: 'sionna_channel.py', desc: 'Sionna 5G信道仿真' },
      { name: 'research_planner.py', desc: '科研周计划生成器' },
    ],
    deliverables: [
      'Python环境配置',
      'MATLAB环境配置',
      'Git仓库初始化',
      'Obsidian vault',
      'LaTeX环境',
    ],
  },
  {
    id: 5,
    title: '论文写作方法论',
    goal: '掌握学术论文结构拆解与写作方法论，产出可投IEEE会议的论文',
    sections: [
      { id: '5.1', title: '论文结构拆解', summary: '6周写一篇会议论文、各章节写作模板（Abstract/Intro/Method/Experiments）、完整性检查' },
      { id: '5.2', title: '写作节奏规划', summary: 'IEEE会议时间线、积少成多策略、番茄工作法' },
      { id: '5.3', title: '语言与图稿', summary: '学术英语高频句式、常见错误自查、图表制作规范' },
    ],
    scripts: [
      { name: 'paper_structure_check.py', desc: '论文结构完整性检查' },
      { name: 'writing_timeline.py', desc: '写作时间线生成' },
      { name: 'paper_formatter.py', desc: '格式检查与辅助' },
    ],
    deliverables: [
      '论文初稿',
      '完整图表',
      '润色版本',
    ],
  },
  {
    id: 6,
    title: '投稿与审稿',
    goal: '掌握IEEE会议/期刊投稿全流程，学会审稿回复与Rebuttal',
    sections: [
      { id: '6.1', title: '投稿策略', summary: '硕士阶段投稿阶梯（小论文→旗舰会议→顶级期刊）、时间表规划' },
      { id: '6.2', title: '稿件准备', summary: '投稿检查清单、Cover Letter模板、推荐/回避审稿人策略' },
      { id: '6.3', title: '审稿回复', summary: '审稿结果解读、Point-by-point回复模板、常用句式' },
      { id: '6.4', title: 'Rebuttal策略', summary: '被拒稿后处理流程、改投路径、投稿记录追踪' },
    ],
    scripts: [
      { name: 'submission_scheduler.py', desc: '投稿时间表规划' },
      { name: 'submission_checklist.py', desc: '投稿检查清单' },
      { name: 'rejection_handler.py', desc: '拒稿后处理方案' },
      { name: 'submission_tracker.py', desc: '投稿历史追踪' },
    ],
    deliverables: [
      '投稿策略确定',
      '稿件准备完成',
      '审稿回复模板',
    ],
  },
]

// ============ 周计划任务模板（research_planner.py）============

export const WEEKLY_PLAN_TEMPLATE = [
  { name: '阅读3篇论文', hours: 6, priority: 5 },
  { name: '复现基线方法', hours: 10, priority: 5 },
  { name: '修改实验代码', hours: 8, priority: 4 },
  { name: '写文献综述', hours: 6, priority: 3 },
  { name: '整理实验数据', hours: 4, priority: 3 },
  { name: '组会PPT准备', hours: 3, priority: 4 },
  { name: '英语学习', hours: 3, priority: 2 },
]
