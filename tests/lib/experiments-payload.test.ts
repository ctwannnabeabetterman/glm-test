import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ex1', ...data })),
  update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'ex1', name: 'Original', ...data })),
}))
vi.mock('@/lib/db', () => ({ db: { experiment: mocks } }))
vi.mock('@/lib/activity', () => ({ recordActivity: vi.fn() }))

function req(method: 'PUT' | 'POST', body: unknown) {
  return new NextRequest('http://localhost/api/experiments/ex1', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ctx = { params: Promise.resolve({ id: 'ex1' }) }
const validJson = { config: '{"model":"DQN","lr":0.001}', metrics: '{"accuracy":95}', baselines: '["WMMSE",{"level":"sota","name":"PPO","status":"pending"}]', ablations: '[{"name":"CNN","impact":0}]' }

beforeEach(() => {
  mocks.create.mockClear()
  mocks.update.mockClear()
})

describe('POST /api/experiments', () => {
  it('preserves the UI JSON-string payload and defaults', async () => {
    const { POST } = await import('@/app/api/experiments/route')
    const result = await POST(req('POST', { name: '  Test  ', ...validJson, seed: 42 }))
    expect(result.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith({ data: {
      name: 'Test', topic: '', status: 'planned', notes: '', seed: 42, ...validJson,
    } })
    await POST(req('POST', { name: 'default' }))
    expect(mocks.create.mock.calls[1][0].data).toMatchObject({ config: '{}', metrics: '{}', baselines: '[]', ablations: '[]', seed: 42 })
  })

  it('rejects malformed request JSON with a 400 rather than a DB call', async () => {
    const { POST } = await import('@/app/api/experiments/route')
    const malformed = new NextRequest('http://localhost/api/experiments', { method: 'POST', body: '{bad' })
    expect((await POST(malformed)).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it.each([
    { name: ' ' }, { name: 'x', status: 'other' }, { name: 'x', seed: 'NaN' },
    { name: 'x', seed: 1.5 }, { name: 'x', seed: null },
    { name: 'x', config: '{oops' }, { name: 'x', metrics: '[]' },
    { name: 'x', config: 'null' }, { name: 'x', baselines: '{}' },
    { name: 'x', ablations: '[null]' }, { name: 'x', metrics: 42 },
    { name: 'x', config: { model: 'DQN' } },
  ])('rejects invalid create payload %j without writing to DB', async (payload) => {
    const { POST } = await import('@/app/api/experiments/route')
    expect((await POST(req('POST', payload))).status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})

describe('PUT /api/experiments/[id]', () => {
  it('whitelists fields; cannot change id/timestamps or inject Prisma relations', async () => {
    const { PUT } = await import('@/app/api/experiments/[id]/route')
    const res = await PUT(req('PUT', { name: ' Changed ', status: 'completed', seed: '7', ...validJson,
      id: 'hacked', createdAt: '1970-01-01', updatedAt: '1970-01-01', other: { create: {} },
    }), ctx)
    expect(res.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ where: { id: 'ex1' }, data: { name: 'Changed', status: 'completed', seed: 7, ...validJson } })
  })

  it('rejects malformed JSON with a 400 before Prisma', async () => {
    const { PUT } = await import('@/app/api/experiments/[id]/route')
    const malformed = new NextRequest('http://localhost/api/experiments/ex1', { method: 'PUT', body: '{bad' })
    expect((await PUT(malformed, ctx)).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('accepts status-only and notes-only edits unchanged', async () => {
    const { PUT } = await import('@/app/api/experiments/[id]/route')
    expect((await PUT(req('PUT', { status: 'running' }), ctx)).status).toBe(200)
    expect(mocks.update.mock.calls[0][0].data).toEqual({ status: 'running' })
    expect((await PUT(req('PUT', { notes: '' }), ctx)).status).toBe(200)
    expect(mocks.update.mock.calls[1][0].data).toEqual({ notes: '' })
  })

  it.each([
    { config: '{oops' }, { metrics: 'null' }, { config: '[]' },
    { metrics: '{"accuracy":{}}' }, { baselines: '{}' }, { baselines: '[null]' },
    { ablations: '[{"impact":3}]' }, { ablations: 42 },
    { seed: '' }, { seed: 1.5 }, { status: 'unknown' }, { name: '' },
    { id: 'hacked' }, [], null,
  ])('rejects invalid or non-updatable PUT %j before Prisma', async (payload) => {
    const { PUT } = await import('@/app/api/experiments/[id]/route')
    expect((await PUT(req('PUT', payload), ctx)).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
