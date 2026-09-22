# 已知问题 / Known Issues

本项目逐步沉淀的已知问题与规避方法。用于记录「测试时发现、但暂不阻塞、或已有规避」的工程事实，便于后续维护与真实用户快速排障。
标 ✅ 的为已修复，标 ⚠️ 的为当前存在、需注意或待处理。

## 数据库与 Electron 桌面端

### ✅ 桌面版升级后仍显示旧界面（本轮修复）
- **现象**：每次更新代码、重新打包安装后，Electron 客户端打开仍是**上一次的旧界面**，新功能不生效。
- **原因**：`desktop/main.js` 的 `ensureAppExtracted()` 只判断 `resources/app/server.js` 是否存在。升级安装时，新版 `resources/app.zip` 被更新，但 `resources/app/` 目录仍是**上一次版本解压出的旧代码**（`server.js` 已存在）→ 永远跳过解压 → 一直用旧版本代码。
- **修复**：以 Next 的 `BUILD_ID`（每次构建都不同）为版本标识。启动时用 `tar -xOf zip .next/BUILD_ID` 读取新 zip 的版本，与已解压目录的版本对比；不一致则删除旧目录重新解压，确保升级后加载最新代码。
- **验证**：隔离逻辑测试 PASS（版本不一致→重解压、版本一致→复用）；并做了真实升级端到端验证。

### ✅ Next standalone 漏追 `xlsx` 依赖（上轮修复）
- **现象**：`next build` 产出 `.next/standalone` 后，`xlsx`（SheetJS）未进入 `standalone/node_modules`。桌面版 `/api/notes/export/xlsx` 会抛 `Cannot find module 'xlsx'`。
- **原因**：Next 的 `outputFileTracing`（turbopack）未把 `xlsx` 收录进该路由的 `route.js.nft.json`。
- **修复**：`next.config.ts` 增设 `outputFileTracingIncludes: { "/api/notes/export/xlsx": ["./node_modules/xlsx/**/*"] }`，显式把该包纳入 standalone 产物。
- **验证**：build 后 `Test-Path '.next\standalone\node_modules\xlsx'` 为真，且能从 standalone 的 node_modules 正常加载生成工作簿。

### ✅ 既有数据库缺新列（桌面版无损迁移，本轮实现）
- **现象**：老版本桌面应用创建的 `%APPDATA%\ai-network-lab\db\custom.db` 不含 `Note.structured` / `Note.lastReadAt` 列。升级装新版后，查询这些字段会因缺列而运行报错。
- **原因**：`ensureDatabase` 只在数据库文件不存在时才复制 `db-template`；已存在的旧库不会重建，Prisma（打包版无 prisma CLI）也不做自动 `ALTER`。
- **修复**：`desktop/main.js` 新增 `migrateDatabase()`，在启动时用 `node:sqlite` 检测缺列并 `ALTER TABLE ADD COLUMN` 补齐，**无损保留既有数据**（结构字段缺省为 `'{}'`）。
- **验证**：在真实旧库上运行迁移逻辑，补列成功且 `SELECT COUNT(*)` 前后不变（无损）。桌面版启动后 userData 库自动补齐新列。

### ✅ 更新检查被一次 504 打掉，整次启动就不再检查（v1.3.12 修复）
- **现象**：用户报「客户端不会自动更新」。`%APPDATA%\ai-network-lab\logs\update.log` 里是
  `[updater:error] HttpError: 504 GET .../releases.atom` → `启动静默检查未成功：unknown — 504`。
- **原因（两层）**：① 更新源用 **GitHub provider**，每次检查都要**先拉 `releases.atom`** 判断最新 tag ——
  这个 feed 动态生成、不吃缓存，会偶发 5xx（同一次故障里本机请求同一地址是 200，属边缘节点瞬时问题）；
  ② **启动检查只跑一次**、失败只写日志、**没有重试** ⇒ 那一次启动就等于「不更新」。
- **修复（三处）**：
  1. publish provider 从 `github` 换成 **`generic`**（`url: .../releases/latest/download`）——
     直接取 `<url>/latest.yml`，资产走 `<url>/<latest.yml 里的 path>`，**完全不碰 atom feed**；
  2. 新增 `desktop/update-retry.js`（纯模块）+ `main.js` 的 `checkForUpdatesWithRetry()`：
     启动检查退避 `0/30s/120s`、手动检查 `0/3s/8s`；**只重试瞬时故障**（5xx/超时/连接类），
     404/406/版本回退一律不重试（白等还会把发布侧的问题伪装成网络问题）；
  3. `classifyUpdateError` 新增 **`upstream`**（5xx）分类并排在 406/404 之前（原来 504 落到 `unknown`，
     用户看到的是「更新出错：unknown — 504」，既不知道是谁的锅也不知道能不能重试）；
     启动检查最终失败时**把状态推给界面**（「设置 → 软件更新」可见，但不弹窗）。
- **验证**：用真的 `GenericProvider`（只注入最小 executor）打真 Release —— 解析到最新版本号、
  资产 URL 正确、安装包 `HEAD 200` 且 `content-length` 与发布核对逐字节一致；
  另用 vm 载入 `main.js` 做**行为级**重试测试（调用次数 / 退避序列 / 最终分类）。
- ⚠️ **生效前提**：已经装在机器上的旧版本仍按各自那份 `app-update.yml`（github provider）走，
  所以必须**先成功更新一次**才轮到新路径。自动检查失败时，到「设置 → 软件更新」多点两次「检查更新」，
  504 是瞬时的，通常就过了。

