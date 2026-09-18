# Changelog

本项目的所有显著变更都记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/)。

## [1.3.4] - 2026-09-18

**这一版修的是「装了 1.3.3 之后应用根本打不开」。** 这不是个别环境问题 —— 1.3.3 的安装包对**所有**用户都是坏的，而且它骗过了当时所有的检查。

### 修复

- **打包产物里带着指向构建机路径的符号链接**（真因）。Next 的 `outputFileTracing` 会在 `.next/standalone/.next/node_modules/` 下，为被外部化的依赖创建**指向构建机项目根 `node_modules` 的绝对符号链接**。1.3.3 的包里实测是这两条：
  ```
  .next/node_modules/pdfkit-<hash>          -> //?/D:/a/glm-test/glm-test/node_modules/pdfkit
  .next/node_modules/@prisma/client-<hash>  -> //?/D:/a/glm-test/glm-test/node_modules/@prisma/client
  ```
  （`D:/a/<org>/<repo>` 是 GitHub Actions windows runner 的固定工作目录 —— 所以这个缺陷只在 CI 打包时产生，本地开发机上看不出来。）而 **bsdtar 会把符号链接原样存进 zip**。用户机器上 `D:/a/glm-test/...` 并不存在，解压时建不出链接，于是**退化成 0 字节的空文件**：
  ```
  require('@prisma/client-<hash>') 拿到空模块
    → TypeError: r.PrismaClient is not a constructor
    → GET /api/settings/llm 返回裸 500（这条路由没有 try/catch）
    → 壳层探针 waitForServer() 只认 statusCode < 500，永远等不到成功
    → 90 秒后弹出「内部服务启动超时」，应用退出
  ```
  这也解释了 1.3.3 首次启动时那个看起来完全不同的报错 —— `tar.exe: .next/node_modules/pdfkit-<hash>: Can't create ...: Invalid argument`。**两条报错同一个根因**：`Invalid argument` 正是「建不出这个链接」的报错。1.3.3 加的退避重试只是让解压那一步侥幸过去了，应用随即换下一个症状继续死。
- **`prepare-standalone.js`：打包前把符号链接落成真实副本。** 新增 `dereferenceSymlinks()`，在 `pruneStandalone()` 之后遍历 standalone，把所有符号链接替换成从真实目标复制来的普通目录；**断链不能一删了之**（删掉就变成 `Cannot find module`），单独收集后由新增的 `assertNoBrokenLinks()` 以 `exit 1` 拒绝出包
- **`prepare-standalone.js`：对最终 zip 加硬断言。** `packStandalone()` 打包完成后用新增的 `listZip()` + `findSymlinkEntries()` 再验一遍**最终产物**里符号链接条目必须为 0，否则打印命中的条目并拒绝出包。宁可打包失败，也不再发一个所有用户都装不起来的包

### 为什么之前的检查都没发现

**这个故障能骗过字节级比对。** 把 `app.zip` 解到干净目录再逐文件比 SHA-256 会得到「完全一致」—— 因为两边同样是 **0 字节的空文件**，哈希当然相同。同理，`resources/app/` 里的文件也「都在」。唯一能暴露它的办法是**真的把内部服务跑起来，探一次 `/api/settings/llm` 要求 200**。

### 如果你已经装了 1.3.3（不用重装即可恢复）

