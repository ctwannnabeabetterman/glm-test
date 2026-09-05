const { DatabaseSync } = require('node:sqlite')

const noteColumns = {
  content: "content TEXT DEFAULT ''",
  tags: "tags TEXT DEFAULT ''",
  links: "links TEXT DEFAULT '[]'",
  category: "category TEXT DEFAULT 'literature'",
  structured: "structured TEXT DEFAULT '{}'",
  lastReadAt: 'lastReadAt DATETIME',
}

const inetSchema = `
  CREATE TABLE IF NOT EXISTS "InetScenario" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "scenarioType" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "parameters" TEXT NOT NULL DEFAULT '{}',
    "manifest" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
  );
  CREATE TABLE IF NOT EXISTS "InetRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scenarioId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "parameters" TEXT NOT NULL DEFAULT '{}',
    "metrics" TEXT NOT NULL DEFAULT '{}',
    "logPath" TEXT NOT NULL DEFAULT '',
    "artifactHash" TEXT NOT NULL DEFAULT '',
    "error" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    FOREIGN KEY ("scenarioId") REFERENCES "InetScenario" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE TABLE IF NOT EXISTS "InetRunArtifact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "runId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL DEFAULT '',
    "sizeBytes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY ("runId") REFERENCES "InetRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
  );
  CREATE INDEX IF NOT EXISTS "InetScenario_scenarioType_idx" ON "InetScenario" ("scenarioType");
  CREATE INDEX IF NOT EXISTS "InetRun_status_idx" ON "InetRun" ("status");
  CREATE INDEX IF NOT EXISTS "InetRun_createdAt_idx" ON "InetRun" ("createdAt");
  CREATE INDEX IF NOT EXISTS "InetRunArtifact_runId_idx" ON "InetRunArtifact" ("runId");
`

function migrateDatabase(dbPath) {
  const db = new DatabaseSync(dbPath)
  try {
    const columns = db.prepare("PRAGMA table_info('Note')").all().map((c) => c.name)
    if (!columns.length) throw new Error('Database template is missing the Note table')
    const missingColumns = Object.keys(noteColumns).filter((name) => !columns.includes(name))
    const objects = new Set(db.prepare('SELECT name FROM sqlite_master').all().map((row) => row.name))
    const required = ['InetScenario', 'InetRun', 'InetRunArtifact', 'InetScenario_scenarioType_idx', 'InetRun_status_idx', 'InetRun_createdAt_idx', 'InetRunArtifact_runId_idx']
    if (!missingColumns.length && required.every((name) => objects.has(name))) return { changed: false }

    // VACUUM INTO includes committed WAL data, unlike a raw file copy while SQLite is open.
    const backupPath = `${dbPath}.pre-inet-${Date.now()}.bak`
    db.prepare('VACUUM INTO ?').run(backupPath)
    db.exec('BEGIN IMMEDIATE')
    try {
      for (const name of missingColumns) db.exec(`ALTER TABLE Note ADD COLUMN ${noteColumns[name]}`)
      db.exec(inetSchema)
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

module.exports = { migrateDatabase }
