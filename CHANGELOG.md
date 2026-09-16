# Changelog

本项目的所有显著变更都记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/)。

## [1.2.4] - 2026-09-16

把「检查更新」真正打通、补上应用图标，并给多版本并发装上闸门。**这一版修掉了自动更新长期不生效的真因，同时只允许一个版本、一个客户端在跑。**

### 修复

- **自动更新一直不生效的真因：CI 每次都只产出草稿 release。** `electron-builder.yml` 的 `publish` 没有写 `releaseType`，而 electron-builder 的**默认值就是 `draft`**。草稿 release 在 GitHub 上既不算「latest」、匿名也访问不到，于是：
  - `https://github.com/<owner>/<repo>/releases/latest` 不再指向任何 tag（实测它 302 到 releases 列表页）
  - electron-updater 的 `getLatestTagName()` 请求该地址并带 `Accept: application/json`，跟随跳转后拿到 **406**，报 `Cannot parse releases feed`，**整条检查更新链路直接抛错**
  - 而这条错误又被 `console.warn` 悄悄吞掉 —— 用户侧表现为「检查更新毫无反应」，实际上每次启动都在失败
  - 已显式写入 `releaseType: release`。**注意：已存在的历史 release 需要在 GitHub 上手动改成正式发布，或重新发一次 tag 让 CI 覆盖**

- **更新失败不再静默**：原先 `autoUpdater` 的 `error` 事件只打日志、返回值也只有一句 `e.message`。现在按 `no-release / no-channel / network / dev / no-updater` 分类，翻译成用户看得懂、能行动的中文说明（例如「更新源暂时没有可用的正式发布（GitHub Releases）」），并在设置页如实展示
- **单实例锁的退出竞态**：拿不到锁时原先只调 `app.quit()`。quit 是「请求退出」，要等 `before-quit` 走完才结束进程，而 `app.whenReady()` 在这个窗口期仍可能被触发 —— 那样第二个实例会照样走完 bootstrap、拉起第二份内部服务（多一批子进程 + 第二个 SQLite 句柄）。改为 `app.exit(0)` 立即终止，并给 `bootstrap()` 与启动钩子都加了短路兜底
  - 实测（win-unpacked 双开）：第二个实例会在打印启动警告后自行退出，进程总数不增加；关窗后 5 个进程全部归零、无残留

### 新增

- **应用图标**：`node scripts/make-icon.mjs` 生成 `build/icon.ico`（含 16/24/32/48/64/128/256 七个尺寸）与 `build/icon.png`，`win.icon` 已接入 —— 打包日志不再出现 `default Electron icon is used`
  - 图案为「中心枢纽 + 四卫星节点」，配色深蓝→青
  - **≤32px 用单独的简化几何（去掉连线、放大节点）**：实测带连线的完整版缩到 16px 时，连线会把节点糊成一个「十字」，看着像医疗标志；简化版在 16px 下能清楚认出是网络拓扑
- **检查更新的界面入口**（原先前端从未调用过壳层暴露的检查接口，等于没有入口）：
  - 设置页新增「软件更新」卡片：显示当前版本、手动检查、按状态给出「已是最新 / 发现新版本 / 具体失败原因」
  - 新增全局更新提醒横幅：发现新版本时常驻顶部（可忽略），并提供「下载更新」；下载完成提供「立即重启并安装」
  - 有新版时**系统对话框 + 界面横幅 + toast 三重提醒** —— 原先只有对话框，用户点「稍后」就再无痕迹
