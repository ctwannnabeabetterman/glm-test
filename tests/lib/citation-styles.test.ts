import { describe, expect, it } from 'vitest'
import {
  CITATION_STYLE_PRESETS,
  CITATION_STYLES,
  DEFAULT_CITATION_STYLE,
  cleanVenue,
  findCitationStylePreset,
  formatAuthorsGBT,
  formatAuthorsIEEE,
  formatReference,
  formatReferences,
  inferDocTypeTag,
  isCitationStyle,
  normalizeCitationStyle,
  parseAuthors,
  referenceBody,
  type CitableReference,
} from '@/lib/writing/citation-styles'
import { buildReferences, renderManuscriptMarkdown, type ReferenceSource } from '@/lib/writing/draft'

/**
 * 用例里的作者串**全部取自真实库**（2026-09-20 用 `.recon/out/probe-authors.py` 抽样），
 * 不是编出来的 —— 姓名解析这类逻辑，用编的样例测等于没测。
 */
const REAL_AUTHOR_STRINGS = {
  initialsFamily2: 'Nasir, Y. S., Guo, D.',
  fullGivenNames2: 'Kenney, Russell H., McDaniel, Jay W.',
  fullGivenNames5: 'Li, Aoyang, Wang, Ye, Mei, Lin, Wu, Shaohua, Zhang, Qinyu',
  packedInitials: 'Mudumbai, R., Brown, D.R., Madhow, U., Poor, H.V.',
  etAlSuffix: 'Zhang, S. et al.',
  singleLoose: 'Tester, A.',
  initialsFirst: 'J. Smith, A. Lee',
}

function ref(over: Partial<CitableReference> = {}): CitableReference {
  return {
    number: 1,
    found: true,
    title: 'Deep RL for Routing',
    authors: 'J. Smith, A. Lee',
    venue: 'IEEE JSAC',
    year: 2024,
    doi: '10.1/aaa',
    paperId: 'p1',
    ...over,
  }
}

