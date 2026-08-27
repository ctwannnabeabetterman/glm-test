# 已知问题 / Known Issues

本项目逐步沉淀的已知问题与规避方法。用于记录「测试时发现、但暂不阻塞、或已有规避」的工程事实，便于后续维护与真实用户快速排障。
标 ✅ 的为已修复，标 ⚠️ 的为当前存在、需注意或待处理。

## 数据库与 Electron 桌面端

### ✅ Next standalone 漏追 `xlsx` 依赖（本轮修复）
- **现象**：`next build` 产出 `.next/standalone` 后，`xlsx`（SheetJS）未进入 `standalone/node_modules`。桌面版 `/api/notes/export/xlsx` 会抛 `Cannot find module 'xlsx'`。
- **原因**：Next 的 `outputFileTracing`（turbopack）未把 `xlsx` 收录进该路由的 `route.js.nft.json`。
- **修复**：`next.config.ts` 增设 `outputFileTracingIncludes: { "/api/notes/export/xlsx": ["./node_modules/xlsx/**/*"] }`，显式把该包纳入 standalone 产物。
- **验证**：build 后 `Test-Path '.next\standalone\node_modules\xlsx'` 为真，且能从 standalone 的 node_modules 正常加载生成工作簿。

### ✅ 既有数据库缺新列（桌面版无损迁移，本轮实现）
- **现象**：老版本桌面应用创建的 `%APPDATA%\ai-network-lab\db\custom.db` 不含 `Note.structured` / `Note.lastReadAt` 列。升级装新版后，查询这些字段会因缺列而运行报错。
- **原因**：`ensureDatabase` 只在数据库文件不存在时才复制 `db-template`；已存在的旧库不会重建，Prisma（打包版无 prisma CLI）也不做自动 `ALTER`。
- **修复**：`desktop/main.js` 新增 `migrateDatabase()`，在启动时用 `node:sqlite` 检测缺列并 `ALTER TABLE ADD COLUMN` 补齐，**无损保留既有数据**（结构字段缺省为 `'{}'`）。
- **验证**：在真实旧库上运行迁移逻辑，补列成功且 `SELECT COUNT(*)` 前后不变（无损）。桌面版启动后 userData 库自动补齐新列。

### ⚠️ 桌面版「App 首启自解压」依赖系统 `tar`（bsdtar）
- **现象**：Windows 10（1803+）自带 `tar.exe`（bsdtar），用于首启解压 `resources/app.zip`。极老的系统或无 `tar` 的环境会解压失败。
- **影响**：受影响的用户会看到「内置服务解压失败」错误弹窗。
- **规避**：现代 Windows 一律内置；若需兼容更老系统，可改用纯 JS 解压库或有损方案。当前作为已知限制记录。

### ⚠️ Electron 二进制下载常被 npm install-scripts 拦截
- **现象**：`npm i electron` 时 `postinstall` 被 install-scripts 策略拦截，`node_modules\electron\dist\electron.exe` 不会自动下载。
- **规避**：手动 `node node_modules\electron\install.js`，或环境变量设镜像：
  `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`
  `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`

## 笔记（ReadingNote）

### ⚠️ 既有文献笔记没有结构化字段，导出时作者/期刊为空
- **现象**：在「科研笔记」引入阅读思考模板**之前**创建的文献笔记，`structured` 为空（`'{}'`），导出 xlsx 时作者、期刊列为空。
- **影响**：不影响既有数据与功能；仅导出表里这些列显示为空。
- **规避**：打开该文献笔记，在「阅读思考模板」里补填结构化字段后再导出即可（数据未丢，只是待填）。

### ⚠️ 新建笔记对话框仍是简单标题/内容表单
- **现象**：点「新建笔记」弹出的对话框仍是标题 + 分类 + 内容（markdown）表单；选「文献笔记」后，详情区才显示「阅读思考模板」逐项填写。
- **影响**：交互略绕（要先建再进详情填模板），但功能完整。
- **待办**：后续可让新建对话框直接展示阅读思考模板字段，减少往返。

## 浏览 / 展示

### ⚠️ Windows 控制台 GBK 编码会误显示 UTF-8 中文为乱码
- **现象**：在 PowerShell 里通过脚本打印含中文的 JSON / 表格时，中文可能显示为 `????-??????`。
- **原因**：为控制台编码（GBK）与数据（UTF-8）不一致，**仅影响显示，不影响真实数据**（数据库与导出的 .xlsx 均为正确 UTF-8）。
- **规避**：用 Node/浏览器读取或 `$OutputEncoding` 调整；不要据此判断数据损坏。
