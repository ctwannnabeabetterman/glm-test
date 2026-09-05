import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseCsv, parseResultDirectory } from '../../src/lib/inet/results'

describe('INET result parser', () => {
  it('maps CSV columns into canonical metrics', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inet-')); const file = path.join(dir, 'metrics.csv')
    fs.writeFileSync(file, 'time,pdr,latencyP95\n0,90,12\n1,95,10\n')
    expect(parseCsv(file).metrics).toEqual({ deliveryRatePercent: 95, latencyP95Ms: 10 })
    expect(parseResultDirectory(dir).sourceFiles).toHaveLength(1)
  })
})