describe('parseAuthors —— 真实库作者串', () => {
  it('「姓, 名」两段式：偶数段 + 奇数位像名 ⇒ 两两成组', () => {
    const p = parseAuthors(REAL_AUTHOR_STRINGS.initialsFamily2)
    expect(p.certain).toBe(true)
    expect(p.names.map((n) => [n.family, n.given])).toEqual([
      ['Nasir', 'Y. S.'],
      ['Guo', 'D.'],
    ])
  })

  it('全名（非缩写）也能成组，名保留原始写法', () => {
    const p = parseAuthors(REAL_AUTHOR_STRINGS.fullGivenNames2)
    expect(p.certain).toBe(true)
    expect(p.names.map((n) => [n.family, n.given])).toEqual([
      ['Kenney', 'Russell H.'],
      ['McDaniel', 'Jay W.'],
    ])
  })

  it('10 段 → 5 位作者（够长的清单也不会被切错）', () => {
    const p = parseAuthors(REAL_AUTHOR_STRINGS.fullGivenNames5)
    expect(p.certain).toBe(true)
    expect(p.names).toHaveLength(5)
    expect(p.names[0]).toMatchObject({ family: 'Li', given: 'Aoyang' })
    expect(p.names[4]).toMatchObject({ family: 'Zhang', given: 'Qinyu' })
  })

  it('连写缩写点 `D.R.` / `H.V.` 不会粘连', () => {
    const p = parseAuthors(REAL_AUTHOR_STRINGS.packedInitials)
    expect(p.certain).toBe(true)
    expect(p.names.map((n) => [n.family, n.given])).toEqual([
      ['Mudumbai', 'R.'],
      ['Brown', 'D.R.'],
      ['Madhow', 'U.'],
      ['Poor', 'H.V.'],
    ])
  })

  it('`et al.` 被识别为「截断标记」而不是人名的一部分', () => {
    const p = parseAuthors(REAL_AUTHOR_STRINGS.etAlSuffix)
    expect(p.certain).toBe(true)
    expect(p.etAl).toBe(true)
    expect(p.names).toEqual([{ raw: 'Zhang, S.', family: 'Zhang', given: 'S.' }])
  })

  it('「缩写在前」的列表不会被当成两段式切错（首段是缩写 ⇒ 关掉成组）', () => {
    const p = parseAuthors(REAL_AUTHOR_STRINGS.initialsFirst)
    expect(p.certain).toBe(true)
    expect(p.names.map((n) => [n.family, n.given])).toEqual([
      ['Smith', 'J.'],
      ['Lee', 'A.'],
    ])
  })

  it('单个词视为「只有姓」；单独一段缩写则判为不确定（分不清姓）', () => {
    expect(parseAuthors('Wang').names).toEqual([{ raw: 'Wang', family: 'Wang', given: '' }])
    expect(parseAuthors('K. Wang').names).toEqual([{ raw: 'K. Wang', family: 'Wang', given: 'K.' }])

    const ambiguous = parseAuthors('Y. S.')
    expect(ambiguous.certain).toBe(false)
    expect(ambiguous.note).toContain('Y. S.')
  })

  it('名在前、无缩写点 ⇒ 刻意不解析（不猜姓）', () => {
    const p = parseAuthors('John Smith')
    expect(p.certain).toBe(false)
    expect(p.names[0].family).toBe('')
  })

  it('段数为奇数（切不出成对）⇒ 不确定，不硬凑', () => {
    const p = parseAuthors('Smith, J., Lee')
    expect(p.certain).toBe(false)
  })

  it('分号是无歧义分隔符，优先于逗号成组', () => {
    const p = parseAuthors('Nasir, Y. S.; Guo, D.')
    expect(p.certain).toBe(true)
    expect(p.names.map((n) => [n.family, n.given])).toEqual([
      ['Nasir', 'Y. S.'],
      ['Guo', 'D.'],
    ])
  })

  it('中文姓名整串保留，不按西文规则改写', () => {
    const p = parseAuthors('张三, 李四, 等')
    expect(p.certain).toBe(true)
    expect(p.etAl).toBe(true)
    expect(p.names.map((n) => n.family)).toEqual(['张三', '李四'])

    // 「、」也是中文顿号分隔符
    expect(parseAuthors('张三、李四').names.map((n) => n.family)).toEqual(['张三', '李四'])
  })

  it('空串是「确定地没有作者」，不是解析失败', () => {
    for (const v of ['', '   ', null, undefined]) {
      const p = parseAuthors(v)
      expect(p).toMatchObject({ names: [], etAl: false, certain: true })
    }
  })
})

describe('formatAuthorsIEEE', () => {
  it('把库里「姓, 名」重排成 IEEE 的「缩写 姓」', () => {
    expect(formatAuthorsIEEE(REAL_AUTHOR_STRINGS.initialsFamily2)).toBe('Y. S. Nasir, D. Guo')
  })

  it('已是「缩写 姓」的串保持原样（幂等）', () => {
    expect(formatAuthorsIEEE(REAL_AUTHOR_STRINGS.initialsFirst)).toBe('J. Smith, A. Lee')
    expect(formatAuthorsIEEE('K. Wang')).toBe('K. Wang')
  })

  it('et al. 按 IEEE 惯例接在末尾且前面不加逗号', () => {
    expect(formatAuthorsIEEE(REAL_AUTHOR_STRINGS.etAlSuffix)).toBe('S. Zhang et al.')
  })

  it('解析不确定时回落到原始串（格式难看可以改，姓名颠倒要出勘误）', () => {
    expect(formatAuthorsIEEE('John Smith')).toBe('John Smith')
    expect(formatAuthorsIEEE('Y. S.')).toBe('Y. S.')
  })

  it('中文姓名原样输出', () => {
    expect(formatAuthorsIEEE('张三, 李四')).toBe('张三, 李四')
  })

  it('空作者串得到空串（让上层决定是否显示占位）', () => {
    expect(formatAuthorsIEEE('')).toBe('')
    expect(formatAuthorsIEEE(null)).toBe('')
  })
})

