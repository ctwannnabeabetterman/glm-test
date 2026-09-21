import { describe, expect, it } from 'vitest'
import {
  appendToSection,
  applyCitationNumbers,
  buildReferences,
  collectCitationIds,
  countWords,
  defaultOutline,
  extractCitationIds,
  formatReferenceIEEE,
  markdownToPlainText,
  newSection,
  normalizeSections,
  pickAppendTarget,
  renderManuscriptMarkdown,
  safeFileName,
  sectionProgress,
  totalWords,
  writingProgress,
  type DraftSection,
  type ReferenceSource,
} from '@/lib/writing/draft'

const PAPERS: ReferenceSource[] = [
  { id: 'p1', title: 'Deep RL for Routing', authors: 'J. Smith, A. Lee', venue: 'IEEE JSAC', year: 2024, doi: '10.1/aaa' },
  { id: 'p2', title: 'Load Balancing in DCN', authors: 'K. Wang', venue: 'INFOCOM', year: 2023, doi: '' },
]

function sections(...contents: string[]): DraftSection[] {
  return contents.map((content, i) => ({ id: `s${i}`, title: `S${i}`, targetWords: 0, content }))
}

describe('countWords', () => {
  it('中日韩字符逐字计数，拉丁按词计数', () => {
    expect(countWords('本文提出了 a novel method')).toBe(8) // 5 汉字 + 3 词
    expect(countWords('Hello world')).toBe(2)
    expect(countWords('')).toBe(0)
    expect(countWords(null)).toBe(0)
    expect(countWords(undefined)).toBe(0)
  })

  it('引用标记不计入字数（否则"没写字字数却涨了"）', () => {
    expect(countWords('[@p1]')).toBe(0)
    expect(countWords('见 [@p1] 所述')).toBe(3) // 见/所/述
    expect(countWords('[@p1, @p2]')).toBe(0)
  })

  it('代码块、行内代码、链接与 markdown 记号不计入字数', () => {
    expect(countWords('```\nconst a = 1\n```')).toBe(0)
    expect(countWords('`code`')).toBe(0)
    expect(countWords('[site](https://example.com)')).toBe(0)
    expect(countWords('## 引言')).toBe(2)
  })
})

describe('normalizeSections', () => {
  it('接受 JSON 字符串并补齐缺省字段', () => {
    const out = normalizeSections('[{"id":"a","title":"Intro","targetWords":300,"content":"x"}]')
    expect(out).toEqual([{ id: 'a', title: 'Intro', targetWords: 300, content: 'x' }])
  })

  it('坏 JSON / 非数组一律降级成空数组，而不是抛错（稿子必须能打开）', () => {
    expect(normalizeSections('{ not json')).toEqual([])
    expect(normalizeSections('{"a":1}')).toEqual([])
    expect(normalizeSections(null)).toEqual([])
  })

  it('id 重复时重新生成，且 targetWords 归一化为非负整数', () => {
    const out = normalizeSections([
      { id: 'same', title: 'A' },
      { id: 'same', title: 'B' },
      { title: '', targetWords: -5 },
    ])
    expect(out[0].id).toBe('same')
    expect(out[1].id).not.toBe('same')
    expect(out[2].title).toBe('未命名章节')
    expect(out[2].targetWords).toBe(0)
  })
})

describe('引用解析与编号', () => {
  it('按首次出现顺序去重，且支持一个标记里多个 id', () => {
    expect(extractCitationIds('a [@p2] b [@p1] c [@p2]')).toEqual(['p2', 'p1'])
    expect(extractCitationIds('[@p1, @p2]')).toEqual(['p1', 'p2'])
    expect(extractCitationIds('[@p1; @p2]')).toEqual(['p1', 'p2'])
    expect(extractCitationIds('没有引用')).toEqual([])
  })

  it('跨章节按章节顺序收集', () => {
    expect(collectCitationIds(sections('[@b]', '[@a] [@b]'))).toEqual(['b', 'a'])
  })

  it('参考文献编号 = 正文首次出现次序', () => {
    const refs = buildReferences(['p2', 'p1'], PAPERS)
    expect(refs.map((r) => [r.number, r.paperId])).toEqual([
      [1, 'p2'],
      [2, 'p1'],
    ])
    expect(refs[0].title).toBe('Load Balancing in DCN')
    expect(refs[0].authors).toBe('K. Wang')
  })

  it('文献库里查不到的引用也占编号并标记 found=false（不许静默丢弃）', () => {
    const refs = buildReferences(['ghost', 'p1'], PAPERS)
    expect(refs[0].found).toBe(false)
    expect(refs[0].number).toBe(1)
    expect(refs[1].found).toBe(true)
    expect(refs[1].number).toBe(2)
  })

  it('正文里的标记被替换成序号，且删段后编号会重排', () => {
    const before = sections('A [@p2] B [@p1] C [@p2]')
    const refs1 = buildReferences(collectCitationIds(before), PAPERS)
    expect(applyCitationNumbers(before[0].content, refs1)).toBe('A [1] B [2] C [1]')

    // 去掉第一次出现的 p2 → p1 升为 [1]
    const after = sections('B [@p1] C [@p2]')
    const refs2 = buildReferences(collectCitationIds(after), PAPERS)
    expect(applyCitationNumbers(after[0].content, refs2)).toBe('B [1] C [2]')
  })

  it('解析不到的标记原样保留，便于用户发现坏引用', () => {
    expect(applyCitationNumbers('x [@unknown]', [])).toBe('x [@unknown]')
  })
})

