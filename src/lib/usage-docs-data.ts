// 技术应用说明书数据源 —— 结构化文档正文（DeepSeek API 文档风格）
// 用法：DocsSection 组件按此数据渲染「快速开始 / 模块地图 / 接入 AI / API 端点 / 数据备份 / FAQ」

export interface DocParam {
  name: string
  value: string
  desc: string
}

export interface DocSection {
  id: string
  title: string
  icon: string // 语义标签，用于左侧导航图标
  body: DocBlock[]
}

export type DocBlock =
  | { type: 'para'; text: string }
  | { type: 'note'; text: string; variant?: 'info' | 'warn' }
  | { type: 'table'; caption?: string; columns: string[]; rows: string[][] }
  | { type: 'params'; caption?: string; rows: DocParam[] }
  | { type: 'code'; lang: string; title?: string; content: string }
  | { type: 'list'; items: string[] }
  | { type: 'faq'; items: { q: string; a: string }[] }

// ---------- 章节 1：快速开始 ----------
const quickStart: DocSection = {
  id: 'quickstart',
  title: '快速开始',
  icon: 'rocket',
  body: [
    { type: 'para', text: 'AI Network Lab 是面向通信/网络方向硕士研究生的「一站式科研管理平台」。它把 6 模块科研方法论（领域认知 → 文献管理 → 实验设计 → 论文写作 → 投稿）落地为一套可操作的 Web + 桌面工具，帮助你把「读什么、怎么读、做什么实验、怎么写」串成一条清晰的主线。' },
    { type: 'note', text: '所有数据持久化在本机 SQLite 数据库，无需注册账号、无需联网即可使用全部离线功能。AI 摘要素等增强功能需自行接入个人 API Key（见「接入 AI 助手」）。', variant: 'info' },
    { type: 'table', caption: '快速上手路径（首次进入建议按此顺序）', columns: ['步骤', '操作', '目的'], rows: [
      ['1', '完成新手引导分步向导', '了解 9 大功能模块与快捷键'],
      ['2', '「总览仪表盘」看项目全局', '确认统计、三层架构、阅读热力图'],
      ['3', '「系统设置」接入 AI Key（可选）', '解锁摘要/综述/实验顾问等 AI 功能'],
      ['4', '「论文库」添加你的第一篇文献', '进入 Zotero 风格的文献管理'],
      ['5', '「科研笔记」用阅读思考模板记录', '按作者/题目/期刊/创新点等逐项填写'],
      ['6', '「组网仿真实验」跑一次可复现实验', '体验种子化确定性仿真'],
    ] },
    { type: 'list', items: [
      '启动方式：`npm run dev` 打开 Web 版；或使用封装好的桌面版（`npm run desktop:start`）。',
      '首次访问会自动播种示例数据，方便直接上手体验。',
      '侧边栏（或移动端底部导航）可在 9 大模块间切换；按 ⌘K 打开全局命令面板。',
    ] },
    { type: 'note', text: '快捷键：⌘K 全局搜索 · ? 快捷键帮助 · G+字母 快速导航 · ⌘J 主题切换。', variant: 'info' },
  ],
}

// ---------- 章节 2：功能模块地图 ----------
const moduleMap: DocSection = {
  id: 'modules',
  title: '功能模块地图',
  icon: 'grid',
  body: [
    { type: 'para', text: '平台包含 9 大功能模块，覆盖从选题到投稿的完整科研链路。每个模块对应一个侧边栏入口。' },
    { type: 'table', caption: '功能模块一览', columns: ['模块', '定位', '核心能力'], rows: [
      ['总览仪表盘', '全局视图', '统计卡片 · 三层架构图 · 阅读热力图 · 成就徽章 · 自定义组件'],
      ['论文库', '文献管理', 'Zotero 风格 · 三遍阅读法 · AI 摘要 · BibTeX/CSV 导出 · 引用网络'],
      ['文献检索工具', '检索', '关键词矩阵 · 实时 arXiv · 雪球法 · 全文搜索 · 方向推荐'],
      ['选题评估', '规划', '4 维加权打分 · 横向对比 · AI 研究空白分析'],
      ['实验管理', '实验', '基线检查 · 超参数网格 · 消融实验 · AI 实验设计顾问'],
      ['研究规划', '进度', '40 周 Gantt 图 · 写作时间线 · 周计划 · 投稿追踪'],
      ['论文写作', '写作', '结构检查 · 学术句式库 · AI 文献综述 · 摘要生成器'],
      ['科研笔记', '笔记', 'Obsidian 风格 · 阅读思考模板 · 双向链接 · 一键导出 Excel'],
      ['组网仿真实验', '仿真', '种子化可复现 · Dijkstra/负载感知/Q-Learning · 环形/Spine-Leaf/Mesh'],
      ['方法论浏览', '指南', '6 模块完整方法论 · 研究统计仪表盘'],
      ['系统设置', '配置', 'LLM 网关接入 · 数据导出/导入 JSON 备份'],
    ] },
    { type: 'note', text: '「总览仪表盘」的组件支持自定义显示/隐藏，可按需聚焦最重要的模块。', variant: 'info' },
  ],
}

