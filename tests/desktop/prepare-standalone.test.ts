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
