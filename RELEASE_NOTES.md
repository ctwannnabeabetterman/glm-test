# 发行说明 v1.1.0

> AI Network Lab —— 智能网络科研工作台
> 当前包版本：v1.1.0（对应 `package.json`，代码提交 `d3079ee`）

本版本是一次**累积功能 + 关键修复**的集中发布。相对上一个可用版（Electron 桌面封装 v1.0.0），新增了文献阅读思考模板与 Excel 导出、技术应用说明书文档页，并集中修复了桌面端「升级后不更新」等多处问题。**强烈建议升级，尤其是桌面版用户——本次修复了升级后始终显示旧界面的问题。**

---

## ⚠️ 本次最需要关注的修复：升级后 Electron 不更新

**现象**：每次更新代码、重新打包安装后，Electron 客户端打开仍是**上一次的旧界面**，新功能不生效。

**根因**：`desktop/main.js` 里解压内置服务的函数只判断"解压目录是否已有 `server.js`"。升级安装时，新版 `resources/app.zip` 被更新，但 `resources/app/` 目录仍是**上一次版本解压出的旧代码**——`server.js` 已存在，于是**永远跳过解压**，一直用旧代码。

**修复**：改为以 Next 每次构建都会变化的 `BUILD_ID` 作为版本标识。启动时读取新 `app.zip` 的 `BUILD_ID`，与已解压目录对比；**不一致（=升级）就删除旧目录、重新解压**，确保升级后加载最新代码。

**验证**：隔离逻辑测试 PASS（版本不一致→重解压、版本一致→复用）；真实升级端到端验证——升级后解压出的 `BUILD_ID` 为最新（`mKUaY…`），首页已含新增功能。

---

## 新功能

### 科研笔记「阅读思考模板」+ 一键导出 Excel
- 文献笔记升级为**结构化思考模板文档**，阅读时逐项填写：作者、题目、期刊、术语记录、参考文献导入、研究方法、研究对象、理论框架、创新点、局限性、对我的启发。
- 一键导出 **Excel (.xlsx)**，列含「作者 / 题目 / 期刊 / 最近一次读的日期」。

### 内置「技术应用说明书」文档页
- 新增「使用说明」功能区，采用 DeepSeek API 文档风格（左侧章节导航 + 右侧正文 + 面包屑 + PARAM/VALUE 表 + 代码复制 + FAQ 折叠）。
- 覆盖：快速开始、功能模块地图、接入 AI 助手（LLM 网关 base_url/api_key/model）、API 端点速查、数据与备份、常见问题。
- 入口集成：侧边栏「使用说明」导航项 + 首页按钮 + **新手引导最后一步「查看使用说明」直达**。

### Electron 桌面封装（v1.0.0 已含）
- 内部以 `ELECTRON_RUN_AS_NODE` 拉起 Next standalone 服务，绑定 `127.0.0.1:<随机端口>`——仅回环可达、不暴露固定端口。
- 数据库模板随包携带，首次启动落位用户数据目录；目标机器无需安装 Node.js。

---

## 修复

- **桌面版升级后仍显示旧界面**（见上文，用 `BUILD_ID` 版本对比驱重解压）。
- **Next standalone 漏追 `xlsx`**：`outputFileTracingIncludes` 显式纳入 `node_modules/xlsx`，修复桌面版导出 Excel 的 `Cannot find module 'xlsx'`。
- **旧数据库缺新列的无损迁移**：桌面版启动时用 `node:sqlite` 检测缺列并 `ALTER TABLE` 补齐 `Note.structured` / `Note.lastReadAt`，保留既有数据。
- **清零全部 ESLint 警告**；Playwright 浏览器 E2E（15 用例）纳入 CI。

## 质量与可靠性

- 单元测试 **46 用例**（测试套件，覆盖仿真引擎确定性、LLM 网关、拓扑/RNG、笔记导出）。
- CI（Node 20/22 矩阵）：`prisma generate → typecheck → lint → test → build → E2E`，全绿通过。
- `KNOWN_ISSUES.md`：沉淀已知问题与规避（xlsx 漏追、旧库迁移、Electron 二进制下载拦截、旧笔记结构化字段为空、控制台 GBK 乱码等）。

---

## 安装

### 桌面版（推荐）
运行：
```bash
npm run desktop:dist        # 重打安装包 → release/AI Network Lab-Setup-1.1.0.exe
```
安装后直接使用；升级时**研究数据（`%APPDATA%\ai-network-lab\db\custom.db`）会自动保留**，旧代码会在启动时被自动清掉。

### Web 版
```bash
npm install
npm run db:push             # 初始化数据库（含新字段）
npm run dev                 # http://localhost:3000
```

## 使用说明
应用内的「使用说明」功能区覆盖了完整上手指引（快速开始 / 接入 AI / API 速查 / 数据备份 / FAQ），也可从新手引导直达。
