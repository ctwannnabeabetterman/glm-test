import { describe, expect, it } from 'vitest'
import {
  clampPercent,
  describeDownloadDetail,
  estimateUpdateEta,
  formatUpdateSize,
  formatUpdateSpeed,
} from '@/lib/update-progress'

/**
 * 更新进度展示层的格式化契约。
 *
 * 为什么值得测：用户 2026-09-18 的反馈是「不知道怎么下的 / 安装没有进度条之类的」——
 * 全是「界面上给不给得出可读信息」的问题。这类逻辑以前散在两个组件里各写一份，
 * 既容易不一致，又完全测不到（本仓库测试跑在 node 环境，不渲染 React）。
 * 抽成纯函数后，这里锁住的是「给用户看什么字」本身。
 *
 * 两条硬规矩贯穿全文件：
 *  1. 数据缺失时**返回空串**，绝不编一个看起来合理的假数字；
 *  2. 单位换算必须对人友好（MB/s 而不是 1048576 B/s）。
 */
describe('formatUpdateSpeed', () => {
  it('大于 1 MB/s 用 MB/s 显示一位小数', () => {
    expect(formatUpdateSpeed(2 * 1048576)).toBe('2.0 MB/s')
    expect(formatUpdateSpeed(1.55 * 1048576)).toBe('1.6 MB/s')
  })

  it('小于 1 MB/s 用 KB/s，并且不会因为四舍五入变成 0 KB/s', () => {
    expect(formatUpdateSpeed(1024 * 300)).toBe('300 KB/s')
    // 极慢的连接：199 B/s 若直接 Math.round(0.19) 会变成「0 KB/s」，看着像卡死
    expect(formatUpdateSpeed(199)).toBe('1 KB/s')
  })

  it('速度为 0 / 缺失 / 负值时返回空串（不显示假数据）', () => {
    expect(formatUpdateSpeed(0)).toBe('')
    expect(formatUpdateSpeed(undefined)).toBe('')
    expect(formatUpdateSpeed(-5)).toBe('')
  })
})

describe('formatUpdateSize', () => {
  it('给出「已下载 / 总量」的 MB 文案', () => {
    expect(formatUpdateSize(60 * 1048576, 140 * 1048576)).toBe('60.0 / 140.0 MB')
  })

  it('总大小未知时返回空串（只有已下载量没有意义）', () => {
    expect(formatUpdateSize(60 * 1048576, 0)).toBe('')
    expect(formatUpdateSize(60 * 1048576, undefined)).toBe('')
  })

  it('已下载量缺失时按 0 显示，但总量有效就仍然显示', () => {
    expect(formatUpdateSize(undefined, 140 * 1048576)).toBe('0.0 / 140.0 MB')
  })
})

describe('estimateUpdateEta', () => {
  it('不足一分钟按秒显示', () => {
    // 剩 2 MB，速度 2 MB/s → 1 秒
    expect(estimateUpdateEta(2 * 1048576, 2 * 1048576)).toBe('1 秒')
    // 剩 30 MB，速度 2 MB/s → 15 秒
    expect(estimateUpdateEta(30 * 1048576, 2 * 1048576)).toBe('15 秒')
  })

  it('超过一分钟按分钟显示', () => {
    // 剩 120 MB，速度 2 MB/s → 60 秒 → 1 分钟
    expect(estimateUpdateEta(120 * 1048576, 2 * 1048576)).toBe('1 分钟')
    // 剩 600 MB，速度 2 MB/s → 300 秒 → 5 分钟
    expect(estimateUpdateEta(600 * 1048576, 2 * 1048576)).toBe('5 分钟')
  })

  it('超过一小时按小时显示', () => {
    // 剩 7200 MB，速度 1 MB/s → 7200 秒 → 2 小时
    expect(estimateUpdateEta(7200 * 1048576, 1048576)).toBe('2 小时')
  })

  it('速度未知 / 已下完 / 脏数据时返回空串 —— 绝不猜', () => {
    expect(estimateUpdateEta(100 * 1048576, 0)).toBe('')
    expect(estimateUpdateEta(100 * 1048576, undefined)).toBe('')
    // 已经下完（剩余 0）没有「还剩多久」可言
    expect(estimateUpdateEta(0, 2 * 1048576)).toBe('')
    expect(estimateUpdateEta(-100, 2 * 1048576)).toBe('')
    expect(estimateUpdateEta(Number.NaN, 2 * 1048576)).toBe('')
  })
})

describe('describeDownloadDetail', () => {
  it('把传输量、速度、剩余时间拼成一行，用 · 分隔', () => {
    const s = describeDownloadDetail({
      transferred: 60 * 1048576,
      total: 140 * 1048576,
      speed: 2 * 1048576,
    })
    expect(s).toContain('60.0 / 140.0 MB')
    expect(s).toContain('2.0 MB/s')
    expect(s).toContain('约剩')
    expect(s.split(' · ').length).toBe(3)
  })

  it('只有百分比、没有总量与速度时给出空串（调用方据此不渲染副标题）', () => {
    expect(describeDownloadDetail({})).toBe('')
    expect(describeDownloadDetail({ speed: 0 })).toBe('')
  })

  it('有总量没速度时仍然给出传输量（说明「在动」，只是快慢未知）', () => {
    const s = describeDownloadDetail({ transferred: 10 * 1048576, total: 140 * 1048576 })
    expect(s).toBe('10.0 / 140.0 MB')
  })
})

describe('clampPercent', () => {
  it('正常值四舍五入成整数', () => {
    expect(clampPercent(42.4)).toBe(42)
    expect(clampPercent(42.6)).toBe(43)
  })

  it('越界值被夹到 0–100（脏数据不能把进度条撑破）', () => {
    expect(clampPercent(-10)).toBe(0)
    expect(clampPercent(150)).toBe(100)
  })

  it('缺失 / 非数字一律当 0', () => {
    expect(clampPercent(undefined)).toBe(0)
    expect(clampPercent(Number.NaN)).toBe(0)
    expect(clampPercent(Number.POSITIVE_INFINITY)).toBe(0)
  })
})