把 `<安装目录>\resources\app\.next\node_modules\` 下那两个 0 字节文件删掉，从**同一棵目录树**里的 `node_modules\pdfkit` 与 `node_modules\@prisma\client` 整目录复制过去（后者 41 个文件 / 14.55 MB，**必须包含 `runtime\query_engine-windows.dll.node`**）。注意别触发重新解压，否则会被坏 zip 覆盖回 0 字节。

### 验证

- 新增 `tests/desktop/prepare-standalone.test.ts`（8 例）：用 1.3.3 真实 `tar -tvf` 输出的那两行做**回归指纹**；junction 夹具下验证链接落成真实副本、且**真实 `node_modules` 不被连坐破坏**（`fs.rmSync(链接, {recursive:true})` 是否跟随链接已实测排除）；断链被拦下且保留原样；对真实 `resources/app.zip` 端到端跑通 `listZip`
- 全量单测 22 个文件全通过，`tsc --noEmit` 零错误
- 本机起真服务验收：剥掉宿主注入的 `ELECTRON_RUN_AS_NODE` 后启动客户端，5 个进程、窗口标题 `AI Network Lab 1.3.3`、内部服务就绪，`/`、`/api/settings/llm`、`/api/papers`、`/api/notes`、`/api/topics`、`/api/experiments` 全部 200

## [1.3.3] - 2026-09-17

**这一版修「点了更新就闪退、版本还是旧的」。** 下载从来就没问题（1.3.2 的安装包完整躺在更新缓存里，字节数与 Release 资产一致）；问题全在**安装那一步**：应用退出了，安装器却没装成。

### 修复

- **`quitAndInstall()` 少了两个参数，导致安装器装完不会把应用拉回来。** electron-builder 的 NSIS 模板里（`templates/nsis/installSection.nsh` 末尾），`oneClick: false`（本项目如此）的安装器执行「装完自动启动应用」的条件是 `${if} ${isForceRun} ${andIf} ${Silent}` —— **只有静默安装才拉得起来**。原先调的是无参 `quitAndInstall()`（等价 `isSilent=false`），用户看到的正是「点一下更新 → 应用消失 → 手动打开还是旧版本」。现改为 `quitAndInstall(true, true)`，等价命令行 `--updated /S --force-run`
- **「点完更新，界面显示异常」的真因：在确认安装会启动之前就把内部服务杀了。** `applyUpdateAndRestart()` 原先先 `serverProc.kill()` 并置 `app.isQuitting`，再调 `quitAndInstall`。但 `quitAndInstall` 是「立即返回、随后才去拉起安装器」，而 `install()` 可能失败（更新缓存被清、安装器被安全软件拦下、spawn 报 EACCES 等）—— 失败时应用并不会退出，而此时内部 Next 服务已经被杀掉，界面上所有接口一起失败，看起来就是整个界面坏掉。现在把服务交给正常退出流程（`before-quit`）去收：`app.quit()` 紧随 `install()` 之后，释放 `resources/app` 句柄的时机依然早于安装器动手
- **新增「安装没启动」守护**：`quitAndInstall` 只在 `install()` 成功时才会真的退出应用。现在 5 秒后复查，应用还活着就明确回传 `install-not-started` 并弹框说明原因与下一步，而不是让用户对着一个「点了没反应的窗口」猜
- **更新链路第一次有了落盘日志**：新增 `%APPDATA%\ai-network-lab\logs\update.log`（electron-updater 的内部日志也接进同一文件），记录版本、检查结果、**安装包真实落盘路径**、`quitAndInstall` 收到的参数。打包后的应用没有控制台，本次排查时应用侧一行痕迹都没有，只能靠安装目录里一个 178 字节的 `debug.log` 和更新缓存残留倒推
- **下载 / 安装阶段的失败现在会回传到界面**（此前 `error` 事件只写日志）。后台静默检查失败仍然不打扰用户 —— 开机就弹错误框是不可接受的 —— 但用户主动点过按钮之后的失败必须让他看见
- **状态行不再自相矛盾**：手动检查的结论此前会永久压住之后推来的状态，于是「已下载完成、按钮已是『立即重启并安装』」的卡片里还写着「点『下载更新』」。现在一旦进入下载 / 已下载 / 出错 / 版本冲突，就清掉那份过期的检查结论
- **更新卡片底部加了手动兜底入口**：直达发布页。桌面端安装器要先清理旧版本目录，只要还有程序占着安装目录，这一步就会卡住 —— 这种情况应用内更新无解，必须留一条能走通的路

### 排查记录：这次到底卡在哪

本机装的是 **v1.2.4**（一个从未发布过的本地构建）。四条现场证据：

1. `%LOCALAPPDATA%\ai-network-lab-updater\pending\` 里躺着 `AI-Network-Lab-Setup-1.3.2.exe`，**125,009,264 字节，与 Release 上的资产逐字节一致**，`update-info.json` 里的 `sha512` 也在 ⇒ **下载是成功的**，问题不在下载
2. 安装目录里出现一个 `debug.log`，只有两行 `FATAL:gin\v8_initializer.cc:675] Error loading V8 startup snapshot file` ⇒ 有一个 Electron 进程从安装目录启动后**直接 FATAL 退出**（这就是「闪退」本体）：那一刻目录处于不一致状态，`snapshot_blob.bin` 不在原位
3. **安装器进程始终没有退出**（`AI-Network-Lab-Setup-1.3.2.exe`，窗口标题「AI Network Lab 安装」，CPU 只消耗了 1.6 秒，无子进程），`%TEMP%\nsXXXX.tmp` 里留着 `old-uninstaller.exe` ⇒ 卡在 NSIS **「先跑旧卸载器清空旧目录」**这一步
4. 机制在模板里写得很明白（`templates/nsis/uninstaller.nsh`）：更新时旧卸载器要把 `$INSTDIR` 整个**改名**到 `$PLUGINSDIR\old-install`（`un.atomicRMDir`），失败则 `restoreFiles` 再 `Abort`。而 **Windows 不允许改名一个「内部还有文件被别的进程打开」的目录** —— 只要有任何程序占着安装目录（把它当工作目录的编辑器 / 知识库工具、同步盘、索引服务、杀软），这一步就会被挡下，留下一个半还原的目录，应用下次启动便 FATAL 在 V8 快照上

⇒ 结论是**代码缺陷（上面前三条）+ 环境约束（安装目录被占用）**。后者无法在应用侧修复，只能在 UI 与配置注释里给出可执行指引：不要把安装目录当工作目录用；安装器卡住时可以直接结束那个 `AI-Network-Lab-Setup-*.exe` 进程 —— 它握着安装互斥量，不结束的话之后每次安装都会立刻被中止（本次排查就是这么处理的）

### 验证

- 新增 `tests/desktop/updater-contract.test.ts`（8 例）：用 `vm` 把 `desktop/main.js` 载入受控上下文后直接断言 IPC handler —— `quitAndInstall` 必须收到 `(true, true)`、安装前不得杀内部服务、开发模式不得安装、失败要回传 `install-not-started`、日志要落盘、`electron-builder.yml` 的 `publish` 段必须保留。这些约束**不会**让类型检查或任何既有用例变红，只能靠契约断言守住
- 全量单测 277/277 通过（原 269 + 新增 8），`tsc --noEmit` 无错
- 本机核实：终止卡死的安装器后，安装目录 1.2.4 各文件（`AI Network Lab.exe` / `snapshot_blob.bin` / `v8_context_snapshot.bin` / `resources\app\server.js`）完好，应用仍可用；1.3.2 安装包仍留在 `pending/` 缓存中，重试无需重新下载

## [1.3.2] - 2026-09-17

**这一版只有一个目的：让安装包真的出现在 Release 里。** v1.3.0 与 v1.3.1 连续两次「job 全绿但 Release 里只有 `.exe.blockmap`」，用户根本下载不到安装包。本版把发布链路的上传环节整个换掉，并加上能拦住这类问题的硬自检。

### 修复

- **弃用 `electron-builder --publish always`，上传改由 `gh` CLI 显式完成**。根因是 electron-publish 的上传路径存在**多处静默放弃**，而它们都不影响退出码（源码 `electron-publish/out/githubPublisher.js`、`app-builder-lib/out/publish/PublishManager.js`）：
  - `getOrCreateRelease()` 在「已存在的 Release `published_at` 超过 2 小时」（除非设 `EP_GH_IGNORE_TIME=1`）、「Release 类型与 `releaseType` 不匹配」等情况下返回 `null`；随后 `doUpload()` 只打一条 `log.warn("skipped publishing")` 就 **return**，不算失败
  - 构建报错时 `app-builder-lib/out/index.js` 会 `publishManager.cancelTasks()` 并把结果换成 `Promise.resolve(null)`，上传任务被丢弃且**不报错**
  - `PublishManager.awaitTasks()` 在 cancellation token 被取消时**直接 return**，连 `latest.yml` 都不会写出来
  现在的分工是：`npx electron-builder --win --publish never` 只负责构建（`publish` 段保留在配置里，`latest.yml` / `app-update.yml` 照常生成），上传交给 `gh release upload --clobber`（失败必然非 0 退出，且同 tag 重跑幂等）
- **上传前新增「本地产物自检」**：断言 `release/*.exe` 与 `release/latest.yml` 都存在，缺失即失败。这一步专门拦「没有更新清单的发布」——`latest.yml` 是 electron-updater 判断有无新版本的唯一依据
- **发布后自检升级为「按字节数核对」**：原先只查 Release 里有没有 `*.exe` 与 `latest.yml`（能发现 v1.3.0 那种全缺），现在还会解析本地 `latest.yml` 里声明的 `path` / `size`，与实际资产的**名字和字节数**逐一比对 —— 这样连「传了一半」的截断上传也拦得住
- **备份工件改为 `if-no-files-found: error`**：此前是 `warn`，产物缺失时只打一条警告就滑过去了
- **新增 `release-cleanup.yml`（手动触发）**：用于删掉「发了但没发成」的残缺 Release（只删 Release、保留 tag）。Releases 页面上残缺版本和平常版本长得一样，点进去却没有包可下，删掉比留着解释便宜

### 关于 v1.3.0 与 v1.3.1 两次发布（如实记录）

两次的 Release 都**只有**一个 `.exe.blockmap`。已确认：v1.3.1 的资产上传发生在该次 run 的时间窗内（run 约 03:22Z 起，blockmap 资产时间 `03:25:42Z`），排除了「Release 已存在超 2 小时」这一条；单次运行里只传上 blockmap 的确切触发点**未能 100% 复现**（读 job 日志需要仓库管理员权限，本机只能读到 run 的注解）。因此本次采取的修法是**不再依赖那条路径 + 加上可信自检**，而不是继续猜 electron-publish 的内部状态。

### 验证

- `release.yml` 的发布段改为「构建 → 本地产物自检 → `gh release upload` → 远程资产核对（名字 + 字节数）」，并保留 `concurrency` 锁
- 通过 `gh` 与 Release 资产页确定性核对：v1.3.0 / v1.3.1 的 Release 资产均为 1 个（`.exe.blockmap`），`*.exe` 与 `latest.yml` 的下载地址均返回 404
- 实际验收标准：本版 Release 里同时存在 `AI-Network-Lab-Setup-1.3.2.exe`、`latest.yml`、`*.blockmap`，且 exe 字节数与 `latest.yml` 中 `size` 一致

## [1.3.1] - 2026-09-17

修补 v1.3.0 发布之后才暴露出来的问题。**v1.3.0 的 Release 实际是残缺的（既没有安装包、也没有 `latest.yml`），请直接装这一版。**

### 修复

- **安装包文件名去掉空格**。`nsis.artifactName` 原为 `${productName}-Setup-${version}.${ext}`，而 `productName` 是 "AI Network Lab"，所以磁盘上生成的文件名带空格；但传到 GitHub Release 后资产名里的空格被规范化成了连字符（v1.3.0 的 Release 里看到的正是 `AI-Network-Lab-Setup-1.3.0.exe.blockmap`）。**而 electron-updater 是照着 `latest.yml` 里记录的 `path` 去拼下载地址的** —— `latest.yml` 由 electron-builder 生成、记的是带空格的原名，与 GitHub 上的实际资产名对不上，更新会卡在「下载」这一步，且报错很难指向真正原因。现改为 `AI-Network-Lab-Setup-${version}.${ext}`，让**磁盘文件名 / GitHub 资产名 / `latest.yml` 里的 path 三者字面一致**
- **发布流程新增「发布后资产自检」**：`release.yml` 在 publish 之后会核对 Release 里是否**同时**存在 `*.exe` 与 `latest.yml`（带 6 次重试，容忍资产短暂延迟），缺任何一个就让 job **失败**。自检刻意放在上传备份工件**之前** —— 这样自检失败时完整的 `release/` 仍会作为 `windows-installer` 工件留下，可以手动补挂，不必重新构建
- **发布加并发锁**：`concurrency: release-<ref>`，避免同一 tag 的两次发布会互相覆盖 Release 资产
- **CI 三个 job 全挂在一个 PDF 导出单测**：`buildSimplePdf` 找不到中文字体时会**显式抛错**（这是刻意的，绝不静默产出一份只有拉丁字形的「中国字」PDF），而 ubuntu runner 默认不带 CJK 字体 —— 本地是 Windows、有 `msyh.ttf`，所以一直没暴露。`ci.yml` 的 `verify` 与 `e2e` 两个 job 各加一步安装 `fonts-noto-cjk`（该包正好提供代码里写死要找的 `/usr/share/fonts/opentype/noto/` 路径）
- **`db-version.test.ts` 在 Node 20 崩**：`node:sqlite` 是 Node 22.5 才有的内置模块，Node 20 上 `process.getBuiltinModule('node:sqlite')` 返回 undefined，于是报 `Cannot read properties of undefined (reading 'DatabaseSync')`。同目录的 `migration.test.ts` 早就有 `describe.skipIf(!sqlite)`，这个文件漏了同一句，补上

### 关于 v1.3.0 那次发布（如实记录）

v1.3.0 的发布 job **所有步骤全是绿灯**（`Release #3`，2m59s），但 GitHub Release 里最终只有一个 `.exe.blockmap` —— 既没有安装包、也没有 `latest.yml`。用户点下载什么也拿不到，客户端也检测不到更新。同一个 run 的 `windows-installer` 工件有 **119 MB**，说明安装包确实构建出来了、只是没能进 Release。批量提交此前从未被 push 过（1.2.3 / 1.2.4 都没发过），所以 CI 与发布链路的问题是一次性集中暴露的。

### 验证

- 两个 workflow 的 YAML 均通过 `js-yaml` 解析；`db-version.test.ts` 在本机（有 `node:sqlite`）照常跑满 5 例、未被 `skipIf` 跳过
- ⚠️ 本机跑单测时磁盘 I/O 被占满（整套从 1.56 s 变成 41.4 s，`rng.test.ts` 从 0.5 s 变成 20.4 s），导致两条走 `VACUUM INTO` 备份的迁移用例 `Test timed out in 30000ms` —— 属**环境问题、非代码回归**（同一份代码几分钟前还是 269/269 全绿）。完整验证以 CI 为准

## [1.3.0] - 2026-09-17

研究规划模块补完（数据层 / 联动 / 偏差复盘 / AI 助手 / 日历集成）。**建议升级** —— 这一版把全项目唯一「只有界面、没有数据」的模块补成了真正能用的模块，标签页从 5 个增到 8 个。

「研究规划」此前是全项目唯一没接完数据层的模块：5 个标签页只有 2 个能写，UI 做完了但「数据化」没做完 —— 它是从一个「方法论脚本集」（一堆 .py 静态出图）直译过来的。本次把五个方向全部补齐。

### 新增 —— D1：补齐数据层

- **`WeeklyTask` 模型（第 13 个）+ `/api/weekly-tasks`、`/api/weekly-tasks/[id]`**。原先周计划是组件里的 `useState(WEEKLY_PLAN_TEMPLATE…)`，`add/remove/toggle` 全在内存 —— **刷新即丢**，是全项目唯一「纯内存」的功能。现在真落库：
  - `GET ?week=YYYY-MM-DD`：传周中任意一天都会归一到该周周一；参数非法则退回本周，不返回空列表
  - `POST`：`order` 缺省时自动追加到该周末尾（不再依赖前端算序号）
  - `PUT`：白名单局部更新，可勾选完成、改工时/优先级、**跨周移动**
  - 越界数值一律截断（hours 99→24、priority 9→5）而不是 500 —— 用户填 12 小时不该被脏数据判定挡住
- **项目配置 `project.config`（`Setting` KV）+ `/api/settings/project`**。这是 D1 的关键：Gantt 里程碑的 `startDate/endDate` 存的是**周序号字符串**（"0".."39"，同样是从脚本集直译来的表示法），没有项目起始日时「第 12 周」是悬空概念 —— 既答不出是哪个月，也判断不了「现在落后没有」。现在：
  - Gantt 轴显示**真实日期区间**（`01-05 ~ 02-01`），并画出**当前周游标**
  - 「本周可用工时」由配置算出（默认 44h/周），不再是写死的 `available = 44`
  - 未设置起始日时退回只显示周序号，不假装知道日期
- **修复 Gantt 行序错乱**：原先 `orderBy: { startDate: 'asc' }` 对 "0".."39" 是**字符串排序**，"10" 会排在 "2" 前面。改为按**数值**周序号排序（`sortByWeekIndex`），40 行甘特图的顺序才正确
- **首访 seed 补上周计划**：新用户第一次进「研究规划」不再是空表（原先只 seed 了里程碑）
- 组件新增 `ProgressStepper`（±5% 步进，到边界自动禁用）作为统一的**进度写入口**：Gantt、写作时间线、投稿时间表都能直接改进度 —— 原先写作时间线**没有任何写入口**，且用 `title === name` 字符串匹配取进度 + seed 里 7 条 `type='writing'` 里程碑 `progress: 0`，导致「总工时完成度」**永远是 0%**

### 新增 —— D2：枢纽化联动（里程碑 ⇄ 实验/稿件）

- `Milestone` 新增 `refType` / `refId` / `autoProgress`：里程碑可以指向一个**实验**或**稿件**
- `POST /api/planner/sync`：按关联实体的状态派生里程碑进度
  - 实验 `planned→0 / running→60 / completed→100 / failed→0`（**失败不推进** —— 失败要人来看，不能替用户宣布完成）
  - 稿件：已投稿 → 100；草稿按字数比例，**封顶 95%**（不投出去就永远不显示「完成」，避免「初稿写完 = 完成」的假象）
- **两条硬规则，避免自动同步变成数据事故**：
  1. **默认关闭**（`autoProgress` 默认 false）。没打开时同步只返回「建议推进到 X%」的提示，**绝不写入** —— 用户手工填的进度不会被一个关联悄悄改掉
  2. **只推进、不回退**。实验被改回 `running` 也不会把里程碑从 100 拉下来
- 为什么做成显式 POST 而不是在 GET 里顺手算完写回去：隐藏写入会让「甘特图自己变了」变得无法解释。现在每一次推进都是用户可见的动作，且返回「改了哪几条、从多少到多少」
- 进度到 100% 时**自动补记实际完成日**（D3 的偏差报告依赖它）
- **通知反向联动**：`/api/notifications` 新增「计划落后提醒」—— 拿项目起始日把周序号换算成真实日期，逾期的里程碑给 `high` 优先级提醒、14 天内的给 `low`。**拿不到起始日就整段跳过**：宁可少一条提醒，也不要按错误的日期催人；逾期超过 90 天的历史残留不再天天催
- Gantt 列表接口批量解析关联实体并附带 `refLabel`（显示「⇄ 实验：xxx」）与 `derivedProgress`（可推进到的值），一次 `in` 查询而不是 N 次

### 新增 —— D3：计划 vs 实际偏差复盘

- `Milestone` 新增 `actualEndDate`（实际完成日）
- `GET /api/planner/deviations`：
  - 默认 JSON（页面用）；`?format=md` 导出 Markdown 报告（可直接贴进组会材料或交给导师）；`?state=behind` 只看落后项
  - 五种状态：提前完成 / 按时完成 / 落后 / 进行中 / 无法判定
  - **已完成但没有实际完成日 → 「无法判定」**，不假称按时
  - 汇总含各状态计数、平均偏差天数、**「最需要处理的」前 3 条**，排序为「落后优先」
  - 与 `/api/notes/export`、`/api/writing/*/export` 一致：**不支持的格式显式 400**（不静默回退）；中文文件名走 RFC 5987 `filename*`
  - 页面与导出**共用同一个计算函数**，保证「看到的」和「导出的」不会各算各的
- 研究规划新增第 6 个标签页「计划 vs 实际」

### 新增 —— D4：AI 规划助手

- **`POST /api/planner/assist` + `src/lib/planner/ai.ts`**（纯逻辑，便于单测）。三种模式：`weekly` 生成本周计划 / `risk` 进度风险体检 / `breakdown` 里程碑拆解。复用既有的 `src/lib/llm` 网关，因此任何 OpenAI 兼容接口（GLM / DeepSeek / OpenAI / Ollama）都能用，Key 仍是用户自己的
- **把「本周可用工时」作为硬约束写进提示词**：不写这条，模型会热情地排出一个 60 小时的一周（提示词里明说「这是硬约束」）。上下文还带上按项目起始日换算后的真实日期，以及每个里程碑的偏差判定（复用 D3 的计算结果）—— 而不是把 Prisma 行原样丢给模型：里程碑行上有 color / category / createdAt 这类纯 UI 字段，既费 token 又容易把模型带偏
- **`extractJsonBlock` 容错解析**：模型经常不听话 —— 套一层 ```json 围栏、前面加一句「好的，这是任务：」。这里逐级降级：先去围栏直接 `JSON.parse`，失败再找配对的 `[...]` / `{...}`。两个容易写错的细节：**括号匹配必须跳过字符串字面量**（否则 `{"name":"[实验 A]"}` 会被截在方括号上）；**必须按出现位置优先试最外层的括号**（`{"tasks":[...]}` 里内层数组虽然更「像数组」，但先试 `[` 会把外层包装丢掉，解析成裸数组 —— 结果碰巧还能用，但语义已经错了）
- **`parseWeeklyPlan` 把模型输出当脏数据处理**：每条都过一遍 `normalizeTaskInput` —— `hours: 999` 截成 24、`priority: 99` 截成 5，缺 `name` 的条目直接丢弃，总数封顶 30 条。**不把越界值写进库**
- **接口刻意无副作用**：只生成、不写库。写入由前端拿返回的 `tasks` 逐条调 `/api/weekly-tasks` 完成 —— 「写进去的就是屏幕上看到的那几条」。如果在接口里顺手写库，用户点第二次「生成」会得到一份**不同**的计划，而库里已经躺了上一份，两边对不上且没人能解释那些任务从哪来。副作用只留在用户明确点击的那个动作上
- **解析失败返回 200 + `parseError` + 原文，而不是 500**：报错会把最有用的信息（模型到底说了什么）丢掉。前端把原文摊开给用户看，可据此手工添加，而不是只看到一句「失败」
- **错误码可判定**：没配 Key 时返回 `400 { code: 'LLM_NOT_CONFIGURED' }`（不是 401 —— 这根本不是鉴权失败，而是功能前置条件没满足），前端据此给出「去设置里填 API Key」的按钮，而不是甩用户一句 400；上游调用失败返回 `502 { code: 'LLM_CALL_FAILED' }`
- **第 7 个标签页「AI 助手」**：选模式 → 填补充要求 → 生成 → 核对 → 「写入本周计划（N）」。逐条写入，中途失败会如实说「已成功 k / N 条」，不假装全成功

