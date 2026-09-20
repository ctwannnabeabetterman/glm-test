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
  // ⚠️ 必须排在 dereference 之后：符号链接目录里的废料只有落成真实副本才看得见
  pruneLinkedDeps()
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
 *
 * ⚠️⚠️ **本函数跑在 dereferenceSymlinks() 之前，因此对符号链接目录是无效的**
 * （`fs.readdirSync` 不穿透链接，walk 进去看到的是空的）。历史上这造成一个很隐蔽的
 * 体积泄漏：`prune` 明明「清理过了」，可 dereference 随后把链接目标**整个**复制回来，
 * 于是打包产物里 `@prisma/client-<hash>/runtime/` 又变回 73.4 MB。
 * 所以符号链接目标目录里的废料必须交给**后置**的 `pruneLinkedDeps()` 处理。
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
 * 对**符号链接解引用之后**才存在的依赖做一次「闭包 / 规则裁剪」。
 *
 * 为什么需要独立一步：`pruneStandalone()` 早于 `dereferenceSymlinks()` 执行，
 * 而符号链接目录在 readdir 下表现为空，所以那里的废料躲过了第一轮清理；
 * dereference 一落成真实副本，它们就全都回来了（实测 87 MB）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 一、Prisma：用**可达性闭包**（判据来自实测，不是猜测）
 * ═══════════════════════════════════════════════════════════════════════════
 * 事实链（2026-09-19 实测，Prisma 6.19.3 / datasource = sqlite）：
 *   `.prisma/client/index.js`  →  `require('@prisma/client/runtime/library.js')`
 *   而 `library.js` 的全部 require 都是 Node 内置模块（node:fs / node:path / …），
 *   **不 require runtime 目录里的任何兄弟文件**。
 *   ⇒ `runtime/` 下 73.4 MB 里真正必需的是 `library.js` 一个文件（197.8 KB）。
 *   ⇒ 其余是 5 种数据库 × 2 种模块格式的 `*.wasm-base64.*`、四套平台 runtime
 *     （edge / wasm-engine-edge / binary / react-native）以及全部 sourcemap。
 *
 * 为什么能安全删 `wasm-base64`（含 sqlite 那份）：生成的 client 走的是 **native 引擎**
 * （`.prisma/client/query_engine-windows.dll.node`，21 MB）；WASM 路径只有
 * `wasm.js` / `wasm-engine-edge.js` / `edge.js` 这三个**从未被任何编译产物 require**
 * 的入口才用得上。已用 grep 对 `.next/server/all-js` 全量核实过（0 命中）。
 *
 * 删除范围严格限定在 `<pkg>/runtime/` 目录内，且只删**不满足可达性**的文件，
 * 因此不会触碰 `@prisma/client` 顶层入口（default.js / index.js / package.json）。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 二、pdfkit：**不**用可达性闭包，改用「保守白名单」—— 原因见下
 * ═══════════════════════════════════════════════════════════════════════════
 * `pdfkit-<hash>` 实测 11.1 MB，但它是 **Yarn workspace 快照**，里面混着构建工具链：
 *   `.yarn/releases/yarn-4.16.0.cjs` (2.9 MB)、`.yarn/install-state.gz` (0.7 MB)、
 *   `tools/`（构建脚本）、四份并列产物（browser / browser.old / old / standalone）
 *   以及全部 sourcemap。
 *
 * ⚠️ 为什么**不能**照搬闭包裁剪：`js/pdfkit.js` 里有运行时 `fs.readFileSync`，
 *    读的是 `./data/sRGB_IEC61966_2_1.icc` 一类**非 JS 资源**，静态 require 图看不见。
 *    闭包算法只会得出「只需 pdfkit.js 一个文件」，据此删除会把 icc / afm 数据删掉 ——
 *    普通 PDF 导出用不到（只在 PDF/A 的 `endSubset()` 里读 ICC），但这是个定时炸弹。
 *    ⇒ pdfkit 只删**构建工具链 + 明确的备用入口 + sourcemap**，数据目录一律保留。
 *
 * 另外保留 `js/pdfkit.js`（CJS 入口）与 `js/pdfkit.node.mjs`（ESM 入口）两份，
 * 不赌运行时走哪条 —— 两者合计只有 462 KB，省这点不值得冒险。
 *
 * ⚠️⚠️ **别按目录名猜「哪一份 pdfkit 在跑」**（2026-09-20 踩过）：
 *    `node_modules/pdfkit` 是 tracer 复制出来的**旁支**，它里面的 `@noble/hashes`
 *    是被掏空的（只剩 `esm/` 子集），直接 require 它会报 `Cannot find module
 *    '@noble/hashes/utils.js'` —— 看着像「包坏了」，其实它根本不参与运行。
 *    编译产物里写的是 `e.y("pdfkit-d5967b64ee09fcf0")`（Turbopack 外部化），
 *    运行时加载的是 `.next/node_modules/pdfkit-<hash>`，那份的嵌套
 *    `node_modules/@noble/hashes` 是完整的。判据是**编译产物里的外部化名**。
 *    因此这里的裁剪对两处都做（都保留 `node_modules/**` 不动），并已用
 *    「裁剪前后各生成一次 PDF」的方式做过功能验证。
 */
