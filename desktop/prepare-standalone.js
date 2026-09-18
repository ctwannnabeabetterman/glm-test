#!/usr/bin/env node
/**
 * 桌面端打包前置准备：
 *  1. 校验 .next/standalone 存在（需先 npm run build）
 *  2. 把 public/ 与 .next/static 拷入 standalone（Next 官方要求的手工步骤）
 *  3. 用当前 schema 生成「空白但结构完整」的 SQLite 模板 → resources/db-template/custom.db
 *     （打包后首次启动复制到用户数据目录；示例数据由应用自身首访 seed 流程写入）
 */

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const STANDALONE = path.join(ROOT, '.next', 'standalone')

function assertStandaloneBuilt() {
  if (!fs.existsSync(path.join(STANDALONE, 'server.js'))) {
    console.error('[desktop] 缺少 .next/standalone —— 请先执行 npm run build')
    process.exit(1)
  }
}

function copyInto(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.cpSync(from, to, { recursive: true })
  console.log(`[desktop] copied ${path.relative(ROOT, from)} -> ${path.relative(ROOT, to)}`)
}

async function makeDbTemplate() {
  const dir = path.join(ROOT, 'resources', 'db-template')
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  const dbFile = path.join(dir, 'custom.db')
  if (fs.existsSync(dbFile)) fs.rmSync(dbFile)
  // Prisma's Windows engine can fail opening a nonexistent SQLite file.
  fs.writeFileSync(dbFile, '')
  // 相对路径按 Prisma 约定解析到 schema 目录，因此用绝对路径
  const url = 'file:' + dbFile.replace(/\\/g, '/')
  execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'db', 'push', '--skip-generate'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  })
  console.log(`[desktop] db template ready: ${path.relative(ROOT, dbFile)} (${fs.statSync(dbFile).size} bytes)`)
}

async function packStandalone() {
  pruneStandalone()
  assertNoBrokenLinks(dereferenceSymlinks())
  // electron-builder 对 extraResources 中名为 node_modules 的目录会做依赖收集式过滤，
  // 导致 standalone 的依赖层丢失；因此压成单文件随包携带，由桌面壳层首次启动时自解压。
  const dir = path.join(ROOT, 'resources')
  fs.mkdirSync(dir, { recursive: true })
  const zip = path.join(dir, 'app.zip')
  if (fs.existsSync(zip)) fs.rmSync(zip)
  // 必须用 Windows 自带 bsdtar：Git Bash 的 tar 会把 "E:" 当成远程主机
  const tarExe = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
  execFileSync(tarExe, [
    '-a', '-cf', zip,
    'server.js', 'package.json', 'node_modules', '.next', 'public',
  ], { cwd: STANDALONE, stdio: 'pipe', windowsHide: true })
  // 最终产物级断言：宁可打包失败，也不能再发一个「所有用户都装不起来」的包
  const badLinks = findSymlinkEntries(listZip(zip))
  if (badLinks.length) {
    console.error(`[desktop] app.zip 里仍有 ${badLinks.length} 个符号链接条目：`)
    badLinks.slice(0, 10).forEach((x) => console.error('   ' + x))
    console.error('[desktop] 这些链接指向构建机路径，用户机器上会退化成 0 字节空文件，')
    console.error('[desktop] 进而让 @prisma/client 变成空模块、应用启动超时。拒绝出包。')
    process.exit(1)
  }
  const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1)
  console.log(`[desktop] packed standalone -> ${path.relative(ROOT, zip)} (${mb} MB)`)
  console.log('[desktop] 符号链接检查通过（0 条）')
}

