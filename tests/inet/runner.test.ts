import { describe, expect, it } from 'vitest'
import { InetRunner } from '../../src/lib/inet/runner'

describe('INET runner', () => {
  it('is constructible and exposes cancellation', () => {
    const runner = new InetRunner()
    expect(typeof runner.run).toBe('function')
    expect(() => runner.cancel()).not.toThrow()
  })
})
