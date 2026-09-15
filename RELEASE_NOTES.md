# 发行说明 v1.2.1

> AI Network Lab —— 智能网络科研工作台
> 当前包版本：v1.2.1（对应 `package.json`）
> 累积自上一个可用版 v1.1.0（桌面安装包 v1.1.0）

本版是一次**累积功能 + 打包可靠性修复**的发布。相对 v1.1.0，新增了「Zotero → 本软件 → Obsidian」科研工作流的补齐，并集中修复了桌面端解压/升级链路的隐患，同时把安装包与运行时体积砍掉约七成。

**强烈建议升级，尤其是桌面版用户。**

---

## ⚠️ 本次最需要关注的修复

### 1. 解压逻辑由"先删后解压"改为 fail-safe 原子替换

**风险（旧实现）**：`ensureAppExtracted()` 先删除旧的 `resources/app` 目录，再解压新 `app.zip`。一旦解压中途失败（磁盘满、被杀进程、压缩包损坏），旧目录已删、新目录不全——**应用直接打不开**，且无法自愈。

**修复**：解压到临时目录 `app.new` → 校验通过 → 原子改名替换，并写入 `.extract-ok` 完整性标记。任一步失败都保留原目录，安装始终处于可用状态。

### 2. 安装包与运行时体积大幅下降

| 项目 | 修复前 | 修复后 |
| --- | --- | --- |
| Next standalone 产物 | 607 MB | **92.9 MB** |
| `resources/app.zip` | 87 MB | **31.2 MB** |
| Chromium 语言包 | 55 个（约 48 MB） | 2 个（zh-CN / en-US） |
| 构建期误拷 `test-results` | 366 MB | 已挡在 tracing 之外 |

- `prepare-standalone.js` 由黑名单改为**白名单裁剪**：顶层只保留运行必需项，递归清除 `*.tmp*`、非 sqlite 的 `wasm-base64`、`*.map`、`*.d.ts`。
- `next.config.ts` 的 `outputFileTracingExcludes` 补挡 `test-results` / `playwright-report` / `e2e` / `tests` / `docs` / `.github` / `db` / `*.db`。

---

## v1.2.0 新增功能（本版一并包含）

### 补齐「Zotero → 本软件 → Obsidian」科研工作流
导入/同步**不会**自动调用 LLM。

- **论文阅读笔记导出 Markdown / PDF / TXT**：论文详情页「导出笔记」走 `/api/papers/:id/notes`
- **科研笔记服务端导出 MD/PDF**：`/api/notes/export/:id`，桌面端不再依赖前端 Blob 拼文件
- **论文库 CSV 是论文列表**：UTF-8 BOM + 题名/作者/期刊/年份/DOI/状态/标签
- **导入 RIS / BibTeX**：按 DOI / Zotero key / 标题去重合并
- **导入 PDF 入库**：PDF 落到本机 `library/pdfs/`，可挂到已有论文或新建条目；不解析、不送 LLM
- **Zotero Web API 同步**：设置页填写 User ID + API Key，一键拉条目元数据

### 其他
- 桌面端升级时对 `Paper.doi` / `zoteroKey` / `pdfPath` 做无损 `ALTER TABLE`

---

## 工程卫生

- 移除已完全合并的 `feature/inet-lab` 工作树与分支
- 归档并移除两个早期废弃仓库（初版四 demo 之一的 `AI-net`、更早的 `智谱AI` 分支）

---

## 安装

### 桌面版（推荐）
```bash
npm run desktop:dist        # 重打安装包 → release/AI Network Lab-Setup-1.2.1.exe
```
安装后直接使用；升级时研究数据（`%APPDATA%\ai-network-lab\db\custom.db`）自动保留，旧代码会在启动时按 `BUILD_ID` 对比被安全替换。

### Web 版
```bash
npm install
npm run db:push             # 初始化数据库（含新字段）
npm run dev                 # http://localhost:3000
```

## 使用说明
应用内「使用说明」功能区覆盖完整上手指引（快速开始 / 接入 AI / API 速查 / 数据备份 / FAQ），也可从新手引导直达。
