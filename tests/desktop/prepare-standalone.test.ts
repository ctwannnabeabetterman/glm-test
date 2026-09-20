import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/**
 * desktop/prepare-standalone.js 的符号链接闸门。
 *
 * 为什么需要这个文件（2026-09-18 复盘）
 * ------------------------------------
 * 1.3.3 这个版本**对所有用户都装不起来**，而且骗过了当时所有的检查。根因是一条链：
 *
 *   Next 的 outputFileTracing 在 `.next/standalone/.next/node_modules/` 下为被外部化的
 *   依赖建了**指向构建机项目根 node_modules 的绝对符号链接**，1.3.3 的包里是这两条：
 *     `.next/node_modules/pdfkit-<hash>`         -> `//?/D:/a/glm-test/glm-test/node_modules/pdfkit`
 *     `.next/node_modules/@prisma/client-<hash>` -> `//?/D:/a/glm-test/glm-test/node_modules/@prisma/client`
 *   （`D:/a/<org>/<repo>` 是 GitHub Actions windows runner 的固定工作目录。）
 *
 *   bsdtar 把符号链接**原样**存进 zip。用户机器上 `D:/a/glm-test/...` 不存在 ⇒ 解压时建不出
 *   链接 ⇒ **退化成 0 字节空文件**。于是：
 *     require('@prisma/client-<hash>') 拿到空模块
 *     → `TypeError: r.PrismaClient is not a constructor`
 *     → `GET /api/settings/llm` 裸 500（这条路由没有 try/catch）
 *     → 壳层探针 waitForServer() 只认 statusCode < 500，永远等不到成功
 *     → 90 秒后弹「内部服务启动超时」，应用退出。
 *
 * ⚠️ 这个故障**骗过了字节级校验**：把 app.zip 解到干净目录再逐文件对 SHA-256 会得到
 * 「完全一致」—— 因为两边同样是 0 字节空文件，哈希当然相同。只有**真的把服务跑起来**
 * （探一次 /api/settings/llm）才会暴露。所以别再拿「文件都在、哈希都对」证明包是好的。
 *
 * 修法是双向的：`dereferenceSymlinks()` 在打包前把链接落成真实副本，`packStandalone()`
 * 里再对**最终 zip** 做一次硬断言。这个文件守住这两道别退化。
 */
const nodeRequire = createRequire(import.meta.url)
const ps = nodeRequire('../../desktop/prepare-standalone.js') as {
  dereferenceSymlinks: (root?: string) => { replaced: number; broken: string[] }
  assertNoBrokenLinks: (r: { broken: string[] }) => void
  findSymlinkEntries: (listing: string) => string[]
  listZip: (zip: string) => string
  pruneLinkedDeps: (root?: string) => { removed: number; freed: number }
  collectRequireClosure: (dir: string, entry: string) => Set<string> | null
  isDeadPdfkitAsset: (name: string) => boolean
  dirSize: (p: string) => number
}

/** 1.3.3 那份 app.zip 里 `tar -tvf` 的真实输出（含目录行、普通文件行、两条链接行） */
const REAL_133_LISTING = [
  'drwxr-xr-x  0 0      0           0 9月 17 19:14 .next/',
  'drwxr-xr-x  0 0      0           0 9月 17 19:14 .next/node_modules/',
  'lrw-rw-rw-  0 0      0           0 9月 17 19:14 .next/node_modules/pdfkit-d5967b64ee09fcf0 -> //?/D:/a/glm-test/glm-test/node_modules/pdfkit',
  'lrw-rw-rw-  0 0      0           0 9月 17 19:14 .next/node_modules/@prisma/client-2c3a283f134fdcb6 -> //?/D:/a/glm-test/glm-test/node_modules/@prisma/client',
  '-rw-rw-rw-  0 0      0        7721 9月 17 19:14 server.js',
  '-rw-rw-rw-  0 0      0      524288 9月 17 19:14 .next/node_modules/@prisma/client-2c3a283f134fdcb6/runtime/query_engine-windows.dll.node',
  'drwxr-xr-x  0 0      0           0 9月 17 19:14 .next/node_modules/next/',
].join('\n')

