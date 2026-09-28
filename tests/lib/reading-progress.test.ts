import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  hasPassContent,
  passesDone,
  parseReadingProgress,
  passNotes,
  PASS_KEYS,
} from '@/lib/library/reading-progress'

/**
 * 「三遍阅读进度」的唯一定义处 —— 2026-09-28 收敛。
 *
 * 收敛前有两份同形解析（组件里的 `parseReadingProgress` 与 `paper-notes.ts` 里的
 * `parseProgress`）。两份实现必然漂移，后果是「界面上读完三遍、导出的 Markdown 少一段」。
 * 所以这里除了钉语义，还要钉**不许再长出第二份**。
 */

describe('parseReadingProgress：脏数据必须兜住', () => {
  it('正常解析勾选与笔记', () => {
    const p = parseReadingProgress('{"pass1":true,"pass2Notes":"记了点东西"}')
    expect(p.pass1).toBe(true)
    expect(p.pass2Notes).toBe('记了点东西')
  })

  it.each([null, undefined, '', '   ', 'not json', '{}', '[]', '123'])(
    '坏输入 %o 一律当成空进度（不抛异常）',
    (raw) => {
      expect(() => parseReadingProgress(raw)).not.toThrow()
      expect(parseReadingProgress(raw)).toEqual({})
    },
  )

  it('⚠️ `"null"` 不许解析成 null —— 旧实现会因此把论文详情打崩', () => {
    // 这一列是客户端 PUT 回来的字符串，白名单只校验「是字符串」⇒ "null" 存得进来。
    // 旧写法：JSON.parse("null") → null，随后 progress.pass1 抛 TypeError。
    const p = parseReadingProgress('null')
    expect(p).toEqual({})
    expect(() => passesDone(p)).not.toThrow()
    expect(p.pass1).toBeUndefined()
  })

  it('数组也当空进度（不是「普通对象」）', () => {
    expect(parseReadingProgress('[{"pass1":true}]')).toEqual({})
  })

  it('未知键与错类型被丢掉，只留认识的', () => {
    const p = parseReadingProgress('{"pass1":"yes","pass2":1,"pass3":true,"pass1Notes":"","foo":"bar"}')
    expect(p).toEqual({ pass3: true }) // "yes"/1 不是布尔、空笔记不保留、foo 不认识
  })
})

describe('passesDone / hasPassContent：完成度只有一份算法', () => {
  it('完成遍数按 0-3 计', () => {
    expect(passesDone({})).toBe(0)
    expect(passesDone({ pass1: true })).toBe(1)
    expect(passesDone({ pass1: true, pass3: true })).toBe(2)
    expect(passesDone({ pass1: true, pass2: true, pass3: true })).toBe(3)
  })

  it('「有内容」= 勾了完成 或 写了笔记（导出 Markdown 靠它决定出不出那一段）', () => {
    expect(hasPassContent({ pass1: true }, 'pass1')).toBe(true)
    expect(hasPassContent({ pass1Notes: '只写了笔记' }, 'pass1')).toBe(true)
    expect(hasPassContent({}, 'pass1')).toBe(false)
    // 别把别的遍算进来
    expect(hasPassContent({ pass2: true }, 'pass1')).toBe(false)
  })

  it('passNotes 取不到时给空串（导出侧不用再判 undefined）', () => {
    expect(passNotes({ pass2Notes: 'x' }, 'pass2')).toBe('x')
    expect(passNotes({}, 'pass2')).toBe('')
  })

  it('PASS_KEYS 是三遍且顺序固定（下游按它渲染进度条）', () => {
    expect(PASS_KEYS).toEqual(['pass1', 'pass2', 'pass3'])
  })
})

const read = (p: string) => readFileSync(path.resolve(p), 'utf8')

describe('收敛守卫：三遍进度只许有一份解析', () => {
  it('两个消费方都从共享模块取，不再各写一份', () => {
    const component = read('src/components/sections/papers-section.tsx')
    const notes = read('src/lib/library/paper-notes.ts')
    for (const src of [component, notes]) {
      expect(src).toMatch(/from ['"]@\/lib\/library\/reading-progress['"]|from ['"]\.\/reading-progress['"]/)
    }
    // 本地再定义一份就是回退到漂移状态
    expect(component).not.toMatch(/function parseReadingProgress/)
    expect(notes).not.toMatch(/function parseProgress/)
  })

  it('`readingProgress` 的 JSON 解析不许散落在别处', () => {
    const files = [
      'src/components/sections/papers-section.tsx',
      'src/lib/library/paper-notes.ts',
      'src/lib/library/reading-progress.ts',
    ]
    const offenders: string[] = []
    for (const f of files) {
      const src = read(f)
      // 只有共享模块可以 JSON.parse 这个字段
      if (f.endsWith('reading-progress.ts')) {
        expect(src).toMatch(/JSON\.parse/)
        continue
      }
      for (const [i, line] of src.split('\n').entries()) {
        if (line.includes('JSON.parse') && /readingProgress|progress\b/.test(line)) {
          offenders.push(`${f}:${i + 1} ${line.trim().slice(0, 80)}`)
        }
      }
    }
    expect(offenders, '这些地方又在自己解析 readingProgress 了').toEqual([])
  })
})
