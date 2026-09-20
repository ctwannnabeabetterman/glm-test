/**
 * 「结果呈现」偏好 —— 用户在 设置 → 界面与阅读 里选。
 *
 * 为什么需要这一层，以及为什么它不经过组件 props：
 *
 * `AiMarkdown` 的 `size` 档位（compact / default / loose）是**面板级**的相对基线：
 * 侧栏小抽屉用小字、主内容区用正文字号。这是「版面关系」，由调用处决定才对。
 * 而「AI 结果整体多大、多密、是不是衬线」是**全局级**的用户偏好 ——
 * 两者正交。如果把它做成 size 的默认值，任何显式传了 size 的面板都会把它吞掉
 * （实测 8 个 AI 面板全部显式传了 size），偏好就完全失效了。
 *
 * 所以这里走**一条属性驱动全局 CSS 变量**的路：
 *
 *   1. `applyResultDensity()` 把 `data-result-density="…"` 写到 <html> 上；
 *   2. `src/app/globals.css` 里按 `html[data-result-density='…']` 定义
 *      `--ai-md-scale`（字号缩放）与 `--ai-md-leading`（行高）；
 *   3. `.ai-markdown` 的 font-size 用 `calc(base × scale)` 取这两个变量。
 *
 * 好处：切换密度只是**改一个属性**，已渲染在页面上的 AI 结果立刻跟着变，
 * 不需要任何面板重渲染 —— 长文结果不会因为改偏好而闪一下重新排版。
 *
 * ⚠️ 数值只写在 globals.css 一处，这里**不重复** scale/leading，
 *    避免两处漂移。`tests/lib/result-density.test.ts` 会核对每个预设 id
 *    在 globals.css 里都有对应规则（漏了就红）。
 */

export type ResultDensity = 'compact' | 'standard' | 'paper'

/** 写在 <html> 上的属性名；globals.css 的选择器必须与它一致 */
export const RESULT_DENSITY_ATTR = 'data-result-density'

export const DEFAULT_RESULT_DENSITY: ResultDensity = 'standard'

export interface ResultDensityPreset {
  id: ResultDensity
  /** 设置页里显示的档位名 */
  name: string
  /** 一句话说明「选了会怎样」，避免用户靠猜 */
  summary: string
}

export const RESULT_DENSITY_PRESETS: readonly ResultDensityPreset[] = [
  {
    id: 'compact',
    name: '紧凑',
    summary: '字更小、行更密，一屏能看到更多结论，适合快速扫读',
  },
  {
    id: 'standard',
    name: '标准',
    summary: '默认档，与界面其余部分的字号保持一致',
  },
  {
    id: 'paper',
    name: '论文式',
    summary: '衬线正文 + 宽松行高，适合把长综述当论文精读',
  },
] as const

export function isResultDensity(value: unknown): value is ResultDensity {
  return value === 'compact' || value === 'standard' || value === 'paper'
}

/** 持久化里可能存着旧版本写下的任意值（或被人手改过），一律收敛到合法档位 */
export function normalizeResultDensity(value: unknown): ResultDensity {
  return isResultDensity(value) ? value : DEFAULT_RESULT_DENSITY
}

export function findResultDensityPreset(value: unknown): ResultDensityPreset {
  const id = normalizeResultDensity(value)
  return RESULT_DENSITY_PRESETS.find((p) => p.id === id) ?? RESULT_DENSITY_PRESETS[1]
}

/**
 * 把偏好落到 <html> 上。
 *
 * 可注入 `root` 是为了可测（node 环境下没有 document）；
 * 默认取 `document.documentElement`，在 SSR 里静默跳过而不是抛错。
 */
export function applyResultDensity(density: ResultDensity, root?: HTMLElement | null): void {
  const el = root ?? (typeof document === 'undefined' ? null : document.documentElement)
  if (!el) return
  el.setAttribute(RESULT_DENSITY_ATTR, normalizeResultDensity(density))
}
