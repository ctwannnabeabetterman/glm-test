# Changelog

本项目的所有显著变更都记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/)。

## [Unreleased]

### 新增

- **科研笔记「阅读思考模板」**：文献笔记（分类=文献笔记）升级为结构化思考模板文档，阅读时逐项填写——作者、题目、期刊、术语记录、参考文献导入、研究方法、研究对象、理论框架、创新点、局限性、对我的启发（`Note.structured` JSON 字段 + `lastReadAt` 记录最近阅读时间）
- **一键导出 Excel (.xlsx)**：文献笔记可一键导出为 xlsx，列含「作者 / 题目 / 期刊 / 最近一次读的日期」，服务端 SheetJS 生成（`GET /api/notes/export/xlsx`），单测锁定表头与字段映射
- **Electron 桌面应用封装**：`npm run desktop:start`（开发直跑）与 `npm run desktop:dist`（NSIS 安装包）。内部以 `ELECTRON_RUN_AS_NODE` 子进程拉起 Next standalone 服务，绑定 `127.0.0.1:<随机空闲端口>`——仅回环可达、不暴露固定端口；数据库模板随包携带、首次启动落位用户数据目录，目标机器无需安装 Node.js

### 修复（桌面端 / 数据库迁移）

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
