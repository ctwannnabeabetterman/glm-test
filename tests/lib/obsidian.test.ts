import { describe, it, expect } from 'vitest'
import path from 'node:path'
import {
  DEFAULT_OBSIDIAN_CONFIG,
  DEFAULT_OBSIDIAN_SUBFOLDER,
  dedupeFileNames,
  isAbsolutePath,
  isObsidianReady,
  isSafeNoteFileName,
  isSafeRelativePath,
  normalizeObsidianConfig,
  obsidianFileName,
  resolveInsideVault,
  sanitizePathSegment,
  sanitizeSubfolder,
} from '@/lib/library/obsidian'

describe('obsidian · sanitizePathSegment', () => {
  it('替换文件系统非法字符', () => {
    expect(sanitizePathSegment('A/B:C*D?E')).toBe('A_B_C_D_E')
    expect(sanitizePathSegment('a<b>c|d"e')).toBe('a_b_c_d_e')
  })

  it('拒绝 . 与 .. 这类有路径语义的名字', () => {
    expect(sanitizePathSegment('.')).toBe('')
    expect(sanitizePathSegment('..')).toBe('')
  })

  it('去掉结尾的点（Windows 会静默剥离）', () => {
    expect(sanitizePathSegment('report...')).toBe('report')
  })

  it('空与纯空白返回空串', () => {
    expect(sanitizePathSegment('')).toBe('')
    expect(sanitizePathSegment('   ')).toBe('')
  })
})