- 壳层新增 IPC：`app-info`、`download-update`、`install-update`，以及主进程 → 渲染层的 `update-status` 推送（preload 用 id 退订，避免 React 严格模式重复挂载导致重复提示）
- 渲染层 IPC 调用方校验抽成 `guardSender()`，四个 handler 共用同一套「本窗口主框架 + 受信任源」判断
- **单一版本使用限制（跨版本守卫）**：`requestSingleInstanceLock` 的互斥只在「双方都调用它」时成立，而 **v1.2.0 及更早版本里根本没有这段代码**（锁是 v1.2.1 才引入的），历史二进制改不了；它们与新版共用同一个 userData 与同一个 `custom.db`，同时运行就是两个写者。新增 `desktop/instance-guard.js`：
  - 启动时枚举同名进程，**只要发现另一个安装路径的同名客户端在跑，就弹框说明并 `app.exit(0)`**，连解压/建库都不做。判定只看「exe 绝对路径不同」——同路径的第二个实例仍交给 `requestSingleInstanceLock`，这样升级后自动重启时旧进程尚未退干净也不会把自己卡在启动对话框上
  - 进程鉴别靠命令行特征：排除带 `--type=` 的渲染/GPU/utility 子进程，以及跑 `server.js` 的内部服务子进程（同一个 exe 用 `ELECTRON_RUN_AS_NODE` 起服务），避免把自己刚拉起的子进程误判成第二个客户端
  - 反向场景（新版在跑、用户又去点旧版图标）无法在旧版内部拦截，改为窗口获得焦点时节流复检（60 s），发现后弹系统提醒 + 界面横幅提示关闭
  - 枚举走 PowerShell `Get-CimInstance Win32_Process`（`wmic` 已在 Windows 11 24H2 移除）；**查询失败时放行并只记日志**（fail-open），避免被安全策略挡住的机器一启动就被自己的弹窗拦住
  - ⚠️ **实测踩到「WMI 偶发返回空结果」导致守卫静默失效**：进程明明在跑，90 秒连续采样里却有两次查到 0 个（见 `.recon/debug-old-watch.mjs`）。而「空」在「有没有别的客户端在跑」这个问题上恰好等价于「没有冲突」，于是不报错、不弹窗，就是拦不住。现在空结果会用 `tasklist`（走另一条内核快照路径、不经 WMI）**交叉确认**并**最多重试 3 次**，只有两边都说「没有」才敢相信；一直拿不到可信结果则返回「查询失败」走 fail-open
  - 「同一路径但代码是旧版本」这一种不归守卫管，由**安装器**在覆盖文件前解决：electron-builder 的 NSIS 会执行 `FIND_PROCESS`/`KILL_PROCESS`（`templates/nsis/include/allowOnlyOneInstallerInstance.nsh`），按 `$_.Path.StartsWith('$INSTDIR')` 找出正在运行的旧进程，提示「应用正在运行」并结束它 —— 否则文件根本覆盖不了。所以「同路径不同代码」不会并存
- **版本一致性（数据库降级保护）**：把程序版本写进 SQLite 文件头自带的 `PRAGMA user_version`（无需建表，Prisma 也看不见）。启动时若「库里记录的版本 > 当前程序版本」，说明本机数据已被更新的版本写过，旧代码继续写就可能悄悄写坏新数据 —— 直接弹框拒绝启动并保留数据。老库从没写过该值（读到 0），因此升级方向永远放行
- **安装目录固定**：`nsis.allowToChangeInstallationDirectory` 由 `true` 改为 `false`。原先用户可以把新版本装到另一个目录，磁盘上就同时有两份不同版本 —— 这正是「多版本开并发」的入口；固定后升级会覆盖旧版本（NSIS 检出已安装版本时沿用注册表记录的目录），磁盘上永远只有一份
- **图标生成并入构建链**：新增 `npm run desktop:icon`，并前置到 `desktop:build`。原先 `electron-builder.yml` 引用的 `build/icon.ico` 只在本机手工生成过，CI 从未跑过这个脚本 —— 换个干净检出打包就会退回 Electron 默认图标。`build/icon.ico` 与 `build/icon.png`（由脚本确定性产出）一并入库作为兜底
- 新增 `tests/desktop/instance-guard.test.ts`（19 例，覆盖主进程/子进程鉴别、同路径放行、路径归一化、非法输入、`tasklist` CSV 解析、以及「CIM 空结果 → 交叉确认 → 重试」的时序）与 `tests/desktop/db-version.test.ts`（5 例，覆盖版本编码、写戳幂等、降级判定），单测总数 128 → 152
- 打包产物一致性校验：`.recon/verify-packed-shell.mjs` 逐个 sha256 比对 `app.asar` 里的 `desktop/*.js` 与仓库源码，并断言六个关键修复点确实打进去了 —— 防止「测的是新的、装的是旧的」

