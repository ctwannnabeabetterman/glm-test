# Changelog

本项目的所有显著变更都记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/)。

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