describe('formatAuthorsGBT（GB/T 7714-2015）', () => {
  it('姓大写在前、名缩写且省略缩写点', () => {
    expect(formatAuthorsGBT(REAL_AUTHOR_STRINGS.initialsFamily2)).toBe('NASIR Y S, GUO D')
  })

  it('全名压成首字母（Russell H. → R H）', () => {
    expect(formatAuthorsGBT(REAL_AUTHOR_STRINGS.fullGivenNames2)).toBe('KENNEY R H, MCDANIEL J W')
  })

  it('超过 3 位只列前 3 位，西文加 `, et al.`', () => {
    expect(formatAuthorsGBT(REAL_AUTHOR_STRINGS.fullGivenNames5)).toBe(
      'LI A, WANG Y, MEI L, et al.',
    )
  })

  it('恰好 3 位时全部列出、不加「等」', () => {
    expect(formatAuthorsGBT('Li, A, Wang, B, Mei, C')).toBe('LI A, WANG B, MEI C')
  })

  it('原串自带 et al. 时补上「等」的语义（如实反映还有别的作者）', () => {
    expect(formatAuthorsGBT(REAL_AUTHOR_STRINGS.etAlSuffix)).toBe('ZHANG S, et al.')
    expect(formatAuthorsGBT('Wu, J. et al.')).toBe('WU J, et al.')
  })

  it('中文文献用「等」而不是 et al.', () => {
    expect(formatAuthorsGBT('张三, 李四, 王五, 赵六')).toBe('张三, 李四, 王五, 等')
  })

  it('连写缩写点展开成空格分隔（D.R. → D R）', () => {
    expect(formatAuthorsGBT(REAL_AUTHOR_STRINGS.packedInitials)).toBe(
      'MUDUMBAI R, BROWN D R, MADHOW U, et al.',
    )
  })

  it('解析不确定时原样输出，绝不猜姓', () => {
    expect(formatAuthorsGBT('John Smith')).toBe('John Smith')
  })
})

describe('cleanVenue —— 去掉混进 venue 的年份', () => {
  it('尾部年份等于 year 字段时删掉（否则输出 `IEEE TCOM, 2019, 2019`）', () => {
    expect(cleanVenue('IEEE TCOM, 2019', 2019)).toBe('IEEE TCOM')
    expect(cleanVenue('IEEE ICC, 2021', 2021)).toBe('IEEE ICC')
    expect(cleanVenue('2024 IEEE/MTT-S International Microwave Symposium - IMS 2024', 2024)).toBe(
      '2024 IEEE/MTT-S International Microwave Symposium - IMS',
    )
    expect(cleanVenue('INFOCOM (2023)', 2023)).toBe('INFOCOM')
  })

  it('不含年份、或年份对不上时不动它', () => {
    expect(cleanVenue('IEEE JSAC', 2024)).toBe('IEEE JSAC')
    expect(cleanVenue('ICC 2025 - IEEE International Conference on Communications', 2025)).toBe(
      'ICC 2025 - IEEE International Conference on Communications',
    )
    // 年份字段为空：没有比对依据，不动
    expect(cleanVenue('IEEE TCOM, 2019', null)).toBe('IEEE TCOM, 2019')
  })
})

describe('inferDocTypeTag —— GB/T 7714 的文献类型标识', () => {
  it('会议类 venue 判为 [C]', () => {
    expect(inferDocTypeTag('2024 IEEE/MTT-S International Microwave Symposium - IMS 2024')).toBe('C')
    expect(inferDocTypeTag('ICC 2025 - IEEE International Conference on Communications')).toBe('C')
    expect(inferDocTypeTag('IEEE ICC')).toBe('C')
    expect(inferDocTypeTag('IEEE INFOCOM')).toBe('C')
  })

  it('期刊类 venue 判为 [J]', () => {
    expect(inferDocTypeTag('IEEE JSAC')).toBe('J')
    expect(inferDocTypeTag('IEEE Journal of Selected Topics in Signal Processing')).toBe('J')
    expect(inferDocTypeTag('IEEE Communications Surveys and Tutorials')).toBe('J')
    expect(inferDocTypeTag('Journal of Telecommunications and Information Technology')).toBe('J')
  })

  it('`Proceedings of the IEEE` 是期刊不是会议（期刊判断必须排在会议之前）', () => {
    expect(inferDocTypeTag('Proceedings of the IEEE')).toBe('J')
  })

  it('判据不足时按期刊落，不留空', () => {
    expect(inferDocTypeTag('')).toBe('J')
    expect(inferDocTypeTag('Science China Information Sciences')).toBe('J')
  })

  it('学位论文 / 图书各归其位', () => {
    expect(inferDocTypeTag('PhD thesis, MIT')).toBe('D')
    expect(inferDocTypeTag('Springer Press')).toBe('M')
  })
})

