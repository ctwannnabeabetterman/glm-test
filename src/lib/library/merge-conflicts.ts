/**
 * 文献合并的**冲突描述**（客户端安全）。
 *
 * 为什么单独一个文件：`merge.ts` 顶部 `import { db } from '@/lib/db'` —— 那是服务端
 * 模块（Prisma）。UI 只需要「冲突长什么样、怎么说给人听」，如果直接从 `merge.ts`
 * 引，打包器会把 Prisma 一起拉进浏览器包。所以把**类型与纯格式化**放在这里，
 * 服务端与客户端共用同一份措辞，谁也不依赖谁。
 */

/** 因身份冲突而未写入的条目 */
export interface MergeConflict {
  title: string
  reason: string
}

/**
 * 把冲突列表压成一句可读提示；无冲突返回 `null`。
 *
 * 放在这里而不是各 UI 里，是为了让三个导入入口（AI 相关论文、RIS/BibTeX 文本、
 * Zotero 同步）用**同一句措辞** —— 否则同一个冲突在不同入口说法不一，
 * 用户会以为是两回事。纯函数，便于单测。
 */
export function describeConflicts(conflicts: MergeConflict[] | undefined, max = 2): string | null {
  if (!conflicts || conflicts.length === 0) return null
  const head = conflicts.slice(0, max).map((c) => `「${c.title}」`).join('、')
  const more = conflicts.length > max ? ` 等 ${conflicts.length} 条` : ''
  return `${head}${more} 未导入：与库中已有文献存在身份冲突（${conflicts[0].reason}）。请在论文库里人工核对后手动添加。`
}