const tmpDirs: string[] = []
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-ps-'))
  tmpDirs.push(root)

  // 「构建机上的 node_modules」——符号链接的真实目标，位于 standalone 之外
  const real = path.join(root, 'real', 'client')
  fs.mkdirSync(path.join(real, 'runtime'), { recursive: true })
  fs.writeFileSync(path.join(real, 'package.json'), '{"name":"@prisma/client"}')
  fs.writeFileSync(path.join(real, 'default.js'), 'module.exports = { PrismaClient: class {} }')
  fs.writeFileSync(path.join(real, 'runtime', 'query_engine-windows.dll.node'), Buffer.alloc(4096, 7))

  const standalone = path.join(root, 'standalone')
  const nm = path.join(standalone, '.next', 'node_modules')
  fs.mkdirSync(nm, { recursive: true })
  fs.mkdirSync(path.join(standalone, 'node_modules', '@prisma'), { recursive: true })

  // 用 junction 造夹具：Windows 上不需要管理员权限，且 Node 的 lstat().isSymbolicLink()
  // 对 junction 同样返回 true，与本例关心的「重解析点」语义一致
  fs.symlinkSync(real, path.join(nm, 'client-2c3a283f134fdcb6'), 'junction')

  // 断链：先建再删目标，模拟「构建机路径在用户机器上不存在」
  const gone = path.join(root, 'real', 'gone')
  fs.mkdirSync(gone)
  fs.symlinkSync(gone, path.join(nm, 'broken-abcdef'), 'junction')
  fs.rmSync(gone, { recursive: true, force: true })

  return { root, standalone, nm, real }
}

afterEach(() => {
  vi.restoreAllMocks()
  while (tmpDirs.length) {
    const d = tmpDirs.pop()
    if (d) fs.rmSync(d, { recursive: true, force: true })
  }
})

describe('findSymlinkEntries：从 bsdtar 输出里认出符号链接', () => {
  it('识别 1.3.3 真实产物里的那两条构建机路径链接（回归指纹）', () => {
    const links = ps.findSymlinkEntries(REAL_133_LISTING)

    expect(links).toHaveLength(2)
    expect(links[0]).toContain('pdfkit-d5967b64ee09fcf0')
    expect(links[0]).toContain('//?/D:/a/glm-test/glm-test/node_modules/pdfkit')
    expect(links[1]).toContain('@prisma/client-2c3a283f134fdcb6')
  })

  it('不误伤目录行与普通文件行', () => {
    expect(ps.findSymlinkEntries(REAL_133_LISTING).join('\n')).not.toContain('server.js')
    expect(ps.findSymlinkEntries('')).toEqual([])
    expect(ps.findSymlinkEntries('-rw-rw-rw-  0 0 0 100 9月 17 19:14 a/b.js')).toEqual([])
    expect(ps.findSymlinkEntries('drwxr-xr-x  0 0 0 0 9月 17 19:14 a/')).toEqual([])
  })
})

describe('dereferenceSymlinks：把链接落成真实副本', () => {
  it('链接被替换成真实内容，且真实目标本身不被破坏', () => {
    const { standalone, nm, real } = makeFixture()
    const link = path.join(nm, 'client-2c3a283f134fdcb6')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)

    const { replaced, broken } = ps.dereferenceSymlinks(standalone)

    expect(replaced).toBe(1)
    expect(broken).toHaveLength(1)

    // 链接没了，换成真目录
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false)
    expect(fs.statSync(link).isDirectory()).toBe(true)
    // 内容（含嵌套的 runtime 引擎文件）完整落地
    expect(fs.readFileSync(path.join(link, 'default.js'), 'utf8')).toContain('PrismaClient')
    expect(fs.statSync(path.join(link, 'runtime', 'query_engine-windows.dll.node')).size).toBe(4096)
    expect(fs.readFileSync(path.join(link, 'package.json'), 'utf8')).toContain('@prisma/client')

    // ⚠️ 关键安全性质：删链接不能连坐真实 node_modules —— 否则 cpSync 会拷到一份空目录，
    //    那正是「包看起来完整、跑起来 PrismaClient is not a constructor」的复现路径
    expect(fs.existsSync(path.join(real, 'default.js'))).toBe(true)
    expect(fs.statSync(path.join(real, 'runtime', 'query_engine-windows.dll.node')).size).toBe(4096)
  })

  it('断链被单独列出来而不是悄悄删掉，且不会被误算成已修复', () => {
    const { standalone, nm } = makeFixture()
    const brokenLink = path.join(nm, 'broken-abcdef')

    const { replaced, broken } = ps.dereferenceSymlinks(standalone)

    expect(replaced).toBe(1)
    expect(broken).toHaveLength(1)
    expect(broken[0].replace(/\\/g, '/')).toBe('.next/node_modules/broken-abcdef')
    // 保留原样：删掉它就变成 Cannot find module，必须让打包显式失败。
    // 注意这里**不能**用 existsSync —— 它跟随链接，断链恒为 false，会把「链接还在」误判成「被删了」。
    expect(fs.lstatSync(brokenLink).isSymbolicLink()).toBe(true)
  })

  it('没有链接时是空操作', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-ps-clean-'))
    tmpDirs.push(root)
    fs.mkdirSync(path.join(root, 'a', 'b'), { recursive: true })
    fs.writeFileSync(path.join(root, 'a', 'b', 'c.js'), 'x')

    expect(ps.dereferenceSymlinks(root)).toEqual({ replaced: 0, broken: [] })
  })
})

