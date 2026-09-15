import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const sqlite = process.getBuiltinModule?.('node:sqlite')
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function makeLegacyDb(DatabaseSync: NonNullable<typeof sqlite>['DatabaseSync'], dbPath: string) {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE Note (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO Note VALUES ('note-1', 'Existing research');
    CREATE TABLE Paper (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO Paper VALUES ('paper-1', 'Existing paper');
    CREATE TABLE Setting (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO Setting VALUES ('llm', '{"apiKey":"test-only-placeholder"}');

    -- 老版本迁移时建出来的 INET 空表（功能已下线，迁移应当清掉）
    CREATE TABLE InetScenario (id TEXT PRIMARY KEY, name TEXT, scenarioType TEXT, updatedAt TEXT);
    CREATE TABLE InetRun (id TEXT PRIMARY KEY, scenarioId TEXT, status TEXT DEFAULT 'queued', updatedAt TEXT);
    CREATE TABLE InetRunArtifact (id TEXT PRIMARY KEY, runId TEXT, fileName TEXT, path TEXT);
  `)
  db.close()
}

describe.skipIf(!sqlite)('desktop database upgrade', () => {
  it('补齐缺失列、清掉已下线功能的遗留表，并保住既有数据', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-upgrade-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')
    makeLegacyDb(sqlite!.DatabaseSync, dbPath)

    const { migrateDatabase } = require('../../desktop/migrate-database.js')
    const first = migrateDatabase(dbPath)
    expect(first.changed).toBe(true)
    expect(fs.existsSync(first.backupPath)).toBe(true)
    // 幂等：第二次不应再改任何东西（否则每次启动都会白做一次 VACUUM 备份）
    expect(migrateDatabase(dbPath).changed).toBe(false)

    const upgraded = new sqlite!.DatabaseSync(dbPath)
    try {
      // 老数据完整保留，且补上了默认值
      expect(upgraded.prepare('SELECT title, structured FROM Note').get()).toEqual({
        title: 'Existing research',
        structured: '{}',
      })
      expect((upgraded.prepare('SELECT value FROM Setting').get() as { value: string }).value).toBe(
        '{"apiKey":"test-only-placeholder"}',
      )

      // 新增列已补齐
      const noteCols = upgraded.prepare("PRAGMA table_info('Note')").all().map((c) => (c as { name: string }).name)
      expect(noteCols).toContain('structured')
      expect(noteCols).toContain('lastReadAt')
      const paperCols = upgraded.prepare("PRAGMA table_info('Paper')").all().map((c) => (c as { name: string }).name)
      expect(paperCols).toContain('zoteroKey')
      expect(paperCols).toContain('pdfPath')

      // INET 遗留表必须被清掉（含索引）
      const objects = upgraded.prepare('SELECT name FROM sqlite_master').all().map((r) => (r as { name: string }).name)
      for (const name of ['InetScenario', 'InetRun', 'InetRunArtifact']) {
        expect(objects).not.toContain(name)
      }
      expect(objects.filter((n) => /Inet/i.test(n))).toEqual([])
    } finally {
      upgraded.close()
    }

    // 备份里应当仍是「迁移前」的样子：数据在、INET 表也在（可回滚）
    const backup = new sqlite!.DatabaseSync(first.backupPath, { readOnly: true })
    try {
      expect((backup.prepare('SELECT title FROM Note').get() as { title: string }).title).toBe('Existing research')
      expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='InetRun'").get()).toBeTruthy()
    } finally {
      backup.close()
    }
  })

  it('已经是干净结构的库不会被改动', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-clean-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')

    const db = new sqlite!.DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE Note (id TEXT PRIMARY KEY, title TEXT, content TEXT, tags TEXT, links TEXT, category TEXT, structured TEXT, lastReadAt DATETIME);
      CREATE TABLE Paper (id TEXT PRIMARY KEY, title TEXT, doi TEXT, zoteroKey TEXT, pdfPath TEXT);
    `)
    db.close()

    const { migrateDatabase } = require('../../desktop/migrate-database.js')
    const result = migrateDatabase(dbPath)
    expect(result.changed).toBe(false)
    expect(result.backupPath).toBeUndefined()
  })
})
