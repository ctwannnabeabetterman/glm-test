import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

/**
 * 迁移 DDL 与 Prisma schema 的**结构等价**守卫。
 *
 * 为什么需要它（审查报告 P1-09 的核心验收）：
 * 桌面端没有 prisma CLI，已装用户靠 `desktop/migrate-database.js` 在启动时补列。
 * 于是「新建的库」与「升级上来的库」是**两条不同的 DDL 路径**，而它们必须等价 ——
 * 一旦漂移，类型检查、单测、e2e 全绿，只有真实老用户升级后才炸。
 *
 * 已经真实发生过的一次漂移：`Note.paperIds` 在 schema 里是**非可空**，
 * 而 `sync-template.mjs` 给模板补列时一律回落 `DEFAULT ''`，
 * 导致 `@default("[]")` 的 JSON 数组列在模板里变成空串 —— 列名对得上（迁移只比列名），
 * 但默认值语义与 schema 不同，直接影响读取端的 `JSON.parse`。
 *
 * ⚠️ 本文件**不**断言可空性完全一致：SQLite 的 `ALTER TABLE ADD COLUMN` 不允许
 * 加 NOT NULL 而无默认值，所以迁移只能加「可空 + 有默认值」的列。
 * 这是被接受的取舍，但由此得到一条必须守住的弱化不变式：
 * **每个由迁移补出的列都必须带非 NULL 默认值** —— 否则老库里会出现 NULL，
 * 而 Prisma 读非可空字段拿到 NULL 会直接报「Inconsistent column data」。
 */

type SchemaField = { name: string; type: string; optional: boolean; defaultExpr: string | null }

const REPO = process.cwd()
const SCHEMA = path.join(REPO, 'prisma', 'schema.prisma')
const MIGRATION = path.join(REPO, 'desktop', 'migrate-database.js')

const SCALAR_TO_SQL: Record<string, string> = {
  String: 'TEXT',
  Int: 'INTEGER',
  BigInt: 'INTEGER',
  Float: 'REAL',
  Decimal: 'REAL',
  Boolean: 'BOOLEAN',
  DateTime: 'DATETIME',
  Json: 'TEXT',
  Bytes: 'TEXT',
}

/** 解析 schema.prisma 的每个模型 → 标量字段（关系字段不算列） */
function parseSchemaModels(text: string): Map<string, SchemaField[]> {
  const models = new Map<string, SchemaField[]>()
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm
  let m: RegExpExecArray | null
  while ((m = modelRe.exec(text))) {
    const fields: SchemaField[] = []
    for (const raw of m[2].split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('//') || line.startsWith('@@')) continue
      const fm = /^(\w+)\s+([A-Za-z_][\w[\]]*)(\?|\[\])?/.exec(line)
      if (!fm) continue
      const baseType = fm[2].replace(/[\[\]]/g, '')
      if (!(baseType in SCALAR_TO_SQL)) continue // 关系字段
      const dm = /@default\(([^)]*)\)/.exec(line)
      fields.push({ name: fm[1], type: baseType, optional: fm[3] === '?', defaultExpr: dm ? dm[1].trim() : null })
    }
    models.set(m[1], fields)
  }
  return models
}

/** 从迁移模块取出「表 → 补列 DDL」与「新建表 DDL 里出现的表名」 */
function loadMigration() {
  const mod = require(MIGRATION) as {
    newTables: Record<string, string>
    newIndexes: Record<string, { table: string }>
    tableColumns: Record<string, Record<string, string>>
  }
  return mod
}

/** 把一条 `colName TYPE DEFAULT x` 的列 DDL 拆开 */
function parseColumnDdl(ddl: string) {
  const m = /^\s*"?(\w+)"?\s+([A-Za-z]+)(?:\s+.*?DEFAULT\s+(.+?))?\s*$/.exec(ddl.trim())
  return m ? { name: m[1], sqlType: m[2].toUpperCase(), dflt: m[3] ? m[3].trim() : null } : null
}

