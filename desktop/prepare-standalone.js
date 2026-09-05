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
  // electron-builder 对 extraResources 中名为 node_modules 的目录会做依赖收集式过滤，
  // 导致 standalone 的依赖层丢失；因此压成单文件随包携带，由桌面壳层首次启动时自解压。
  const dir = path.join(ROOT, 'resources')
  fs.mkdirSync(dir, { recursive: true })
  const zip = path.join(dir, 'app.zip')
  if (fs.existsSync(zip)) fs.rmSync(zip)
  // Windows 10+ 自带 bsdtar（tar.exe），-a 按扩展名产出 zip
  execFileSync('tar', ['-a', '-cf', zip, '--exclude=.env*', '--exclude=*.db', '.'], { cwd: STANDALONE, stdio: 'pipe', windowsHide: true })
  const mb = (fs.statSync(zip).size / 1024 / 1024).toFixed(1)
  console.log(`[desktop] packed standalone -> ${path.relative(ROOT, zip)} (${mb} MB)`)
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