### 验证范围（如实说明）

- **已跑通**：`tsc --noEmit`、`eslint .` 全绿；单测 `152/152`；asar 与源码 sha256 逐文件一致；`app.zip` 内含全部前端改动且版本已注入为 `1.2.4`
- **未跑通**：跨版本守卫的**实机端到端**验证（`.recon/guard-live-test2.mjs`，用两段安装路径互相拒绝）。
  本机开发沙箱**禁止执行任意 exe、禁止 spawn `powershell.exe`/`taskkill`**，因此被起测的应用既拉不起来、
  守卫内部的进程枚举也必然拿不到结果（正好走 fail-open 分支，会被误读成"守卫没生效"）。
  脚本已留档，可在普通桌面会话里直接 `node .recon/guard-live-test2.mjs` 复核。
  **结论**：守卫的**判定逻辑**由 19 条单测覆盖（含 CIM 空结果 → `tasklist` 交叉确认 → 重试的时序），
  打包产物也已逐字节核对；但「两版本同时运行时会互相拒绝」这一条目前**只有逻辑证明，没有实机证明**。

## [1.2.3] - 2026-09-15

移除一个实测不可用的功能，并让笔记导出真正接入 Obsidian。**建议桌面版用户升级。**

### 移除

- **移除「智能组网实验室」（INET）**。实测结论：该功能有两个互相独立的阻塞点——① 前端从未提供 manifest 配置入口（只发 `scenarioType` + `parameters`，全前端搜索 `manifest` 在组件层零命中），服务端因此必然判定为 failed，**即使自行装好 OMNeT++/INET 也无法从界面运行**；② 依赖外部 OMNeT++/INET 工具链，需用户自行编译数 GB 环境。要求用户为此自建环境不划算，故整体移除
  - 删除 `src/lib/inet/`、`src/app/api/inet/`、`src/components/sections/inet-lab-section.tsx`、导航与分区注册、相关测试与文档
  - `prisma/schema.prisma` 移除 `InetScenario` / `InetRun` / `InetRunArtifact` 三个模型
  - `desktop/migrate-database.js` 不再创建这些表；改为**在升级时清理已建出的空表**（先子表后父表，避免外键阻挡），老数据不受影响
  - 真正的组网仿真能力由内置引擎的「组网仿真实验」承担（无需任何外部依赖，结果可复现）

### 新增

- **导出 Markdown 直接写入 Obsidian vault**：设置页新增「Obsidian 笔记库」（vault 目录 + vault 内子目录 + 开关，可用系统原生目录选择器）；导出菜单新增「同步这一篇 / 全部文献笔记同步到 vault」；「导出 Markdown」在 vault 可用时顺便写入。写盘由内部服务完成，只有「选目录」走 Electron IPC
  - 路径安全：绝对路径 / `..` / 盘符 / UNC 一律拒绝或净化，写入前用 `path.resolve` 二次校验必须仍在 vault 内（E2E 实测确认 vault 外目录不被写入）
  - 同名笔记自动追加短 id 后缀，批量同步不会互相覆盖