describe('formatReference —— 两种样式', () => {
  it('IEEE 与加入样式层之前逐字一致（向后兼容的硬约束）', () => {
    expect(formatReference(ref(), 'ieee')).toBe(
      '[1] J. Smith, A. Lee, "Deep RL for Routing", IEEE JSAC, 2024. doi: 10.1/aaa.',
    )
    expect(
      formatReference(
        ref({ title: 'Load Balancing in DCN', authors: 'K. Wang', venue: 'INFOCOM', year: 2023, doi: '' }),
        'ieee',
      ),
    ).toBe('[1] K. Wang, "Load Balancing in DCN", INFOCOM, 2023.')
  })

  it('GB/T 7714 输出姓前名缩写 + 类型标识 + 年份，用 `. ` 分隔著录项', () => {
    const r = ref({ authors: 'Nasir, Y. S., Guo, D.' })
    expect(formatReference(r, 'gbt7714')).toBe(
      '[1] NASIR Y S, GUO D. Deep RL for Routing[J]. IEEE JSAC, 2024. DOI:10.1/aaa.',
    )
  })

  it('GB/T 7714 遇 et al. 不产生双句点（`et al.. Title`）', () => {
    const r = ref({ authors: 'Nasir, Y. S., Guo, D., Li, Aoyang, Wang, Ye' })
    const out = formatReference(r, 'gbt7714')
    expect(out).not.toContain('..')
    expect(out).toBe(
      '[1] NASIR Y S, GUO D, LI A, et al. Deep RL for Routing[J]. IEEE JSAC, 2024. DOI:10.1/aaa.',
    )
  })

  it('IEEE 会把库里的 venue 年份去重（不再出现 `IEEE TCOM, 2019, 2019`）', () => {
    const r = ref({ venue: 'IEEE TCOM, 2019', year: 2019, doi: '' })
    expect(formatReference(r, 'ieee')).toBe(
      '[1] J. Smith, A. Lee, "Deep RL for Routing", IEEE TCOM, 2019.',
    )
  })

  it('坏引用在两种样式下都给同一句可操作提示', () => {
    const ghost = ref({ found: false, paperId: 'ghost' })
    for (const style of CITATION_STYLES) {
      const out = formatReference(ghost, style)
      expect(out).toContain('未在文献库中找到')
      expect(out).toContain('ghost')
    }
  })

  it('缺题录信息时不产出空行', () => {
    const bare = ref({ authors: '', title: '', venue: '', year: null, doi: '' })
    expect(formatReference(bare, 'ieee')).toContain('缺少题录信息')
    expect(formatReference(bare, 'gbt7714')).toContain('缺少题录信息')
  })

  it('默认样式是 IEEE（旧调用方不传 style 时行为不变）', () => {
    expect(DEFAULT_CITATION_STYLE).toBe('ieee')
    expect(formatReference(ref())).toBe(formatReference(ref(), 'ieee'))
  })

  it('referenceBody 不含编号，供「编号单独渲染」的预览列表使用', () => {
    expect(referenceBody(ref(), 'ieee')).not.toMatch(/^\[1\]/)
    expect(referenceBody(ref(), 'ieee')).toContain('"Deep RL for Routing"')
    expect(referenceBody(ref(), 'gbt7714')).toContain('Deep RL for Routing[J]')
  })

  it('formatReferences 保持入参顺序（= 正文首次出现顺序）', () => {
    const list = formatReferences([ref({ number: 1 }), ref({ number: 2, authors: 'K. Wang' })], 'gbt7714')
    expect(list[0].startsWith('[1] ')).toBe(true)
    expect(list[1].startsWith('[2] ')).toBe(true)
  })
})

