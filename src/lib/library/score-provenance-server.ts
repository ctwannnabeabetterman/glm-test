/**
 * 「这条分数是 AI 给的还是人给的」的存取层。
 *
 * 为什么存成一条 `Setting` 的 JSON 映射，而不是给 `Paper` 加一列 `scoreSource`：
 * 加列要走 prisma schema + 桌面端启动迁移 + 同步模板库三处（本项目都做过，也不难），
 * 但代价是**每个用户的库都要改结构**，而这一列只为「界面上显示一个 AI 徽标」服务。
 * 用一条设置行换掉一次结构迁移，对「升级零风险」这条硬要求来说是划算的。
 * 代价是它不进 `Paper` 的字段级导出 —— 那是可接受的（徽标丢了不影响数据正确性）。
 */

import { db } from '@/lib/db'
import {
  SCORE_PROVENANCE_KEY,
  clearScored,
  markScored,
  parseProvenance,
  type ProvenanceMap,
} from './reading-priority'

export async function readProvenance(): Promise<ProvenanceMap> {
  try {
    const row = await db.setting.findUnique({ where: { key: SCORE_PROVENANCE_KEY } })
    return parseProvenance(row?.value)
  } catch (e) {
    // 读标记失败不该让论文库打不开：最坏情况是「徽标不显示」
    console.error('readProvenance error', e)
    return {}
  }
}

export async function writeProvenance(map: ProvenanceMap): Promise<void> {
  const value = JSON.stringify(map)
  await db.setting.upsert({
    where: { key: SCORE_PROVENANCE_KEY },
    update: { value },
    create: { key: SCORE_PROVENANCE_KEY, value },
  })
}

/** 记下「这些论文的分数是 AI 给的」 */
export async function markScoredInDb(ids: readonly string[], at: string): Promise<ProvenanceMap> {
  const next = markScored(await readProvenance(), ids, at)
  await writeProvenance(next)
  return next
}

/**
 * 摘掉标记 —— **手工改过分数之后必须调用**，
 * 否则界面上会继续谎称「这是 AI 打的分」，用户会以为自己看到的是模型的判断。
 */
export async function clearScoredInDb(ids: readonly string[]): Promise<ProvenanceMap> {
  const current = await readProvenance()
  const next = clearScored(current, ids)
  // 没有变化就不写库（手工编辑论文是很高频的操作，没必要每次都写一条 Setting）
  if (Object.keys(next).length !== Object.keys(current).length) {
    await writeProvenance(next)
  }
  return next
}
