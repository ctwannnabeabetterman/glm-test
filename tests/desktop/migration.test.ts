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

function columnNames(db: { prepare: (sql: string) => { all: () => unknown[] } }, table: string): string[] {
  return (db.prepare(`PRAGMA table_info('${table}')`).all() as { name: string }[]).map((c) => c.name)
}

function objectNames(db: { prepare: (sql: string) => { all: () => unknown[] } }): string[] {
  return (db.prepare('SELECT name FROM sqlite_master').all() as { name: string }[]).map((r) => r.name)
}

function makeLegacyDb(DatabaseSync: NonNullable<typeof sqlite>['DatabaseSync'], dbPath: string) {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE Note (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO Note VALUES ('note-1', 'Existing research');
    CREATE TABLE Paper (id TEXT PRIMARY KEY, title TEXT);
    INSERT INTO Paper VALUES ('paper-1', 'Existing paper');
    CREATE TABLE Setting (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO Setting VALUES ('llm', '{"apiKey":"test-only-placeholder"}');

    -- v1.2.4 之前的里程碑表：没有 refType/refId/autoProgress/actualEndDate
    CREATE TABLE Milestone (id TEXT PRIMARY KEY, type TEXT, title TEXT, startDate TEXT, endDate TEXT, progress INTEGER);
    INSERT INTO Milestone VALUES ('ms-1', 'gantt', 'Old milestone', '0', '8', 40);

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
      const noteCols = columnNames(upgraded, 'Note')
      expect(noteCols).toContain('structured')
      expect(noteCols).toContain('lastReadAt')
      const paperCols = columnNames(upgraded, 'Paper')
      expect(paperCols).toContain('zoteroKey')
      expect(paperCols).toContain('pdfPath')
      // 摘要原料列：老库升级后必须补上，否则 AI 摘要永远没有输入
      expect(paperCols).toContain('abstract')

      // 里程碑的联动/复盘列：老行必须保留，且默认值与 Prisma schema 一致
      const msCols = columnNames(upgraded, 'Milestone')
      expect(msCols).toEqual(
        expect.arrayContaining(['refType', 'refId', 'autoProgress', 'actualEndDate']),
      )
      expect(
        upgraded.prepare('SELECT title, progress, refType, refId, autoProgress, actualEndDate FROM Milestone').get(),
      ).toEqual({
        title: 'Old milestone',
        progress: 40,
        refType: '',
        refId: '',
        autoProgress: 0,
        actualEndDate: '',
      })

      // INET 遗留表必须被清掉（含索引）
      const objects = objectNames(upgraded)
      for (const name of ['InetScenario', 'InetRun', 'InetRunArtifact']) {
        expect(objects).not.toContain(name)
      }
      expect(objects.filter((n) => /Inet/i.test(n))).toEqual([])

      // 新增的表必须补齐（写作工作台 + 周计划），索引也要建上
      expect(objects).toContain('Manuscript')
      expect(objects).toContain('Manuscript_createdAt_idx')
      expect(objects).toContain('WeeklyTask')
      expect(objects).toContain('WeeklyTask_weekStart_idx')
      expect(objects).toContain('WeeklyTask_done_idx')
      // 新增索引（结构没变但索引新增的情况也要覆盖到）
      expect(objects).toContain('Milestone_refType_refId_idx')

      const msWorkbenchCols = columnNames(upgraded, 'Manuscript')
      expect(msWorkbenchCols).toEqual(
        expect.arrayContaining(['id', 'title', 'venue', 'targetWords', 'sections', 'status', 'createdAt', 'updatedAt']),
      )
      // 默认值必须与 Prisma schema 一致，否则新表写入会与 Prisma Client 不一致
      upgraded.prepare("INSERT INTO Manuscript (id, title, updatedAt) VALUES ('ms-2', 'Draft', '2026-01-01')").run()
      expect(upgraded.prepare('SELECT targetWords, sections, status FROM Manuscript').get()).toEqual({
        targetWords: 0,
        sections: '[]',
        status: 'draft',
      })

      // 周计划表同样要对齐 schema 默认值（order 是保留字，必须加引号）
      expect(columnNames(upgraded, 'WeeklyTask')).toEqual(
        expect.arrayContaining(['id', 'name', 'hours', 'priority', 'done', 'weekStart', 'order', 'createdAt', 'updatedAt']),
      )
      upgraded.prepare("INSERT INTO WeeklyTask (id, name, updatedAt) VALUES ('wt-1', 'Read 3 papers', '2026-01-01')").run()
      expect(upgraded.prepare('SELECT hours, priority, done, weekStart, "order" FROM WeeklyTask').get()).toEqual({
        hours: 2,
        priority: 3,
        done: 0,
        weekStart: '',
        order: 0,
      })
    } finally {
      upgraded.close()
    }

    // 备份里应当仍是「迁移前」的样子：数据在、INET 表也在（可回滚）
    const backup = new sqlite!.DatabaseSync(first.backupPath, { readOnly: true })
    try {
      expect((backup.prepare('SELECT title FROM Note').get() as { title: string }).title).toBe('Existing research')
      expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='InetRun'").get()).toBeTruthy()
      // 备份是迁移前的快照：那时还没有 refType 列
      expect(columnNames(backup, 'Milestone')).not.toContain('refType')
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
      CREATE TABLE Paper (id TEXT PRIMARY KEY, title TEXT, doi TEXT, zoteroKey TEXT, pdfPath TEXT, abstract TEXT DEFAULT '');
      CREATE TABLE Manuscript (id TEXT PRIMARY KEY, title TEXT, venue TEXT, targetWords INTEGER, sections TEXT, status TEXT, createdAt DATETIME, updatedAt DATETIME);
      CREATE TABLE Milestone (id TEXT PRIMARY KEY, type TEXT, title TEXT, startDate TEXT, endDate TEXT, progress INTEGER, refType TEXT DEFAULT '', refId TEXT DEFAULT '', autoProgress BOOLEAN DEFAULT false, actualEndDate TEXT DEFAULT '');
      CREATE INDEX Milestone_refType_refId_idx ON Milestone(refType, refId);
      CREATE TABLE WeeklyTask (id TEXT PRIMARY KEY, name TEXT, hours INTEGER DEFAULT 2, priority INTEGER DEFAULT 3, done BOOLEAN DEFAULT false, weekStart TEXT DEFAULT '', "order" INTEGER DEFAULT 0, createdAt DATETIME, updatedAt DATETIME);
      CREATE INDEX WeeklyTask_weekStart_idx ON WeeklyTask(weekStart);
      CREATE INDEX WeeklyTask_done_idx ON WeeklyTask(done);
    `)
    db.close()

    const { migrateDatabase } = require('../../desktop/migrate-database.js')
    const result = migrateDatabase(dbPath)
    expect(result.changed).toBe(false)
    expect(result.backupPath).toBeUndefined()
  })

  it('缺表时不硬建索引（避免 "no such table" 直接让启动失败）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-nomilestone-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')

    const db = new sqlite!.DatabaseSync(dbPath)
    // 一个刻意不含 Milestone 的库：补列/建索引都必须被安全跳过
    db.exec(`
      CREATE TABLE Note (id TEXT PRIMARY KEY, title TEXT, content TEXT, tags TEXT, links TEXT, category TEXT, structured TEXT, lastReadAt DATETIME);
      CREATE TABLE Paper (id TEXT PRIMARY KEY, title TEXT, doi TEXT, zoteroKey TEXT, pdfPath TEXT, abstract TEXT DEFAULT '');
    `)
    db.close()

    const { migrateDatabase } = require('../../desktop/migrate-database.js')
    expect(() => migrateDatabase(dbPath)).not.toThrow()
  })
})
