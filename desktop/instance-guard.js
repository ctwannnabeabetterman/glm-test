/**
 * 单一版本守卫 —— 同一时刻只允许一个 AI Network Lab 在运行。
 *
 * 为什么光有 app.requestSingleInstanceLock() 不够：
 *   requestSingleInstanceLock 的互斥只在「双方都调用它」时成立。而 v1.2.0 及更早的
 *   版本代码里压根没有这段逻辑（锁是 v1.2.1 才引入的），历史二进制无法回改。它们与
 *   新版**共用同一个 userData 与同一个 SQLite 库**（%APPDATA%\ai-network-lab\db\custom.db），
 *   一旦同时运行就是两个进程并发写同一个库 —— 这正是「用多版本开并发」的漏洞。
 *   所以新版必须在启动时主动去系统里看一眼：是不是还有**另一个版本**的客户端在跑。
 *
 * 判定口径（宁可漏报也不误报，误报会让用户完全打不开应用）：
 *   · 同名可执行文件（image name 完全一致）
 *   · 不是自己这个 pid
 *   · 不是自己的子进程 —— 见下面两个正则的说明
 *   · **可执行文件路径与自己的不同** ⇒ 才判定为「另一个版本」
 *     路径相同的情形（同一份安装里的第二个实例）由 requestSingleInstanceLock 负责，
 *     这里刻意不重复拦截：升级后自动重启时，旧进程可能还没退干净就被新进程扫到，
 *     若连「同路径」也拦，就会把用户自己的自动更新卡死在启动对话框上。
 *
 * 路径相同但**代码是旧版本**这一种（1.2.0 无锁进程占着 %LOCALAPPDATA% 那份安装），
 * 由安装器在覆盖文件之前先解决：electron-builder 的 NSIS 会执行
 * `FIND_PROCESS`/`KILL_PROCESS`（见 templates/nsis/include/allowOnlyOneInstallerInstance.nsh），
 * 用 PowerShell 找 `$_.Path.StartsWith('$INSTDIR')` 的进程，弹「应用正在运行」并结束它，
 * 否则文件根本覆盖不了。所以「同路径不同代码」不会并存，这里不必也不应再拦。
 *
 * 只认「exe 路径不同」还有一层好处：它精确对应「多版本」这个定义 —— 同一个版本装到
 * 两个不同目录、或新旧版本各装一份，都会被拦下；同一份安装则交给上面的进程内锁。
 */

const path = require('path')
const { execFile } = require('child_process')

/** Electron 的渲染/GPU/utility/network 子进程命令行里一定带 `--type=xxx` */
const ELECTRON_CHILD_FLAG = /(^|\s)--type=/

/**
 * 内部 Next 服务的子进程命令行形如 `<exe> "C:\...\resources\app\server.js"` ——
 * 它同样是「同名 exe 且没有 --type=」，但它是服务不是客户端，必须排除。
 * （见 main.js 的 startInternalServer：用 ELECTRON_RUN_AS_NODE 让同一份 exe 以 Node 身份跑。）
 */
const INTERNAL_SERVER_ARG = /server\.js/i

/**
 * 从 `Win32_Process` 的查询结果里挑出「另一个版本的客户端主进程」。
 *
 * 抽成纯函数是为了能在单元测试里直接喂各种刁钻的命令行组合 —— 进程枚举本身没法在
 * 测试里稳定复现（需要真的起进程），但「怎么区分主进程/子进程」才是容易出错的地方。
 *
 * @param {Array<{ProcessId?: number|string, ExecutablePath?: string, CommandLine?: string}>} rows
 * @param {number} selfPid 当前进程 pid（必须排除掉自己）
 * @param {string} selfExePath 当前进程 exe 绝对路径（同路径视为同一份安装，不算冲突）
 * @returns {Array<{pid: number, exePath: string}>}
 */
