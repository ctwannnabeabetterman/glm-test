import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RESULT_DENSITY,
  RESULT_DENSITY_ATTR,
  RESULT_DENSITY_PRESETS,
  applyResultDensity,
  findResultDensityPreset,
  normalizeResultDensity,
} from '@/lib/result-density'
import { useAppStore } from '@/lib/store'

/**
 * 「结果呈现」偏好的契约测试。
 *
 * 这里最有价值的其实是最后那组 **CSS 漂移守卫**：
 * 数值（缩放 / 行高）只写在 globals.css 一处，TS 侧只保留 id 与文案。
 * 这种「一对多」的约定最容易在后续维护中悄悄断掉 —— 加了新档位却忘了写 CSS，
 * 表现为「用户选了没反应」，而且不报任何错。所以用测试把两端钉在一起。
 */

/** 够用的假 <html>：只验证 setAttribute 被正确调用 */
function fakeRoot() {
  const attrs: Record<string, string> = {}
  const el = {
    setAttribute: (k: string, v: string) => {
      attrs[k] = v
    },
  } as unknown as HTMLElement
  return { el, attrs }
}

describe('result-density：预设与归一化', () => {
  it('三个档位齐全，顺序是 紧凑 → 标准 → 论文式', () => {
    expect(RESULT_DENSITY_PRESETS.map((p) => p.id)).toEqual(['compact', 'standard', 'paper'])
  })

  it('每档都有名字与一句说明（设置页直接渲染这两项，缺了用户就是在盲选）', () => {
    for (const preset of RESULT_DENSITY_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0)
      expect(preset.summary.length).toBeGreaterThan(8)
    }
  })

  it('默认档是「标准」，且它确实在预设列表里', () => {
    expect(DEFAULT_RESULT_DENSITY).toBe('standard')
    expect(RESULT_DENSITY_PRESETS.some((p) => p.id === DEFAULT_RESULT_DENSITY)).toBe(true)
  })

  it('脏值一律收敛到默认档，而不是把非法值一路带到 DOM 上', () => {
    for (const junk of [undefined, null, '', 'Compact', 'PAPER', 0, {}, []]) {
      expect(normalizeResultDensity(junk)).toBe(DEFAULT_RESULT_DENSITY)
    }
    expect(normalizeResultDensity('paper')).toBe('paper')
  })

  it('findResultDensityPreset 永远返回一个可用预设', () => {
    expect(findResultDensityPreset('paper').id).toBe('paper')
    expect(findResultDensityPreset('不存在的东西').id).toBe(DEFAULT_RESULT_DENSITY)
  })
})

describe('result-density：落到 <html> 上', () => {
  it('写的是 data-result-density 属性，且值经过归一化', () => {
    const { el, attrs } = fakeRoot()
    applyResultDensity('compact', el)
    expect(attrs[RESULT_DENSITY_ATTR]).toBe('compact')

    applyResultDensity('胡说' as never, el)
    expect(attrs[RESULT_DENSITY_ATTR]).toBe(DEFAULT_RESULT_DENSITY)
  })

  it('没有 document（SSR）也不抛错 —— 静默跳过而不是把首屏渲染搞崩', () => {
    expect(() => applyResultDensity('paper', null)).not.toThrow()
    expect(() => applyResultDensity('paper')).not.toThrow()
  })
})

describe('store：呈现密度是持久化的用户偏好', () => {
  it('默认值与 result-density 模块保持一致，setter 有归一化兜底', () => {
    expect(useAppStore.getState().resultDensity).toBe(DEFAULT_RESULT_DENSITY)
    useAppStore.getState().setResultDensity('compact')
    expect(useAppStore.getState().resultDensity).toBe('compact')
    useAppStore.getState().setResultDensity('随便什么' as never)
    expect(useAppStore.getState().resultDensity).toBe(DEFAULT_RESULT_DENSITY)
    useAppStore.getState().setResultDensity(DEFAULT_RESULT_DENSITY)
  })
})

describe('globals.css：密度数值与 TS 预设不许漂移', () => {
  const css = readFileSync(path.resolve(process.cwd(), 'src/app/globals.css'), 'utf8')

  /** 取某个密度档位块里的变量值 */
  const blockOf = (id: string) => css.match(new RegExp(`html\\[data-result-density='${id}'\\]\\s*\\{([^}]*)\\}`))?.[1] ?? ''
  // 注意：文件里 :root 有好几个（字体栈 / 浅色主题 / 深色主题 …），
  // 必须挑出定义了密度变量那一个，否则拿到的是别的块、变量一律 NaN。
  const rootBlock = css.match(/:root\s*\{([^}]*--ai-md-scale[^}]*)\}/)?.[1] ?? ''
  const varOf = (block: string, name: string) => {
    const m = block.match(new RegExp(`${name}:\\s*([\\d.]+)\\s*;`))
    if (!m) throw new Error(`CSS 块里找不到 ${name}：${block.trim().slice(0, 90)}`)
    return Number(m[1])
  }

  it('每个预设 id 在 globals.css 里都有对应的 html[data-result-density] 规则', () => {
    // 漏写一档的症状是「用户选了没反应」，且不抛任何错 —— 必须由测试兜住
    for (const preset of RESULT_DENSITY_PRESETS) {
      expect(blockOf(preset.id)).not.toBe('')
    }
  })

  it('两个密度变量都有缺省值，且被 .ai-markdown 真正取用', () => {
    // 缺省值：SSR 首次渲染（<html> 上还没有属性）时必须落在「标准」档上
    expect(varOf(rootBlock, '--ai-md-scale')).toBe(1)
    expect(varOf(rootBlock, '--ai-md-leading')).toBeGreaterThan(0)
    // 取用点：字号乘密度缩放、行高取密度行高
    expect(css).toMatch(/font-size:\s*calc\(var\(--ai-md-base[^)]*\)\s*\*\s*var\(--ai-md-scale\)\)/)
    expect(css).toMatch(/line-height:\s*var\(--ai-md-leading\)/)
  })

  it('「标准」档的显式声明与 :root 缺省值一致（否则 SSR 与运行时会是两套字号）', () => {
    const standard = blockOf('standard')
    expect(varOf(standard, '--ai-md-scale')).toBe(varOf(rootBlock, '--ai-md-scale'))
    expect(varOf(standard, '--ai-md-leading')).toBe(varOf(rootBlock, '--ai-md-leading'))
  })

  it('三档的缩放确实有区分度（含预期方向：紧凑 < 标准 < 论文式）', () => {
    const compact = varOf(blockOf('compact'), '--ai-md-scale')
    const standard = varOf(blockOf('standard'), '--ai-md-scale')
    const paper = varOf(blockOf('paper'), '--ai-md-scale')
    expect(compact).toBeLessThan(standard)
    expect(standard).toBeLessThan(paper)
    // 论文式行高必须比标准松，否则「论文式」只是把字放大而已
    expect(varOf(blockOf('paper'), '--ai-md-leading')).toBeGreaterThan(varOf(blockOf('standard'), '--ai-md-leading'))
  })

  it('「论文式」确实是衬线正文', () => {
    expect(css).toMatch(/html\[data-result-density='paper'\]\s+\.ai-markdown\s*\{[^}]*font-family:\s*var\(--font-body\)/)
  })
})
