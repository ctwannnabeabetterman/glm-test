/**
 * 选题评估的 AI 打分支撑层。
 *
 * 背景（2026-09-18 用户反馈）：「打分应该是 AI 打的吧，自己打分有点难」。
 * 原实现是全部细项 × (滑杆 + 数字框) 全靠用户手工填，新增课题时一律预设 5 分 ——
 * 用户点开「打分」看到一片 5，既不知道自己填得对不对，也懒得逐项调。
 *
 * 但「全交给 AI」并不对：矩阵里有 4 项（数据/仿真平台可得性、计算资源需求、
 * 个人能力匹配度、是否与毕业论文方向一致）**只有用户自己知道**，
 * 模型只能按「同类学生的常见情况」猜 —— 猜出来的分数如果被当成事实看，
 * 比不填更危险（它会直接抬/压总分，进而影响「这个课题该不该做」的判断）。
 *
 * 所以本文件承担两件事，都必须是纯函数（本仓库无组件测试基建，逻辑必须能单测）：
 *  1. `interpretScorePayload` —— 把模型返回的 JSON 变成可信的分数表：
 *     只收白名单内的项、clamp 到 0-10、缺项用回退值补齐、顺手按权重算总分；
 *  2. `splitByJudge` —— 把细项分成「AI 给的分」与「需你确认的分」，供 UI 标注来源。
 *
 * ⚠️ 细项总数**不要硬编 14**。真实数字是 `ALL_SUB_ITEMS.length`（当前 13）：
 * 创新性 3 + 可行性 4 + 发表价值 3 + 可持续性 3。文案里写死数字，
 * 一旦矩阵增删一项就会变成错的（本文件最初就写错过，被测试挡下来了）。
 */

import { TOPIC_CRITERIA } from '@/lib/methodology-data'

export type ScoreMap = Record<string, Record<string, number>>

/**
 * AI 只能「按常规经验猜」的细项 —— 这些分数在 UI 上必须显式标为「待你确认」。
 *
 * 判据不是「AI 会不会答」，而是「这件事的事实存在于谁手里」：
 * 实验室有没有某个仿真平台、你手头有几张卡、你的毕业论文写到哪了 ——
 * 这些是私有事实，模型无从知晓，只能给一个同类样本的均值。
 */
export const SUBJECTIVE_ITEMS: readonly string[] = [
  '数据/仿真平台可得性',
  '计算资源需求',
  '个人能力匹配度',
  '是否与毕业论文方向一致',
]

/** 全部合法细项名（用于白名单校验：模型多写/写错名字一律丢弃） */
export const ALL_SUB_ITEMS: string[] = Object.values(TOPIC_CRITERIA).flatMap((info) =>
  Object.keys(info.subItems as Record<string, number>)
)

const SUBJECTIVE_SET = new Set(SUBJECTIVE_ITEMS)

/** 该细项是否属于「只有用户自己知道」的那一类 */
export function isSubjective(subItem: string): boolean {
  return SUBJECTIVE_SET.has(subItem)
}

/** 空打分表：全部填同一个回退值（默认 5，与旧行为一致，便于「AI 失败时不留空」） */
export function emptyScoreMap(fallback = 5): ScoreMap {
  const out: ScoreMap = {}
  Object.entries(TOPIC_CRITERIA).forEach(([crit, info]) => {
    out[crit] = {}
    Object.keys(info.subItems as Record<string, number>).forEach((sub) => {
      out[crit][sub] = fallback
    })
  })
  return out
}

/**
 * 按权重算总分（满分 10）。
 *
 * 与组件里此前的内联实现是同一套公式，抽出来是为了让「AI 写回」与
 * 「用户手改」两条路径共用一份算术 —— 两处各写一遍迟早会漂。
 */
export function computeTotalScore(scores: ScoreMap): number {
  let total = 0
  Object.entries(TOPIC_CRITERIA).forEach(([crit, info]) => {
    let critScore = 0
    Object.entries(info.subItems as Record<string, number>).forEach(([sub, weight]) => {
      critScore += (scores[crit]?.[sub] ?? 0) * weight
    })
    total += critScore * info.weight
  })
  return Math.round(total * 100) / 100
}