### 新增 —— D5：日历集成

- **`GET /api/planner/calendar` + `src/lib/planner/calendar.ts`**：默认返回事件 JSON（月历视图用）；`?format=ics` 导出 `.ics`，可直接导入 Google 日历 / Apple 日历 / Outlook
- **为什么用 ICS 而不是接某个日历 API**：ICS 是 RFC 5545 定义的纯文本，**不需要账号、OAuth、任何网络请求**；而且导出结果是一个字符串 —— 意味着能被单测逐字符锁住。代价是细节极多，所以每个细节单独成函数：
  - **换行一律 CRLF**（RFC 5545 §3.1，只写 `\n` 会被部分客户端判为非法）
  - **按 75 octets 折行，且必须按字节而不是按字符** —— 中文一个字 3 字节，按字符折会在中文标题上直接违反 RFC；续行的前导空格还要**占掉 1 个 octet 额度**
  - **`DTEND` 是排他的**：全天事件区间要写成「结束日 + 1 天」，否则最后一天会丢
  - **TEXT 转义顺序**：必须先转义反斜杠，否则后面为 `;` / `,` 补上的反斜杠会被再转一遍
  - **`UID` 由稳定 id 派生**（不是随机数）：重复导入是**更新**而不是堆一堆重复项
  - **提醒用 `TRIGGER;RELATED=END:-P1D`**（结束前 1 天）而不是默认的「开始前 1 天」—— 对里程碑来说，「截止前一天」才是有用的提醒
  - 全天事件标 `TRANSP:TRANSPARENT`，避免把一整周显示成「忙碌」
