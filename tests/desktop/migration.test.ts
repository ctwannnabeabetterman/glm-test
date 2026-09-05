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

describe.skipIf(!sqlite)('desktop database upgrade', () => {
  it('adds INET tables and keeps existing notes and settings across repeated starts', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-upgrade-'))
    tempDirs.push(dir)
    const dbPath = path.join(dir, 'custom.db')
    const db = new sqlite.DatabaseSync(dbPath)
    db.exec(`
      CREATE TABLE Note (id TEXT PRIMARY KEY, title TEXT);
      INSERT INTO Note VALUES ('note-1', 'Existing research');
      CREATE TABLE Setting (key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO Setting VALUES ('llm', '{"apiKey":"test-only-placeholder"}');
    `)
    db.close()

    const { migrateDatabase } = require('../../desktop/migrate-database.js')
    const first = migrateDatabase(dbPath)
    expect(first.changed).toBe(true)
    expect(fs.existsSync(first.backupPath)).toBe(true)
    expect(migrateDatabase(dbPath).changed).toBe(false)

    const upgraded = new sqlite.DatabaseSync(dbPath)
    try {
      expect(upgraded.prepare('SELECT title, structured FROM Note').get()).toEqual({ title: 'Existing research', structured: '{}' })
      expect((upgraded.prepare('SELECT value FROM Setting').get() as { value: string }).value).toBe('{"apiKey":"test-only-placeholder"}')
      upgraded.exec(`
        INSERT INTO InetScenario (id, name, scenarioType, updatedAt) VALUES ('s1', 'Mesh', 'b5g-mesh', CURRENT_TIMESTAMP);
        INSERT INTO InetRun (id, scenarioId, updatedAt) VALUES ('r1', 's1', CURRENT_TIMESTAMP);
        INSERT INTO InetRunArtifact (id, runId, fileName, path) VALUES ('a1', 'r1', 'result.csv', 'result.csv');
      `)
      expect((upgraded.prepare('SELECT status FROM InetRun').get() as { status: string }).status).toBe('queued')
      expect(upgraded.prepare('PRAGMA foreign_key_check').all()).toEqual([])
      upgraded.exec("DELETE FROM InetScenario WHERE id = 's1'")
      expect((upgraded.prepare('SELECT count(*) AS count FROM InetRunArtifact').get() as { count: number }).count).toBe(0)
    } finally {
      upgraded.close()
    }
    const backup = new sqlite.DatabaseSync(first.backupPath, { readOnly: true })
    try {
      expect((backup.prepare('SELECT title FROM Note').get() as { title: string }).title).toBe('Existing research')
      expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='InetRun'").get()).toBeUndefined()
    } finally {
      backup.close()
    }
  })
})