/**
 * 把任意输入压成 0-10 的整数分；非数字返回 null（调用方决定回退）。
 *
 * ⚠️ 空字符串与纯空白必须显式挡掉：`Number('')` 是 **0** 而不是 NaN，
 * 所以「模型把某一项写成 ""」会被静默当成「这项 0 分」——
 * 0 分在评分矩阵里意味着「教科书内容 / 无任何参考实现」，是极强的负面判断，
 * 绝不能由一次空值事故产生。宁可判为非法、走回退值并记进 `missing`，
 * 让用户看到「这项 AI 没给」而不是看到「这项 AI 判了 0 分」。
 */
export function clampScore(value: unknown): number | null {
  let n: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    n = Number(trimmed)
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) return null
  return Math.max(0, Math.min(10, Math.round(n)))
}

/**
 * 从模型回复里抠出 JSON。
 *
 * 模型经常不听话：包在 ```json 围栏里、前后带一句「好的，以下是评分结果：」、
 * 或者在 JSON 后面追加解释。这里逐层退让，直到能解析出**对象**为止。
 *
 * ⚠️ 这一层有两个互相冲突的要求，不能只顾一边：
 *
 *  - 「前面出现数组」不能让结果变 null。`参考 [1,2]，评分如下：{"a":1}` 是
 *    很常见的形态，若写成「看到 `[` 在 `{` 前就放弃」，这句里的合法对象会被丢掉 ——
 *    把「防数组」误伤成了「拒解析」。
 *  - 「整体是数组」必须被判为不算数。`[{"a":1}]` 若用「第一个 `{` 到最后一个 `}`」
 *    去切，会切出 `{"a":1}` 并解析成功，于是调用方拿到一个
 *    「看起来合法、实为数组元素」的对象。
 *
 * 两者靠**一个前置判据**区分（试过只靠候选片段顺序，两个要求无法同时成立）：
 * 对象之前若出现过 `[`，且该数组的 `]` 落在对象**之后**，说明这个数组把对象
 * 包在里面 —— 它是外层容器，整体是数组，直接放弃。
 *
 * 判据要「跨过对象」而不是「紧邻对象」：`参考 [1,2]，评分如下：{…}` 里的 `[...]`
 * 在对象之前就闭合了，它只是句子里的方括号，不是容器；而 `[{"a":1}]` 的 `]`
 * 在对象之后，说明对象被数组包着。
 */
export function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null

  const first = text.indexOf('{')
  if (first === -1) return null

  // 前置判据：数组包着对象 ⇒ 整体是数组，不算数。
  const bracketBefore = text.lastIndexOf('[', first)
  if (bracketBefore !== -1 && text.lastIndexOf(']') > first) {
    return null
  }

  const candidates: string[] = []

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)
  // 围栏优先：围栏内容最可能是模型「打算输出的那个 JSON」
  if (fenced) candidates.push(fenced[1])

  const last = text.lastIndexOf('}')
  // 第一个 `{` 到最后一个 `}`：应对「对象后面跟了另一段含 `}` 的文字」
  if (last > first) candidates.push(text.slice(first, last + 1))
  // 第一个 `{` 到结尾：应对「对象后面跟了不含 `}` 的尾巴」
  candidates.push(text.slice(first))

  candidates.push(text)

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate.trim())
      // 底线：结果必须是对象。数组即使长得像评分表也不算数。
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* 试下一个候选片段 */
    }
  }
  return null
}

export interface ScoreInterpretation {
  /** 归一化后的完整打分表（`ALL_SUB_ITEMS` 全齐，全是 0-10 整数） */
  scores: ScoreMap
  /** 按权重算出的总分 */
  totalScore: number
  /** 模型确实给了分、且合法可用的细项数 */
  scored: number
  /** 模型没给（或给了非法值）而沿用回退值的细项名 */
  missing: string[]
  /** 模型额外给出的、不在评分矩阵内的键（用来提示「它跑题了」） */
  ignored: string[]
  /** 模型给的理由（若有） */
  rationale: string
}