- **论文写作首次形成闭环（写作工作台）**：新增 `Manuscript` 模型与「论文写作 → 写作工作台」标签页，把「文献库 → 插入引用 → 写章节 → 引用自动编号 → 参考文献 → 导出」串成一条不断链的流程
  - **稿件管理**：新建稿件自动带 Abstract / Introduction / Related Work / System Model / Method / Experiments / Conclusion 默认骨架；可改标题、目标期刊、全稿目标字数与各章节目标字数
  - **写作体验**：自动保存（停笔 800 ms 落盘，`Ctrl/Cmd+S` 立即保存，保存失败保留待写内容并可点重试）；切走页面前把未落盘改动补写，不会「看着在、其实没存」
  - **引用**：右侧搜索文献库，点一下即把 `[@paperId]` 插到光标处并恢复光标位置；已引用文献打勾
  - **自动编号**：引用编号按正文**首次出现顺序**生成，删段或调序后自动重排；服务端 `resolveManuscriptReferences` 为唯一编号来源，**预览与导出用的是同一份数据**，不会出现两边对不上
  - **缺失引用可见**：`[@id]` 指向的文献在库里不存在时，仍占号并在面板与导出里标红提示，而不是静默丢弃
  - **导出**：`/api/writing/manuscripts/:id/export?format=md|txt`，md 带标题、章节层级与规范化参考文献（IEEE 风格）；不支持的格式显式 400，不做静默回退；中文文件名走 RFC 5987 `filename*=UTF-8''`，不出现乱码
  - 字数统计按中英混排分别计数（CJK 按字、拉丁按词），并自动剔除 `[@..]` 标记、代码块与链接
  - 新增 `tests/lib/writing-draft.test.ts`（29 例）覆盖计数、编号、缺失引用、导出与文件名净化；迁移测试补充 `Manuscript` 表 / 索引 / 列的存在性断言

### 修复

- **INET runner 启动失败会打崩整个后端**：`InetRunner.run` 未监听子进程的 `'error'` 事件。实测 `opp_run` 不存在时只 emit `'error'`、不再 emit `'close'`，EventEmitter 无监听者即抛未捕获异常 → 进程直接退出；而该调用位于 fire-and-forget 的异步 IIFE 中，等于一次失败的实验让整个内部服务消失（用户侧表现为界面失去响应）。现已统一收敛为「resolve 成 failed + 可操作提示」
- **测试套件跑完不退出，会让 CI 卡死**：`vitest run` 在本项目里全绿后进程不退出（既有问题，改动前的基线同样复现），会使发布工作流的 `Unit tests` 步骤一直挂到 GitHub 默认的 6 小时上限，安装包永远发不出来。改用 `pool: 'threads'`（实测连续多次稳定退出），并给发布 job 加 `timeout-minutes` 兜底
- **未知导出格式静默回退**：`/api/notes/export/:id?format=tex` 原先不报错、静默返回 md（用户以为拿到 tex，实际是 md），现改为显式 400 并列出支持的格式
- **E2E 分区断言失真**：`e2e/sections.spec.ts` 文案写死「11 个分区」而实际侧边栏有 12 项、且断言未覆盖「使用说明」，长期无人发现。改为数量从列表派生并补齐全部分区
- **`electron-builder.yml` 用了不存在的键 `win.locales`，导致打包直接失败**：electron-builder 26 的语言包选项叫 `win.electronLanguages`；写成 `locales` 会让 JSON schema 拒绝整个 `win` 段并终止打包，报错仅一句 `configuration.win should be one of these: null`，不指向具体字段。**CI 的发布 job 会因同样原因失败，即 v1.2.2 的 Release 从未产出可用安装包。** 已改为 `win.electronLanguages` 并在本机跑通完整打包链路

## [1.2.2] - 2026-09-15

- 新增：导出 Markdown 直接写入 Obsidian vault，交给 Obsidian 管理（详见 1.2.3 条目）
- 修复：INET runner 子进程启动失败导致后端进程退出
- 修复：测试套件全绿后进程不退出，改用 `pool: 'threads'`

## [1.2.1] - 2026-09-15

桌面端打包与升级链路的可靠性修复，并大幅削减安装包与运行时体积。**建议桌面版用户升级**——本次修复了"升级后不生效"的隐患，并解决内存占用偏高问题。

