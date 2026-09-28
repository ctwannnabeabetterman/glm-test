import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import yaml from 'js-yaml'

/**
 * 工作流里内联 shell 脚本的**结构守卫**。
 *
 * 为什么要有它（2026-09-27 血的教训）：我用正则把 `Write-Error (...)` 批量改写为
 * `Write-Host ("::error::" + ...)`，而其中一条语句**跨了两行**，正则只吃到第一行，
 * 于是生成了：
 *
 *     Write-Host ("::error::" + ("草稿验收失败：…，" +)
 *       "期望 […]")
 *
 * `+` 后面直接跟 `)` ⇒ **整段脚本解析失败** ⇒ 该步骤一启动就死，
 * 里面所有的错误处理都来不及执行，远端只剩「Process completed with exit code 1」。
 * 结果就是**连续四轮 Release 失败，而我完全读不到原因** —— 排查成本极高。
 *
 * 本机没装 pwsh，做不了真正的语法解析，所以这里守住几条**能机械判定**的强签名：
 *  ① 行尾出现「二元运算符」却换行（`+` / `-` / `*` / `/` / `,` / `|` / `&` / `=`）
 *     —— 尤其 `+` 后面紧跟 `)` 这种必然非法的写法；
 *  ② 引号外的圆括号 / 方括号 / 花括号不平衡。
 * 这两条足以拦住上面那类「批量改写把语句切坏」的事故。
 */

const REPO = process.cwd()
const WORKFLOWS = ['.github/workflows/release.yml', '.github/workflows/ci.yml', '.github/workflows/release-cleanup.yml']

type Step = { name?: string; run?: string; shell?: string; uses?: string }
type Job = { steps?: Step[] }
type Workflow = { jobs?: Record<string, Job> }

/** 去掉整行注释（行首是 # 的），只留可执行代码用于判定 */
const codeLines = (script: string) =>
  script.split('\n').filter((l) => !l.trim().startsWith('#'))

/** 逐字符扫，统计引号外的括号平衡 */
function bracketBalance(script: string): { paren: number; bracket: number; brace: number; unterminatedQuote: boolean } {
  let paren = 0
  let bracket = 0
  let brace = 0
  let inSingle = false
  let inDouble = false
  for (let i = 0; i < script.length; i += 1) {
    const c = script[i]
    if (inSingle) {
      if (c === "'") inSingle = false
      continue
    }
    if (inDouble) {
      // 反引号是 PowerShell 的转义符；`"` 用来在双引号串里嵌引号
      if (c === '`') {
        i += 1
        continue
      }
      if (c === '"') inDouble = false
      continue
    }
    if (c === "'") inSingle = true
    else if (c === '"') inDouble = true
    else if (c === '(') paren += 1
    else if (c === ')') paren -= 1
    else if (c === '[') bracket += 1
    else if (c === ']') bracket -= 1
    else if (c === '{') brace += 1
    else if (c === '}') brace -= 1
  }
  return { paren, bracket, brace, unterminatedQuote: inSingle || inDouble }
}

/**
 * ⚠️ 判据刻意**只抓确切签名**，不做通用的「行尾运算符」扫描：
 * PowerShell 合法地允许行尾 `|`（管道续行）与行尾 `,`（数组元素续行），
 * 泛化判据会在这两处误报（第一版就误报了 3 处正当写法）。
 * 而「批量改写把跨行语句切坏」这件事的签名是稳定的：**`+` 后面直接跟 `)`**。
 */
const PLUS_BEFORE_CLOSE = /\+\s*\)\s*$/
const TRAILING_PLUS = /\+\s*$/

function collectScripts(): Array<{ where: string; script: string }> {
  const out: Array<{ where: string; script: string }> = []
  for (const file of WORKFLOWS) {
    const wf = yaml.load(readFileSync(path.join(REPO, file), 'utf8')) as Workflow
    for (const [jobName, job] of Object.entries(wf.jobs ?? {})) {
      for (const [idx, step] of (job.steps ?? []).entries()) {
        if (typeof step.run !== 'string' || !step.run.trim()) continue
        out.push({ where: `${file} › ${jobName} › 第 ${idx + 1} 步「${step.name ?? '(未命名)'}」`, script: step.run })
      }
    }
  }
  return out
}

describe('工作流内联脚本的结构守卫', () => {
  const scripts = collectScripts()

  it('至少解析到若干脚本（否则说明这份守卫形同虚设）', () => {
    expect(scripts.length).toBeGreaterThan(8)
  })

  it('没有「`+` 后紧跟 `)`」或行尾悬空 `+` 的断句（批量改写切坏语句的确切签名）', () => {
    const problems: string[] = []
    for (const { where, script } of scripts) {
      for (const [n, line] of codeLines(script).entries()) {
        if (PLUS_BEFORE_CLOSE.test(line)) {
          problems.push(`${where} 第 ${n + 1} 行：\`+\` 后紧跟 \`)\` —— 该语句必然解析失败：${line.trim().slice(0, 100)}`)
        } else if (TRAILING_PLUS.test(line)) {
          problems.push(`${where} 第 ${n + 1} 行：行尾悬空 \`+\`，下面一行很可能是被切坏的另一半：${line.trim().slice(0, 100)}`)
        }
      }
    }
    expect(problems, '被批量改写切坏的 shell 语句（会导致整步解析失败、且远端看不到原因）').toEqual([])
  })

  it('引号外的括号平衡（不平衡同样意味着脚本解析失败）', () => {
    const problems: string[] = []
    for (const { where, script } of scripts) {
      const b = bracketBalance(codeLines(script).join('\n'))
      if (b.paren !== 0 || b.bracket !== 0 || b.brace !== 0 || b.unterminatedQuote) {
        problems.push(`${where}：圆括号差 ${b.paren}、方括号差 ${b.bracket}、花括号差 ${b.brace}${b.unterminatedQuote ? '、还有未闭合的引号' : ''}`)
      }
    }
    expect(problems).toEqual([])
  })
})
