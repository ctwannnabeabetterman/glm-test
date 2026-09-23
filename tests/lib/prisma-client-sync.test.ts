import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 「改了 schema 却忘了 `prisma generate`」的守卫。
 *
 * 为什么需要它（2026-09-23 真踩到）：给 `Note` 加 `paperIds` 后，
 * 数据库那一侧齐了（`migrate-database.js` 补列 + 模板已对齐）、
 * 类型检查也过了，但**运行时每个新建笔记都 500**：
 *
 *     Unknown argument `paperIds`. Available options are marked with ?
 *     POST /api/notes 500
 *
 * 两个环节都没拦住它，这正是要被守住的空白：
 *  - **`tsc` 拦不住** —— 字段是从 `pickWritableNote()` 返回的
 *    `Record<string, unknown>` 里**展开**进 `data` 的，TS 的「多余属性检查」
 *    只看字面量键，展开进来的键它不查；
 *  - **单测也拦不住** —— 单测里 `db` 是 mock，根本不走 Prisma 的字段校验。
 *
 * 所以只能直接比对「生成的客户端」是否认得 schema 里的每个字段。
 * CI 与 Release 都在 `typecheck` / `test` 之前跑 `npx prisma generate`，
 * 因此这条在本机与 CI 都成立。
 */
const REPO = process.cwd()
const SCHEMA = path.join(REPO, 'prisma', 'schema.prisma')
const GENERATED = path.join(REPO, 'node_modules', '.prisma', 'client', 'schema.prisma')

const SCALARS = ['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'Decimal', 'BigInt']

/** 抽出每个 model 的**标量列名**（跳过关系字段与 `@@` 块属性） */
function scalarFieldsByModel(text: string): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(text))) {
    const fields: string[] = []
    for (const raw of m[2].split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue
      const fm = /^(\w+)\s+([A-Za-z_][\w[\]?]*)/.exec(line)
      if (!fm) continue
      const type = fm[2].replace(/[?[\]]/g, '')
      if (!SCALARS.includes(type)) continue // 关系字段不是列
      fields.push(fm[1])
    }
    out[m[1]] = fields
  }
  return out
}

// 没跑过 generate 的环境（例如干净 checkout 直接跑某个单测）不该因此变红 ——
// 那时根本没有「生成物落后」这件事可言。
describe.skipIf(!existsSync(GENERATED))('Prisma 客户端与 schema 保持同步', () => {
  it('schema 里的每个字段，生成的客户端都认得', () => {
    const want = scalarFieldsByModel(readFileSync(SCHEMA, 'utf8'))
    const got = scalarFieldsByModel(readFileSync(GENERATED, 'utf8'))

    const missing: string[] = []
    for (const [model, fields] of Object.entries(want)) {
      if (!got[model]) {
        missing.push(`${model}（整张表都不在生成物里）`)
        continue
      }
      for (const f of fields) {
        if (!got[model].includes(f)) missing.push(`${model}.${f}`)
      }
    }

    expect(
      missing,
      '这些字段只写在 prisma/schema.prisma 里，生成的客户端还不知道 → 一旦有代码写这些列，' +
        '运行时会抛 PrismaClientValidationError（Unknown argument），而 tsc 与单测都发现不了。' +
        '修法：`npx prisma generate`（注意先停掉正在跑的服务，否则 query_engine DLL 被占用会 EPERM）。',
    ).toEqual([])
  })
})
