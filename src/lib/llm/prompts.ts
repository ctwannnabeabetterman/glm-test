/**
 * 所有 AI 路由共用的提示词约束。
 *
 * 背景（2026-09-18 全量排查）：7 个 AI 路由里**只有 ai-direction** 的提示词带了
 * 「必须基于提供的本地数据回答，不能假装查阅未提供的论文」，其余 6 个都没有 ——
 * 而 ai-related-papers / ai-gap-analysis / ai-experiment 恰恰是让模型输出
 * **论文标题、作者、年份、期刊、GitHub 链接** 的地方。
 *
 * 对一个科研工作台来说，凭空生成的参考文献是最严重的一类幻觉：它不像错别字那样
 * 能被一眼看穿，反而会被当成线索去检索、去引用，代价由用户承担。
 *
 * 所以把约束抽成统一常量，凡是要「说事实」的路由都拼上这一句；文案只此一份，
 * 要调就调这里，不必去 7 个文件里改 7 遍不一致的说法。
 */

/** 通用防编造约束：适用于「基于输入推断外部事实」的路由 */
export const NO_FABRICATION_GUARD =
  '约束：只依据本条消息中提供的信息、以及你确有把握的公认知识作答；' +
  '凡是无法由此确认的内容（论文标题、作者、年份、期刊、DOI、代码仓库链接、实验数值等），' +
  '一律明确标注「需自行核实」，绝不编造或凭印象补全。'

/**
 * 同上，英文版 —— `/api/ai-review` 在 `language='en'` 时要输出英文学术英文，
 * 提示词本身是英文；此时塞一句中文约束会让风格混掉，所以另存一份英文说法。
 */
export const NO_FABRICATION_GUARD_EN =
  'Constraint: rely only on the information given in this message and on well-established ' +
  'knowledge you are certain about. Anything you cannot confirm this way — paper titles, ' +
  'authors, years, venues, DOIs, repository links, experimental numbers — must be explicitly ' +
  'marked as "needs verification". Never fabricate or fill in from vague recollection. ' +
  'Cite only the papers listed above; do not invent citations for papers not in that list.'

/**
 * 「只有元数据」约束：`/api/ai-summary` 专用。
 *
 * 为什么单独一条：`Paper` 模型（prisma/schema.prisma）**没有摘要/正文字段**，
 * 该接口只把 title/authors/venue/year/tags/notes 喂给模型。也就是说
 * 「快速摘要（研究问题 + 核心方法 + 主要贡献）」这个功能，在用户没写笔记时
 * **手里根本没有可总结的原料** —— 不点明这一点，模型就会一本正经地把
 * 研究问题、方法名、贡献点编出来，而用户会以为这是从论文里读出来的。
 */
export const METADATA_ONLY_GUARD =
  '约束：你只能看到论文的标题、作者、期刊、年份、标签，以及用户自己写的笔记，' +
  '**看不到论文正文或摘要**。只能基于这些信息作答；对研究问题、方法细节、实验结果的推断' +
  '必须显式标注为「推测」，并提示用户补充笔记或查阅原文，不要编造具体方法名、数据集或数值。'