function pickForeignInstances(rows, selfPid, selfExePath) {
  if (!Array.isArray(rows)) return []
  const self = normalizePath(selfExePath)
  const found = []
  for (const row of rows) {
    if (!row) continue
    const pid = Number(row.ProcessId)
    if (!Number.isInteger(pid) || pid <= 0 || pid === selfPid) continue

    const cmd = String(row.CommandLine || '')
    if (ELECTRON_CHILD_FLAG.test(cmd)) continue
    if (INTERNAL_SERVER_ARG.test(cmd)) continue

    // 路径读不到就没法判断是不是「另一个版本」—— 这种情况下放行（fail-open），
    // 否则某些被安全软件限制读取进程信息的机器会一启动就被自己的弹窗挡住。
    const exePath = String(row.ExecutablePath || '').trim()
    if (!exePath) continue
    if (normalizePath(exePath) === self) continue

    found.push({ pid, exePath })
  }
  return found
}

/** Windows 路径比较：统一分隔符 + 大小写不敏感（NTFS 大小写不敏感） */
function normalizePath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase()
}

/**
 * 给用户看的冲突说明。要写清「哪个进程、在哪」，否则用户根本不知道该关谁 ——
 * 任务管理器里同名进程一大把，光说「已有一个实例在运行」等于没说。
 */
function buildConflictDetail(instances, selfExePath) {
  const lines = instances.map((it) => `· PID ${it.pid}  ——  ${it.exePath}`)
  return [
    '为了保证数据一致（同一个本地数据库同一时刻只能有一个客户端在写），',
    '同一时间只允许运行一个 AI Network Lab，且不允许新旧两个版本并存。',
    '',
    '检测到另一个版本的客户端正在运行：',
    ...lines,
    '',
    `当前启动的是：${selfExePath}`,
    '',
    '请先关闭上面列出的进程，再重新启动。',
    '若窗口中找不到它，可在「任务管理器 → 详细信息」里搜索 “AI Network Lab” 并结束这些任务。',
  ].join('\n')
}

/**
 * 查一遍系统里同名的进程。
 *
 * 用 PowerShell 的 Get-CimInstance 而不是 wmic：wmic 从 Windows 11 24H2 起已被移除，
 * 而 PowerShell 从 Win7 起就是系统自带。查询失败（被策略禁用 / 超时）时返回 null，
 * 由调用方决定怎么办 —— 这里不吞掉「失败」和「没有」这两种不同的结果。
 *
 * @param {string} exeName 目标 exe 文件名（含扩展名）
 * @param {(file: string, args: string[], options: object, cb: Function) => void} execFileImpl
 *   注入 execFile，方便测试与复用；不传则用 child_process.execFile
 * @returns {Promise<Array<object>|null>} 进程行数组；查询失败为 null
 */
/**
 * 单次 CIM 查询。查不到东西返回 []，查询本身失败返回 null —— 两者含义完全不同，
 * 调用方靠这个区分「确实没有」和「没查到」。
 *
 * @returns {Promise<Array<object>|null>}
 */
function queryLabProcessesOnce(exeName, execFileImpl) {
  const exec = execFileImpl || execFile
  // ⚠️ 第一条语句后面必须带分号：几条语句是用空格拼成**一行**传给 -Command 的，
  // 少一个 ';' 就变成 `$ErrorActionPreference='SilentlyContinue' Get-CimInstance ...`，
  // PowerShell 会报 "表达式或语句中包含意外的标记 Get-CimInstance"、退出码 1 ——
  // 而退出码非 0 会被当成「查询失败」走 fail-open，结果是**守卫永远静默失效**。
  // （实测踩过：加上分号前 queryLabProcesses 恒返回 null。）
  //
  // ⚠️ 也必须用 ForEach-Object 显式投影成 pscustomobject，不能直接
  // `Select-Object ProcessId,ExecutablePath,CommandLine`：后者返回的仍是包着
  // CimInstance 的包装对象，ConvertTo-Json 会把 **整个 CIM 类定义**（CimClass /
  // CimInstanceProperties / 所有属性元数据）一起序列化出来 —— 实测单个进程约 4 KB，
  // 十几个进程就是几十 KB 的解析垃圾，且字段层级变得难以预测。
  // 投影之后每个进程只剩三个字段，输出干净且体积可控。
  const script = [
    "$ErrorActionPreference='SilentlyContinue';",
    `Get-CimInstance Win32_Process -Filter "Name='${exeName}'"`,
    '| ForEach-Object { [pscustomobject]@{ ProcessId = $_.ProcessId; ExecutablePath = $_.ExecutablePath; CommandLine = $_.CommandLine } }',
    '| ConvertTo-Json -Compress -Depth 2',
  ].join(' ')

  return new Promise((resolve) => {
    exec(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        const text = String(stdout || '').trim()
        // 没有任何匹配进程时 Get-CimInstance 输出空，ConvertTo-Json 也就什么都没有
        if (!text) return resolve([])
        try {
          const parsed = JSON.parse(text)
          return resolve(Array.isArray(parsed) ? parsed : [parsed])
        } catch {
          return resolve(null)
        }
      },
    )
  })
}