/**
 * 把模型返回的 payload 解释成可信的分数表。
 *
 * `payload` 期望形状（提示词里约定的）：
 * ```json
 * { "scores": { "问题新颖度": 7, ... }, "rationale": "..." }
 * ```
 * 但也容忍模型直接平铺一层 `{ "问题新颖度": 7, ... }`。
 *
 * 容错策略刻意偏「保守可用」而不是「全有或全无」：宁可大部分项用 AI 的、
 * 少数项用回退值并明确告诉你哪些没拿到，也不因为一个键写错就整块丢弃 ——
 * 后者会让用户觉得「AI 打分坏了」，而前者他能直接补那几项。
 */
export function interpretScorePayload(
  payload: Record<string, unknown> | null,
  fallback: ScoreMap = emptyScoreMap(5)
): ScoreInterpretation {
  const scores: ScoreMap = {}
  Object.entries(TOPIC_CRITERIA).forEach(([crit, info]) => {
    scores[crit] = {}
    Object.keys(info.subItems as Record<string, number>).forEach((sub) => {
      scores[crit][sub] = fallback[crit]?.[sub] ?? 5
    })
  })

  const flat: Record<string, unknown> = {}
  const missing: string[] = []
  const ignored: string[] = []

  if (payload) {
    const nested = payload.scores
    const source: Record<string, unknown> =
      nested && typeof nested === 'object' && !Array.isArray(nested)
        ? (nested as Record<string, unknown>)
        : payload

    // 只认白名单里的项。模型有时会顺手塞进「总评」「建议」之类的键，
    // 一旦被当成分数写进库里，导出和图表就全是脏数据。
    const allowed = new Set(ALL_SUB_ITEMS)
    for (const [key, value] of Object.entries(source)) {
      if (key === 'rationale' || key === 'totalScore' || key === '总分') continue
      if (!allowed.has(key)) {
        ignored.push(key)
        continue
      }
      flat[key] = value
    }
  }

  let scored = 0
  Object.entries(TOPIC_CRITERIA).forEach(([crit, info]) => {
    Object.keys(info.subItems as Record<string, number>).forEach((sub) => {
      const value = clampScore(flat[sub])
      if (value === null) {
        missing.push(sub)
        return
      }
      scores[crit][sub] = value
      scored += 1
    })
  })

  const rationale =
    payload && typeof payload.rationale === 'string'
      ? payload.rationale.trim()
      : ''

  return {
    scores,
    totalScore: computeTotalScore(scores),
    scored,
    missing,
    ignored,
    rationale,
  }
}

export interface JudgeSplit {
  /** AI 确实在行的项：问题新颖度/方法创新性/区分度/期刊匹配/贡献显著性/竞争程度/… */
  ai: string[]
  /** 只有用户自己知道的项，AI 给的分只是「同类样本均值」，需要他确认 */
  user: string[]
}

/** 把细项按「谁更有资格判」分成两组，供 UI 标注来源 */
export function splitByJudge(): JudgeSplit {
  const ai: string[] = []
  const user: string[] = []
  for (const item of ALL_SUB_ITEMS) {
    if (isSubjective(item)) user.push(item)
    else ai.push(item)
  }
  return { ai, user }
}

/**
 * 给 AI 打分提示词用的「评分矩阵说明书」。
 *
 * 必须把每一项的**判分口径**写清楚：只说「给 0-10 分」，模型会一律给 7 分
 * （它的安全回答区），14 项全是 7 等于没打。所以每项都配一句「什么算高分」。
 *
 * 同时要显式告诉它哪 4 项是主观项 —— 否则它会以「我很确定」的语气给
 * 「个人能力匹配度」打 8 分，用户看了会以为自己确实匹配。
 */
