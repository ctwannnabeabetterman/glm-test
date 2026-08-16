/**
 * 可复现随机数 —— mulberry32 种子化 RNG + FNV-1a 流名派生。
 * 同一 (seed, stream) 组合在任意机器上产生完全一致的随机序列，
 * 这是实验可复现的根基：丢包判定、RED、拓扑生成、Q-Learning 探索各自使用独立子流。
 */

export type Rng = () => number

/** FNV-1a 32-bit hash */
export function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** mulberry32 PRNG：种子 → [0,1) 均匀分布 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 从主种子派生命名子流，避免流间相互影响 */
export function deriveStream(seed: number, streamName: string): Rng {
  return mulberry32((seed ^ fnv1a(streamName)) >>> 0)
}

/** [min, max] 均匀整数 */
export function randInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** [min, max] 均匀浮点 */
export function randFloat(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min)
}