### ⚠️ 桌面版「App 首启自解压」依赖系统 `tar`（bsdtar）
- **现象**：Windows 10（1803+）自带 `tar.exe`（bsdtar），用于首启解压 `resources/app.zip`。极老的系统或无 `tar` 的环境会解压失败。
- **影响**：受影响的用户会看到「内置服务解压失败」错误弹窗。
- **规避**：现代 Windows 一律内置；若需兼容更老系统，可改用纯 JS 解压库或有损方案。当前作为已知限制记录。

### ✅ 安装包体积已收敛到约 120 MB（原记录是 1.2.0 的 ~1.3GB）
- **原现象**：`AI Network Lab-Setup-1.2.0.exe` 比 1.1.0（约 315MB）大很多；`resources/app.zip`（Next standalone）约 1GB。
- **修复（v1.3.7 打包瘦身）**：standalone 依赖裁剪 —— Prisma 走可达性闭包（运行时只需要 `library.js` 一个文件）、
  pdfkit 走保守白名单（它有运行时 `fs.readFileSync('./data/*.icc')`，闭包图看不见）。实测共回收 **95.6 MB**
  （`@prisma/client-<hash>/runtime` 从 73.4 MB 降下来、app.zip 从 120.9 MB 降到 25.3 MB）。
- **现状（2026-09-21）**：安装包 **120,470,134 B ≈ 120 MB**（v1.3.11 实测）。这条从「待处理」改为「已收敛」。

### ⚠️ Electron 二进制下载常被 npm install-scripts 拦截
- **现象**：`npm i electron` 时 `postinstall` 被 install-scripts 策略拦截，`node_modules\electron\dist\electron.exe` 不会自动下载。
- **规避**：手动 `node node_modules\electron\install.js`，或环境变量设镜像：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

## 文献工作流（Zotero / PDF / 导出）

### ✅ 论文笔记现在可以导出为 Markdown / PDF
- **原现象**：论文详情只有编辑框，没有「导出这一篇笔记」；科研笔记的 Markdown 依赖前端拼 Blob，桌面端经常落不到文件。CSV 被当成「导出论文内容」。
- **修复**：论文详情「导出笔记」走服务端附件下载；CSV 改为带 BOM 的论文列表。

### ✅ 导入 PDF 不再触发 LLM
- **原现象**：论文库不能直接入库 PDF；用户期望的是「文件进库」，实际路径却把文本丢给 LLM 再改列表/关系网络。
- **修复**：`POST /api/papers/pdf` 只存文件并挂 `pdfPath`。关系网络仍按标签/作者/分类计算，导入后如需 AI 摘要请在详情页手动点。

### ✅ Zotero 同步从口号变成接口
- **原现象**：界面写「Zotero 风格」，Zotero 里更新条目后本软件完全不知道。
- **修复**：设置页保存 User ID + API Key，论文库「同步 Zotero」拉 Web API 元数据并去重合并。附件 PDF 不会自动下载（Zotero 附件另有权限与存储，避免把实验室变成第二个 Zotero 文件库）。

### ⚠️ Zotero 附件 PDF 不会随同步自动进来
- **影响**：同步只更新题录。需要 PDF 时用「导入 PDF」挂到对应条目，或继续在 Zotero 里打开原文。
- **规避**：保持 Zotero 为文件主库，本软件管阅读笔记与实验。

## 笔记（ReadingNote）

### ⚠️ 既有文献笔记没有结构化字段，导出时作者/期刊为空
- **现象**：在「科研笔记」引入阅读思考模板**之前**创建的文献笔记，`structured` 为空（`'{}'`），导出 xlsx 时作者、期刊列为空。
- **影响**：不影响既有数据与功能；仅导出表里这些列显示为空。
- **规避**：打开该文献笔记，在「阅读思考模板」里补填结构化字段后再导出即可（数据未丢，只是待填）。
- **不做「按标题去论文库兜底」**（2026-09-21 明确）：文献笔记的标题是用户自己起的 —— 本机实测那条是
  「DRL资源分配 - 核心方法笔记」，与论文库里任何一篇标题都没有稳定对应关系。硬做模糊匹配会**填错作者**
  （对科研工具来说比留空更糟）。要自动填，前提是笔记与论文之间有一条**用户确认过的**关联，
  那需要给 `Note` 加一列并做迁移 —— 目前不做，保持「留空 + 提示补填」。

### ⚠️ 新建笔记对话框仍是简单标题/内容表单
- **现象**：点「新建笔记」弹出的对话框仍是标题 + 分类 + 内容（markdown）表单；选「文献笔记」后，详情区才显示「阅读思考模板」逐项填写。
- **影响**：交互略绕（要先建再进详情填模板），但功能完整。
- **待办**：后续可让新建对话框直接展示阅读思考模板字段，减少往返。

## 浏览 / 展示

### ⚠️ Windows 控制台 GBK 编码会误显示 UTF-8 中文为乱码
- **现象**：在 PowerShell 里通过脚本打印含中文的 JSON / 表格时，中文可能显示为 `????-??????`。
- **原因**：为控制台编码（GBK）与数据（UTF-8）不一致，**仅影响显示，不影响真实数据**（数据库与导出的 .xlsx 均为正确 UTF-8）。
- **规避**：用 Node/浏览器读取或 `$OutputEncoding` 调整；不要据此判断数据损坏。