describe('样式判定与预设', () => {
  it('isCitationStyle / normalizeCitationStyle 收敛脏值', () => {
    expect(isCitationStyle('ieee')).toBe(true)
    expect(isCitationStyle('gbt7714')).toBe(true)
    expect(isCitationStyle('IEEE')).toBe(false) // 大小写敏感：路由里先 toLowerCase
    expect(isCitationStyle('mla')).toBe(false)
    expect(isCitationStyle(null)).toBe(false)

    expect(normalizeCitationStyle('gbt7714')).toBe('gbt7714')
    expect(normalizeCitationStyle('mla')).toBe(DEFAULT_CITATION_STYLE)
    expect(normalizeCitationStyle(undefined)).toBe(DEFAULT_CITATION_STYLE)
    expect(normalizeCitationStyle(123)).toBe(DEFAULT_CITATION_STYLE)
  })

  it('每个样式都有预设，且样例是**现算**出来的（说明与实现不会漂移）', () => {
    expect(CITATION_STYLE_PRESETS.map((p) => p.id)).toEqual(CITATION_STYLES)
    for (const preset of CITATION_STYLE_PRESETS) {
      expect(preset.name.trim().length).toBeGreaterThan(0)
      expect(preset.summary.trim().length).toBeGreaterThan(0)
      expect(preset.sample.startsWith('[1] ')).toBe(true)
    }
    const ieee = findCitationStylePreset('ieee')
    const gbt = findCitationStylePreset('gbt7714')
    expect(ieee.sample).toContain('Y. S. Nasir')
    expect(gbt.sample).toContain('NASIR Y S')
    // 样例必须真的不同 —— 相同就说明其中一条走错了分支
    expect(ieee.sample).not.toBe(gbt.sample)
  })

  it('findCitationStylePreset 对未知 id 回落到第一条，不返回 undefined', () => {
    expect(findCitationStylePreset('mla' as never).id).toBe(CITATION_STYLES[0])
  })

  it('样例里能看见「超过 3 位作者只列前 3 位」这条规则', () => {
    expect(findCitationStylePreset('gbt7714').sample).toContain(', et al.')
    expect(findCitationStylePreset('ieee').sample).not.toContain('et al.')
  })
})

describe('整稿导出接入样式', () => {
  const PAPERS: ReferenceSource[] = [
    { id: 'p1', title: 'Deep RL for Routing', authors: 'J. Smith, A. Lee', venue: 'IEEE JSAC', year: 2024, doi: '10.1/aaa' },
  ]
  const sections = [{ id: 'a', title: 'Introduction', targetWords: 0, content: '路由 [@p1] 很重要。' }]

  function md(style?: 'ieee' | 'gbt7714') {
    const refs = buildReferences(['p1'], PAPERS)
    return renderManuscriptMarkdown({ title: 'T', sections, references: refs, style })
  }

  it('不传 style 时输出与旧版一致（IEEE）', () => {
    expect(md()).toBe(md('ieee'))
    expect(md()).toContain('[1] J. Smith, A. Lee, "Deep RL for Routing", IEEE JSAC, 2024. doi: 10.1/aaa.')
  })

  it('传 gbt7714 时参考文献段整段换格式，正文编号保持不变', () => {
    const out = md('gbt7714')
    expect(out).toContain('## 参考文献')
    expect(out).toContain('[1] SMITH J, LEE A. Deep RL for Routing[J]. IEEE JSAC, 2024. DOI:10.1/aaa.')
    // 正文里的编号是「与样式无关」的，换样式不该动它
    expect(out).toContain('路由 [1] 很重要。')
  })
})
