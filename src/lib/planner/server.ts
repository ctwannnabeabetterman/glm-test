/**
 * 规划模块的服务端取数辅助。
 *
 * 单独成文件是因为「同步」与「偏差报告」两条路由都要用同一套口径：
 * 项目配置的读法、以及把里程碑上的 (refType, refId) 批量解析成实体快照。
 * 口径只写一份，才能保证页面上看到的和导出报告里算出来的完全一致。
 */

import { db } from '@/lib/db'
import {
  DEFAULT_PROJECT_CONFIG,
  PROJECT_SETTING_KEY,
  normalizeProjectConfig,
  type ProjectConfig,
} from './config'
import { manuscriptWordCount, type RefSnapshot } from './linkage'

export async function loadProjectConfig(): Promise<ProjectConfig> {
  try {
    const row = await db.setting.findUnique({ where: { key: PROJECT_SETTING_KEY } })
    if (!row) return { ...DEFAULT_PROJECT_CONFIG }
    return normalizeProjectConfig(JSON.parse(row.value))
  } catch {
    return { ...DEFAULT_PROJECT_CONFIG }
  }
}

export function refKey(type: string, id: string): string {
  return `${type}:${id}`
}

interface RefPointer {
  type: string
  id: string
}

/**
 * 批量取关联实体快照。
 * 一次 in 查询而不是 N 次 findUnique —— 里程碑一多，逐条查会明显拖慢规划页。
 */
export async function loadRefSnapshots(refs: readonly RefPointer[]): Promise<Map<string, RefSnapshot>> {
  const map = new Map<string, RefSnapshot>()

  const experimentIds = [...new Set(refs.filter((r) => r.type === 'experiment' && r.id).map((r) => r.id))]
  const manuscriptIds = [...new Set(refs.filter((r) => r.type === 'manuscript' && r.id).map((r) => r.id))]

  if (experimentIds.length) {
    const rows = await db.experiment.findMany({ where: { id: { in: experimentIds } } })
    for (const r of rows) {
      map.set(refKey('experiment', r.id), {
        type: 'experiment',
        item: { id: r.id, name: r.name, status: r.status },
      })
    }
  }

  if (manuscriptIds.length) {
    const rows = await db.manuscript.findMany({ where: { id: { in: manuscriptIds } } })
    for (const r of rows) {
      map.set(refKey('manuscript', r.id), {
        type: 'manuscript',
        item: {
          id: r.id,
          title: r.title,
          status: r.status,
          targetWords: r.targetWords,
          sections: r.sections,
        },
      })
    }
  }

  return map
}

/** 人类可读的关联名（UI 上显示「⇄ 实验：xxx」）；解析不出来返回空串 */
export function refLabel(snapshot: RefSnapshot | null | undefined): string {
  if (!snapshot) return ''
  return snapshot.type === 'experiment' ? snapshot.item.name : snapshot.item.title
}

/** 稿件当前字数（用于把「写到哪了」显示给用户） */
export function snapshotWordCount(snapshot: RefSnapshot | null | undefined): number | null {
  if (!snapshot || snapshot.type !== 'manuscript') return null
  return manuscriptWordCount(snapshot.item.sections)
}
