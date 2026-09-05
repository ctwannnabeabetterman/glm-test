# INET 智能组网实验室 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI Network Lab 产品化为面向 B5G/6G 自组网、室内波束赋形、无人机自组网和空天地一体化组网实验的可复现科研实验室。

**Architecture:** 保留现有 Next.js + Prisma + Electron 工作台和 `src/lib/sim` 纯函数仿真内核，新增 INET 工程适配层作为外部仿真执行器。统一用 Experiment/SimRun 记录场景、参数、种子、工件和指标；浏览器负责编排与可视化，Node/Electron 主进程负责受控启动 OMNeT++/INET、收集结果和打包。

**Tech Stack:** React 19, Next.js 16 Route Handlers, TypeScript, Prisma/SQLite, Electron 44, OMNeT++ 6.x, INET 4.x, Python 3.11（结果解析与报告辅助），Vitest, Playwright。

---

## 产品边界与首个可交付版本

首个版本只承诺离线、仿真优先和可复现，不承诺真实 SDR/射频闭环。交付包含四类内置场景：

- B5G/6G 分层自组网：核心、接入、终端节点，支持链路失效和路由重构。
- 室内波束赋形：房间布局、AP/UE、障碍物和可切换波束码本，输出覆盖率、SINR、吞吐与切换次数。
- 无人机自组网：三维移动轨迹、空中中继、链路随距离和遮挡变化，输出连通性、端到端时延和能耗代理指标。
- 空天地一体化：卫星/空中平台/地面站三层节点，支持可见窗口、传播时延和故障切换。

现有论文、课题、笔记、实验管理和通用组网仿真内容全部保留。INET 场景以插件式适配器接入，不替换当前 JS 仿真内核。

## 文件地图

- Modify: `src/lib/sim/types.ts`，扩展场景、移动性、波束和执行状态类型。
- Create: `src/lib/inet/manifest.ts`，INET 工程清单与版本校验。
- Create: `src/lib/inet/runner.ts`，受控启动 `opp_run`、超时、取消和日志收集。
- Create: `src/lib/inet/results.ts`，解析 `.sca/.vec/.csv` 为稳定指标结构。
- Create: `src/lib/inet/scenarios.ts`，四类场景模板及默认参数。
- Modify: `src/lib/db.ts`、`prisma/schema.prisma`，增加场景、工件、运行状态和指标索引。
- Create: `src/app/api/inet/projects/route.ts`，工程发现、导入和版本检查。
- Create: `src/app/api/inet/runs/route.ts`，运行、取消、状态查询和结果导出。
- Create: `src/components/sections/inet-lab-section.tsx`，INET 工作台主界面。
- Create: `src/components/inet/scenario-editor.tsx`、`inet-run-monitor.tsx`、`inet-results-view.tsx`，场景编辑、运行监控、结果对比。
- Modify: `src/components/app-shell.tsx`、`src/app/page.tsx`，增加入口并保留既有导航。
- Create: `scripts/check-inet.mjs`，本机依赖探测和最小 smoke run。
- Create: `tests/inet/manifest.test.ts`、`tests/inet/results.test.ts`、`tests/inet/scenarios.test.ts`、`e2e/inet-lab.spec.ts`。
- Modify: `desktop/main.js`、`desktop/prepare-standalone.js`、`electron-builder.yml`，打包外部 runner、模板和诊断信息。
- Create: `docs/INET_USER_GUIDE.md`、`docs/INET_SCENARIO_SPEC.md`、`docs/INET_DELIVERY_CHECKLIST.md`。

### Task 1: 建立 INET 工程与版本边界

**Files:** `src/lib/inet/manifest.ts`, `scripts/check-inet.mjs`, `tests/inet/manifest.test.ts`

