import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const tables = [
  ['topics', 'topic'], ['papers', 'paper'], ['keywords', 'keyword'], ['experiments', 'experiment'],
  ['milestones', 'milestone'], ['weeklyTasks', 'weeklyTask'], ['notes', 'note'], ['searchLogs', 'searchLog'],
  ['readingGoals', 'readingGoal'], ['readingSessions', 'readingSession'], ['citations', 'citation'],
  ['manuscripts', 'manuscript'], ['simRuns', 'simRun'], ['activities', 'activity'], ['settings', 'setting'],
] as const

type Rows = Record<string, Array<Record<string, unknown>>>
const mock = vi.hoisted(() => ({ rows: {} as Rows, dir: '', failOn: '' }))

vi.mock('@/lib/library/paths', () => ({ pdfStorageDir: () => mock.dir }))
vi.mock('@/lib/db', () => ({
  db: {
    paper: { findMany: async () => structuredClone(mock.rows.paper) },
    $transaction: async (run: (client: Record<string, unknown>) => Promise<unknown>) => {
      const draft: Rows = structuredClone(mock.rows)
      const client = Object.fromEntries(
        Object.keys(draft).map((name) => [name, {
          findMany: async (args?: { where?: { key?: { in?: string[] } } }) => {
            const keys = args?.where?.key?.in
            return structuredClone(keys ? draft[name].filter((row) => keys.includes(row.key as string)) : draft[name])
          },
          deleteMany: async (args: { where?: { key?: { in?: string[] } } }) => {
            const keys = args.where?.key?.in
            draft[name] = keys ? draft[name].filter((row) => !keys.includes(row.key as string)) : []
          },
          create: async ({ data }: { data: Record<string, unknown> }) => {
            if (mock.failOn === name) throw new Error('injected failure')
            draft[name].push(data)
          },
          upsert: async ({ where, update, create }: {
            where: Record<string, unknown>; update: Record<string, unknown>; create: Record<string, unknown>
          }) => {
            if (mock.failOn === name) throw new Error('injected failure')
            const key = name === 'setting' ? 'key' : 'id'
            const existing = draft[name].find((row) => row[key] === where[key])
            if (existing) Object.assign(existing, update)
            else draft[name].push(create)
          },
        }]),
      )
      const result = await run(client)
      mock.rows = draft
      return result
    },
  },
}))

function backup(version: 1 | 2 = 2) {
  const data = Object.fromEntries(tables.map(([name]) => [name, []])) as Rows
  return { version, data, attachments: [] as Array<{ path: string; size: number; sha256: string; base64: string }> }
}

function post(body: unknown) {
  return new NextRequest('http://localhost/api/backup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mock.rows = Object.fromEntries(tables.map(([, name]) => [name, []])) as Rows
  mock.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-backup-test-'))
  mock.failOn = ''
})
afterEach(() => {
  fs.rmSync(mock.dir, { recursive: true, force: true })
})