describe('formatReferenceIEEE', () => {
  it('拼出作者、题名、会议/期刊与年份', () => {
    const [r] = buildReferences(['p1'], PAPERS)
    expect(formatReferenceIEEE(r)).toBe(
      '[1] J. Smith, A. Lee, "Deep RL for Routing", IEEE JSAC, 2024. doi: 10.1/aaa.',
    )
  })

  it('缺 DOI / 缺年份时不留下多余标点', () => {
    const [r] = buildReferences(['p2'], PAPERS)
    expect(formatReferenceIEEE(r)).toBe('[1] K. Wang, "Load Balancing in DCN", INFOCOM, 2023.')
  })

  it('坏引用给出可操作提示而不是空白', () => {
    const [r] = buildReferences(['ghost'], PAPERS)
    expect(formatReferenceIEEE(r)).toContain('未在文献库中找到')
    expect(formatReferenceIEEE(r)).toContain('ghost')
  })
})

describe('进度', () => {
  it('未设目标时百分比为 0，不产生除零', () => {
    expect(writingProgress(sections('abc def'), 0)).toEqual({ words: 2, target: 0, percent: 0, remaining: 0 })
  })

  it('超额完成时百分比封顶 100，remaining 不为负', () => {
    const p = writingProgress(sections('one two three four'), 2)
    expect(p.percent).toBe(100)
    expect(p.remaining).toBe(0)
  })

  it('章节进度按章节自身目标计算', () => {
    const p = sectionProgress({ id: 'x', title: 'x', targetWords: 10, content: 'a b c d e' })
    expect(p).toMatchObject({ words: 5, target: 10, percent: 50, remaining: 5 })
  })

  it('totalWords 汇总全部章节', () => {
    expect(totalWords(sections('a b', 'c'))).toBe(3)
  })
})

describe('整稿导出', () => {
  it('输出章节标题、已编号正文与参考文献表', () => {
    const secs = [
      { id: 'a', title: 'Introduction', targetWords: 0, content: '路由问题 [@p1] 很重要。' },
      { id: 'b', title: 'Method', targetWords: 0, content: '我们用 [@p2] 的方法。' },
    ]
    const refs = buildReferences(collectCitationIds(secs), PAPERS)
    const md = renderManuscriptMarkdown({ title: '我的论文', venue: 'IEEE JSAC', sections: secs, references: refs })

    expect(md).toContain('# 我的论文')
    expect(md).toContain('> 目标：IEEE JSAC')
    expect(md).toContain('## Introduction')
    expect(md).toContain('## Method')
    expect(md).toContain('路由问题 [1] 很重要。')
    expect(md).toContain('我们用 [2] 的方法。')
    expect(md).toContain('## 参考文献')
    expect(md).toContain('[1] J. Smith, A. Lee')
    expect(md).toContain('[2] K. Wang')
  })

  it('全文没有引用时不渲染参考文献段', () => {
    const md = renderManuscriptMarkdown({ title: 'T', sections: sections('no citation'), references: [] })
    expect(md).not.toContain('## 参考文献')
  })

  it('标题为空时给出占位而不是空标题', () => {
    expect(renderManuscriptMarkdown({ title: '  ', sections: [], references: [] })).toContain('# 未命名稿件')
  })
})

describe('markdownToPlainText', () => {
  it('去掉结构记号但保留正文与引用编号', () => {
    const md = '# 标题\n\n> 目标：IEEE JSAC\n\n正文 [1] 与 **强调** 和 `code`。\n\n## 参考文献\n\n[1] K. Wang, "T", INFOCOM, 2023.'
    const txt = markdownToPlainText(md)
    expect(txt).not.toContain('#')
    expect(txt).not.toContain('>')
    expect(txt).not.toContain('**')
    expect(txt).not.toContain('`')
    expect(txt).toContain('正文 [1] 与 强调 和 code')
    expect(txt).toContain('[1] K. Wang')
  })

  it('代码块保留内容、只去围栏', () => {
    expect(markdownToPlainText('```\nconst a = 1\n```')).toContain('const a = 1')
  })
})

