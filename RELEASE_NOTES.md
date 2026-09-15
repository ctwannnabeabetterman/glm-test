# 发行说明 v1.2.3

> AI Network Lab —— 智能网络科研工作台
> 当前包版本：v1.2.3（对应 `package.json`）

**本次两件大事：删掉一个实测不可用的功能，把笔记导出真正接进 Obsidian。**

---

## 一、移除「智能组网实验室」（INET）

实测结论：这个功能**跑不起来**，而且有两道互相独立的门槛。

**门槛 A —— 前端从来没有 manifest 配置入口。**
点击「运行场景」时只发送 `scenarioType` 与 `parameters`，没有 manifest；全前端搜索 `manifest` 在组件层**零命中**。
服务端拿到空的 `projectRoot`，`validateManifest` 必然返回诊断 → 任务在到达运行器之前就被判为 failed。
也就是说：**即使你自己把 OMNeT++/INET 装好，也无法从界面跑起来**。

**门槛 B —— 依赖外部工具链。**
它需要 OMNeT++ + INET，这是要自行编译、数 GB 量级的 C++ 工具链。

让使用者为此自建一套重型环境，成本远大于收益，因此**整体移除**：相关 UI、API、库、测试、文档、Prisma 模型全部删除。
老版本升级时，`migrate-database.js` 会把这些功能遗留的空表清理掉（先子表后父表，避免外键阻挡），**你的文献与笔记数据不受影响**。

**组网仿真能力并没有丢**：内置引擎的「组网仿真实验」不需要任何外部依赖，同参数同种子结果完全可复现，是真正可用的那一个。

## 二、导出 Markdown 直接写入 Obsidian vault

以前只能「另存为」得到一份 Obsidian 兼容的 md，你还得手动搬进 vault —— Obsidian 无从索引、无从双链。
现在：

- 设置页新增「**Obsidian 笔记库**」：vault 目录（系统原生目录选择器）+ vault 内子目录 + 开关
- 导出菜单新增「**同步这一篇到 vault**」「**全部文献笔记同步到 vault**」
- 「导出 Markdown」在 vault 可用时**顺便写入**（vault 写入失败不影响下载）
- 导出的 md 带 YAML frontmatter 与 `#标签`，Obsidian 打开即纳入索引

写入路径做了围栏校验：绝对路径 / `..` / 盘符 / UNC 一律拒绝或净化；写入前用 `path.resolve` 二次确认仍在 vault 内。
端到端实测确认：**vault 之外的目录不会被写入**。同名笔记自动追加短 id 后缀，批量同步不会互相覆盖。

## 三、顺带修掉的两个隐患

1. **INET 运行器一旦启动失败，会把整个后端打崩。** 子进程的 `'error'` 事件没人监听，而 Node 在「可执行文件不存在」时只发 `'error'`、不再发 `'close'`——EventEmitter 无监听者就会抛未捕获异常，进程直接退出。这条调用又在 fire-and-forget 的异步函数里，等于**一次失败的实验让整个内部服务消失**，你看到的是界面突然全废。
2. **测试跑完不退出，会让发布流水线永远卡住。** `vitest run` 在本项目里用例全绿后进程不退出（既有问题，改动前的基线同样复现）。这会让发布的 `Unit tests` 步骤一直挂到 GitHub 默认的 **6 小时**上限，安装包永远发不出来。已改用 `pool: 'threads'` 并给发布任务加超时兜底。

## 四、打包配置里一个会让发版彻底失败的错键（本次才发现）

`electron-builder.yml` 里限制 Chromium 语言包的键写成了 `win.locales`。这个键**不存在**——electron-builder 26 里它叫 `electronLanguages`。

后果比"少了一行配置"严重得多：整段 `win` 配置会被 JSON schema 校验拒绝，打包**当场终止**，而报错只有一句

```
configuration.win should be one of these: null
```

**它不告诉你是哪个字段错了。** 于是 CI 的发布任务会以同样原因失败——**也就是说 v1.2.2 的 Release 从来没有产出过可用安装包**，而失败原因藏在这么一句看不出所以然的话里。

本次已改为 `win.electronLanguages`，并**在本机完整跑通了 `desktop:build` → `electron-builder --win` 全流程**，确认能产出安装包。

---

# 上一版发行说明 v1.2.1

> AI Network Lab —— 智能网络科研工作台
> 当时包版本：v1.2.1（对应 `package.json`）
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