- [ ] 定义 `InetManifest`：`projectRoot`、`omnetppVersion`、`inetVersion`、`oppRunPath`、`iniPath`、`nedPath`、`resultDir`。
- [ ] 实现 Windows 路径规范化、必需文件检查、版本命令探测和可读诊断；所有错误返回结构化 code/message。
- [ ] 测试有效工程、缺少 `opp_run`、缺少 `omnetpp.ini` 和版本不匹配。
- [ ] `node scripts/check-inet.mjs --json` 输出机器可读诊断，退出码 0/1 分别表示可运行/不可运行。

### Task 2: 扩展领域模型和数据库

**Files:** `src/lib/sim/types.ts`, `prisma/schema.prisma`, `src/lib/db.ts`, `tests/inet/scenarios.test.ts`

- [ ] 新增 `InetScenario`、`InetRunArtifact`、`InetRun` 三个模型，保存场景类型、版本、参数 JSON、状态、日志路径、指标 JSON 和校验哈希。
- [ ] 将参数拆成 `topology`、`mobility`、`radio`、`beamforming`、`traffic`、`failure` 六个明确分区；禁止把不可验证的自由文本当作执行参数。
- [ ] 为 `scenarioType`、`status`、`createdAt` 建索引，运行记录保留输入参数快照以支持复现。
- [ ] 执行 `npm run db:generate` 和 `npm run db:push`，补充默认数据迁移兼容旧 SQLite。

### Task 3: 实现场景模板和参数校验

**Files:** `src/lib/inet/scenarios.ts`, `src/lib/inet/validation.ts`, `tests/inet/scenarios.test.ts`

- [ ] 提供四个模板：`b5g-mesh`、`indoor-beamforming`、`uav-ad-hoc`、`sat-air-ground`，每个模板返回参数、说明、推荐节点对和可用指标。
- [ ] 校验节点数量、坐标范围、频段、带宽、波束码本索引、无人机高度、卫星窗口和随机种子。
- [ ] 用统一 `ScenarioValidationError` 返回字段路径和用户可读中文提示。
- [ ] 测试默认参数可生成、边界参数被接受、越界和缺失参数被拒绝。

### Task 4: 实现 INET 执行器和生命周期

**Files:** `src/lib/inet/runner.ts`, `src/app/api/inet/runs/route.ts`, `tests/inet/runner.test.ts`

- [ ] 通过 `spawn` 启动白名单内的 `opp_run`，参数只来自已校验 manifest 和场景参数，禁止 shell 拼接。
- [ ] 支持 `queued/running/succeeded/failed/cancelled` 状态、超时、取消、stdout/stderr 分离和退出码记录。
- [ ] 每次运行创建独立目录，写入 `run.json`、输入参数、命令摘要、日志和结果文件，并计算 SHA-256。
- [ ] API 提供 POST 创建、GET 状态、POST cancel、GET artifacts；key、环境变量和绝对路径不回传给前端。

### Task 5: 结果解析与指标统一

**Files:** `src/lib/inet/results.ts`, `src/lib/sim/types.ts`, `tests/inet/results.test.ts`

- [ ] 解析 INET scalar/vector/CSV 输出，映射为统一指标：PDR、吞吐、P50/P95/P99 时延、抖动、SINR、覆盖率、切换次数、连通率、能耗代理和收敛时间。
- [ ] 处理空文件、缺失字段、NaN、重复样本和多 run 聚合；保留原始字段名与单位映射表。
- [ ] 输出 `ResultSummary` 和 `MetricSeries`，前端不直接读取原始文件。
- [ ] 用固定 fixtures 测试四类场景各一份，确认解析结果具有确定性。

### Task 6: 工作台 UI 与实验流程

**Files:** `src/components/sections/inet-lab-section.tsx`, `src/components/inet/scenario-editor.tsx`, `src/components/inet-run-monitor.tsx`, `src/components/inet-results-view.tsx`, `src/components/app-shell.tsx`, `src/app/page.tsx`

