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

function migrateDatabase(dbPath) {
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
    if (!missingColumns.length && !missingPaperColumns.length && !hasLegacyTables) return { changed: false }

    // VACUUM INTO includes committed WAL data, unlike a raw file copy while SQLite is open.
    const backupPath = `${dbPath}.pre-migrate-${Date.now()}.bak`
    db.prepare('VACUUM INTO ?').run(backupPath)
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const name of missingColumns) db.exec(`ALTER TABLE Note ADD COLUMN ${noteColumns[name]}`)
      for (const name of missingPaperColumns) db.exec(`ALTER TABLE Paper ADD COLUMN ${paperColumns[name]}`)
      for (const name of legacyTables) db.exec(`DROP TABLE IF EXISTS "${name}"`)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    return { changed: true, backupPath }
  } finally {
    db.close()
  }
}

module.exports = { migrateDatabase, noteColumns, paperColumns, legacyTables }
