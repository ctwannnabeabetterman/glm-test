/**
 * 文献阅读编辑器（ReadingNoteEditor）的渲染契约。
 *
 * 背景 —— 2026-09-18 用户反馈「科研笔记的侧边栏点了无法切换，也不能删除」：
 *   ① 不能删除：NoteDetail 对 category === 'literature' 是**提前 return** 的，
 *      跳过了下面那张带垃圾桶按钮的 Card；而 ReadingNoteEditor 当时压根没有删除入口。
 *   ② 切不动：编辑器的草稿 state（title/author/fields）只在挂载时按 note 初始化。
 *      React 复用同一位置的组件实例，换笔记时 state 不重置 ⇒ 右侧仍显示上一篇，
 *      更糟的是 save() 用的是**新笔记的 id**，会把 A 篇的草稿写进 B 篇。
 *
 * 这里守住两条线：
 *   - 删除入口必须真的渲染出来（传了 onDelete 就有按钮）
 *   - 渲染内容必须来自传入的 note（而不是某个残留的模块级状态）
 */
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ReadingNoteEditor, type ReadingNoteNote } from '@/components/reading-note-editor'

function makeNote(over: Partial<ReadingNoteNote> = {}): ReadingNoteNote {
  return {
    id: 'note-1',
    title: '分布式天线阵列的无线皮秒级时间同步',
    content: '',
    tags: 'Clock synchronization',
    category: 'literature',
    structured: {
      author: 'Jason M. N.',
      journal: 'IEEE TCOM',
      terms: '时间同步',
      method: '分布式协同',
    },
    lastReadAt: null,
    updatedAt: '2026-09-10T00:00:00.000Z',
    ...over,
  }
}

function render(note: ReadingNoteNote, onDelete?: () => void): string {
  return renderToStaticMarkup(
    createElement(ReadingNoteEditor, {
      note,
      onUpdate: () => {},
      ...(onDelete ? { onDelete } : {}),
    }),
  )
}

describe('ReadingNoteEditor 渲染契约', () => {
  it('传了 onDelete 时必须渲染出删除按钮（用户反馈的「不能删除」）', () => {
    const html = render(makeNote(), () => {})
    expect(html).toContain('删除这篇笔记')
    // 光有 title 不算，得真的是个 button 元素，否则用户点不到
    expect(html).toMatch(/<button[^>]*title="删除这篇笔记"/)
  })

  it('没传 onDelete 时不渲染删除按钮（可选 prop 不能变成必填）', () => {
    const html = render(makeNote())
    expect(html).not.toContain('删除这篇笔记')
  })

  it('渲染内容来自传入的 note，而不是任何残留状态', () => {
    const a = makeNote()
    const b = makeNote({
      id: 'note-2',
      title: 'DRL资源分配 - 核心方法笔记',
      structured: { author: 'Nasir, Y. S.', journal: 'IEEE TCOM 2019', terms: 'DRL', method: '基线' },
    })

    const htmlA = render(a, () => {})
    const htmlB = render(b, () => {})

    expect(htmlA).toContain(a.title)
    expect(htmlA).toContain('Jason M. N.')
    expect(htmlB).toContain(b.title)
    expect(htmlB).toContain('Nasir, Y. S.')
    // 关键：渲染 B 时不能还带着 A 的元数据
    expect(htmlB).not.toContain('Jason M. N.')
    expect(htmlA).not.toContain('Nasir, Y. S.')
  })

  it('结构化字段写进 textarea 的 value（保证草稿确实是这篇笔记的）', () => {
    const html = render(makeNote(), () => {})
    expect(html).toContain('分布式协同')
    expect(html).toContain('时间同步')
  })

  it('缺 structured 时不炸（老笔记只有 content 的情况）', () => {
    const note = makeNote({ structured: undefined })
    const html = render(note, () => {})
    expect(html).toContain(note.title)
  })
})
