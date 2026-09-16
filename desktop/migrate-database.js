const { DatabaseSync } = require('node:sqlite')

const noteColumns = {
  content: "content TEXT DEFAULT ''",
  tags: "tags TEXT DEFAULT ''",
  links: "links TEXT DEFAULT '[]'",
  category: "category TEXT DEFAULT 'literature'",
  structured: "structured TEXT DEFAULT '{}'",
  lastReadAt: 'lastReadAt DATETIME',
}

const paperColumns = {
  doi: "doi TEXT DEFAULT ''",
  zoteroKey: "zoteroKey TEXT DEFAULT ''",
  pdfPath: "pdfPath TEXT DEFAULT ''",
}

/**
 * 已下线功能的遗留表。
 *
 * 「智能组网实验室」(INET) 依赖外部 OMNeT++/INET 工具链——用户得自行编译数 GB 环境，
 * 实际不可用，因此整个功能已移除。这里负责把老版本迁移时建出来的空表清掉，
 * 否则它们会永远以空表形式留在用户库里。
 * 删除顺序必须是「先子表后父表」，否则外键约束会挡住 DROP。
 */
const legacyTables = ['InetRunArtifact', 'InetRun', 'InetScenario']

/**
 * 版本戳 —— 写进 SQLite 文件头自带的 `PRAGMA user_version`（4 字节整数）。
 *
 * 为什么不另建一张表：user_version 是 SQLite 文件格式的一部分，不需要任何 DDL，
 * Prisma 也完全看不见它（不会在下一次 db push 时把这张「多余的表」当成漂移处理）。
 *
 * 为什么要这个戳：多版本共存最危险的不是「同时开着两个窗口」，而是**用旧程序打开
 * 新版本写过的库** —— 旧代码不知道新列/新表，随手 UPDATE 就可能把新数据写坏，
 * 而且坏得很安静。有了戳，任何 1.2.4 及以后启动的程序都能发现「库比我还新」，
 * 直接拒绝启动，把数据毁坏挡在写入之前。
 *
 * 老库（v1.2.3 及更早）从没写过 user_version，读到的是 0 —— 正好等于「未知/很老」，
 * 于是升级方向上永远不会误拦。
 */
const VERSION_MAJOR_MAX = 200
const VERSION_MINOR_MAX = 99
const VERSION_PATCH_MAX = 99

/** semver → user_version 整数（1.2.4 → 10204）；解析不出来返回 null */
function encodeVersion(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(version || '').trim())
  if (!m) return null
  const major = Number(m[1])
  const minor = Number(m[2])
  const patch = Number(m[3])
  if (major > VERSION_MAJOR_MAX || minor > VERSION_MINOR_MAX || patch > VERSION_PATCH_MAX) return null
  return major * 10000 + minor * 100 + patch
}

/** user_version 整数 → 可读 semver（10204 → 1.2.4） */
function formatVersion(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return '未知'
  return `${Math.floor(n / 10000)}.${Math.floor((n % 10000) / 100)}.${n % 100}`
}

/** 读取库里记录的版本整数；库不存在或读失败返回 0（视为「很老的库」） */
function readDatabaseVersion(dbPath) {
  let db
  try {
    db = new DatabaseSync(dbPath)
    const row = db.prepare('PRAGMA user_version').get()
    return Number((row && row.user_version) || 0)
  } catch {
    return 0
  } finally {
    if (db) {
      try {
        db.close()
      } catch {
        /* 已关闭 */
      }
    }
  }
}

/** 写入版本戳。只在确实变了的时候写，避免每次启动都产生一次写事务 */
function stampVersion(db, version) {
  const encoded = encodeVersion(version)
  if (encoded === null) return null
  const current = Number((db.prepare('PRAGMA user_version').get() || {}).user_version || 0)
  if (current === encoded) return encoded
  // PRAGMA 不支持参数占位符，只能拼接；encoded 由上面的正则保证是安全整数
  db.exec(`PRAGMA user_version = ${encoded}`)
  return encoded
}