/**
 * 用 tasklist 判断「系统里到底有没有同名进程」。
 *
 * 为什么需要它：实测在本机上，WMI 的 Win32_Process 查询会**偶发返回空结果** ——
 * 进程明明在跑，90 秒的连续采样里却有两次查到 0 个（见 .recon/debug-old-watch.mjs）。
 * 而「空结果」在「有没有别的客户端在跑」这个问题上恰好等价于「没有冲突」，
 * 于是守卫会**静默失效**：不报错、不弹窗，就是拦不住。
 * tasklist 走的是另一条内核进程快照路径、不经过 WMI，用它做一次交叉确认，
 * 成本只有几十毫秒。
 *
 * 注意「没有匹配」的提示是**本地化**的（中文系统上是「信息: 没有运行的任务匹配指定标准。」），
 * 所以不能匹配英文文案，只能按 CSV 的第一列比对镜像名。
 *
 * @returns {Promise<boolean|null>} true/false 表示有/无；null 表示这次判断本身没成功
 */
function hasSameNamedProcess(exeName, execFileImpl) {
  const exec = execFileImpl || execFile
  return new Promise((resolve) => {
    exec(
      'tasklist',
      ['/FI', `IMAGENAME eq ${exeName}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 15000, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve(null)
        const wanted = exeName.toLowerCase()
        const found = String(stdout || '')
          .split(/\r?\n/)
          .some((line) => {
            const m = /^"([^"]+)"/.exec(line.trim())
            return !!m && m[1].toLowerCase() === wanted
          })
        resolve(found)
      },
    )
  })
}

/** CIM 空结果时的最多尝试次数（含首次） */
const CIM_ATTEMPTS = 3

/**
 * 主入口：查同名进程。带「空结果交叉确认 + 重试」，避免 WMI 偶发空响应让守卫静默失效。
 *
 * @returns {Promise<Array<object>|null>} null 表示反复都拿不到可信结果（调用方 fail-open）
 */
async function queryLabProcesses(exeName, execFileImpl) {
  for (let attempt = 1; attempt <= CIM_ATTEMPTS; attempt++) {
    const rows = await queryLabProcessesOnce(exeName, execFileImpl)
    if (rows === null) continue // 查询报错 → 换一次再试
    if (rows.length) return rows // 有结果，直接用
    // CIM 说「一个都没有」：用 tasklist 交叉确认，别急着相信
    const exists = await hasSameNamedProcess(exeName, execFileImpl)
    if (exists === false) return [] // 两边都说没有 → 可信
  }
  return null
}

/**
 * 主入口：找出「另一个版本」的客户端主进程。
 *
 * @returns {Promise<Array<{pid:number, exePath:string}>|null>} null 表示查询失败（调用方放行）
 */
async function findForeignLabInstances(selfPid, selfExePath, execFileImpl) {
  if (process.platform !== 'win32') return []
  const exeName = path.basename(selfExePath || process.execPath)
  if (!exeName) return null
  const rows = await queryLabProcesses(exeName, execFileImpl)
  if (rows === null) return null
  return pickForeignInstances(rows, selfPid, selfExePath)
}

module.exports = {
  pickForeignInstances,
  buildConflictDetail,
  queryLabProcesses,
  queryLabProcessesOnce,
  hasSameNamedProcess,
  findForeignLabInstances,
  normalizePath,
}