export const AI_SCORE_RUBRIC = `## 评分矩阵（4 个维度、14 个细项，每项 0-10 整数分）

维度权重：创新性 30%、可行性 25%、发表价值 25%、可持续性 20%

**创新性（30%）**
- 问题新颖度（占本维度 40%）：10=前人基本没碰过；7=有人提过但未解决；4=已有成熟解法；0=教科书内容
- 方法创新性（占本维度 30%）：10=提出新方法族；7=对现有方法做本质改造；4=常规组合/调参；0=直接套用
- 与现有工作的区分度（占本维度 30%）：10=一眼可辨的差异；7=差异清晰但易被同类覆盖；4=与某篇工作高度重叠；0=实质重复

**可行性（25%）**
- 数据/仿真平台可得性（占本维度 35%）【你无法确知，请按「同类学生的常见情况」估计，并在理由里注明是估计】
- 基线可复现程度（占本维度 30%）：10=官方开源且文档齐全；7=有社区复现；4=仅论文描述；0=无任何参考实现
- 计算资源需求（占本维度 20%）【你无法确知，按常见实验室条件估计，注明是估计】：10=单卡数小时；7=单卡数天；4=多卡数天；0=需要集群
- 个人能力匹配度（占本维度 15%）【你无法确知，按该方向的一般门槛估计，注明是估计】

**发表价值（25%）**
- 目标会议/期刊匹配度（占本维度 40%）：10=与顶会/顶刊近期征稿方向高度契合；7=合适但非热点；4=需降档投稿；0=无对口去处
- 预期贡献的显著性（占本维度 35%）：10=能改变领域做法；7=在细分问题上推进明显；4=增量改进；0=工程调参
- 竞争激烈程度（占本维度 25%）：**注意这是反向指标**，10=冷门、易做出首发结果；4=热门但仍有空隙；0=已被大组占满

**可持续性（20%）**
- 能否扩展为多篇论文（占本维度 35%）：10=可拆成 3 篇以上且有层次；7=可延伸 1-2 篇；4=做完即止；0=死胡同
- 是否与毕业论文方向一致（占本维度 35%）【你无法确知，若用户未说明则以 5 分表示「需用户确认」，并在理由里点明】
- 后续研究空间（占本维度 30%）：10=打开新问题；7=有自然延伸；4=空间有限；0=无`

/**
 * 拼给模型的打分任务说明。
 *
 * 两处刻意设计：
 *  1. **强制 JSON 输出** —— 这一条路由不拼 OUTPUT_FORMAT_CONTRACT
 *     （那份合同是给「给人看的 Markdown」用的），改成 JSON 契约；
 *     否则模型会用 Markdown 表格回答，程序解析不了，用户白等两分钟。
 *  2. **要求区分「实测依据」与「经验估计」** —— 4 个主观项必须自曝是猜的。
 */
export const AI_SCORE_JSON_CONTRACT = `## 输出格式（必须严格遵守）
只输出一个 JSON 对象，**不要** Markdown 代码围栏、不要任何解释性前后缀：

{
  "scores": { "问题新颖度": 7, "方法创新性": 6, "...": 0 },
  "rationale": "用 3-6 句话说明打分依据"
}

要求：
- scores 的键必须是上面列出的 13 个细项名，**逐字照抄**，不要改写、不要增删；
- 每个值必须是 0-10 的整数，不要写小数、不要写"7分"这种带单位的字符串；
- 没有依据的细项也必须给一个分（不允许留空或写 null）；
- rationale 里必须明确指出哪些项是「根据经验估计」而非有实测依据。`

/**
 * 组装打分依据（论文与笔记）。
 *
 * 为什么要把「有无依据」单独回传：如果一个课题还没挂任何论文、
 * 也没挂笔记，AI 只能凭课题名和描述硬猜 —— 这种分数必须让用户看到
 * 「本次无文献依据」，否则他会以为 AI「读了资料」才给的分。
 */
export interface TopicEvidence {
  paperCount: number
  noteCount: number
  text: string
}

export function buildScoreEvidence(
  papers: Array<{ title: string; venue?: string; year?: number; tags?: string; abstract?: string }>,
  notes: Array<{ title: string; content?: string }>
): TopicEvidence {
  const lines: string[] = []
  if (papers.length) {
    lines.push('本课题已挂论文：')
    papers.forEach((p, i) => {
      const meta = [p.venue, p.year ? String(p.year) : '', p.tags].filter(Boolean).join(' / ')
      const abstract = (p.abstract || '').trim().slice(0, 300)
      lines.push(`${i + 1}. ${p.title}${meta ? `（${meta}）` : ''}${abstract ? `\n   摘要节选：${abstract}` : ''}`)
    })
  }
  if (notes.length) {
    if (lines.length) lines.push('')
    lines.push('本课题已挂笔记：')
    notes.forEach((n, i) => {
      lines.push(`${i + 1}. ${n.title}\n   正文节选：${(n.content || '').trim().slice(0, 300)}`)
    })
  }
  return {
    paperCount: papers.length,
    noteCount: notes.length,
    text: lines.join('\n'),
  }
}