- **取不到日期的事件直接跳过，不猜**：未设置项目起始日时，甘特里程碑（存的是周序号）换算不出日期 —— 宁可日历里少一条，也不把「第 12 周」塞成一个错误的日期
- **第 8 个标签页「日历」**：6×7 月历网格，**以周一为一周之始**，与 `startOfWeekIso` 的周计划口径保持一致（两处周界不一致会让「本周任务」和日历上这一行对不上）；点某天在下方看当天事件详情；一键导出 `.ics`。网格在客户端本地算，切月不再打接口
- 页面与导出**共用同一个 `buildCalendarEvents`**，保证「看到的」和「导出的」同源

### 修复

- **`PUT /api/milestones/[id]` 改为白名单更新**。旧实现直接把请求体透传给 Prisma（`db.update({ data: body })`），前端多传一个 UI 用的字段就抛错 → 500。现在非法字段被忽略，`progress` 夹在 0–100（非法值 400），不存在的 id 返回 404（原先会冒成 500）
- **不允许写入「半截关联」**。`refType` 与 `refId` 必须成对：只给类型没给实体、或只给实体没给类型的，**整对置空**。否则 `/api/planner/sync` 会扫到一批永远解析不出实体的行，白白多查一次。`refType` 置空时会连带清掉 `refId`/`autoProgress`
- 新增 `refType`/`refId` 联合索引 `Milestone_refType_refId_idx`
- 给 `Milestone.startDate` 的**一字段两语义**（甘特图存周序号 / 投稿与写作存 ISO 日期）补上注释，并让读取端统一走 `plannedStartIso`/`plannedEndIso` 处理，不再靠 `type` 硬编码区分

