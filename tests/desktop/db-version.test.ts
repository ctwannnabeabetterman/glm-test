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

/**
 * 「结构已是最新」的库。
 *
 * 必须与当前的 Prisma schema 同步增长 —— 一旦新增了模型/列/索引，这里漏掉就会让
 * `migrateDatabase` 判定为「需要迁移」，本文件的版本戳用例会集体误报。
 * 加字段时记得同时改这里和 tests/desktop/migration.test.ts 的「干净库」用例。
 */
function makeCleanDb(DatabaseSync: NonNullable<typeof sqlite>['DatabaseSync'], dbPath: string) {
  const db = new DatabaseSync(dbPath)
  db.exec(`
    CREATE TABLE Note (id TEXT PRIMARY KEY, title TEXT, content TEXT, tags TEXT, links TEXT, category TEXT, structured TEXT, lastReadAt DATETIME);
    CREATE TABLE Paper (id TEXT PRIMARY KEY, title TEXT, doi TEXT, zoteroKey TEXT, pdfPath TEXT);
    CREATE TABLE Manuscript (id TEXT PRIMARY KEY, title TEXT, venue TEXT, targetWords INTEGER, sections TEXT, status TEXT, createdAt DATETIME, updatedAt DATETIME);
    CREATE TABLE Milestone (id TEXT PRIMARY KEY, type TEXT, title TEXT, startDate TEXT, endDate TEXT, progress INTEGER, refType TEXT DEFAULT '', refId TEXT DEFAULT '', autoProgress BOOLEAN DEFAULT false, actualEndDate TEXT DEFAULT '');
    CREATE INDEX Milestone_refType_refId_idx ON Milestone(refType, refId);
    CREATE TABLE WeeklyTask (id TEXT PRIMARY KEY, name TEXT, hours INTEGER DEFAULT 2, priority INTEGER DEFAULT 3, done BOOLEAN DEFAULT false, weekStart TEXT DEFAULT '', "order" INTEGER DEFAULT 0, createdAt DATETIME, updatedAt DATETIME);
    CREATE INDEX WeeklyTask_weekStart_idx ON WeeklyTask(weekStart);
    CREATE INDEX WeeklyTask_done_idx ON WeeklyTask(done);
  `)
  db.close()
}

describe('desktop database version stamp', () => {
  it('semver 与 user_version 整数互转', () => {
    const { encodeVersion, formatVersion } = require('../../desktop/migrate-database.js')
    expect(encodeVersion('1.2.4')).toBe(10204)
    expect(encodeVersion('1.0.0')).toBe(10000)
    expect(encodeVersion('0.1.0')).toBe(100)
    expect(encodeVersion('v1.2.4')).toBeNull()
    expect(encodeVersion('1.2.4-beta.1')).toBe(10204)
    expect(encodeVersion('')).toBeNull()
    expect(encodeVersion(undefined)).toBeNull()
    expect(encodeVersion('abc')).toBeNull()
    // 超出 4 字节整数安全区间的版本号拒绝编码，而不是悄悄溢出成一个更小的数
    expect(encodeVersion('99999.0.0')).toBeNull()

    expect(formatVersion(10204)).toBe('1.2.4')
    expect(formatVersion(10000)).toBe('1.0.0')
    expect(formatVersion(0)).toBe('未知')
  })

  it('带 appVersion 迁移时写入版本戳，之后能读回来', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-stamp-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')
    makeCleanDb(sqlite!.DatabaseSync, dbPath)

    const { migrateDatabase, readDatabaseVersion } = require('../../desktop/migrate-database.js')
    expect(readDatabaseVersion(dbPath)).toBe(0) // 老库从没写过

    const result = migrateDatabase(dbPath, { appVersion: '1.2.4' })
    expect(result.changed).toBe(false) // 结构本来就是最新的，schema 没动
    expect(result.versionStamped).toBe(10204)
    expect(readDatabaseVersion(dbPath)).toBe(10204)

    // 幂等：再来一次不会报错，值也不变
    expect(migrateDatabase(dbPath, { appVersion: '1.2.4' }).versionStamped).toBe(10204)
    expect(readDatabaseVersion(dbPath)).toBe(10204)
  })

  it('不传 appVersion 时不写戳（老调用方行为完全不变）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-nostamp-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')
    makeCleanDb(sqlite!.DatabaseSync, dbPath)

    const { migrateDatabase, readDatabaseVersion } = require('../../desktop/migrate-database.js')
    const result = migrateDatabase(dbPath)
    expect(result.changed).toBe(false)
    expect(result.versionStamped).toBeUndefined()
    expect(readDatabaseVersion(dbPath)).toBe(0)
  })

  it('库比程序新时能判出「降级」——旧程序必须拒绝启动', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-downgrade-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')
    makeCleanDb(sqlite!.DatabaseSync, dbPath)

    const { migrateDatabase, readDatabaseVersion, encodeVersion } = require('../../desktop/migrate-database.js')
    // 假设用户先用 1.5.0 跑过，库里记着 10500
    migrateDatabase(dbPath, { appVersion: '1.5.0' })
    const stored = readDatabaseVersion(dbPath)
    expect(stored).toBe(10500)

    // 现在拿 1.2.4 去开：stored > self  ⇒ 必须拦
    expect(stored > encodeVersion('1.2.4')).toBe(true)
    // 反过来（升级方向）永远放行
    expect(encodeVersion('1.2.4') > stored).toBe(false)
  })

  it('版本戳与 schema 迁移能在同一次调用里一起完成', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-both-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')
    const db = new sqlite!.DatabaseSync(dbPath)
    db.exec(`CREATE TABLE Note (id TEXT PRIMARY KEY, title TEXT);`)
    db.close()

    const { migrateDatabase, readDatabaseVersion } = require('../../desktop/migrate-database.js')
    const result = migrateDatabase(dbPath, { appVersion: '1.2.4' })
    expect(result.changed).toBe(true) // 缺列 → 走迁移
    expect(result.backupPath).toBeTruthy()
    expect(result.versionStamped).toBe(10204)
    expect(readDatabaseVersion(dbPath)).toBe(10204)
  })
})
