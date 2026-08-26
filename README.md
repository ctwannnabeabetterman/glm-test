# AI Network Lab · 智能网络科研工作台

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![CI](https://github.com/ctwannnabeabetterman/glm-test/actions/workflows/ci.yml/badge.svg)](https://github.com/ctwannnabeabetterman/glm-test/actions/workflows/ci.yml)
[![Next.js](https://img.shields.io/badge/Next.js-16-black)](package.json)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

一个面向通信/网络方向研究生的**个人科研全流程工作台**，由四个独立 demo 整合重构而成：

| 能力 | 说明 |
|---|---|
| 📚 科研管理 | 论文库（Zotero 风格）、关键词矩阵、选题评估打分、Gantt 规划、写作助手、Obsidian 风格笔记 |
| 🧪 组网仿真 | **种子化可复现**的离散事件仿真引擎：Dijkstra / 负载感知 / Q-Learning 三种路由算法在环形骨干、Spine-Leaf、Mesh 拓扑下的对比实验 |
| 🤖 AI 助手 | 摘要/关键点/追问、文献综述、选题 gap 分析、实验方案设计 —— **接入你自己的 API Key**（智谱 GLM / DeepSeek / OpenAI / Ollama 均可） |

> 全栈单仓：Next.js 16 App Router + React 19 + Tailwind 4 + shadcn/ui + Prisma/SQLite。
> 无外部服务依赖，`npm install && npm run db:push && npm run dev` 即可跑起来。

---

## 快速开始

```bash
# 1. 安装依赖（Node >= 20）
npm install

# 2. 初始化本地数据库（SQLite，自动创建 db/custom.db）
npm run db:push

# 3. 启动
npm run dev
# 打开 http://localhost:3000，首次访问自动写入示例数据
```

### 接入你的 AI API Key（可选，但推荐）

所有 AI 功能通过统一的 LLM 网关调用任何 OpenAI 兼容接口，Key 只存你本机：

**方式一（推荐）：应用内配置**
打开 `http://localhost:3000` → 侧边栏「系统设置」→ 选择服务商预设 → 粘贴 API Key → 保存 → 点击「测试连通」。

**方式二：环境变量**

```bash
cp .env.example .env
# 编辑 .env
LLM_API_KEY=你的key
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4   # 默认：智谱
LLM_MODEL=glm-4-flash                                # 免费模型，够用
```

| 服务商 | Base URL | 推荐 Key 获取 |
|---|---|---|
| 智谱 GLM | `https://open.bigmodel.cn/api/paas/v4` | [open.bigmodel.cn](https://open.bigmodel.cn/usercenter/apikeys)（glm-4-flash 免费） |
| DeepSeek | `https://api.deepseek.com/v1` | [platform.deepseek.com](https://platform.deepseek.com/api_keys) |
| OpenAI | `https://api.openai.com/v1` | [platform.openai.com](https://platform.openai.com/api-keys) |
| Ollama 本地 | `http://localhost:11434/v1` | 无需 Key（任意非空） |

应用内配置优先于环境变量；读取接口只返回脱敏 Key（`abcd****ef12`）。

---

## 组网仿真引擎（本项目的技术核心）

`src/lib/sim/` 是一套纯 TypeScript、零依赖、前后端共用的仿真内核：

```
rng.ts        mulberry32 + FNV-1a 流派生 —— 可复现性的根基
topology.ts   环形骨干 / Spine-Leaf / Mesh 三类拓扑，全部由 (seed, 参数) 确定性生成
routing.ts    二叉堆 Dijkstra（congestionWeight=0 最短时延 / >0 负载感知）
qlearning.ts  目的地感知 Q-Learning（状态 = 当前节点 × 目的地），完整训练闭环 + 训练曲线
engine.ts     离散事件仿真：三流业务(URLLC/eMBB/mMTC) × 有向边排队(drop-tail/RED) × 故障注入
index.ts      多种子批量运行 + 均值/标准差汇总
```

**可复现承诺**：相同参数 + 种子 ⇒ 任意机器上字节级一致的结果。该承诺由 41 个自动化单元测试持续守护（`npm test`），覆盖 RNG 流派生、三类拓扑确定性生成、路由算法、"状态含目的地"Q-Learning 回归、引擎字节级确定性快照与拥塞物理合理性，以及 LLM 网关的配置优先级与错误映射；另有 GitHub Actions 在每次 push / PR 时自动执行 typecheck + lint + test + build（Node 20/22 双版本矩阵）。

**相对原始 demo 的工程修复**（详见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)）：

- ❌ 原版 Mesh 拓扑用 `Math.random()` 生成，每次刷新都不同 → ✅ 种子化确定性生成
- ❌ 原版 Q-Learning 状态不含目的地、每流仅训练 12 episode、失败静默回退 → ✅ 状态含目的地、默认 300 episode、如实上报回退与训练曲线
- ❌ 原版动画引擎与批引擎结果不一致 → ✅ 单一确定性事件引擎
- ❌ 原版 API 层是 "Hello world"、数据库未接入实验 → ✅ 27+ API 全量 CRUD，实验参数/结果/训练曲线持久化到 SQLite

典型实验玩法（侧边栏「组网仿真实验」）：

1. 选 Mesh 拓扑 + Q-Learning，看训练曲线（累计奖励 ↑、贪心路径代价 ↓、ε 衰减）
2. 点「三算法对比」，同拓扑同种子横向比较交付率 / P95 时延 / Jain 公平性
3. 打开「链路故障注入」，测故障检测后的收敛时间
4. 批量次数调到 10，看多种子均值 ± 标准差，避免单次实验的偶然性

---

## 项目结构

```
├── prisma/schema.prisma        # Paper/Topic/Experiment/Milestone/Note/Setting/SimRun ...
├── src/
│   ├── app/
│   │   ├── api/                # 30+ REST 端点：CRUD + AI 网关 + 仿真 + 备份导入导出
│   │   ├── layout.tsx
│   │   └── page.tsx            # 11 个功能分区
│   ├── components/
│   │   ├── sections/           # 9 大科研模块 + 仿真实验 + 系统设置
│   │   └── ui/                 # shadcn/ui 组件
│   └── lib/
│       ├── llm/                # LLM 网关（BYO Key，OpenAI 兼容）
│       ├── sim/                # 组网仿真引擎（纯函数，可单测）
│       ├── db.ts               # Prisma 单例
│       └── store.ts            # Zustand 状态
└── docs/ARCHITECTURE.md        # 架构决策与算法说明
```

## 常用脚本

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发服务器（:3000） |
| `npm run build && npm start` | 生产构建与启动 |
| `npm run typecheck` | TypeScript 全量类型检查 |
| `npm run lint` | ESLint |
| `npm test` | 运行单元测试（仿真引擎 + LLM 网关，41 用例） |
| `node scripts/smoke-api.mjs` | 全链路 HTTP 冒烟测试（需 dev server 运行中，32 检查点，自动清理） |
| `npm run db:push` | 同步 schema 到 SQLite |
| `npm run db:studio` | Prisma 数据浏览器 |

## 版本管理

- 遵循 [Semantic Versioning](https://semver.org/)，版本历史见 [CHANGELOG.md](CHANGELOG.md)
- 主分支 `main` 保持可发布状态；功能开发请从 `main` 拉 `feat/*` 分支
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-CN/)（`feat:` `fix:` `docs:` `refactor:` ...）

## License

[MIT](LICENSE) © 2026 ctwannnabeabetterman

## English Summary

AI Network Lab is a full-stack personal research workbench for graduate students in wireless networking, consolidating four earlier prototypes into one open-source project. It combines a Zotero-style paper library and research-planning toolkit with a **seeded, reproducible discrete-event network simulator** (Dijkstra / load-aware / destination-aware Q-Learning routing over ring, spine-leaf and mesh topologies) and an AI assistant layer that works with **your own API key** on any OpenAI-compatible endpoint (Zhipu GLM, DeepSeek, OpenAI, or local Ollama). Stack: Next.js 16, React 19, Tailwind 4, Prisma + SQLite. `npm install && npm run db:push && npm run dev` to start.
