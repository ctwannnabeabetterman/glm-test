import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { NextRequest } from 'next/server'

const vault = vi.hoisted(() => ({ path: '' }))
const dbMock = vi.hoisted(() => {
  const notes: Array<{ id: string; title: string; content: string; tags: string; category: string; structured: string; updatedAt: Date; lastReadAt: null }> = []
  return {
    notes,
    setting: { findUnique: vi.fn(async () => ({ value: JSON.stringify({ vaultPath: vault.path, subfolder: '', enabled: true }) })) },
    note: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => notes.find((n) => n.id === where.id) ?? null),
      findMany: vi.fn(async () => notes),
    },
  }
})
vi.mock('@/lib/db', () => ({ db: dbMock }))

function note(id: string, content: string) {
  return { id, title: 'Same Title', content, tags: '', category: 'literature', structured: '{}', updatedAt: new Date('2026-01-01'), lastReadAt: null }
}
function request(id?: string) {
  return new NextRequest('http://localhost/api/notes/export/obsidian', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(id ? { scope: 'note', id } : { scope: 'category', category: 'literature' }),
  })
}

beforeEach(() => {
  vault.path = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-export-test-'))
  dbMock.notes.length = 0
})
afterEach(() => fs.rmSync(vault.path, { recursive: true, force: true }))

describe('Obsidian export ownership', () => {
  it('separate same-title single-note exports keep distinct stable files and re-export their own files', async () => {
    const { POST } = await import('@/app/api/notes/export/obsidian/route')
    dbMock.notes.push(note('note-a', 'A'), note('note-b', 'B'))
    const a = await (await POST(request('note-a'))).json()
    const b = await (await POST(request('note-b'))).json()
    expect(a.written[0].filename).toBe('Same Title.md')
    expect(b.written[0].filename).not.toBe(a.written[0].filename)
    expect(b.written[0].filename).toContain('Same Title-')
    expect(fs.readFileSync(a.written[0].path, 'utf8')).toContain('\nA\n')
    dbMock.notes[0].content = 'A updated'
    const again = await (await POST(request('note-a'))).json()
    expect(again.written[0].path).toBe(a.written[0].path)
    expect(fs.readFileSync(b.written[0].path, 'utf8')).toContain('\nB\n')
  })

  it('batch export does not overwrite earlier single-note exports of the same title', async () => {
    const { POST } = await import('@/app/api/notes/export/obsidian/route')
    dbMock.notes.push(note('note-a', 'A'), note('note-b', 'B'))
    const original = await (await POST(request('note-a'))).json()
    const batch = await (await POST(request())).json()
    expect(batch.ok).toBe(true)
    expect(batch.writtenCount).toBe(2)
    expect(batch.written.find((w: { path: string }) => w.path === original.written[0].path)).toBeDefined()
    expect(fs.readFileSync(original.written[0].path, 'utf8')).toContain('\nA\n')
  })

  it('keeps the same per-note paths if a batch is followed by individual exports or reordered', async () => {
    const { POST } = await import('@/app/api/notes/export/obsidian/route')
    dbMock.notes.push(note('note-a', 'A'), note('note-b', 'B'))
    const first = await (await POST(request())).json()
    const files = first.written.map((w: { filename: string }) => w.filename)
    expect(files[0]).not.toBe(files[1])
    dbMock.notes.reverse()
    const second = await (await POST(request())).json()
    expect(second.written.map((w: { filename: string }) => w.filename).reverse()).toEqual(files)
    const single = await (await POST(request('note-a'))).json()
    expect(single.written[0].filename).toBe(files[0])
  })

  it('does not overwrite an existing manual/legacy file or a modified exported file', async () => {
    const { POST } = await import('@/app/api/notes/export/obsidian/route')
    dbMock.notes.push(note('note-a', 'A'))
    const legacy = path.join(vault.path, 'Same Title.md')
    fs.writeFileSync(legacy, 'manual/legacy')
    const first = await (await POST(request('note-a'))).json()
    expect(first.writtenCount).toBe(1)
    expect(first.written[0].filename).not.toBe('Same Title.md')
    expect(fs.readFileSync(legacy, 'utf8')).toBe('manual/legacy')
    fs.appendFileSync(first.written[0].path, '\nmy changes')
    const again = await (await POST(request('note-a'))).json()
    expect(again.ok).toBe(false)
    expect(again.skipped).toBe(1)
    expect(fs.readFileSync(first.written[0].path, 'utf8')).toContain('my changes')
  })

  it('rejects a configured subfolder symlink that points outside the vault', async () => {
    const { POST } = await import('@/app/api/notes/export/obsidian/route')
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-outside-test-'))
    try {
      fs.symlinkSync(outside, path.join(vault.path, 'linked'), 'junction')
      dbMock.setting.findUnique.mockResolvedValueOnce({
        value: JSON.stringify({ vaultPath: vault.path, subfolder: 'linked/nested', enabled: true }),
      })
      dbMock.notes.push(note('note-a', 'A'))
      const res = await POST(request('note-a'))
      expect(res.status).toBe(400)
      expect((await res.json()).code).toBe('BAD_SUBFOLDER')
      expect(fs.readdirSync(outside)).toEqual([])
    } finally {
      fs.rmSync(outside, { recursive: true, force: true })
    }
  })

  it('reports conflict instead of overwriting unrelated content at both stable paths', async () => {
    const { POST } = await import('@/app/api/notes/export/obsidian/route')
    dbMock.notes.push(note('note-a', 'A'))
    const first = await (await POST(request('note-a'))).json()
    fs.writeFileSync(first.written[0].path, 'manual')
    // Unowned primary is never overwritten; alternate is used if available.
    const second = await (await POST(request('note-a'))).json()
    fs.writeFileSync(second.written[0].path, 'manual 2')
    const final = await (await POST(request('note-a'))).json()
    expect(final.ok).toBe(false)
    expect(final.writtenCount).toBe(0)
    expect(final.skipped).toBe(1)
    expect(fs.readFileSync(first.written[0].path, 'utf8')).toBe('manual')
    expect(fs.readFileSync(second.written[0].path, 'utf8')).toBe('manual 2')
  })
})