/**
 * 老库升级时需要补齐的**新表**。
 *
 * 这些 DDL 不是手写的：由 `prisma migrate diff --from-empty --to-schema-datamodel
 * prisma/schema.prisma --script` 生成后原样搬过来，保证与 Prisma Client 的预期结构
 * 完全一致（列名/类型/默认值/索引名）。新增模型时请用同一条命令取 DDL，不要凭印象写。
 *
 * 打包模板 resources/db-template/custom.db 由 `prisma db push` 全新生成，天然含这些表；
 * 这里只为**已装老版本的用户**在升级时补上。
 */
const newTables = {
  Manuscript: `
    CREATE TABLE IF NOT EXISTS "Manuscript" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "title" TEXT NOT NULL,
      "venue" TEXT NOT NULL DEFAULT '',
      "targetWords" INTEGER NOT NULL DEFAULT 0,
      "sections" TEXT NOT NULL DEFAULT '[]',
      "status" TEXT NOT NULL DEFAULT 'draft',
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL
    );
    CREATE INDEX IF NOT EXISTS "Manuscript_createdAt_idx" ON "Manuscript"("createdAt");
  `,
}

/**
 * @param {string} dbPath
 * @param {{ appVersion?: string }} [options] 传入 appVersion 时顺带把版本戳写进 user_version
 */
function migrateDatabase(dbPath, options = {}) {
  const db = new DatabaseSync(dbPath)
  try {
    const columns = db.prepare("PRAGMA table_info('Note')").all().map((c) => c.name)
    if (!columns.length) throw new Error('Database template is missing the Note table')
    const missingColumns = Object.keys(noteColumns).filter((name) => !columns.includes(name))
    const paperInfo = db.prepare("PRAGMA table_info('Paper')").all()
    const paperColNames = paperInfo.map((c) => c.name)
    const missingPaperColumns = paperColNames.length
      ? Object.keys(paperColumns).filter((name) => !paperColNames.includes(name))
      : []
    const objects = new Set(db.prepare('SELECT name FROM sqlite_master').all().map((row) => row.name))
    const hasLegacyTables = legacyTables.some((name) => objects.has(name))
    const missingTables = Object.keys(newTables).filter((name) => !objects.has(name))
    const needsSchemaWork =
      missingColumns.length || missingPaperColumns.length || hasLegacyTables || missingTables.length

    let result = { changed: false }
    if (needsSchemaWork) {
      // VACUUM INTO includes committed WAL data, unlike a raw file copy while SQLite is open.
      const backupPath = `${dbPath}.pre-migrate-${Date.now()}.bak`
      db.prepare('VACUUM INTO ?').run(backupPath)
      db.exec('BEGIN IMMEDIATE')
      try {
        for (const name of missingColumns) db.exec(`ALTER TABLE Note ADD COLUMN ${noteColumns[name]}`)
        for (const name of missingPaperColumns) db.exec(`ALTER TABLE Paper ADD COLUMN ${paperColumns[name]}`)
        for (const name of missingTables) db.exec(newTables[name])
        for (const name of legacyTables) db.exec(`DROP TABLE IF EXISTS "${name}"`)
        db.exec('COMMIT')
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
      result = { changed: true, backupPath }
    }

    // 版本戳独立于 schema 迁移：即使这次没改结构，也要把「本程序写过的库」记下来，
    // 否则升级到 1.2.4 时若结构已经是最新的，戳就永远写不进去。
    const stamped = stampVersion(db, options.appVersion)
    return stamped === null ? result : { ...result, versionStamped: stamped }
  } finally {
    db.close()
  }
}

module.exports = {
  migrateDatabase,
  noteColumns,
  paperColumns,
  legacyTables,
  newTables,
  encodeVersion,
  formatVersion,
  readDatabaseVersion,
  stampVersion,
}