/**
 * 把 .next/standalone 裁剪成「只含运行时真正需要的东西」。
 *
 * Next 的 outputFileTracing 会把项目根目录下的**一切**（含测试产物、旧安装包、文档）
 * 按需拷进 standalone，历史上曾把 366 MB 的 test-results 和 3 GB 的 release 拷进来。
 * 因此这里用**白名单**判断顶层条目：不在白名单里的一律删除——这样以后新增任何目录
 * 都不会再悄悄进入安装包，而白名单只需在真正新增运行时目录时才改。
 *
 * 另外裁掉几类确定的运行时废料（均由实测确认，非猜测）：
 *  - `*.tmp*`：Prisma 下载 native 引擎时的临时残留，曾占 40 MB
 *  - 非 sqlite 的 `*wasm-base64*`：Prisma 给 5 种数据库各生成一份 base64 WASM 引擎，
 *    本项目只用 SQLite；已核实 `.next/server/**\/*.js` 对 wasm-base64 零引用
 *  - `*.map` / `*.d.ts`：生产运行时不需要
 *
 * 注意：**不要**删除 `.next/node_modules/@prisma/client-<hash>` 与 `pdfkit-<hash>`。
 * 实测它们被 40 个编译后的 route.js 直接 require，删了会 Cannot find module。
 * ⚠️ 而且它们在 standalone 里是**指向构建机 node_modules 的绝对符号链接**，
 * 必须靠 `dereferenceSymlinks()` 落成真实副本后才能打包 —— 见那个函数的说明。
 */
function pruneStandalone() {
  const KEEP_TOP_LEVEL = new Set(['server.js', 'package.json', 'node_modules', '.next', 'public'])
  let freed = 0
  let removed = 0

  const sizeOf = (p) => {
    const st = fs.statSync(p, { throwIfNoEntry: false })
    if (!st) return 0
    if (st.isFile()) return st.size
    let t = 0
    for (const e of fs.readdirSync(p, { withFileTypes: true })) {
      t += sizeOf(path.join(p, e.name))
    }
    return t
  }
  const drop = (p) => {
    const s = sizeOf(p)
    fs.rmSync(p, { recursive: true, force: true })
    freed += s
    removed++
    return s
  }

  // ① 顶层白名单外的条目全部删除
  for (const name of fs.readdirSync(STANDALONE)) {
    if (KEEP_TOP_LEVEL.has(name)) continue
    const s = drop(path.join(STANDALONE, name))
    console.log(`[desktop] prune 顶层非运行时条目 ${name} (${(s / 1048576).toFixed(2)} MB)`)
  }

  // ② 递归裁掉运行时废料
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(fp)
        continue
      }
      const low = e.name.toLowerCase()
      const isTmp = low.includes('.tmp')
      const isForeignWasm = low.includes('wasm-base64') && !low.includes('sqlite')
      const isMap = low.endsWith('.map')
      const isTypes = low.endsWith('.d.ts') || low.endsWith('.d.mts') || low.endsWith('.d.cts')
      if (isTmp || isForeignWasm || isMap || isTypes) drop(fp)
    }
  }
  walk(path.join(STANDALONE, 'node_modules'))
  walk(path.join(STANDALONE, '.next'))

  console.log(`[desktop] prune 共移除 ${removed} 项，回收 ${(freed / 1048576).toFixed(1)} MB`)
}

/**
 * 把 standalone 里的符号链接替换成**真实副本**。
 *
 * 为什么必须做（2026-09-18 复盘：1.3.3 对**所有**用户都装不起来，且骗过了静态检查）
 *
 * Next 的 outputFileTracing 会在 `.next/node_modules/` 下为部分被外部化的依赖创建
 * **指向构建机项目根 node_modules 的绝对符号链接**。1.3.3 的包里实测就是这两条：
 *   `.next/node_modules/pdfkit-<hash>`          -> `//?/D:/a/glm-test/glm-test/node_modules/pdfkit`
 *   `.next/node_modules/@prisma/client-<hash>`  -> `//?/D:/a/glm-test/glm-test/node_modules/@prisma/client`
 * （`D:/a/<org>/<repo>` 是 GitHub Actions windows runner 的固定工作目录。）
 *
 * 而 bsdtar **默认把符号链接原样存进 zip**。用户机器上 `D:/a/glm-test/...` 根本不存在，
 * 解压时建不出这个链接 ⇒ **退化成 0 字节空文件**。于是多米诺：
 *   require('@prisma/client-<hash>') 拿到空模块
 *   → `TypeError: PrismaClient is not a constructor`
 *   → `GET /api/settings/llm` 返回 500（这条路由没有 try/catch，裸 500）
 *   → 壳层启动探针 `waitForServer()` 只认 `statusCode < 500`，永远等不到成功
 *   → 90 秒后弹「内部服务启动超时」，应用退出。
 *
 * ⚠️ 这个故障**能骗过字节级比对**：把 app.zip 解到干净目录再逐文件比 SHA-256 会得到
 * 「完全一致」—— 因为两边同样是 0 字节空文件。只有**真的把服务跑起来**才暴露
 * （见 tests/desktop/prepare-standalone.test.ts 的说明）。所以别再用「文件都在」证明包是好的。
 *
 * 断链不能一删了之（删掉就是 `Cannot find module`），必须显式报错终止打包。
 * 返回 `{ replaced, broken }`，由调用方决定怎么处置（便于单测）。
 */
