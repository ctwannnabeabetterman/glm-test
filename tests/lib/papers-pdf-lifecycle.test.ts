import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const store = vi.hoisted(() => ({ dir: '' }))
const dbMock = vi.hoisted(() => {
  const papers: Array<{ id: string; title: string; pdfPath: string }> = []
  return {
    papers,
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
      const p = papers.find((p) => p.id === where.id)
      return p ? { ...p } : null
    }),
    count: vi.fn(async ({ where }: { where: { pdfPath: string } }) => papers.filter((p) => p.pdfPath === where.pdfPath).length),
    updateMany: vi.fn(async ({ where, data }: { where: { id: string; pdfPath: string }; data: { pdfPath: string } }) => {
      const p = papers.find((p) => p.id === where.id && p.pdfPath === where.pdfPath)
      if (!p) return { count: 0 }
      p.pdfPath = data.pdfPath
      return { count: 1 }
    }),
    create: vi.fn(async ({ data }: { data: { title: string; pdfPath: string } }) => {
      const p = { id: 'new', ...data }
      papers.push(p)
      return p
    }),
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      const i = papers.findIndex((p) => p.id === where.id)
      papers.splice(i, 1)
    }),
  }
})
vi.mock('@/lib/db', () => ({ db: {
  paper: dbMock,
  citation: { findFirst: vi.fn(async () => null) },
  note: { findMany: vi.fn(async () => []) },
  manuscript: { findMany: vi.fn(async () => []) },
  $transaction: (fn: (tx: unknown) => unknown) => fn({
    paper: dbMock,
    citation: { findFirst: async () => null },
    note: { findMany: async () => [] },
    manuscript: { findMany: async () => [] },
  }),
} }))
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn(async () => {}) }))
vi.mock('@/lib/library/paths', () => ({
  pdfStorageDir: () => store.dir,
  safePdfName: (name: string) => path.basename(name),
}))

function upload(id?: string) {
  const form = new FormData()
  form.append('file', new File(['%PDF-1.4 new'], 'new.pdf', { type: 'application/pdf' }))
  if (id) form.append('paperId', id)
  return new NextRequest('http://localhost/api/papers/pdf', { method: 'POST', body: form })
}

beforeEach(() => {
  store.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'papers-pdf-test-'))
  dbMock.papers.length = 0
  for (const name of ['findUnique', 'count', 'updateMany', 'create', 'delete'] as const) dbMock[name].mockClear()
})
afterEach(() => fs.rmSync(store.dir, { recursive: true, force: true }))

const oldRel = 'pdfs/1700000000000-12345678-1234-1234-1234-123456789abc-old.pdf'
function oldFile() {
  fs.writeFileSync(path.join(store.dir, path.basename(oldRel)), '%PDF-1.4 old')
}