describe('obsidian · isAbsolutePath', () => {
  it('识别 POSIX / 盘符 / UNC', () => {
    expect(isAbsolutePath('/etc')).toBe(true)
    expect(isAbsolutePath('C:/Users/x')).toBe(true)
    expect(isAbsolutePath('C:\\Users\\x')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share')).toBe(true)
  })

  it('相对路径不算绝对路径', () => {
    expect(isAbsolutePath('notes')).toBe(false)
    expect(isAbsolutePath('notes/papers')).toBe(false)
    expect(isAbsolutePath('')).toBe(false)
  })
})

describe('obsidian · sanitizeSubfolder', () => {
  it('保留正常子目录并统一分隔符', () => {
    expect(sanitizeSubfolder('AI Network Lab')).toBe('AI Network Lab')
    expect(sanitizeSubfolder('notes/papers')).toBe('notes/papers')
    expect(sanitizeSubfolder('notes\\papers')).toBe('notes/papers')
    expect(sanitizeSubfolder('  a / b  ')).toBe('a/b')
  })

  it('丢弃 . 与 .. 片段，杜绝逃出 vault', () => {
    expect(sanitizeSubfolder('../escape')).toBe('escape')
    expect(sanitizeSubfolder('a/../../b')).toBe('a/b')
    expect(sanitizeSubfolder('..')).toBe('')
    expect(sanitizeSubfolder('./..')).toBe('')
  })

  it('绝对路径整体判为非法', () => {
    expect(sanitizeSubfolder('/etc/passwd')).toBe('')
    expect(sanitizeSubfolder('C:\\Windows\\System32')).toBe('')
    expect(sanitizeSubfolder('\\\\server\\share')).toBe('')
  })

  it('空串保持空串（表示直接写 vault 根目录）', () => {
    expect(sanitizeSubfolder('')).toBe('')
  })
})

describe('obsidian · isSafeRelativePath', () => {
  it('接受干净的相对路径', () => {
    expect(isSafeRelativePath('a.md')).toBe(true)
    expect(isSafeRelativePath('notes/a.md')).toBe(true)
  })

  it('拒绝穿越、绝对路径与控制字符', () => {
    expect(isSafeRelativePath('..')).toBe(false)
    expect(isSafeRelativePath('a/../b')).toBe(false)
    expect(isSafeRelativePath('/abs')).toBe(false)
    expect(isSafeRelativePath('C:/abs')).toBe(false)
    expect(isSafeRelativePath('a\u0000b')).toBe(false)
    expect(isSafeRelativePath('')).toBe(false)
  })
})

describe('obsidian · resolveInsideVault（写入 vault 的唯一安全边界）', () => {
  const root = path.resolve('tmp-vault-root')

  it('正常相对路径解析到 vault 内', () => {
    expect(resolveInsideVault(root, 'notes')).toBe(path.join(root, 'notes'))
    expect(resolveInsideVault(root, 'a/b')).toBe(path.join(root, 'a', 'b'))
  })

  it('越界一律返回 null', () => {
    expect(resolveInsideVault(root, '..')).toBeNull()
    expect(resolveInsideVault(root, '../evil')).toBeNull()
    expect(resolveInsideVault(root, 'notes/../../evil')).toBeNull()
    expect(resolveInsideVault(root, 'a/../b')).toBeNull()
    expect(resolveInsideVault(root, '/etc')).toBeNull()
    expect(resolveInsideVault(root, 'C:\\Windows')).toBeNull()
    expect(resolveInsideVault(root, '')).toBeNull()
  })

  it('解析结果永远以 vault 根目录为前缀', () => {
    for (const rel of ['a', 'a/b', 'notes/papers/2024', 'x.md']) {
      const out = resolveInsideVault(root, rel)
      expect(out).not.toBeNull()
      expect(out!.startsWith(root + path.sep)).toBe(true)
    }
  })
})

describe('obsidian · isSafeNoteFileName', () => {
  it('接受单段 .md 文件名', () => {
    expect(isSafeNoteFileName('笔记.md')).toBe(true)
    expect(isSafeNoteFileName('Note 1.MD')).toBe(true)
  })

  it('拒绝非 md、带分隔符、穿越与空名', () => {
    expect(isSafeNoteFileName('a.pdf')).toBe(false)
    expect(isSafeNoteFileName('dir/a.md')).toBe(false)
    expect(isSafeNoteFileName('dir\\a.md')).toBe(false)
    expect(isSafeNoteFileName('../a.md')).toBe(false)
    expect(isSafeNoteFileName('')).toBe(false)
  })
})

describe('obsidian · obsidianFileName', () => {
  it('非法字符替换为下划线并补 .md', () => {
    expect(obsidianFileName('A/B:C')).toBe('A_B_C.md')
    expect(obsidianFileName('复杂 标题?')).toBe('复杂 标题_.md')
  })

  it('空标题兜底为 untitled', () => {
    expect(obsidianFileName('')).toBe('untitled.md')
    expect(obsidianFileName('   ')).toBe('untitled.md')
  })

  it('超长标题截断到 80 字符（不含扩展名）', () => {
    const long = 'x'.repeat(200)
    const out = obsidianFileName(long)
    expect(out.endsWith('.md')).toBe(true)
    expect(out.length).toBe(80 + 3)
  })
})

describe('obsidian · dedupeFileNames', () => {
  it('同名笔记追加短 id，互不覆盖', () => {
    const out = dedupeFileNames([
      { id: 'abcdef123456', filename: 'same.md' },
      { id: 'zzzzzz999999', filename: 'same.md' },
      { id: 'other0000000', filename: 'other.md' },
    ])
    expect(out[0]).toBe('same.md')
    expect(out[1]).toBe('same-999999.md')
    expect(out[2]).toBe('other.md')
    expect(new Set(out).size).toBe(3)
  })

  it('无 id 时用序号兜底', () => {
    const out = dedupeFileNames([{ filename: 'a.md' }, { filename: 'a.md' }])
    expect(out[0]).toBe('a.md')
    expect(out[1]).not.toBe('a.md')
    expect(new Set(out).size).toBe(2)
  })

  it('大小写不同视为同名（避免 Windows 上互相覆盖）', () => {
    const out = dedupeFileNames([{ filename: 'A.md' }, { filename: 'a.md' }])
    expect(new Set(out).size).toBe(2)
  })
})

describe('obsidian · normalizeObsidianConfig', () => {
  it('解析 JSON 字符串输入', () => {
    const cfg = normalizeObsidianConfig(
      JSON.stringify({ vaultPath: 'D:/Obsidian/V', subfolder: 'notes', enabled: false }),
    )
    expect(cfg).toEqual({ vaultPath: 'D:/Obsidian/V', subfolder: 'notes', enabled: false })
  })

  it('脏数据兜底到默认值', () => {
    expect(normalizeObsidianConfig('not json')).toEqual(DEFAULT_OBSIDIAN_CONFIG)
    expect(normalizeObsidianConfig(null)).toEqual(DEFAULT_OBSIDIAN_CONFIG)
    expect(normalizeObsidianConfig({})).toEqual(DEFAULT_OBSIDIAN_CONFIG)
  })

  it('非法子目录兜底到默认子目录', () => {
    const cfg = normalizeObsidianConfig({ vaultPath: '/v', subfolder: 'C:\\evil' })
    expect(cfg.subfolder).toBe(DEFAULT_OBSIDIAN_SUBFOLDER)
  })

  it('显式空子目录表示写 vault 根目录，不被兜底覆盖', () => {
    const cfg = normalizeObsidianConfig({ vaultPath: '/v', subfolder: '' })
    expect(cfg.subfolder).toBe('')
  })

  it('穿越型子目录被净化而非被拒绝', () => {
    const cfg = normalizeObsidianConfig({ vaultPath: '/v', subfolder: '../out' })
    expect(cfg.subfolder).toBe('out')
  })
})

describe('obsidian · isObsidianReady', () => {
  it('需要同时满足 enabled 且已配置路径', () => {
    expect(isObsidianReady({ vaultPath: '/v', subfolder: 'x', enabled: true })).toBe(true)
    expect(isObsidianReady({ vaultPath: '/v', subfolder: 'x', enabled: false })).toBe(false)
    expect(isObsidianReady({ vaultPath: '', subfolder: 'x', enabled: true })).toBe(false)
    expect(isObsidianReady({ vaultPath: '   ', subfolder: 'x', enabled: true })).toBe(false)
  })
})