describe('assertNoBrokenLinks：断链一律拒绝出包', () => {
  it('有断链时以退出码 1 终止（宁可打包失败，也不能再发一个所有用户都装不起来的包）', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('__process_exit__')
    }) as never)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => ps.assertNoBrokenLinks({ broken: ['.next/node_modules/broken-abcdef'] })).toThrow(
      '__process_exit__',
    )
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('无断链时放行', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never)
    expect(() => ps.assertNoBrokenLinks({ broken: [] })).not.toThrow()
    expect(exit).not.toHaveBeenCalled()
  })
})

// resources/ 被 .gitignore 忽略，CI 上没有这个文件；本地跑过一次 desktop:prepare 才会有
const LOCAL_ZIP = path.join(process.cwd(), 'resources', 'app.zip')

describe('listZip：对真实 bsdtar 产物的端到端读取', () => {
  it.skipIf(!fs.existsSync(LOCAL_ZIP))('能读出真实 app.zip 的条目，两条判据结果一致', () => {
    const listing = ps.listZip(LOCAL_ZIP)

    expect(listing).toContain('server.js')
    expect(listing).toContain('.next/node_modules')

    // 首字符 l 与 " -> " 两条判据必须一致，否则闸门会漏掉一半
    const byFirstChar = listing.split(/\r?\n/).filter((l) => l.startsWith('l')).length
    expect(ps.findSymlinkEntries(listing)).toHaveLength(byFirstChar)
  })
})

/* ══════════════════════════════════════════════════════════════════════════
 * pruneLinkedDeps / collectRequireClosure —— 解引用后的死文件裁剪
 * ══════════════════════════════════════════════════════════════════════════
 *
 * 为什么需要单独守这一层（2026-09-20 体积体检）：
 *
 * `pruneStandalone()` 跑在 `dereferenceSymlinks()` **之前**，而 `fs.readdirSync` 不穿透
 * 符号链接（读出来是空的）⇒ 链接目录里的废料完全躲过第一轮清理。紧接着 dereference
 * 把链接目标**整个**复制回来，于是打包产物里又出现了：
 *   · `@prisma/client-<hash>/runtime/` 73.4 MB —— 5 种数据库 × 2 种模块格式的
 *     `*.wasm-base64.*`、4 套平台 runtime（edge / wasm-engine-edge / binary / react-native）与全部 sourcemap；
 *   · `pdfkit-<hash>` 11.1 MB —— 里面居然有 `.yarn/releases/yarn-4.16.0.cjs`（2.9 MB）这类构建工具链。
 * 合计约 87 MB，属于「清理日志显示已清理、产物却依旧臃肿」的典型静默失败。
 *
 * 判据是**从真实入口出发的 require 可达闭包**（Prisma）与**保守白名单**（pdfkit）：
 *   · Prisma 生成的 `.prisma/client/index.js` 只 require `@prisma/client/runtime/library.js`，
 *     而 `library.js` 的 require 全是 node: 内置模块 ⇒ runtime 目录里只留它一个。
 *   · pdfkit 的 `js/pdfkit.js` 有运行时 `fs.readFileSync('./data/*.icc')`，静态 require 图
 *     **看不见**这类读取，所以绝不能对 pdfkit 用闭包裁剪 —— 只删构建工具链与备用入口。
 */
