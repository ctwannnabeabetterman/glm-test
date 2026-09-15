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
  const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1)
  console.log(`[desktop] packed standalone -> ${path.relative(ROOT, zip)} (${mb} MB)`)
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

async function main() {
  assertStandaloneBuilt()
  copyInto(path.join(ROOT, 'public'), path.join(STANDALONE, 'public'))
  copyInto(path.join(ROOT, '.next', 'static'), path.join(STANDALONE, '.next', 'static'))
  await makeDbTemplate()
  await packStandalone()
  console.log('[desktop] prepare done.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