### 迁移与打包

- `desktop/migrate-database.js`：新增 Milestone 的四列、`WeeklyTask` 表与其两个索引、`Milestone_refType_refId_idx`；**表不存在时跳过建索引**（避免在老库上 `no such table` 直接让启动失败）。DDL 由 `prisma migrate diff --from-empty --to-schema-datamodel` 生成后原样搬入，保证与 Prisma Client 预期一致。老库升级仍走 `VACUUM INTO` 备份 + 事务，**无损**
- **重新生成打包模板 `resources/db-template/custom.db`**（184 320 → 208 896 B，14 张表）：全新安装的用户**不跑迁移就能用**周计划与偏差复盘。已核对该模板跑 `migrateDatabase` 的结果为 `changed: false`
- 本机开发环境**没有重新构建前端、也没有打包**（`next build` 的类型检查阶段在本机会无限挂起，见 `KNOWN_ISSUES.md`）—— 前端构建与 NSIS 打包交给打 tag 后的发布 CI（`npm run desktop:build` + `electron-builder`），本地不重复跑一遍已知会挂的流程

### 验证

- `tsc --noEmit` 0 错、`eslint .` 0 错
- 单测 **269/269**（19 文件；新增 `planner-schedule.test.ts` 21 例、`planner-linkage.test.ts` 30 例、`planner-ai.test.ts` 27 例、`planner-calendar.test.ts` 38 例，并重写 `migration.test.ts`、修正 `db-version.test.ts` 的「干净库」fixture —— schema 增长后该 fixture 必须同步增长，否则会把「结构已最新」误判成需要迁移）
- **接口端到端 156/156**（`.recon/verify-planner/run.mjs`）：拿新模板复制一份临时库 → 真起 `next dev` → 真打 HTTP 接口 → **最后直接读 SQLite 文件**核对确实落库（证明不是又一个内存态）。断言覆盖：配置局部更新/脏数据归一化、周计划的按周隔离与跨周移动、白名单不写入多余字段、数值排序、半截关联、进度夹取与自动补记完成日、同步的「只推进不回退 / 幂等 / 关联不存在时不动」、偏差的日期换算与排序、Markdown 导出不含 `undefined`/`NaN`、不支持的导出格式 400、通知的逾期提醒
- **D4 / D5 的端到端另起一段本地假 LLM 服务**：脚本内用 `http.createServer` 起一个 OpenAI 兼容端点，再经 `PUT /api/settings/llm` **正规地**配置 baseUrl + apiKey，因此 AI 助手这条链路是「真发 HTTP 请求、真回 JSON、真解析」——而不是把 `chatComplete` mock 掉（mock 掉就测不到「提示词里到底写了什么」「Bearer 有没有带上」）。覆盖：未配 Key → 400+`LLM_NOT_CONFIGURED`、Bearer 与模型名确实取自配置、提示词含周可用工时/补充要求/换算日期、生成不写库、围栏+废话可解析、越界数值被截断、非 JSON 不返回 500 且保留原文、按返回值逐条写入后本周真的多出对应条数、breakdown 提示词点名里程碑、risk 返回 Markdown 且不误报 `parseError`、上游报错 → 502+`LLM_CALL_FAILED`、清空 Key 后立刻回到未配置提示（不会拿着旧 Key 悄悄发请求）。日历侧覆盖：事件数守恒、甘特按起始日换算真实区间、周任务铺满整周、ICS 的 CRLF / 排他 `DTEND` / 稳定 `UID` / `VALARM` / 每行 ≤75 octets / 无裸 CR LF、`format` 大小写不敏感、不支持格式 400
- **未做**：浏览器级 UI 冒烟（本机未安装 Playwright 浏览器，且 C 盘紧张，没有下载）。前端消费的字段名已与上面实测的响应结构逐项核对一致
- 新增脚本 `resources/db-template` 的单独重建工具 `.recon/make-db-template.cjs`（`desktop/prepare-standalone.js` 的 `makeDbTemplate()` 会连带 prune + pack standalone，而本轮只需重建模板、不需要碰 `.next/standalone`）

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