describe('collectRequireClosure：静态解析相对 require', () => {
  function closureFixture(files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-closure-'))
    tmpDirs.push(dir)
    for (const [name, content] of Object.entries(files)) {
      const fp = path.join(dir, name)
      fs.mkdirSync(path.dirname(fp), { recursive: true })
      fs.writeFileSync(fp, content)
    }
    return dir
  }

  it('沿 require 链收集同目录可达文件，忽略裸模块名', () => {
    const dir = closureFixture({
      'entry.js': "const a = require('./a')\nconst fs = require('node:fs')\nrequire('some-pkg')",
      'a.js': "module.exports = require('./sub/b')",
      'sub/b.js': 'module.exports = 1',
      'dead.js': 'module.exports = 2',
    })

    expect(ps.collectRequireClosure(dir, 'entry.js')).toEqual(
      new Set(['entry.js', 'a.js', 'sub/b.js']),
    )
  })

  it('识别 import(...) 形式的动态导入', () => {
    const dir = closureFixture({
      'entry.mjs': "export const x = import('./lazy.mjs')",
      'lazy.mjs': 'export const y = 1',
      'dead.mjs': 'export const z = 2',
    })

    expect(ps.collectRequireClosure(dir, 'entry.mjs')).toEqual(new Set(['entry.mjs', 'lazy.mjs']))
  })

  /**
   * ⚠️ 这条是「目录形式 require」的回归守卫。
   *
   * `require('./sub')` 在 Node 里会解析到 `sub/index.js`。如果解析器不认识这种形式，
   * 就会把它判成「解析不到」而**跳过** —— 而调用方是按 `keep` 之外一律
   * `rmSync(..., {recursive: true})` 删除的，于是 `sub/` 整个目录会被删掉，
   * 产物里少一个模块但打包日志一切正常。
   */
  it('能解析目录形式的 require（index.js 与 package.json main）', () => {
    const dir = closureFixture({
      'entry.js': "require('./byIndex')\nrequire('./byMain')",
      'byIndex/index.js': 'module.exports = 1',
      'byIndex/other.js': 'module.exports = 2',
      'byMain/package.json': '{"main":"lib/start.js"}',
      'byMain/lib/start.js': 'module.exports = 3',
    })

    expect(ps.collectRequireClosure(dir, 'entry.js')).toEqual(
      new Set([
        'entry.js',
        'byIndex/index.js',
        'byMain/package.json',
        'byMain/lib/start.js',
      ]),
    )
  })

  /**
   * ⚠️ 核心安全性质：**相对**依赖解析不到时必须整体放弃裁剪，而不是「跳过它继续删」。
   *
   * 因为调用方会删除 `keep` 之外的所有条目（且是递归删除）。解析不到就意味着
   * 「我判断不了这个目录里什么还需要」，此时唯一安全的选择是不裁。
   */
  it('相对依赖解析不到时返回 null（宁可多留，也不赌）', () => {
    const dir = closureFixture({
      'entry.js': "require('./does-not-exist')",
      'bystander.js': 'module.exports = 1',
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(ps.collectRequireClosure(dir, 'entry.js')).toBeNull()
  })

  it('入口本身不存在时返回 null，而不是抛异常', () => {
    const dir = closureFixture({ 'x.js': 'module.exports = 1' })
    expect(ps.collectRequireClosure(dir, 'nope.js')).toBeNull()
  })

  it('越界引用（../ 跑到 dir 之外）视为解析不到', () => {
    const dir = closureFixture({
      'sub/entry.js': "require('../../outside')",
    })
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    // outside 不在 dir 内 ⇒ 不属于本目录裁剪范围 ⇒ 放弃裁剪
    expect(ps.collectRequireClosure(dir, 'sub/entry.js')).toBeNull()
  })
})

describe('isDeadPdfkitAsset：pdfkit 里哪些文件可以删', () => {
  it.each([
    'pdfkit.browser.js',
    'pdfkit.browser.mjs',
    'pdfkit.browser.old.js',
    'pdfkit.browser.old.mjs',
    'pdfkit.old.js',
    'pdfkit.standalone.js',
    'pdfkit.js.map',
    'pdfkit.node.mjs.map',
    'pdfkit.browser.js.map',
    'index.d.ts',
  ])('构建工具链/备用入口/sourcemap 判为可删：%s', (name) => {
    expect(ps.isDeadPdfkitAsset(name)).toBe(true)
  })

  it.each([
    'pdfkit.js',
    'pdfkit.node.mjs',
    'output.cjs',
    'output.mjs',
    'Helvetica.afm',
    'sRGB_IEC61966_2_1.icc',
    'Helvetica.cjs',
  ])('运行时需要的文件必须保留：%s', (name) => {
    expect(ps.isDeadPdfkitAsset(name)).toBe(false)
  })
})

describe('pruneLinkedDeps：解引用之后的死文件裁剪', () => {
  /** 造一个带 Prisma 与 pdfkit 的目录树，形如解引用后的 standalone */
  function linkedFixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-linked-'))
    tmpDirs.push(root)

    // ── Prisma：顶层入口 + runtime 目录（library.js 可达，其余是死重） ──
    const prismaClient = path.join(root, 'node_modules', '@prisma', 'client')
    fs.mkdirSync(path.join(prismaClient, 'runtime'), { recursive: true })
    fs.writeFileSync(path.join(prismaClient, 'default.js'), "module.exports = require('#main-entry-point')")
    fs.writeFileSync(path.join(prismaClient, 'package.json'), '{"name":"@prisma/client"}')
    fs.writeFileSync(
      path.join(prismaClient, 'runtime', 'library.js'),
      "const fs = require('node:fs')\nconst u = require('./helpers/util')\nmodule.exports = {}",
    )
    // 必需的嵌套模块：用来守住「按顶层名比较会连坐删掉父目录」这个坑
    fs.mkdirSync(path.join(prismaClient, 'runtime', 'helpers'), { recursive: true })
    fs.writeFileSync(path.join(prismaClient, 'runtime', 'helpers', 'util.js'), 'module.exports = {}')
    // 不该被保留的兄弟目录（用于确认裁剪确实在干活）
    fs.mkdirSync(path.join(prismaClient, 'runtime', 'dead-dir'), { recursive: true })
    fs.writeFileSync(path.join(prismaClient, 'runtime', 'dead-dir', 'x.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(prismaClient, 'runtime', 'edge.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(prismaClient, 'runtime', 'binary.js'), 'module.exports = {}')
    fs.writeFileSync(
      path.join(prismaClient, 'runtime', 'query_engine_bg.sqlite.wasm-base64.js'),
      'A'.repeat(4096),
    )
    fs.writeFileSync(path.join(prismaClient, 'runtime', 'library.js.map'), '{}')

    // ── 带 hash 的外部化副本（standalone 特有） ──
    const hashed = path.join(root, '.next', 'node_modules', '@prisma', 'client-abc123def456abcd')
    fs.mkdirSync(path.join(hashed, 'runtime'), { recursive: true })
    fs.writeFileSync(path.join(hashed, 'runtime', 'library.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(hashed, 'runtime', 'query_engine_bg.mysql.wasm-base64.mjs'), 'B'.repeat(2048))

    // ── pdfkit：构建工具链 + 数据目录 ──
    const pdfkit = path.join(root, '.next', 'node_modules', 'pdfkit-d5967b64ee09fcf0')
    fs.mkdirSync(path.join(pdfkit, 'js', 'data'), { recursive: true })
    fs.mkdirSync(path.join(pdfkit, '.yarn', 'releases'), { recursive: true })
    fs.mkdirSync(path.join(pdfkit, 'tools'), { recursive: true })
    fs.writeFileSync(path.join(pdfkit, 'js', 'pdfkit.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(pdfkit, 'js', 'pdfkit.node.mjs'), 'export default {}')
    fs.writeFileSync(path.join(pdfkit, 'js', 'pdfkit.browser.js'), 'X'.repeat(1024))
    fs.writeFileSync(path.join(pdfkit, 'js', 'pdfkit.js.map'), '{}')
    fs.writeFileSync(path.join(pdfkit, 'js', 'data', 'sRGB_IEC61966_2_1.icc'), 'ICC')
    fs.writeFileSync(path.join(pdfkit, 'js', 'data', 'Helvetica.afm'), 'AFM')
    fs.writeFileSync(path.join(pdfkit, '.yarn', 'releases', 'yarn-4.16.0.cjs'), 'Y'.repeat(8192))
    fs.writeFileSync(path.join(pdfkit, 'tools', 'afm-converter.js'), 'tool')
    fs.writeFileSync(path.join(pdfkit, 'package.json'), '{"name":"pdfkit"}')

    return { root, prismaClient, hashed, pdfkit }
  }

  it('Prisma runtime 只保留可达闭包，顶层入口一根汗毛都不动', () => {
    const { root, prismaClient, hashed } = linkedFixture()

    ps.pruneLinkedDeps(root)

    // runtime 里只剩 library.js 与它真正 require 的 helpers/ 目录
    expect(fs.readdirSync(path.join(prismaClient, 'runtime')).sort()).toEqual(['helpers', 'library.js'])
    expect(fs.readdirSync(path.join(hashed, 'runtime'))).toEqual(['library.js'])

    // ⚠️ 嵌套依赖必须完整存活 —— 只按顶层名比较会把 helpers/ 整个删掉
    expect(fs.existsSync(path.join(prismaClient, 'runtime', 'helpers', 'util.js'))).toBe(true)
    // 确认裁剪确实在干活（兄弟目录被清掉）
    expect(fs.existsSync(path.join(prismaClient, 'runtime', 'dead-dir'))).toBe(false)

    // ⚠️ 顶层入口必须完好 —— 删了就是 Cannot find module / PrismaClient is not a constructor
    expect(fs.existsSync(path.join(prismaClient, 'default.js'))).toBe(true)
    expect(fs.existsSync(path.join(prismaClient, 'package.json'))).toBe(true)
  })

  it('pdfkit 只删构建工具链与备用入口，数据目录必须保留', () => {
    const { root, pdfkit } = linkedFixture()

    ps.pruneLinkedDeps(root)

    // 删掉的
    expect(fs.existsSync(path.join(pdfkit, '.yarn'))).toBe(false)
    expect(fs.existsSync(path.join(pdfkit, 'tools'))).toBe(false)
    expect(fs.existsSync(path.join(pdfkit, 'js', 'pdfkit.browser.js'))).toBe(false)
    expect(fs.existsSync(path.join(pdfkit, 'js', 'pdfkit.js.map'))).toBe(false)

    // ⚠️ 保留的：js/pdfkit.js 会在运行时 fs.readFileSync 这些数据文件，
    //    静态 require 图看不见，删了是隐蔽的运行时故障
    expect(fs.existsSync(path.join(pdfkit, 'js', 'pdfkit.js'))).toBe(true)
    expect(fs.existsSync(path.join(pdfkit, 'js', 'pdfkit.node.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(pdfkit, 'js', 'data', 'sRGB_IEC61966_2_1.icc'))).toBe(true)
    expect(fs.existsSync(path.join(pdfkit, 'js', 'data', 'Helvetica.afm'))).toBe(true)
    expect(fs.existsSync(path.join(pdfkit, 'package.json'))).toBe(true)
  })

  it('闭包解析失败时保持原样，一个文件都不删', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-linked-bad-'))
    tmpDirs.push(root)
    const runtime = path.join(root, 'node_modules', '@prisma', 'client', 'runtime')
    fs.mkdirSync(runtime, { recursive: true })
    // library.js 缺失 ⇒ 无法建立闭包 ⇒ 必须放弃裁剪
    fs.writeFileSync(path.join(runtime, 'edge.js'), 'module.exports = {}')
    fs.writeFileSync(path.join(runtime, 'binary.js'), 'module.exports = {}')
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = ps.pruneLinkedDeps(root)

    expect(res.removed).toBe(0)
    expect(fs.readdirSync(runtime).sort()).toEqual(['binary.js', 'edge.js'])
  })

  it('目录不存在时是空操作，不抛异常', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'anl-linked-empty-'))
    tmpDirs.push(root)
    expect(ps.pruneLinkedDeps(root)).toEqual({ removed: 0, freed: 0 })
  })

  it('返回的回收量与实际减少的字节数一致', () => {
    const { root } = linkedFixture()
    const before = ps.dirSize(root)

    const res = ps.pruneLinkedDeps(root)

    expect(ps.dirSize(root)).toBe(before - res.freed)
    expect(res.freed).toBeGreaterThan(0)
  })
})