### 修复（桌面端 / 打包链路）

- **解压改为 fail-safe 原子替换**：`desktop/main.js` 的 `ensureAppExtracted()` 不再"先删后解压"。改为先解压到 `app.new` 并校验，通过后再原子改名替换，成功写入 `.extract-ok` 完整性标记；任一步失败均保留原目录，不会把可用安装破坏成打不开
- **standalone 裁剪由黑名单改为白名单**：`desktop/prepare-standalone.js` 的 `pruneStandalone()` 顶层仅保留 `server.js` / `package.json` / `node_modules` / `.next` / `public`，递归清除 `*.tmp*`、非 sqlite 的 `wasm-base64`、`*.map`、`*.d.ts`。实测 standalone 由 **607 MB 降至 92.9 MB**
- **Next tracing 补挡测试/开发目录**：`outputFileTracingExcludes` 增加 `test-results` / `playwright-report` / `e2e` / `tests` / `docs` / `.github` / `db` / `*.db`（曾实测 `test-results` 被 tracing 拷入 **366 MB**）
- **Chromium 语言包裁剪**：`electron-builder.yml` 仅保留 `zh-CN` / `en-US`，去掉其余 53 个语言包（约 **47 MB**）

### 工程卫生

- 移除已完全合并的 `feature/inet-lab` git 工作树与本地分支
- 归档并移除两个早期废弃仓库（初版四 demo 之一的 `AI-net` 教学仿真前端、更早的 `智谱AI` 分支）——功能已并入正式源码 v1.2，删除不造成功能缺失

## [1.2.0] - 2026-09-10

补齐「Zotero → 本软件 → Obsidian」单向断裂的科研工作流。导入/同步**不会**自动调用 LLM。

### 新增

- **论文阅读笔记导出 Markdown / PDF / TXT**：论文详情页「导出笔记」走 `/api/papers/:id/notes`，导出的是这一篇的阅读笔记正文（含三遍阅读记录），可直接丢进 Obsidian
- **科研笔记服务端导出 MD/PDF**：`/api/notes/export/:id`，桌面端不再依赖前端 Blob 拼文件
- **论文库 CSV 是论文列表**：UTF-8 BOM + 题名/作者/期刊/年份/DOI/状态/标签等列，不再把笔记正文当成导出主体
- **导入 RIS / BibTeX**：Zotero/EndNote 导出内容粘贴即写入论文列表，按 DOI / Zotero key / 标题去重合并
- **导入 PDF 入库**：PDF 落到本机 `library/pdfs/`，可挂到已有论文或新建条目；**不解析、不送 LLM**
- **Zotero Web API 同步**：设置页填写 User ID + API Key，论文库一键「同步 Zotero」拉条目元数据

### 修复

- 桌面端升级时对 `Paper.doi` / `zoteroKey` / `pdfPath` 做无损 `ALTER TABLE`
- 论文库文案从「Zotero 风格」改为真实工作流说明，避免误导成已对接 Zotero

## [1.1.0] - 2026-08-27

> 完整发布说明见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。本版重点：科研笔记阅读思考模板 + Excel 导出、内置技术应用说明书、Electron 升级后不更新的修复。

### 新增

- **科研笔记「阅读思考模板」**：文献笔记（分类=文献笔记）升级为结构化思考模板文档，阅读时逐项填写——作者、题目、期刊、术语记录、参考文献导入、研究方法、研究对象、理论框架、创新点、局限性、对我的启发（`Note.structured` JSON 字段 + `lastReadAt` 记录最近阅读时间）
- **一键导出 Excel (.xlsx)**：文献笔记可一键导出为 xlsx，列含「作者 / 题目 / 期刊 / 最近一次读的日期」，服务端 SheetJS 生成（`GET /api/notes/export/xlsx`），单测锁定表头与字段映射
- **Electron 桌面应用封装**：`npm run desktop:start`（开发直跑）与 `npm run desktop:dist`（NSIS 安装包）。内部以 `ELECTRON_RUN_AS_NODE` 子进程拉起 Next standalone 服务，绑定 `127.0.0.1:<随机空闲端口>`——仅回环可达、不暴露固定端口；数据库模板随包携带、首次启动落位用户数据目录，目标机器无需安装 Node.js