/** schema 的常量默认值 → SQLite 里应写的字面量；非常量（now()/cuid()）返回 undefined 表示「不比对」 */
function expectedDefault(field: SchemaField): string | undefined {
  if (!field.defaultExpr) return undefined
  const e = field.defaultExpr
  if (/^(now|cuid|uuid|auto)\(/.test(e)) return undefined
  if (e === 'true' || e === 'false') return e
  if (/^-?\d+(\.\d+)?$/.test(e)) return e
  const sm = /^"(.*)"$/.exec(e)
  if (sm) return `'${sm[1]}'`
  return undefined
}

/** 归一化两种写法里可能出现的引号差异，便于比较 */
const normDefault = (v: string | null) => (v === null ? null : v.replace(/^"|"$/g, "'").trim())

describe('桌面迁移：DDL 与 Prisma schema 的结构等价', () => {
  const schema = parseSchemaModels(readFileSync(SCHEMA, 'utf8'))
  const migration = loadMigration()

  it('迁移引用的表都在 schema 里（防止模型改名后留下过时的补列）', () => {
    for (const table of Object.keys(migration.tableColumns)) {
      expect(schema.has(table), `tableColumns 里的 ${table} 已不在 schema 中`).toBe(true)
    }
    for (const ddl of Object.values(migration.newTables)) {
      const name = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?(\w+)"?/i.exec(ddl)?.[1]
      expect(name, 'newTables 的 DDL 里取不到表名').toBeTruthy()
      expect(schema.has(name!), `newTables 里的 ${name} 已不在 schema 中`).toBe(true)
    }
  })

  it('每个补列字段都存在于 schema 且 SQL 类型与 schema 一致', () => {
    const problems: string[] = []
    for (const [table, cols] of Object.entries(migration.tableColumns)) {
      const fields = schema.get(table) ?? []
      for (const [field, ddl] of Object.entries(cols)) {
        const f = fields.find((x) => x.name === field)
        if (!f) {
          problems.push(`${table}.${field}：schema 里已无此字段`)
          continue
        }
        const parsed = parseColumnDdl(ddl)
        if (!parsed) {
          problems.push(`${table}.${field}：无法解析列 DDL「${ddl}」`)
          continue
        }
        const want = SCALAR_TO_SQL[f.type]
        if (parsed.sqlType !== want) {
          problems.push(`${table}.${field}：SQL 类型 ${parsed.sqlType} ≠ schema ${f.type} → ${want}`)
        }
      }
    }
    expect(problems, '迁移的补列与 schema 不一致').toEqual([])
  })

  it('补列的默认值必须与 schema 的 @default 一致（JSON 数组列曾是空串）', () => {
    const problems: string[] = []
    for (const [table, cols] of Object.entries(migration.tableColumns)) {
      const fields = schema.get(table) ?? []
      for (const [field, ddl] of Object.entries(cols)) {
        const f = fields.find((x) => x.name === field)
        if (!f) continue
        const want = expectedDefault(f)
        if (want === undefined) continue
        const got = parseColumnDdl(ddl)?.dflt ?? null
        if (normDefault(got) !== normDefault(want)) {
          problems.push(`${table}.${field}：迁移写 DEFAULT ${got}，schema 要求 ${want}`)
        }
      }
    }
    expect(problems, '默认值语义漂移会让老库和新库读出不同的值').toEqual([])
  })

  it('迁移补出的列必须带非 NULL 默认值（否则老库会出现 Prisma 读不了的 NULL）', () => {
    const problems: string[] = []
    for (const [table, cols] of Object.entries(migration.tableColumns)) {
      const fields = schema.get(table) ?? []
      for (const [field, ddl] of Object.entries(cols)) {
        const f = fields.find((x) => x.name === field)
        // 只要求「schema 里必填」的列必须有非 NULL 默认值。
        // 可空字段（如 lastReadAt）本来就应该允许 NULL。
        if (!f || f.optional) continue
        const dflt = parseColumnDdl(ddl)?.dflt ?? null
        if (dflt === null || dflt.toUpperCase() === 'NULL') {
          problems.push(`${table}.${field}：schema 必填，但补列没有默认值 → 老库该列为 NULL`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('newIndexes 绑定的表都真实存在（缺表时建索引会抛 no such table 让启动失败）', () => {
    for (const [name, idx] of Object.entries(migration.newIndexes)) {
      expect(schema.has(idx.table), `${name} 绑定的表 ${idx.table} 不在 schema 里`).toBe(true)
    }
  })
})
