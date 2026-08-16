# 贡献指南

欢迎 issue 与 PR。

## 开发流程

```bash
npm install
npm run db:push        # 初始化本地 SQLite
npm run dev            # http://localhost:3000
```

提交 PR 前请确保三项全部通过：

```bash
npm run typecheck
npm run lint
npm run build
```

## 分支与提交规范

- 从 `main` 拉出 `feat/*`、`fix/*`、`docs/*` 分支
- 提交信息遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-CN/)：`feat: 新增 xxx`、`fix: 修复 xxx`
- 显著行为变更请同步更新 `CHANGELOG.md` 的 Unreleased 段

## 仿真引擎改动须知

`src/lib/sim/` 的核心承诺是**可复现性**：同参数同种子必须产生一致结果。改动该目录时：

1. 不要引入 `Math.random()`、`Date.now()` 等非种子随机源
2. 不要改变已有流名（`drop:*`、`red:*`、`qlearning:*`、`*-topology`）的派生逻辑——这会破坏既有实验记录的复现性；新增随机性请新开流名
3. 改动后运行两次同参数仿真对比指标 JSON 是否一致

## LLM 网关改动须知

- 所有 AI 功能必须经由 `src/lib/llm` 的 `chatComplete()`，不得在路由内直接 fetch 第三方接口
- 任何返回中不得出现明文 API Key