### 修复（桌面端 / 数据库迁移）

- **修复桌面版升级后仍显示旧界面**：`ensureAppExtracted()` 原先只判断 `resources/app/server.js` 存在与否，导致升级重装时旧解压目录残留、新 zip 永不被解压（一直用旧代码）。现以 Next 的 `BUILD_ID` 为版本标识，启动时对比新 zip 与已解压目录的版本，不一致则删除旧目录重新解压，确保每次更新后加载最新代码
- **Next standalone 漏追 `xlsx` 依赖**：`outputFileTracingIncludes` 显式把 `node_modules/xlsx` 纳入 standalone，修复桌面版 `/api/notes/export/xlsx` 的 `Cannot find module 'xlsx'`
- **旧数据库缺新列的无损迁移**：`desktop/main.js` 新增 `migrateDatabase()`，启动时用 `node:sqlite` 检测缺列并 `ALTER TABLE` 补齐（`Note.structured`/`lastReadAt`），保留既有数据，升级桌面版不再因缺列报错

### 新增

- **技术应用说明书（内置使用说明文档页）**：新增「使用说明」功能区，DeepSeek API 文档风格——左侧章节导航 + 右侧正文，含面包屑、PARAM/VALUE 配置表（base_url/api_key/model）、服务商预置表、API 端点速查、代码示例（带复制）、FAQ 折叠。覆盖快速开始 / 功能模块地图 / 接入 AI 助手 / API 端点速查 / 数据与备份 / 常见问题 6 章节
- 入口集成：侧边栏「系统」组新增「使用说明」导航项；首页「总览仪表盘」hero 新增「使用说明」按钮；新手引导最后一步新增「查看使用说明」直达链接

### 文档

- `KNOWN_ISSUES.md`：记录测试中发现的工程问题与规避方法（xlsx 漏追、旧库迁移、Electron 二进制下载拦截、旧笔记结构化字段为空、控制台 GBK 乱码等）
- README 功能表新增「📖 内置文档」说明
- `next.config.ts` 启用 `output: "standalone"`（增量产物，Web 部署方式不受影响）
- 桌面壳层 `desktop/main.js`：空闲端口申请、内部服务健康等待、外部链接移交系统浏览器、服务异常退出联动关窗

### 修复

- 清零全部 6 条 ESLint 警告（`react-hooks/set-state-in-effect`）：`useFetch` 重构为 await 后赋值 + 卸载竞态守卫；`useIsMobile` 改用 `useSyncExternalStore` 订阅 matchMedia；命令面板防抖搜索的 setState 全部移入定时器回调；其余两处挂载取数与 shadcn/ui 上游模式加定向豁免注释

### 新增

- **浏览器端到端测试**（Playwright，15 用例）：11 个功能分区的导航渲染回归（历史运行时崩溃防线）+ 三条关键工作流（论文添加全流程、仿真实验出指标、设置页无 Key 中文引导），本地复用运行中的 dev server，CI 自动拉起全新实例
- **CI 新增 e2e job**：Node 22 上安装 Chromium 后执行单测 + 浏览器套件，失败自动上传 trace 报告产物

### 新增（测试基建）

