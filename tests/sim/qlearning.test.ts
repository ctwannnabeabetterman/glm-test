import { describe, expect, it } from 'vitest'
import { QRouter } from '@/lib/sim/qlearning'
import { buildAdjacency, buildTopology } from '@/lib/sim/topology'
import { deriveStream } from '@/lib/sim/rng'

function ring() {
  return buildAdjacency(buildTopology('ring', { seed: 42, nodeCount: 8 }))
}

describe('qlearning：目的地感知 Q-Learning', () => {
  it('默认 300 episode（修复原版 12 episode 训练不足）', () => {
    const r = new QRouter(ring(), new Map(), 0)
    expect(r.episodes).toBe(300)
    expect(new QRouter(ring(), new Map(), 0, { episodes: 50 }).episodes).toBe(50)
  })

  it('【核心回归】同一 Q 表先后训练两个不同目的地，先学到的策略不被污染', () => {
    // ring(8) 带两条弦：R1→R5 最优走 R2→弦(R2-R6)；R1→R7 最优走 R0。两者首跳相反。
    const adj = ring()
    const router = new QRouter(adj, new Map(), 0)
    const r5 = router.train('R1', 'R5', deriveStream(1, 'pair:R1>R5'))
    const r7 = router.train('R1', 'R7', deriveStream(1, 'pair:R1>R7'))

    expect(r5.foundPath).toBe(true)
    expect(r7.foundPath).toBe(true)
    // 若状态缺目的地，第二次训练会覆盖 R1 的出边 Q 值，R5 的贪心路径将无法到达或绕远
    const p5 = router.greedyPath('R1', 'R5')
    const p7 = router.greedyPath('R1', 'R7')
    expect(p5[p5.length - 1]).toBe('R5')
    expect(p7[p7.length - 1]).toBe('R7')
    expect(p5).not.toEqual(p7)
  })

  it('训练报告字段完整：successRate ∈ [0,1]，曲线含首末样本，ε 单调不增', () => {
    const adj = ring()
    const router = new QRouter(adj, new Map(), 0, { episodes: 60 })
    const report = router.train('R1', 'R5', deriveStream(3, 'curve'))
    expect(report.episodes).toBe(60)
    expect(report.successRate).toBeGreaterThanOrEqual(0)
    expect(report.successRate).toBeLessThanOrEqual(1)
    expect(report.fellBackToDijkstra).toBe(false) // 学习成功才不回退
    expect(report.curve.length).toBeGreaterThanOrEqual(2)
    expect(report.curve[0].episode).toBe(1)
    expect(report.curve[report.curve.length - 1].episode).toBe(60)
    for (let i = 1; i < report.curve.length; i++) {
      expect(report.curve[i].epsilon).toBeLessThanOrEqual(report.curve[i - 1].epsilon)
    }
  })

  it('训练后收敛成功率应显著高于纯随机探索的水平', () => {
    const adj = ring()
    const router = new QRouter(adj, new Map(), 0)
    const report = router.train('R1', 'R6', deriveStream(11, 'success'))
    // ring 上随机游走有 visited 约束仍常失败；学完后贪心可达 ⇒ 成功率应远超一半
    expect(report.successRate).toBeGreaterThan(0.8)
  })

  it('未知节点训练 ⇒ 如实上报回退，不抛异常', () => {
    const adj = ring()
    const router = new QRouter(adj, new Map(), 0)
    const report = router.train('NOPE', 'R1', deriveStream(1, 'x'))
    expect(report.episodes).toBe(0)
    expect(report.foundPath).toBe(false)
    expect(report.fellBackToDijkstra).toBe(true)
    expect(router.greedyPath('NOPE', 'R1')).toEqual([])
  })
})