// ---------- 章节 3：接入 AI 助手 ----------
const aiAssistant: DocSection = {
  id: 'ai',
  title: '接入 AI 助手',
  icon: 'sparkles',
  body: [
    { type: 'para', text: '「论文摘要、文献综述、实验设计顾问」等 AI 功能使用 OpenAI 兼容的 Chat Completions 接口。只需在「系统设置」填入基础地址、模型名与你自己的 API Key 即可解锁，Key 仅保存在本机 SQLite，不会上传。' },
    { type: 'note', text: '请求格式：`POST {baseUrl}/chat/completions`，与 OpenAI SDK 完全兼容；也可直接用 OpenAI/Anthropic 的 SDK 调用。', variant: 'info' },
    { type: 'params', caption: '配置参数（PARAM / VALUE）', rows: [
      { name: 'base_url', value: 'https://open.bigmodel.cn/api/paas/v4', desc: 'OpenAI 兼容接口地址（默认智谱；服务商预置见下表）' },
      { name: 'api_key', value: '（你的 Key）', desc: '服务商控制台申请；Ollama 本地可填任意非空值' },
      { name: 'model', value: 'glm-4-flash', desc: '模型名；DeepSeek 用 deepseek-chat，OpenAI 用 gpt-4o-mini' },
    ] },
    { type: 'table', caption: '预置服务商（设置页下拉可选）', columns: ['服务商', 'base_url', 'model', 'Key 获取'], rows: [
      ['智谱 GLM', 'https://open.bigmodel.cn/api/paas/v4', 'glm-4-flash', 'open.bigmodel.cn（glm-4-flash 免费）'],
      ['DeepSeek', 'https://api.deepseek.com/v1', 'deepseek-chat', 'platform.deepseek.com'],
      ['OpenAI', 'https://api.openai.com/v1', 'gpt-4o-mini', 'platform.openai.com'],
      ['Ollama（本地）', 'http://localhost:11434/v1', 'qwen2.5:7b', 'ollama.com（无需 Key）'],
    ] },
    { type: 'code', lang: 'bash', title: '用 curl 直接验证接口连通性', content: `curl -X POST https://open.bigmodel.cn/api/paas/v4/chat/completions \\
  -H "Authorization: Bearer <你的API_KEY>" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "glm-4-flash",
    "messages": [{"role":"user","content":"一句话介绍你自己"}]
  }'` },
    { type: 'note', text: '也可通过环境变量 `LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL` 配置；应用内「设置」页的配置优先级最高（数据库 > 环境变量 > 默认）。', variant: 'info' },
  ],
}