- **单元测试套件**（Vitest，41 用例）：
  - 仿真引擎：同参数两次运行字节级一致的确定性快照回归（覆盖三种算法 × 三类拓扑 × Drop-Tail/RED × 优先级调度）、预热包剔除计数、拥塞物理合理性（大队列显著提升交付率）、故障收敛时间非空、指标体系形状完整性
  - Q-Learning："同一 Q 表先后训练两个目的地互不污染"的核心回归测试（锁定"状态含目的地"修复）、训练曲线 ε 单调性、成功率上界、失败如实回退
  - 拓扑/RNG：三拓扑种子化确定性生成（锁死 Math.random 缺陷不再复发）、流派生独立性
  - LLM 网关：配置优先级（数据库 > 环境变量 > 默认）、Key 脱敏、URL 尾斜杠归一、上游 401 错误消息透传、空回复/连接拒绝的中文错误映射
- **CI 工作流** `.github/workflows/ci.yml`：push / PR 时在 Node 20 与 22 双版本矩阵上自动执行 prisma generate → typecheck → lint → test → 生产构建
- `npm test` / `npm run test:watch` 脚本

## [1.0.0] - 2026-08-16

首个正式开源版本。由四个独立 demo（科研仪表盘原型、AI-net 教学仿真前端、5G NR 调度器 Python 仿真、Mesh MARL 训练框架）整合重构为一个全栈单仓项目。

### 新增

- **LLM 网关（BYO API Key）**：`src/lib/llm` 统一接入任意 OpenAI 兼容接口（智谱 GLM / DeepSeek / OpenAI / Ollama），应用内「系统设置」页可配置并一键测试连通，Key 脱敏存储于本地 SQLite，应用内配置优先于环境变量。
- **组网仿真引擎** `src/lib/sim`（纯 TypeScript、零外部依赖）：
  - mulberry32 + FNV-1a 流派生的种子化 RNG，保证实验字节级可复现
  - 环形骨干 / Spine-Leaf / Mesh 三类拓扑模板，均由 (seed, 参数) 确定性生成
  - 二叉堆 Dijkstra（最短时延 / 负载感知两种代价权）路由
  - 目的地感知 Q-Learning 路由：状态 = (当前节点, 目的地)，完整 ε-greedy 训练闭环，输出训练曲线，学习失败时如实上报回退
  - 离散事件引擎：URLLC/eMBB/mMTC 三流业务、有向边独立排队（FIFO/严格优先级调度 × Drop-Tail/RED 队列策略）、逐跳误码丢包、链路故障注入与收敛时间测量
  - 指标体系：交付率、吞吐、时延分位数(P50/P95/P99)、抖动、排队时延、峰值队列深度、流公平 Jain 指数、链路负载公平 Jain 指数、丢包原因分解
  - 多种子批量运行与均值 ± 标准差汇总
- **仿真实验 API 与界面**：`POST /api/sim/run`、实验历史持久化（SimRun 模型）、参数面板 / 指标卡片 / 训练曲线 / 三算法一键对比 / 历史记录管理。
- **系统设置模块**：LLM 服务商预设、Base URL / 模型 / Key 管理、连通性测试。
- 保留并整备原仪表盘全部 9 大科研模块与 27 个 API（论文库、检索、选题、实验、规划、写作、笔记、方法论、统计）。

### 修复（相对原始 demo）

- 移除沙箱专用 `z-ai-web-dev-sdk`，AI 功能脱离特定云环境可用
- Mesh 拓扑不再使用 `Math.random()`（原版刷新即变，无法复现）
- Q-Learning 状态加入目的地维度（原版多流共享 Q 表互相污染）；训练量 12 → 300 episode；失败不再静默回退 Dijkstra
- 单一确定性事件引擎替代「动画引擎 + 批引擎」双轨不一致结构
- 生产构建不再忽略 TypeScript 错误（`ignoreBuildErrors` 已移除），`npm run typecheck` 全量通过

### 工程

- 干净仓库：去除沙箱残留（Caddyfile、bun.lock、.zscripts、tool-results 等）
- 跨平台 npm 脚本（不再依赖 bun / bash 特有语法）
- MIT License、双语 README、架构文档、CHANGELOG、.env.example、.gitignore
