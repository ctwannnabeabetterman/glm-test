import { describe, expect, it } from 'vitest'
import { deriveStream, fnv1a, mulberry32, randFloat, randInt } from '@/lib/sim/rng'

describe('rng：可复现性的根基', () => {
  it('mulberry32 同种子产生完全一致的序列', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 100 }, () => a())
    const seqB = Array.from({ length: 100 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('不同种子产生不同序列', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    const seqA = Array.from({ length: 50 }, () => a())
    const seqB = Array.from({ length: 50 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('输出严格落在 [0,1)', () => {
    const rng = mulberry32(0xdeadbeef)
    for (let i = 0; i < 10_000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('fnv1a 确定性且区分不同流名', () => {
    expect(fnv1a('stream-a')).toBe(fnv1a('stream-a'))
    expect(fnv1a('stream-a')).not.toBe(fnv1a('stream-b'))
  })

  it('deriveStream：同 (seed, 流名) 一致，流名不同则独立', () => {
    const s1 = deriveStream(7, 'drop:R0>R1')
    const s2 = deriveStream(7, 'drop:R0>R1')
    expect(Array.from({ length: 32 }, () => s1())).toEqual(Array.from({ length: 32 }, () => s2()))
    const s3 = deriveStream(7, 'red:L0>L1')
    const s4 = deriveStream(7, 'drop:R0>R1')
    expect(Array.from({ length: 32 }, () => s3())).not.toEqual(Array.from({ length: 32 }, () => s4()))
  })

  it('randInt/randFloat 在闭区间内且可复现', () => {
    const r1 = deriveStream(9, 'test')
    const r2 = deriveStream(9, 'test')
    for (let i = 0; i < 200; i++) {
      const a = randInt(r1, 3, 9)
      expect(a).toBeGreaterThanOrEqual(3)
      expect(a).toBeLessThanOrEqual(9)
      const b = randFloat(r2, -1, 1)
      expect(b).toBeGreaterThanOrEqual(-1)
      expect(b).toBeLessThanOrEqual(1)
    }
    // 两个独立实例消费同一序列 ⇒ randInt 与 randFloat 取自同一底层序列
    expect(randInt(deriveStream(9, 'test'), 3, 9)).toBe(randInt(deriveStream(9, 'test'), 3, 9))
  })
})