describe('PDF upload lifecycle', () => {
  it('returns 404 before writing if target paper is gone', async () => {
    const { POST } = await import('@/app/api/papers/pdf/route')
    const res = await POST(upload('gone'))
    expect(res.status).toBe(404)
    expect(fs.readdirSync(store.dir)).toEqual([])
  })

  it('removes only its new file when create fails, leaving existing files alone', async () => {
    const { POST } = await import('@/app/api/papers/pdf/route')
    oldFile()
    dbMock.create.mockRejectedValueOnce(new Error('database unavailable'))
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await POST(upload())).status).toBe(500)
    } finally {
      log.mockRestore()
    }
    expect(fs.readdirSync(store.dir)).toEqual([path.basename(oldRel)])
  })

  it('cleans up a partially written file when disk write fails', async () => {
    const { POST } = await import('@/app/api/papers/pdf/route')
    const realWrite = fs.writeFileSync
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(((file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
      if (typeof file === 'number') throw new Error('disk full')
      return realWrite(file, data, options)
    }) as typeof fs.writeFileSync)
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect((await POST(upload())).status).toBe(500)
    } finally {
      spy.mockRestore()
      log.mockRestore()
    }
    expect(fs.readdirSync(store.dir)).toEqual([])
    expect(dbMock.create).not.toHaveBeenCalled()
  })

  it('creates a paper with a readable uniquely named PDF on success', async () => {
    const { POST, GET } = await import('@/app/api/papers/pdf/route')
    const first = await (await POST(upload())).json()
    const second = await (await POST(upload())).json()
    expect(first.created).toBe(true)
    expect(first.pdfPath).not.toBe(second.pdfPath)
    expect(fs.readFileSync(path.join(store.dir, path.basename(first.pdfPath)), 'utf8')).toBe('%PDF-1.4 new')
    expect((await GET(new NextRequest('http://localhost/api/papers/pdf?id=new'))).status).toBe(200)
  })

  it('removes new file on failed/CAS-conflicting update while preserving the old path and bytes', async () => {
    const { POST, GET } = await import('@/app/api/papers/pdf/route')
    oldFile()
    dbMock.papers.push({ id: 'p1', title: 'Old', pdfPath: oldRel })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      dbMock.updateMany.mockRejectedValueOnce(new Error('write failed'))
      expect((await POST(upload('p1'))).status).toBe(500)
    } finally {
      log.mockRestore()
    }
    expect((await POST(upload('p1'))).status).toBe(200)
    const newRel = dbMock.papers[0].pdfPath
    // Simulate an update collision; no new file from the losing request may remain.
    dbMock.updateMany.mockResolvedValueOnce({ count: 0 })
    expect((await POST(upload('p1'))).status).toBe(409)
    expect(dbMock.papers[0].pdfPath).toBe(newRel)
    expect((await GET(new NextRequest('http://localhost/api/papers/pdf?id=p1'))).status).toBe(200)
    expect(fs.readdirSync(store.dir).filter((n) => n.endsWith('new.pdf'))).toHaveLength(1)
  })

  it('archives a replaced owned PDF only after the last paper stops referencing it', async () => {
    const { POST } = await import('@/app/api/papers/pdf/route')
    oldFile()
    dbMock.papers.push({ id: 'p1', title: 'First', pdfPath: oldRel }, { id: 'p2', title: 'Second', pdfPath: oldRel })
    expect((await POST(upload('p1'))).status).toBe(200)
    expect(fs.existsSync(path.join(store.dir, path.basename(oldRel)))).toBe(true)
    expect((await POST(upload('p2'))).status).toBe(200)
    expect(dbMock.count).toHaveBeenCalledWith({ where: { pdfPath: oldRel } })
    expect(dbMock.papers.map((p) => p.pdfPath)).not.toContain(oldRel)
    expect(fs.existsSync(path.join(store.dir, path.basename(oldRel)))).toBe(false)
    const archived = fs.readdirSync(path.join(store.dir, '.replaced'))
    expect(archived).toHaveLength(1)
    expect(archived[0]).toContain(path.basename(oldRel))
    expect(fs.readFileSync(path.join(store.dir, '.replaced', archived[0]), 'utf8')).toBe('%PDF-1.4 old')
    expect(fs.existsSync(path.join(store.dir, path.basename(dbMock.papers[0].pdfPath)))).toBe(true)
  })

  it('keeps legacy timestamp-only PDF paths recoverable after replacement', async () => {
    const { POST } = await import('@/app/api/papers/pdf/route')
    const legacy = 'pdfs/1700000000000-legacy.pdf'
    fs.writeFileSync(path.join(store.dir, path.basename(legacy)), '%PDF-1.4 legacy')
    dbMock.papers.push({ id: 'p1', title: 'Old', pdfPath: legacy })
    expect((await POST(upload('p1'))).status).toBe(200)
    expect(fs.readFileSync(path.join(store.dir, path.basename(legacy)), 'utf8')).toBe('%PDF-1.4 legacy')
  })

  it('never archives a custom old path, even when no paper refers to it after replacement', async () => {
    const { POST } = await import('@/app/api/papers/pdf/route')
    const custom = 'pdfs/my-own-attachment.pdf'
    fs.writeFileSync(path.join(store.dir, path.basename(custom)), '%PDF-1.4 mine')
    dbMock.papers.push({ id: 'p1', title: 'First', pdfPath: custom })
    expect((await POST(upload('p1'))).status).toBe(200)
    expect(fs.readFileSync(path.join(store.dir, path.basename(custom)), 'utf8')).toBe('%PDF-1.4 mine')
  })

  it('deletes a paper record without deleting its local PDF', async () => {
    const { DELETE } = await import('@/app/api/papers/[id]/route')
    oldFile()
    dbMock.papers.push({ id: 'p1', title: 'First', pdfPath: oldRel })
    const res = await DELETE(new NextRequest('http://localhost/api/papers/p1', { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'p1' }),
    })
    expect(res.status).toBe(200)
    expect(fs.readFileSync(path.join(store.dir, path.basename(oldRel)), 'utf8')).toBe('%PDF-1.4 old')
  })
})