function pruneLinkedDeps(rootDir = STANDALONE) {
  const problems = []
  let freed = 0
  let removed = 0

  const drop = (p) => {
    let s = 0
    try {
      const st = fs.statSync(p)
      s = st.isFile() ? st.size : dirSize(p)
    } catch {
      return 0
    }
    fs.rmSync(p, { recursive: true, force: true })
    freed += s
    removed++
    return s
  }

  // ① Prisma runtime 闭包裁剪
  const prismaRoots = [
    path.join(rootDir, 'node_modules', '@prisma'),
    path.join(rootDir, '.next', 'node_modules', '@prisma'),
  ]

  for (const prismaDir of prismaRoots) {
    if (!fs.existsSync(prismaDir)) continue
    let entries
    try {
      entries = fs.readdirSync(prismaDir, { withFileTypes: true })
    } catch {
      continue
    }
    // 同时覆盖 `client`（真实包）与 `client-<hash>`（standalone 外部化副本）
    for (const e of entries) {
      if (!e.isDirectory()) continue
      if (e.name !== 'client' && !e.name.startsWith('client-')) continue
      const runtimeDir = path.join(prismaDir, e.name, 'runtime')
      if (!fs.existsSync(runtimeDir)) continue

      // 入口必须存在且可读；读不到就**不裁**（宁可多留，也不赌）
      if (!fs.existsSync(path.join(runtimeDir, 'library.js'))) {
        problems.push(path.relative(rootDir, runtimeDir))
        continue
      }

      const keep = collectRequireClosure(runtimeDir, 'library.js')
      if (keep === null) {
        problems.push(path.relative(rootDir, runtimeDir))
        continue
      }

      // ⚠️ `keep` 里存的是**文件路径**（可能是 `sub/index.js` 这种嵌套形式），
      //    而下面按**顶层条目名**决定删不删、且删除是 `recursive: true` 的。
      //    因此判断「这个顶层条目能不能删」必须看「有没有任何被保留的路径落在它下面」——
      //    只比较名字相等会把必需的嵌套目录整个删掉。
      const keptTopLevel = new Set()
      for (const rel of keep) {
        const top = rel.split('/')[0]
        if (top) keptTopLevel.add(top)
      }

      for (const name of fs.readdirSync(runtimeDir)) {
        if (keptTopLevel.has(name)) continue
        drop(path.join(runtimeDir, name))
      }
    }
  }

  // ② pdfkit 构建工具链裁剪（保守白名单，见函数头的说明）
  const nmRoots = [
    path.join(rootDir, 'node_modules'),
    path.join(rootDir, '.next', 'node_modules'),
  ]

  for (const nm of nmRoots) {
    if (!fs.existsSync(nm)) continue
    let pkgs
    try {
      pkgs = fs.readdirSync(nm, { withFileTypes: true })
    } catch {
      continue
    }
    for (const pk of pkgs) {
      if (!pk.isDirectory() || !pk.name.startsWith('pdfkit')) continue
      const base = path.join(nm, pk.name)

      const walkPdfkit = (dir) => {
        let items
        try {
          items = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        for (const it of items) {
          const fp = path.join(dir, it.name)
          if (it.isDirectory()) {
            if (PDFKIT_DEAD_DIRS.has(it.name)) drop(fp)
            else walkPdfkit(fp)
            continue
          }
          if (isDeadPdfkitAsset(it.name)) drop(fp)
        }
      }
      walkPdfkit(base)
    }
  }

  if (problems.length) {
    // 解析失败不删任何东西，但必须让打包者看见（体积异常时这是第一嫌疑人）
    console.warn('[desktop] 以下 runtime 目录未能解析依赖闭包，已保持原样：')
    problems.forEach((p) => console.warn('   ' + p))
  }
  console.log(
    `[desktop] pruneLinkedDeps 移除 ${removed} 项，回收 ${(freed / 1048576).toFixed(1)} MB`
  )
  return { removed, freed }
}

/** 递归求目录字节数（用于统计回收量） */
function dirSize(p) {
  let st
  try {
    st = fs.statSync(p)
  } catch {
    return 0
  }
  if (st.isFile()) return st.size
  let items
  try {
    items = fs.readdirSync(p, { withFileTypes: true })
  } catch {
    return 0
  }
  let t = 0
  for (const it of items) t += dirSize(path.join(p, it.name))
  return t
}

/** pdfkit 里「一律非运行时」的目录名 */
const PDFKIT_DEAD_DIRS = new Set(['.yarn', 'tools'])
/** pdfkit 的备用打包产物：CDN / bundler 用，Node 运行时走不到 */
const PDFKIT_DEAD_BASENAMES = new Set(['pdfkit.standalone.js'])
/** browser / browser.old / old 三套并列入口 + 全部 sourcemap */
const PDFKIT_DEAD_RE =
  /\.(browser|browser\.old|old|standalone)\.(js|mjs)$|\.(js|mjs|cjs)\.map$/

/**
 * 判断 pdfkit 包里的一个文件是否属于「构建工具链/备用入口/sourcemap」。
 * ⚠️ **不要**把 `js/data/**` 或 `js/standard-fonts/**` 加进来：
 *    `js/pdfkit.js` 会在运行时用 fs 读 `./data/sRGB_IEC61966_2_1.icc` 等资源，
 *    这些读操作不出现在 require 图里，删了就是隐蔽的运行时故障。
 */
function isDeadPdfkitAsset(name) {
  const low = name.toLowerCase()
  if (low.endsWith('.d.ts') || low.endsWith('.d.mts') || low.endsWith('.d.cts')) return true
  if (PDFKIT_DEAD_BASENAMES.has(low)) return true
  return PDFKIT_DEAD_RE.test(low)
}

/**
 * 从 `entry` 出发，静态解析相对 require，收集**同目录内**可达的文件名集合。
 *
 * 只跟踪 `./` 与 `../` 开头的 require（裸模块名是外部依赖，不归这里管）。
 * 用「同目录文件名」而非绝对路径作键，是因为 runtime 目录是平铺的。
 *
 * ⚠️ **宁可多留，也不赌** —— 以下任一情况直接返回 null，调用方据此放弃整个包的裁剪：
 *      · 入口读不出来
 *      · 某个**相对** specifier 解析不到落点
 *    第二条是关键：调用方会按 `keep` 之外一律删除，而删除是 `recursive: true` 的，
 *    一个解析不到的 `require('./x')` 若其实指向 `./x/index.js`，那个目录就会被整个删掉。
 *    解析不到就说明我的解析能力不足以判断这里的安全性 —— 那就别裁。
 *    （裸模块名不受此限：它们本来就不在待裁目录里。）
 *
 * ⚠️ 另一个已知局限：**看不见 `fs.readFileSync(path.join(__dirname, …))` 这类运行时文件读取**。
 *    因此它只适用于纯代码模块（如 Prisma 的 runtime/*.js），
 *    不适用于带数据文件的包（如 pdfkit）—— 后者必须走白名单规则。
 */
function collectRequireClosure(dir, entry) {
  const keep = new Set()
  const queue = [entry]
  const seen = new Set()
  // 扩展名按 Node 的解析顺序试；空串放最后（精确匹配文件名的情况）
  const FILE_EXTS = ['.js', '.mjs', '.cjs', '.json', '']
  const INDEX_EXTS = ['.js', '.mjs', '.cjs', '.json']

  /** 把绝对路径归一成「相对 dir 的正斜杠路径」，且必须仍位于 dir 之内 */
  const toKey = (abs) => {
    const rel = path.relative(dir, abs)
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null // 越界，不裁
    return rel.split(path.sep).join('/')
  }

  const resolveLocal = (fromFile, spec) => {
    if (!spec.startsWith('.')) return null // 裸模块名：外部依赖，与本目录裁剪无关
    const base = path.resolve(dir, path.dirname(fromFile), spec)

    // ① 当作文件
    for (const ext of FILE_EXTS) {
      const cand = base + ext
      try {
        if (fs.statSync(cand).isFile()) return toKey(cand)
      } catch {
        /* 不存在，继续试 */
      }
    }
    // ② 当作目录：先看 package.json 的 main，再看 index.*
    let st
    try {
      st = fs.statSync(base)
    } catch {
      return null
    }
    if (!st.isDirectory()) return null

    try {
      const pj = path.join(base, 'package.json')
      if (fs.existsSync(pj)) {
        const main = JSON.parse(fs.readFileSync(pj, 'utf8')).main
        if (typeof main === 'string') {
          for (const ext of FILE_EXTS) {
            const cand = path.resolve(base, main + ext)
            if (fs.existsSync(cand) && fs.statSync(cand).isFile()) {
              // package.json 本身也是解析依据，一并保留（它同样不该被删）
              const pjKey = toKey(pj)
              if (pjKey) keep.add(pjKey)
              return toKey(cand)
            }
          }
        }
      }
    } catch {
      /* package.json 坏了，退回 index 查找 */
    }
    for (const ext of INDEX_EXTS) {
      const cand = path.join(base, 'index' + ext)
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return toKey(cand)
    }
    return null
  }

  const RE_REQUIRE = /(?:require|import)\s*\(\s*['"]([^'"]+)['"]\s*\)/g

  while (queue.length) {
    const cur = queue.shift()
    if (seen.has(cur)) continue
    seen.add(cur)
    keep.add(cur)

    let src
    try {
      src = fs.readFileSync(path.join(dir, cur), 'utf8')
    } catch {
      return null
    }
    let m
    RE_REQUIRE.lastIndex = 0
    while ((m = RE_REQUIRE.exec(src))) {
      const spec = m[1]
      const rel = resolveLocal(cur, spec)
      if (rel === null) {
        // 裸模块名是预期内的；起点是 `.` 却解析不到 ⇒ 能力不足，放弃裁剪
        if (spec.startsWith('.')) {
          console.warn(
            `[desktop] ${cur} 里的相对依赖 '${spec}' 解析不到落点，放弃该目录的可达性裁剪`,
          )
          return null
        }
        continue
      }
      if (!seen.has(rel)) queue.push(rel)
    }
  }
  return keep
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
  pruneLinkedDeps,
  collectRequireClosure,
  isDeadPdfkitAsset,
  dirSize,
  packStandalone,
  STANDALONE,
}