function dereferenceSymlinks(rootDir = STANDALONE) {
  let replaced = 0
  const broken = []
  const rel = (p) => path.relative(rootDir, p) || p
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name)
      let lst
      try {
        lst = fs.lstatSync(fp)
      } catch {
        continue
      }
      if (lst.isSymbolicLink()) {
        let real = null
        try {
          real = fs.realpathSync(fp)
        } catch {
          real = null
        }
        if (!real || !fs.existsSync(real)) {
          broken.push(rel(fp))
          continue
        }
        fs.rmSync(fp, { recursive: true, force: true })
        fs.cpSync(real, fp, { recursive: true, dereference: true })
        replaced++
        console.log(`[desktop] dereference ${rel(fp)} -> ${real}`)
        continue
      }
      if (lst.isDirectory()) walk(fp)
    }
  }
  walk(rootDir)
  console.log(`[desktop] dereference 完成：替换 ${replaced} 个符号链接，断链 ${broken.length} 个`)
  return { replaced, broken }
}

/**
 * 打包前置的硬闸门：断链一律拒绝出包（断链被删掉就是 Cannot find module）。
 * 与 `packStandalone` 里的 zip 级断言分工：这条管「复制阶段」，那条管「最终产物」。
 */
function assertNoBrokenLinks({ broken }) {
  if (!broken.length) return
  console.error('[desktop] standalone 里存在断链，包不完整，拒绝继续：')
  broken.slice(0, 10).forEach((p) => console.error('   ' + p))
  process.exit(1)
}

/** 列出 zip 的详细条目（bsdtar -tvf）。失败即视为打包不可信。 */
function listZip(zip) {
  const tarExe = process.platform === 'win32' ? 'C:\\Windows\\System32\\tar.exe' : 'tar'
  try {
    return execFileSync(tarExe, ['-tvf', zip], { encoding: 'utf8', windowsHide: true })
  } catch (e) {
    console.error('[desktop] 无法列出 app.zip（打包结果不可信）：', e && e.message ? e.message : e)
    process.exit(1)
  }
}

/**
 * 从 `tar -tvf` 输出里挑出符号链接行。
 * bsdtar 对符号链接的首字符是 `l`，并且会在名称后追加 ` -> 目标`，两条判据一起用。
 */
function findSymlinkEntries(listing) {
  return String(listing || '')
    .split(/\r?\n/)
    .filter((line) => line.trim() && (line.startsWith('l') || line.includes(' -> ')))
}

async function main() {
  assertStandaloneBuilt()
  copyInto(path.join(ROOT, 'public'), path.join(STANDALONE, 'public'))
  copyInto(path.join(ROOT, '.next', 'static'), path.join(STANDALONE, '.next', 'static'))
  await makeDbTemplate()
  await packStandalone()
  console.log('[desktop] prepare done.')
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}

module.exports = {
  dereferenceSymlinks,
  assertNoBrokenLinks,
  findSymlinkEntries,
  listZip,
  pruneStandalone,
  packStandalone,
  STANDALONE,
}
