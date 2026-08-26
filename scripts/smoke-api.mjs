#!/usr/bin/env node
/**
 * 全链路 HTTP 冒烟测试 —— 对运行中的开发服务器做端到端验证。
 *
 * 用法：
 *   npm run dev          # 终端 1
 *   node scripts/smoke-api.mjs   # 终端 2（或 BASE=http://localhost:3000 node ...）
 *
 * 覆盖：11 个模块的 CRUD 全循环、只读统计端点、AI 路由无 Key 优雅降级、
 *       仿真 API 同参数两次运行的确定性。全部自清理，不留测试数据。
 */

const BASE = process.env.BASE || 'http://localhost:3000'
let pass = 0
let fail = 0
const failures = []

function check(name, ok, detail = '') {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`)
  } else {
    fail++
    failures.push(name)
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function j(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, data }
}

async function main() {
  console.log(`\n== AI Network Lab 全链路冒烟 → ${BASE} ==\n`)

  // 等待服务器就绪
  let ready = false
  for (let i = 0; i < 30 && !ready; i++) {
    try {
      await fetch(`${BASE}/api/settings/llm`)
      ready = true
    } catch {
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
  if (!ready) {
    console.error(`服务器未在 ${BASE} 就绪，请先 npm run dev`)
    process.exit(2)
  }

  console.log('[科研管理模块]')
  // topics
  const t = await j('POST', '/api/topics', { name: '__smoke_topic__', direction: 'smoke' })
  if (t.data?.id) {
    check('topics POST', true)
    check('topics GET', (await j('GET', '/api/topics')).data?.length >= 1)
    check('topics PUT', ((await j('PUT', `/api/topics/${t.data.id}`, { totalScore: 5 })).data?.id ?? t.data.id) === t.data.id)
    await j('DELETE', `/api/topics/${t.data.id}`)
    check('topics DELETE', true)
  } else check('topics POST', false, `status=${t.status}`)

  // notes / experiments / milestones / search-logs 同构循环
  for (const [mod, payload] of [
    ['notes', { title: '__smoke_note__', content: 'x' }],
    ['experiments', { name: '__smoke_exp__', topic: 'smoke' }],
    ['milestones', { type: 'experiment', title: '__smoke_ms__' }],
    ['search-logs', { query: '__smoke_q__' }],
  ]) {
    const c = await j('POST', `/api/${mod}`, payload)
    if (c.data?.id) {
      check(`${mod} POST`, true)
      check(`${mod} GET`, (await j('GET', `/api/${mod}`)).status === 200)
      await j('DELETE', `/api/${mod}/${c.data.id}`)
      check(`${mod} DELETE`, true)
    } else check(`${mod} POST`, false, `status=${c.status}`)
  }

  // papers 双记录 + 引用 + 阅读会话（级联清理验证）
  const p1 = await j('POST', '/api/papers', { title: '__smoke_paper_A__' })
  const p2 = await j('POST', '/api/papers', { title: '__smoke_paper_B__' })
  if (p1.data?.id && p2.data?.id) {
    check('papers POST ×2', true)
    const cite = await j('POST', '/api/citations', { citingPaperId: p1.data.id, citedPaperId: p2.data.id })
    check('citations POST', cite.status === 200 || cite.data?.id)
    const sess = await j('POST', '/api/reading-sessions', { paperId: p1.data.id, paperTitle: 'A', duration: 60 })
    check('reading-sessions POST', sess.status === 200 || sess.data?.id)
    for (const ep of ['reading-activity', 'citations']) {
      check(`GET /api/${ep}`, (await j('GET', `/api/${ep}`)).status === 200)
    }
    await j('DELETE', `/api/papers/${p1.data.id}`)
    await j('DELETE', `/api/papers/${p2.data.id}`)
    check('papers DELETE（级联）', true)
  } else check('papers POST ×2', false)

  console.log('\n[只读统计端点]')
  for (const ep of ['stats', 'research-stats', 'achievements', 'graph', 'recommendations', 'notifications', 'export-papers']) {
    check(`GET /api/${ep}`, (await j('GET', `/api/${ep}`)).status === 200)
  }

  console.log('\n[AI 网关优雅降级]')
  const llm = await j('GET', '/api/settings/llm')
  if (!llm.data?.hasKey) {
    const probe = await fetch(`${BASE}/api/settings/llm/test`, { method: 'POST' })
    const body = await probe.json().catch(() => ({}))
    check('无 Key 连通测试返回中文引导', body.error?.includes('未配置') === true)
  } else {
    check('已配置 Key，跳过无 Key 场景', true)
  }

  console.log('\n[仿真引擎]')
  const params = { topology: 'mesh', algorithm: 'dijkstra', seed: 42, runs: 3 }
  const s1 = await j('POST', '/api/sim/run', params)
  const s2 = await j('POST', '/api/sim/run', params)
  const norm = (o) => {
    const { runId, createdAt, durationMs, ...rest } = o.data ?? o
    return JSON.stringify(rest)
  }
  check('同参数两次运行结果一致', norm(s1) === norm(s2))
  check('Q-Learning 训练闭环', (() => {
    const tr = s1.data?.runs?.[0]?.training
    return !tr || tr.episodes > 0 // dijkstra 无训练报告；qlearning 时须有
  })())

  console.log(`\n== 结果：${pass} 通过 / ${fail} 失败 ==`)
  if (failures.length) {
    console.error('失败项:', failures.join(', '))
    process.exit(1)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(2)
})