describe('safeFileName', () => {
  it('替换掉文件系统非法字符', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a-b-c-d-e-f-g-h-i-j')
  })

  it('空名与纯点号回退到默认名，避免生成隐藏文件或空名', () => {
    expect(safeFileName('')).toBe('manuscript')
    expect(safeFileName('   ')).toBe('manuscript')
    expect(safeFileName('...')).toBe('manuscript')
    expect(safeFileName('', 'draft')).toBe('draft')
  })

  it('过长文件名被截断，但保留可读前缀', () => {
    const long = 'A'.repeat(200)
    expect(safeFileName(long).length).toBe(80)
    expect(safeFileName(long).startsWith('AAAA')).toBe(true)
  })
})

describe('追加目标的选择（跨面板投递：插入引用 / 补一段话）', () => {
  const secs = (...pairs: Array<[string, string]>): DraftSection[] =>
    pairs.map(([title, content], i) => ({ id: `s${i}`, title, targetWords: 0, content }))

  it('指定章节名优先 —— 引用默认落 Related Work', () => {
    const s = secs(['Abstract', 'x'], ['Introduction', ''], ['Related Work', ''], ['Method', 'y'])
    expect(pickAppendTarget(s, 'Related Work')).toBe(2)
  })

  it('标题匹配忽略大小写与首尾空格，但**不做模糊匹配**', () => {
    const s = secs(['Related Work', ''], ['Related Work Summary', ''])
    expect(pickAppendTarget(s, ' related work ')).toBe(0)
    expect(pickAppendTarget(s, 'Related Work Summary')).toBe(1)
    // 半截名不匹配 —— 否则「Related」会把两章都吃掉，用户看到的是「插一条引用整章变了」。
    // 匹配不到就走回落规则；这组用例里两章都是空的 ⇒ 落到第一章。
    expect(pickAppendTarget(s, 'Related')).toBe(0)
  })

  it('没指定 / 匹配不到 → 落到最后一个有内容的章节', () => {
    const s = secs(['Abstract', 'a'], ['Introduction', 'b'], ['Method', ''])
    expect(pickAppendTarget(s, 'Related Work')).toBe(1)
    expect(pickAppendTarget(s)).toBe(1)
  })

  it('全空 → 第一章；完全没有章节 → -1（由调用方退化成「新建章节」）', () => {
    expect(pickAppendTarget(secs(['A', ''], ['B', '   ']))).toBe(0)
    expect(pickAppendTarget([])).toBe(-1)
  })

  it('appendToSection 自动补空行，不与上一句粘连', () => {
    const next = appendToSection(secs(['Related Work', '已有内容。']), 0, '[@p1]')
    expect(next[0].content).toBe('已有内容。\n\n[@p1]')
  })

  it('空章节直接写入，不留前导空行', () => {
    expect(appendToSection(secs(['A', '']), 0, '[@p1]')[0].content).toBe('[@p1]')
    expect(appendToSection(secs(['A', '   ']), 0, '[@p1]')[0].content).toBe('[@p1]')
  })

  it('不修改入参（React state 就地改会引发难查的重渲染问题）', () => {
    const s = secs(['A', 'x'])
    const snapshot = JSON.parse(JSON.stringify(s))
    appendToSection(s, 0, '[@p1]')
    expect(s).toEqual(snapshot)
  })

  it('空文本 / 越界索引原样返回（不制造一个空章节）', () => {
    const s = secs(['A', 'x'])
    expect(appendToSection(s, 0, '   ')).toBe(s)
    expect(appendToSection(s, 5, '[@p1]')).toBe(s)
    expect(appendToSection(s, -1, '[@p1]')).toBe(s)
  })

  it('追加进去的引用标记照常编号（语法没被拼接破坏）', () => {
    const s = appendToSection(secs(['Related Work', '综述见']), 0, '[@p1, @p2]')
    const refs = buildReferences(collectCitationIds(s), PAPERS)
    expect(applyCitationNumbers(s[0].content, refs)).toContain('[1, 2]')
  })
})

describe('defaultOutline', () => {
  it('给出可用的默认章节骨架，且 id 唯一', () => {
    const outline = defaultOutline()
    expect(outline.length).toBeGreaterThanOrEqual(6)
    expect(new Set(outline.map((s) => s.id)).size).toBe(outline.length)
    expect(outline.every((s) => s.targetWords > 0)).toBe(true)
    expect(outline.map((s) => s.title)).toContain('Introduction')
  })

  it('newSection 生成的 id 不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSection().id))
    expect(ids.size).toBe(50)
  })
})
