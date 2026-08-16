# 架构与算法说明

## 总体结构

```
浏览器 (React 19 + Zustand)
   │  fetch /api/*
   ▼
Next.js Route Handlers (src/app/api/**)     ←─ 无状态，仅编排
   │                    │
   │                    └── src/lib/sim/**   纯函数仿真内核（零依赖，可单测）
   │                    └── src/lib/llm/**   LLM 网关（OpenAI 兼容 fetch）
   ▼
Prisma + SQLite (db/custom.db)              论文/课题/实验/笔记/设置/SimRun
```

设计原则：

1. **仿真内核与框架解耦**：`src/lib/sim` 不 import 数据库、框架或 React，只依赖自身模块，理论上可移植到任何 JS 运行时（Node / Bun / 浏览器 Worker）。
2. **LLM 网关单点收口**：所有 AI 路由只调 `chatComplete()`，换服务商、改超时、加流式都只动一处。
3. **确定性优先**：凡是影响结果的随机性（拓扑生成、丢包、RED、Q-Learning 探索）全部走种子化 RNG 命名子流，杜绝隐式全局随机。

## 可复现性设计

```
seed = 20260727
  ├─ stream("ring-topology")   → 环和弦路带宽抽样
  ├─ stream("mesh-topology")   → Mesh 撒点/链路质量
  ├─ stream("drop:R0>R1")      → 该有向链路的逐跳误码丢包序列
  ├─ stream("red:A>B")         → 该队列的 RED 早期丢包判定
  └─ stream("qlearning:S>D")   → 该流对的 ε-greedy 探索序列
```

mulberry32 输出由 `(seed XOR FNV1a(streamName))` 决定；流之间互不干扰，同一流内序列单调推进（持久注册表，而非每次重建）。**同参数 ⇒ 同字节输出**，已用自动化脚本验证（同种子两次请求指标 JSON 完全一致、不同种子结果不同）。

## 路由算法

### 代价模型（决策度量，非物理时延）

```
edgeCost = propagationMs
         + w · propagationMs · load      w: dijkstra=0, loadaware=2
         + lossRate · 30                 丢包惩罚
         + (1-reliability) · 20          不可靠惩罚
```

物理时延单独建模：`hop = 传播 + sizeKb/bandwidthMbps(传输) + procDelay(处理)`，避免把无量纲代价和毫秒混在一个数里（原 demo 的主要建模缺陷之一）。

### Q-Learning（相对原 demo 的修复）

| 维度 | 原 demo | 本项目 |
|---|---|---|
| 状态 | 当前节点（多流污染） | (当前节点, 目的地) |
| 训练量 | 每流 12 episode | 默认 300，可调 50–2000 |
| 奖励 | −loadaware 代价 | −hopCost + 到达奖励 +20，死路罚 −5 |
| 失败处理 | 静默回退 Dijkstra | 训练曲线如实输出，`fellBackToDijkstra` 上报 |
| 可观测性 | 无 | 每 episode 采样（累计奖励 / 贪心路径代价 / ε / 成功率） |

## 事件引擎

事件类型优先序：`FAULT(0) < DETECT(1) < SERVICE_END(2) < EMIT(3)`，同刻按序号稳定排序。

- 每条**有向边**独立建模：单服务台（一次一包）+ 等待队列；服务时间 = `sizeKb / bandwidthMbps`
- 入队策略：Drop-Tail（队长 ≥ 容量丢）或 RED（EWMA 平均队长，min/max 阈值间概率早期丢包）
- 调度：FIFO 或严格优先级（URLLC > eMBB > mMTC）
- 丢包原因分类：`queue-full / red-early-drop / link-loss / link-failure / no-route`
- 故障注入：t=300ms 物理断链（在途包 link-failure），检测时延（默认 40ms）后才从路由图移除并重路由，输出收敛时间
- 预热包（每流前 3 包）不计入统计，消除冷启动偏置

## LLM 网关

```
resolveLlmConfig():
  DB Setting('llm.config')  >  env LLM_*  >  默认（智谱 glm-4-flash）
```

- 请求：`POST {baseUrl}/chat/completions`（OpenAI 兼容载荷）
- Key 永不回传明文：读取接口只返回 `hasKey` + 脱敏 `keyHint`
- 连通性测试：`max_tokens=16` 的最小补全

## 数据模型（要点）

完整定义见 `prisma/schema.prisma`。科研域 9 个模型（Paper/Topic/Keyword/Experiment/Milestone/Note/SearchLog/Citation/ReadingSession 等）+ 2 个新模型：

- `Setting`：KV JSON 存储（目前只有 `llm.config`）
- `SimRun`：一次实验 = 完整参数 JSON + 汇总指标 JSON + 每次运行明细（含训练曲线）JSON，构成复现凭据

## 已知边界（诚实声明）

- 负载演化是现象学模型（路径上边 +Δ 与服务时间相关，其余 −0.02 衰减），不是流体/微分方程级建模
- 传输时延在队列服务中体现，误码丢包与队列拥塞独立判定（与真实 TCP 拥塞控制的交互未建模）
- Q-Learning 训练在仿真前一次性完成，运行期不在线更新（观察的是「学到的策略」而非「在线适应」）