- [ ] 增加“智能组网实验室”入口，提供场景选择、参数表单、依赖状态、运行按钮和最近运行列表。
- [ ] 场景编辑器按六个参数分区展示；室内场景显示二维平面，UAV/空天地场景显示简化三维轨迹预览，不能阻塞表单操作。
- [ ] 运行监控显示状态、耗时、实时日志尾部、取消按钮和失败诊断。
- [ ] 结果页支持指标卡、时序图、拓扑/轨迹图、算法/场景对比、原始工件下载和“一键生成实验记录”。
- [ ] 使用现有 shadcn/Radix 组件与 Recharts，保留原导航和已有内容；补充移动端折叠布局与空状态。

### Task 7: AI 辅助实验解释与论文产出

**Files:** `src/lib/llm/index.ts`, `src/app/api/inet/runs/[id]/explain/route.ts`, `src/components/inet-results-view.tsx`, `tests/lib/llm.test.ts`

- [ ] AI 输入只包含脱敏后的场景参数、指标摘要和用户选择的工件，不发送 API key、绝对路径或完整原始日志。
- [ ] 提供“解释异常”“比较两次运行”“生成实验记录草稿”三个固定 schema 输出，失败时回退到本地模板。
- [ ] 明确标注 AI 生成内容、指标来源和运行 ID；用户确认后才写入 Note/Experiment。
- [ ] 增加 schema 校验和 provider 不可用时的测试。

### Task 8: 打包、文档与交付验收

**Files:** `desktop/main.js`, `desktop/prepare-standalone.js`, `electron-builder.yml`, `scripts/check-inet.mjs`, `docs/INET_USER_GUIDE.md`, `docs/INET_SCENARIO_SPEC.md`, `docs/INET_DELIVERY_CHECKLIST.md`, `e2e/inet-lab.spec.ts`

- [ ] 支持用户在设置中选择 OMNeT++/INET 根目录，保存路径时只保存本机路径引用，不把工程内容复制进数据库。
- [ ] Windows 安装包包含场景模板、解析器、诊断脚本和示例结果；无 INET 环境时主应用仍可使用现有 JS 仿真。
- [ ] Playwright 覆盖：打开 INET 页面、创建场景、校验错误、启动 mock runner、查看结果、导出工件。
- [ ] CI 顺序执行 `npm run typecheck`、`npm run lint`、`npm test`、`npm run test:e2e`、`npm run build` 和 `node scripts/check-inet.mjs --fixture`。
- [ ] 交付包包含安装程序、版本清单、示例工程说明、已知限制、回滚说明和 SHA-256 校验文件。

## 验收标准

- 新用户在未安装 OMNeT++/INET 时能打开原有工作台和 JS 仿真，不出现启动错误。
- 配置有效 INET 工程后，四类模板均能生成可运行输入；至少一个 fixture smoke run 能完成并解析结果。
- 同一场景、同一版本、同一种子重复运行时，参数快照、指标摘要和工件哈希一致；随机性差异只能来自明确改变的种子。
- 运行失败能显示可操作诊断，取消后进程被回收且不会留下“运行中”记录。
- 结果页可以导出 JSON/CSV 和实验记录，AI 解释失败不影响结果查看。
- 现有论文、笔记、实验和通用仿真回归测试全部通过。

## 分阶段交付

1. **MVP（2 周）**：Task 1-5，完成工程检测、四类模板、runner、结果解析和数据库记录。
2. **产品体验（1-2 周）**：Task 6，完成 INET 工作台和结果可视化。
3. **科研产出（1 周）**：Task 7，完成 AI 解释、实验记录和论文段落草稿。
4. **可交付版本（1 周）**：Task 8，完成 Electron 打包、文档、CI 和验收回归。

## 明确不纳入首版

- 真实 SDR、USRP、毫米波射频硬件闭环。
- 在线强化学习训练和跨机器分布式仿真调度。
- 未经校准的真实无线传播结论；所有结果页必须显示“仿真模型/版本/参数/种子”。
- 自动上传论文、自动投稿或将 API key 写入项目文件。
