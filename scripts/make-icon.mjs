/**
 * 生成应用图标：build/icon.png（1024×1024，源图）与 build/icon.ico（多尺寸）。
 *
 * 为什么要自己生成 ico 而不是让 electron-builder 从 png 转：
 * 它转出来的 ico 往往只带一个尺寸，Windows 在任务栏/资源管理器小图标位置
 * 会拿 256px 硬缩到 16px，糊成一团。这里按 16/24/32/48/64/128/256 各渲一张，
 * 让系统按 DPI 与显示位置挑最近的那张。
 *
 * 图案取「网络」本意：一个中心节点 + 四个卫星节点 + 连接线，
 * 用较粗的描边与较大的节点，保证缩到 16px 仍然认得出是拓扑图而不是一团点。
 *
 * 用法：node scripts/make-icon.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(ROOT, 'build')

const SIZE = 1024
// 圆角半径：Windows 11 图标观感约为边长的 22%
const RX = Math.round(SIZE * 0.22)

const CENTER = SIZE / 2

/**
 * 两套几何，按尺寸取用。
 *
 * 实测（把 16/24/32 放大 8 倍逐个看）：带连线的完整版缩到 16px 时，
 * 四条连线会和节点糊成一个「十字」，看着像医疗十字而不是网络拓扑。
 * 所以 ≤32px 改用简化版：**去掉连线**、放大节点与中心、收紧环半径，
 * 16px 下能清楚认出「一个枢纽 + 四个节点」。
 * ≥48px 用完整版，连线让「网络」的语义更明确。
 */
const FULL = { ring: 0.295, nodeR: 0.072, hubR: 0.105, lines: true, glow: true }
const SIMPLE = { ring: 0.27, nodeR: 0.095, hubR: 0.15, lines: false, glow: false }

// 卫星节点：上、右、下、左。比六边形更疏朗，小尺寸下不糊。
const ANGLES = [-90, 0, 90, 180]

function buildSvg(opt) {
  const pts = ANGLES.map((deg) => {
    const a = (deg * Math.PI) / 180
    return { x: CENTER + opt.ring * SIZE * Math.cos(a), y: CENTER + opt.ring * SIZE * Math.sin(a) }
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#16265c"/>
      <stop offset="55%" stop-color="#123a6b"/>
      <stop offset="100%" stop-color="#0e7490"/>
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#67e8f9" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#67e8f9" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect x="0" y="0" width="${SIZE}" height="${SIZE}" rx="${RX}" fill="url(#bg)"/>
  ${opt.glow ? `<circle cx="${CENTER}" cy="${CENTER}" r="${SIZE * 0.42}" fill="url(#glow)"/>` : ''}

  ${
    opt.lines
      ? `<!-- 连接线：先画线、节点压在上面，交点才干净 -->
  <g stroke="#7dd3fc" stroke-linecap="round" fill="none">
    ${pts
      .map(
        (p) =>
          `<line x1="${CENTER}" y1="${CENTER}" x2="${p.x.toFixed(1)}" y2="${p.y.toFixed(1)}" stroke-width="${SIZE * 0.026}" opacity="0.85"/>`,
      )
      .join('\n    ')}
  </g>`
      : ''
  }

  ${pts
    .map(
      (p) =>
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(opt.nodeR * SIZE).toFixed(1)}" fill="#a5f3fc" stroke="#0e7490" stroke-width="${SIZE * 0.011}"/>`,
    )
    .join('\n  ')}

  <!-- 中心节点：白心 + 青环，视觉落点 -->
  <circle cx="${CENTER}" cy="${CENTER}" r="${(opt.hubR * SIZE).toFixed(1)}" fill="#ecfeff"/>
  <circle cx="${CENTER}" cy="${CENTER}" r="${(opt.hubR * SIZE * 0.54).toFixed(1)}" fill="#0e7490"/>
</svg>
`
}

/** 小尺寸走简化版，避免连线糊成十字 */
function svgForSize(size) {
  return buildSvg(size <= 32 ? SIMPLE : FULL)
}

/** 依据 ICO 规范打包多尺寸（每张图用 PNG 负载，Vista+ 全尺寸支持） */
function buildIco(entries) {
  const count = entries.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // type: 1 = icon
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  entries.forEach((e, i) => {
    const b = i * 16
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 0) // 256 用 0 表示
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, b + 1)
    dir.writeUInt8(0, b + 2) // 调色板数
    dir.writeUInt8(0, b + 3) // reserved
    dir.writeUInt16LE(1, b + 4) // color planes
    dir.writeUInt16LE(32, b + 6) // bits per pixel
    dir.writeUInt32LE(e.buf.length, b + 8)
    dir.writeUInt32LE(offset, b + 12)
    offset += e.buf.length
  })

  return Buffer.concat([header, dir, ...entries.map((e) => e.buf)])
}

const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })

  // 源图（1024）用完整版
  const png1024 = await sharp(Buffer.from(buildSvg(FULL)), { density: 384 })
    .resize(SIZE, SIZE)
    .png({ compressionLevel: 9 })
    .toBuffer()
  writeFileSync(join(OUT_DIR, 'icon.png'), png1024)

  const entries = []
  for (const size of SIZES) {
    const buf = await sharp(Buffer.from(svgForSize(size)), { density: 384 })
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer()
    entries.push({ size, buf })
  }
  const ico = buildIco(entries)
  writeFileSync(join(OUT_DIR, 'icon.ico'), ico)

  console.log(`[icon] build/icon.png  ${png1024.length} B (${SIZE}x${SIZE}, 完整版)`)
  console.log(`[icon] build/icon.ico  ${ico.length} B (${SIZES.join('/')})`)
  const small = SIZES.filter((s) => s <= 32)
  console.log(`[icon] ≤32px 用简化版(${small.join('/')})，其余用完整版`)
}

main().catch((e) => {
  console.error('[icon] 生成失败：', e)
  process.exit(1)
})