// ---------- 章节 4：API 端点速查 ----------
const apiRef: DocSection = {
  id: 'api',
  title: 'API 端点速查',
  icon: 'code',
  body: [
    { type: 'para', text: '平台的后端为纯 REST 接口，服务端渲染与前端调用共用。以下为常用端点分组速查（前缀 `/api`）。' },
    { type: 'table', caption: '文献与检索', columns: ['方法', '路径', '说明'], rows: [
      ['GET/POST', '/api/papers', '论文列表 / 新建'],
      ['GET/PUT/DELETE', '/api/papers/[id]', '单篇论文详情 / 更新 / 删除'],
      ['GET', '/api/export-papers', '导出 BibTeX/CSV/EndNote'],
      ['GET', '/api/search', '全文检索'],
      ['GET', '/api/keywords', '关键词矩阵'],
      ['GET', '/api/graph', '引用关系图数据'],
      ['GET', '/api/citations', '引用关系列表'],
    ] },
    { type: 'table', caption: '课题与实验', columns: ['方法', '路径', '说明'], rows: [
      ['GET/POST', '/api/topics', '课题评估列表 / 新建'],
      ['GET/PUT/DELETE', '/api/topics/[id]', '课题详情 / 更新 / 删除'],
      ['GET/POST', '/api/experiments', '实验列表 / 新建'],
      ['GET', '/api/milestones', '里程碑（Gantt/写作/投稿）'],
      ['GET', '/api/research-stats', '研究统计'],
    ] },
    { type: 'table', caption: '笔记与导出', columns: ['方法', '路径', '说明'], rows: [
      ['GET/POST', '/api/notes', '笔记列表 / 新建（含结构化字段）'],
      ['GET/PUT/DELETE', '/api/notes/[id]', '笔记详情 / 更新 / 删除'],
      ['GET', '/api/notes/export/xlsx', '一键导出文献笔记为 Excel'],
    ] },
    { type: 'table', caption: 'AI 与仿真', columns: ['方法', '路径', '说明'], rows: [
      ['POST', '/api/ai-summary', '论文摘要'],
      ['POST', '/api/ai-review', '文献综述'],
      ['POST', '/api/ai-gap-analysis', '研究空白分析'],
      ['POST', '/api/ai-experiment', '实验设计顾问'],
      ['POST', '/api/sim/run', '执行仿真'],
      ['GET', '/api/sim/runs', '仿真运行记录'],
    ] },
    { type: 'table', caption: '系统', columns: ['方法', '路径', '说明'], rows: [
      ['GET/PUT', '/api/settings/llm', '读取 / 保存 LLM 网关配置'],
      ['POST', '/api/settings/llm/test', '测试 LLM 连通性'],
      ['GET/POST', '/api/backup', '导出 / 导入 JSON 备份'],
      ['POST', '/api/seed', '播种示例数据'],
      ['GET', '/api/stats', '总览统计汇总'],
    ] },
  ],
}

// ---------- 章节 5：数据与备份 ----------
const dataBackup: DocSection = {
  id: 'data',
  title: '数据与备份',
  icon: 'database',
  body: [
    { type: 'para', text: '所有科研数据（论文、课题、实验、里程碑、笔记、检索记录、LLM 配置）持久化在一个本机 SQLite 数据库文件中，便于备份与迁移。' },
    { type: 'table', caption: '数据位置', columns: ['环境', '数据库路径'], rows: [
      ['Web / 开发版', '项目目录 `db/custom.db`（`DATABASE_URL=file:../db/custom.db`）'],
      ['Electron 桌面版', '`%APPDATA%/ai-network-lab/db/custom.db`（首次启动自动从模板复制，并自动迁移补列）'],
    ] },
    { type: 'list', items: [
      '「总览仪表盘 → 数据管理」提供一键导出/导入 JSON 备份，支持合并或替换模式，适合跨设备同步。',
      '桌面版内部服务绑定 `127.0.0.1:<随机端口>`，仅本机可达、不暴露固定端口，从 `netstat` 只能看到一条随机回环监听。',
      '升级到含新字段的版本时，桌面版会自动对已有数据库做无损 `ALTER TABLE` 补列，保留既有数据。',
    ] },
  ],
}

// ---------- 章节 6：常见问题 ----------
const faq: DocSection = {
  id: 'faq',
  title: '常见问题',
  icon: 'help',
  body: [
    { type: 'faq', items: [
      { q: 'AI 功能提示「尚未配置 LLM API Key」怎么办？', a: '到「系统设置」页填入你的 API Key（推荐智谱 glm-4-flash 免费模型），或在 .env 里配置 LLM_API_KEY。Key 仅存本机 SQLite。' },
      { q: '为什么既有文献笔记导出 Excel 时作者/期刊为空？', a: '阅读思考模板是后加的。旧笔记没有结构化字段，导出时这几列为空是正常回退。打开该笔记，在「阅读思考模板」里补填后再导出即可。' },
      { q: '桌面版会暴露真实端口吗？', a: '不会。桌面版每次启动向系统申请一个随机空闲端口，并绑定 127.0.0.1（仅回环）。外部无法用固定端口探测，netstat 也只能看到一条随机回环监听。' },
      { q: '仿真实验能不能复现？', a: '能。仿真引擎是种子化确定性的（mulberry32 + FNV-1a 流派生），同参数两次运行结果字节级一致，实验记录会保存完整参数作为复现依据。' },
      { q: '想清空示例数据 / 重新播种怎么操作？', a: '可在「数据管理」用替换模式导入空备份，或手动删除 db/custom.db 后重新执行 npm run db:push 并重访首页自动播种。' },
    ] },
  ],
}

export const USAGE_DOCS: DocSection[] = [quickStart, moduleMap, aiAssistant, apiRef, dataBackup, faq]