describe('备份及恢复的完整性', () => {
  it('导出全部科研表与 PDF，排除 API Key 与 Zotero 等敏感设置', async () => {
    const bytes = Buffer.from('%PDF-1.4\nexample')
    fs.writeFileSync(path.join(mock.dir, 'paper.pdf'), bytes)
    mock.rows.paper.push({ id: 'paper-1', title: 'Paper', pdfPath: 'pdfs/paper.pdf' })
    mock.rows.manuscript.push({ id: 'draft-1', sections: '[]' })
    mock.rows.simRun.push({ id: 'sim-1', params: '{}' })
    mock.rows.setting.push({ key: 'llm.config', value: '{"apiKey":"secret"}' })
    mock.rows.setting.push({ key: 'project.config', value: '{"startDate":"2026-01-01"}' })
    const { GET } = await import('@/app/api/backup/route')
    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.version).toBe(2)
    expect(Object.keys(body.data)).toEqual(tables.map(([name]) => name))
    expect(body.data.manuscripts).toHaveLength(1)
    expect(body.data.simRuns).toHaveLength(1)
    expect(body.data.settings).toEqual([{ key: 'project.config', value: '{"startDate":"2026-01-01"}' }])
    expect(body.attachments).toEqual([{
      path: 'pdfs/paper.pdf', size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64'),
    }])
    expect(mock.rows.paper).toHaveLength(1)
  })

  it('拒绝用空 data 或不完整备份替换，而不动现有数据', async () => {
    mock.rows.paper.push({ id: 'existing', title: 'Keep' })
    const { POST } = await import('@/app/api/backup/route')
    expect((await POST(post({ version: 2, mode: 'replace', data: {} }))).status).toBe(400)
    expect((await POST(post({ version: 1, mode: 'replace', data: {} }))).status).toBe(400)
    expect(mock.rows.paper).toHaveLength(1)
  })

  it('无效附件校验和缺少文件阻断替换', async () => {
    mock.rows.paper.push({ id: 'existing', title: 'Keep' })
    const data = backup()
    data.data.papers.push({ id: 'new', title: 'New', pdfPath: 'pdfs/missing.pdf' })
    const { POST } = await import('@/app/api/backup/route')
    expect((await POST(post({ ...data, mode: 'replace' }))).status).toBe(400)
    data.attachments.push({ path: 'pdfs/missing.pdf', size: 3, sha256: '0'.repeat(64), base64: 'UEZG' })
    expect((await POST(post({ ...data, mode: 'replace' }))).status).toBe(400)
    expect(mock.rows.paper).toHaveLength(1)
  })

  it('替换恢复某张表写入失败时回滚所有表并清理新 PDF', async () => {
    mock.rows.paper.push({ id: 'existing', title: 'Keep' })
    mock.rows.manuscript.push({ id: 'existing-draft', title: 'Keep' })
    const bytes = Buffer.from('%PDF-1.4\nexample')
    const data = backup()
    data.data.papers.push({ id: 'new', title: 'New', pdfPath: 'pdfs/new.pdf' })
    data.data.manuscripts.push({ id: 'new-draft', title: 'New' })
    data.attachments.push({ path: 'pdfs/new.pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') })
    mock.failOn = 'manuscript'
    const { POST } = await import('@/app/api/backup/route')
    expect((await POST(post({ ...data, mode: 'replace' }))).status).toBe(500)
    expect(mock.rows.paper).toEqual([{ id: 'existing', title: 'Keep' }])
    expect(mock.rows.manuscript).toEqual([{ id: 'existing-draft', title: 'Keep' }])
    expect(fs.readdirSync(mock.dir)).toEqual([])
  })

  it('新备份可恢复稿件和 PDF，而不覆盖本地 API Key', async () => {
    mock.rows.setting.push({ key: 'llm.config', value: 'local-key' })
    const bytes = Buffer.from('%PDF-1.4\nexample')
    const data = backup()
    data.data.papers.push({ id: 'new', title: 'New', pdfPath: 'pdfs/new.pdf' })
    data.data.manuscripts.push({ id: 'draft', title: 'Draft' })
    data.data.settings.push({ key: 'project.config', value: 'project-start' })
    data.attachments.push({ path: 'pdfs/new.pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') })
    const { POST } = await import('@/app/api/backup/route')
    const response = await POST(post({ ...data, mode: 'replace' }))
    expect(response.status).toBe(200)
    expect(mock.rows.manuscript).toEqual([{ id: 'draft', title: 'Draft' }])
    expect(mock.rows.setting).toEqual(expect.arrayContaining([
      { key: 'llm.config', value: 'local-key' }, { key: 'project.config', value: 'project-start' },
    ]))
    const restored = mock.rows.paper[0].pdfPath as string
    expect(restored).not.toBe('pdfs/new.pdf')
    expect(fs.readFileSync(path.join(mock.dir, path.basename(restored)))).toEqual(bytes)
  })

  it('同一份 PDF 重复合并时复用已校验的附件，不制造新副本', async () => {
    const bytes = Buffer.from('%PDF-1.4\nexample')
    const data = backup()
    data.data.papers.push({ id: 'new', title: 'New', pdfPath: 'pdfs/new.pdf' })
    data.attachments.push({ path: 'pdfs/new.pdf', size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), base64: bytes.toString('base64') })
    const { POST } = await import('@/app/api/backup/route')
    expect((await POST(post({ ...data, mode: 'merge' }))).status).toBe(200)
    const first = mock.rows.paper[0].pdfPath
    expect((await POST(post({ ...data, mode: 'merge' }))).status).toBe(200)
    expect(mock.rows.paper[0].pdfPath).toBe(first)
    expect(fs.readdirSync(mock.dir)).toHaveLength(1)
  })

  it('旧版七表备份仍可合并，但不影响稿件及已有 PDF', async () => {
    mock.rows.paper.push({ id: 'existing', title: 'Keep', pdfPath: 'pdfs/local.pdf' })
    mock.rows.manuscript.push({ id: 'draft', title: 'Keep' })
    const data = backup(1)
    data.data.papers.push({ id: 'existing', title: 'Updated', pdfPath: 'pdfs/other-device.pdf' })
    const { POST } = await import('@/app/api/backup/route')
    const response = await POST(post({ ...data, mode: 'merge' }))
    expect(response.status).toBe(200)
    expect(mock.rows.paper).toEqual([{ id: 'existing', title: 'Updated', pdfPath: 'pdfs/local.pdf' }])
    expect(mock.rows.manuscript).toEqual([{ id: 'draft', title: 'Keep' }])
  })
})
