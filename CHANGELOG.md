# Changelog

本项目的所有显著变更都记录在此文件中。
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [Semantic Versioning](https://semver.org/)。

## [1.3.9] - 2026-09-21

**这一版把「论文库里的判断」接到了 AI 与写作上：阅读优先级不再靠建库时手填一遍就再也不动，引用追踪里的关系可以直接变成稿子里的 `[@引用]`。**

起因是用户指出：*「论文库的优先级排序和引用追踪也是 AI 基于论文信息整合的」*。查下来的现状与这句话有出入，值得如实记下来：

- **优先级排序是一套固定公式**（相关度 × 0.4 + 新颖度 × 0.3 + 开源代码 × 15 + 年份项 × 0.5 + 优先级 × 2），
  而这四个输入值靠**建库时手工填**、之后基本没人回头改 —— 于是那张决定「今天读哪篇」的榜会很快不再反映真实优先级；
- **AI 只给建议、不写回**：`/api/ai-related-papers` 会产出「高/中/低优先级」，但它写在推荐结果里，从不落库；
- **引用追踪是纯手工的**（`Citation` 表 + 关系图），既没有 AI 参与，也**没有任何通向稿件的出口** ——
  看得到「谁引了谁」，却没法把这份信息用进正在写的论文里。

于是这一版分别补上这两处，并顺手修掉一个「数字与列表自相矛盾」的既有缺陷。

### 新增 — AI 重评阅读优先级（论文库 → 优先级排序）

- 新增 `src/lib/library/reading-priority.ts`：把评分公式、排序、AI 建议的解析、来源标记**收敛成唯一定义**。
  以前这段公式在 `papers-section.tsx` 里被**复制了三份**（排序比较器两处 + 行内渲染一处），改一处忘一处就会出现
  「显示的分数与排序依据不一致」—— 这种不一致特别难被发现。抽层时配了**逐字节等价对照**：把旧实现原样抄进测试，
  对一组样例逐一比对，**语义刻意不变**（改公式等于静默重排用户已经熟悉的那张榜）。
  只有一处行为变化并写进了测试：脏优先级（`priority: 'urgent'`）以前会算出 `NaN`，现在按 `medium` 兜底。
- 新增 `POST /api/ai-paper-score`：按**课题域**（`scopeByTopic`）+ **阅读范围**（全部/仅未读/仅在读/仅已读）取料，
  把 id / 题录 / 摘要（≤400 字）交给模型，要求逐篇给出 `relevance / novelty / priority` + 一句理由。
  - 取料**刻意不按现有分数排序**：那样每次重评都只看到「本来就排名靠前」的论文，靠后的永远不会被重新审视，榜单会自我固化；
  - 提示词用 **JSON-only 约束**（`JSON_ONLY_GUARD`），与 Markdown 格式合同**互斥** —— 两条一起拼会让模型
    产出「JSON 外面裹一层 Markdown」，解析失败率明显上升（`planner/ai.ts` 早已踩过这个坑，这条约定有测试钉着）；
  - 模型输出不可信：**清单之外的 id 一律不采纳但如实回报**（`unknownIds`），越界数值夹紧、非法优先级归一。
- 新增 `POST /api/papers/apply-scores`：**确认后**才写回，并记下「这些分数是 AI 给的」（存成一条 `Setting` 的 JSON 映射，
  **不加数据库列、不做迁移**）。用户**手工改过**某篇的分数时，`PUT /api/papers/[id]` 会摘掉那条标记 ——
  否则界面上的 AI 徽标会继续说谎（用户会以为看到的仍是模型的判断）。
- 界面：优先级排序页新增**两步式**面板（生成建议 → 逐条看「当前 → 建议」与理由 → 勾选后应用），
  **刻意不做「一键全改」**：模型的分数可能整体偏高，批量静默覆盖用户自己填过的判断，比不做更糟。
  排序行带 `AI 评` 徽标（悬停显示打分时间），悬停分数可看到**构成的五项拆解**（公式只此一份，界面不再抄一遍）。

### 新增 — 引用追踪 → 插入引用（与写作闭环打通）

- 新增可复用组件 `InsertCitationButton`：一次点击生成 `[@id]`（多篇合成 `[@a, @b]`）→ 经 store 的一次性投递
  送进写作工作台 → 落到 **`Related Work` 章节末尾**（匹配不到时按规则回落）→ **自动切到写作页**，
  让用户当场看到它落在哪。它替掉的是「复制题录 → 切页 → 找章节 → 粘到光标处」四步手工动作。
- 一次性投递扩展成两种落点：`section`（新建章节，综述草稿用）与 `append`（追加到已有章节，引用/段落用）。
  单条 `[@p1]` 若走「新建章节」，稿件里会凭空多出一个只含一个标记的章节 —— 比不插入更糟。
  落点由纯函数 `pickAppendTarget` 决定：**指定章节名优先**（严格相等，不做模糊匹配，否则「Related」会把两章都吃掉）
  → 否则**最后一个有内容的章节** → 否则第一章；一章都没有则退化成新建章节。
- 三处调用：**引用追踪**（引用排行可一次把前 5 篇合成一处引用、逐条关系一键引用被引方）、
  **关系网络**（一条关系＝两篇一起引）、**论文详情**（BibTeX 卡片旁）。

### 修复 — 引用统计口径与列表对齐（原实现自相矛盾）

`/api/citations` 会把「指向已删除论文」的关系过滤掉，但 `stats.totalCitations` 用的是**过滤前**的条数 ——
于是界面上会出现**「引用关系 3」而列表区写着「暂无引用关系」**（本机实测就是 3 条这样的孤儿关系）。
用户既看不出原因（删论文不会连带删除关系），也没有任何提示。现在：统计口径与列表**同源**，
并新增 `stats.orphanCitations` 如实交代被隐藏的条数（界面显示「另有 N 条关系的论文已不在库中」），
引用排行也只按**确实可见**的关系计算（否则会出现「列表里没有、排行里却有」的幽灵计数）。

### 测试

- 新增 `tests/lib/reading-priority.test.ts`（33 例）：公式**逐字节等价对照**、排序稳定性（同分按年份降序再按标题，
  不依赖引擎的稳定排序行为）、不改入参、数值/枚举收敛、JSON 抠取与坏输出降级、`unknownIds`/`malformed` 回报、
  `diffSuggestion` 的「只显示真的变了的项」、来源标记的累加与摘除。
- 新增 `tests/lib/paper-score-routes.test.ts`（13 例）：真调两个 handler，断言**写入参数** ——
  越界数值必须夹紧后才写库、论文已删除只报 `missing` 不带崩整批、写回成功必须写来源标记、
  全部失败时**不能**写标记、空 `items` 400 且不碰数据库。
- 新增 `tests/lib/citations-route.test.ts`（3 例）：把「数字与列表必须一致」这条钉死（含孤儿关系的两种分布）。
- 新增 `tests/lib/citation-loop.test.ts`（10 例）：跨 5 个文件的**接线契约**（按钮 → store → 工作台消费端），
  任何一处缺失都只会表现为「点了按钮什么都不发生」，不报错、没日志，所以必须逐处钉住。
- `tests/lib/writing-draft.test.ts` 增补「追加目标的选择」9 例（含不修改入参、越界索引原样返回、追加后引用编号照常解析）。
- `tests/lib/ai-routes-contract.test.ts` 把新路由纳入防编造守卫，并新增一条「JSON 模式路由不得拼 Markdown 格式合同」。
- 全量：**40 文件 / 734 用例通过**（上一版 36/654）；`tsc` 无输出、`eslint` 无输出。

### 验证（真机，无头 Edge + CDP）

`.recon/out/verify-scores-citations.mjs` —— **21/21 通过，零未捕获异常**：

1. **AI 面板**：优先级排序标签下渲染出取料三件套（课题域/重评范围/上限）与打分按钮；点击后请求**真的发到**
   `/api/ai-paper-score`，返回的错误是「尚未配置 LLM API Key」（出自 `llmFailureResponse`）而**不是**入参错误或
   `NO_CONTEXT` —— 这反过来证明新路由的 scope/topic 校验与取料路线在真实库上完整跑通了（本机未配 Key，故走错误分支）。
2. **引用闭环**：建一条真实引用关系后，点「把前 N 篇插入稿件」→ 界面切到论文写作页 → toast 明确说出
   「已插入「Related Work」章节末尾」→ 稿件正文里确实出现 `[@id1, id2]`（两篇合成一处引用）。
3. **追加而非覆盖**：再点一次逐条关系的插入按钮，稿件从 55 字变成 85 字，**第一次插入的内容仍在**，
   且标记数从 1 处变 2 处 —— 这条最容易被「插入变成覆盖」的实现悄悄破坏。
4. 孤儿关系的提示在真机上可见（「另有 3 条引用关系的论文已不在库中」）。
5. 截图留档 `.recon/out/{scores-panel,scores-panel-after-run,citation-tracker,citation-inserted,citation-appended}.png`。
6. 验证用的临时稿件与临时引用关系已用应用自身的 DELETE 接口删除，并以「接口 + 直查 SQLite」双重复核：
   **回到 0 稿件 / 3 条原有关系 / 20 篇论文**的原始状态。

## [1.3.8] - 2026-09-20

**这一版把「结果长什么样」和「引用怎么落地」这两件事交给用户：AI 结果的呈现密度可在设置里选，参考文献可按 IEEE 或 GB/T 7714 著录，综述不再是只能看的文本而是能一键进写作台的草稿。**

起因是用户在完成 1.3.7 之后的两个判断：*「我觉得可以设计结果界面在设置供用户选择」* 与 *「基础功能足够，可以拓展了」*。于是这一版不走新模块，而是把**已有功能里"差最后一米"的地方补齐**：密度补的是「同一份结果要能适应不同阅读场景」，引文与综述补的是「AI 产出要能真的进稿子」。

### 新增 — 结果呈现密度（设置 → 界面与阅读）

用户反馈 *「可以设计结果界面在设置供用户选择」*。选的是最低风险、复用度最高的那一层：**呈现密度与排版**——只改 AI 输出的字号／行高／字体，不动布局与数据。

- **三档**：`紧凑`（字号 ×0.92、行高 1.5，一屏看更多结论）／`标准`（默认，与界面其余部分一致）／`论文式`（字号 ×1.08、行高 1.9、正文换衬线体）。选择立即生效并持久化在 `ai-research-store`，**已生成的结果直接跟着变**，不需要重跑 AI。
- **实现走「一个 html 属性 + 两个 CSS 变量」，不走组件 props**（`src/lib/result-density.ts` + `globals.css`）：
  `AiMarkdown` 的 `size` 档位是**面板级**相对基线（侧栏小抽屉 vs 主内容区），只有调用处知道该给哪档；而密度是**全局**偏好。两者正交。若把密度做成 `size` 的默认值，**8 个 AI 面板全部显式传了 `size`**，偏好会被完全吞掉——所以密度改为写在 `<html data-result-density>` 上，由 CSS 变量施加缩放。
  代价是要把 `AiMarkdown` 里写死的 `text-xs`／`text-[13px]` 改成相对字号（`em`），否则密度换档只改段落、标题和表格纹丝不动。
- 主题与密度同属「读 store → 写一个 html 属性 → 全局 CSS 跟着变」，合并进 `appearance-manager.tsx`（原 `theme-manager.tsx`），避免每加一项外观偏好就多一个只在 `app-shell` 里挂一次的幽灵组件。
- 设置页新增「界面与阅读」卡片：三档单选 + **实时预览**（预渲染一段真实的 AI 输出样张，不另做假预览）。

### 新增 — 写作即引用：参考文献著录格式（IEEE / GB-T 7714）

写作工作台此前已经能把正文里的 `[@paperId]` 按首次出现顺序编号、生成参考文献表并导出，但**著录格式写死成 IEEE 一种** —— 要投国内期刊（GB/T 7714）就得手改整张文献表。

- **抽出 `src/lib/writing/citation-styles.ts`**（纯函数层）：`formatReference(ref, style)` 派发到 IEEE 与 GB/T 7714-2015 两套实现。`draft.ts` 的 `formatReferenceIEEE` 退化成一行包装，**既有调用方与单测零改动**。
- **姓名解析刻意「不猜」。** 库里真实的作者串是「姓, 名」逗号拼接（`Nasir, Y. S., Guo, D.`、`Li, Aoyang, Wang, Ye, Mei, Lin, Wu, Shaohua, Zhang, Qinyu`、`Mudumbai, R., Brown, D.R., Madhow, U., Poor, H.V.`、`Zhang, S. et al.` —— 2026-09-20 用只读探针抽样确认），而 IEEE 要「缩写在前」、GB/T 要「姓在前名缩写」，**两种格式都要重排姓名**。于是先做一次解析，判据按可靠性排序：
  1. 有 `;` → 无歧义分隔符，优先；
  2. 否则按逗号切，**段数为偶数 + 首段不是「缩写在前」+ 所有奇数位都像「名」** → 按「姓, 名」两两成组（覆盖真实库的全部形态）；
  3. 否则每段各自解析（覆盖 `J. Smith, A. Lee` 这类「缩写在前」的列表）。
- 分不清的（`John Smith` 名在前无缩写点、段数为奇数、单段只有缩写 `Y. S.`）一律 `certain=false`，**回落到原始作者串** —— 格式不标准可以改，姓和名颠倒了是要出勘误的。
- GB/T 7714 补齐规范里能补的部分：文献类型标识 `[J]/[C]/[M]/[D]`（只凭 venue 文本推断；`Proceedings of the IEEE` 是期刊不是会议，这条特判必须排在会议判断之前）、超 3 位作者只列前 3 位加「，等 / , et al.」、缩写点省略（`SMITH J`、`D.R.` → `D R`）。**库里没有的字段（卷/期/页码/出版地/出版者）不输出占位符**，界面明说这个缺口 —— 编造比留空更贵。
- 顺手修掉一个既有瑕疵：库里有 `venue` 混着年份的记录（`IEEE TCOM, 2019`），原样拼会导出「IEEE TCOM, 2019, 2019」。现在只在尾部年份**恰好等于 `year` 字段**时删掉，不误伤 `ICC 2025 - IEEE International Conference on Communications` 这类自带年份的会议名。
- **样式是全局偏好，不是稿件字段**：存在 `ai-research-store` 的 `citationStyle`，**不给 Manuscript 加列、不做库迁移** —— 升级零风险。工作台右栏加了格式下拉 + **现算样张**（样张由真实渲染函数生成，不手写，避免说明与实现漂移）、导出徽标、以及「库里没有卷期页码」的提示。
- 预览列表与导出**同一样式**：导出链接带 `?style=`，未知样式**显式 400 并列出可选值** —— 静默回退成 IEEE 会让用户以为拿到 GB/T，到投稿被打回时才发现。

### 新增 — 阅读 → 综述草稿（`/api/ai-review` 重写）

- **旧实现的三个问题**：取料是 `paper.findMany({ take: 15, orderBy: year desc })` —— 全库最新 15 篇，**与用户读过什么、属于哪个课题都无关**；引用写成 `[Author, Year]` 自由文本，与文献库没有任何结构关联，**既不能自动编号也不能生成文献表**。
- **取料改为两维**：`scope`（阅读范围：仅已读 / 已读+在读 / 不限，**默认仅已读** —— 综述依据只应该是你确实读过的）× `topicId`（课题域，复用与 AI 研究分析同一个 `scopeByTopic`：手挂优先 + 关键词兜底）。响应回传 `excludedByScope`，让用户知道「还有 N 篇没读、没标记」。
- **产出改为真引用**：提示词写死 `[@paperId]` 语法（id 必须逐字取自清单），并明确禁止自造编号与参考文献表 —— 那段提示词不只是格式要求，它是**与写作工作台之间的接口约定**。
- **防幻觉收口**：生成后把正文里所有 `[@…]` 与清单求差集，`citations.unknown` 原样回报并当场告警（凭空编 id、把作者名写进标记都会在这里被抓住）。这类错误在导出前几乎不可能被发现。
- **无料必拒**：范围内没有论文时 400 + `NO_CONTEXT`，并给出可操作的下一步（放宽范围 / 去标记已读），而不是拿空清单让模型凭记忆编综述。
- **一键闭环**：面板新增「发到写作工作台」，经 store 的一次性投递插入为新章节（没有稿件时会在内存里等，新建后立刻补插）。没有这条通道，用户要自己复制 → 切页 → 选章节 → 粘到光标处。
- **信息架构**：「综述草稿」独立成一个标签 —— 原先它挂在「审稿回复」下面，用户根本找不到。

### 测试

- 新增 `tests/lib/result-density.test.ts`：预设/归一化/脏值收敛/`<html>` 属性写入，以及一组 **CSS 漂移守卫**——逐档核对 `globals.css` 里存在 `html[data-result-density='…']` 规则、核对「标准」档显式声明与 `:root` 缺省值一致、核对三档系数方向正确。漏写一档的症状是「选了没反应」且不报错，必须由测试兜住。
- 新增 `tests/lib/citation-styles.test.ts`（46 例）：**用例里的作者串全部取自真实库**（不是编的）——姓名解析这类逻辑用编的样例测等于没测；含 `et al.` 双句点、`Proceedings of the IEEE` 类型判定、venue 去重年份等具体回归线。
- 新增 `tests/lib/manuscript-export-style.test.ts`：真调导出 handler，钉住「不带 style 时与旧行为逐字一致」「未知 style 400 且列出可选值」「txt 也带样式」「format 与 style 两条校验不互相吞掉」。
- 新增 `tests/lib/review-draft.test.ts`：真调路由 handler，钉住阅读范围过滤、课题域筛选、**无料必须 400 NO_CONTEXT 且不打 LLM**、编造引用被检出且不静默丢弃、以及「引用语法是与写作台的接口约定」。
- `tests/lib/ai-markdown.test.ts` 的「排版成档」块改写：从断言 `text-xs` 等固定字号，改为断言**基线写进行内 `--ai-md-base`** 且标题/表格用相对字号（原来的断言在新机制下已不成立）。
- 全量：**36 文件 / 654 用例通过**；`eslint` 无输出。
- ⚠️ **一处真实的门禁教训（值得记下来）**：本机 `tsc --noEmit` 判绿，第一次 CI 却红的 ——
  `src/app/api/ai-review/route.ts` 有一处类型错误：`SCOPE_STATUSES[scope]` 是**元组联合类型**
  （`readonly ["read"] | readonly ["read","reading"] | readonly []`），在它上面调 `.includes(p.status)`
  时参数被收窄成字面量 `"read"`，于是 `string` 传不进去。
  本机为此做了 5 组对照：同一份 TS 5.9.3、同一份 tsconfig、换 `-p`/不带 `-p`/关掉增量缓存，
  `tsc` **一律判绿**（另做过反向验证：往该文件里塞一个必然的类型错误，`tsc` 确实会报 ⇒ 文件是被检查的）。
  差异来自 **Next 自己的类型检查路径**，而 `next build` 在本机会无限挂起、跑不了 —— 所以本机拿不到同源门禁。
  ⇒ 已修（显式标注 `readonly string[]`）。经验：**不要在「元组联合类型」上直接调 `.includes()`**，
  显式标注宽类型（`readonly string[]`）即可；**涉及类型收窄的改动，最终以 CI 绿为准**，不能只看本机 `tsc`。

### 验证（四层，逐层加强）

1. **编译产物**（`.recon/out/verify-density.mjs`）：起服务抓首页样式表，确认三档变量块与 `.ai-markdown` 的 `calc()` 取用点**真的被 Tailwind 编进产物**，且规则落在 `@layer components`（早于 `utilities`，调用处仍可覆盖）。**11/11 通过**。
2. **真机计算样式**（`.recon/out/verify-density-browser.mjs`，无头 Edge + CDP）：三档实测 `11.04 / 12 / 12.96 px`，行高 `1.5 / 1.625 / 1.9`，论文式确实切到 `Noto Serif SC`；**「字号 = 行内基线 × 密度系数」偏差 0.0000px**，标题与表格同步缩放。**12/12 通过**。
3. **真机引文切换 + 综述面板**（`.recon/out/verify-citation-browser.mjs`，无头 Edge + CDP，**33/33 通过、零未捕获异常、零 console.error**）：
   - 给临时稿件塞入一条**真实库题录**的引用（`Uher, Jason, Wysocki, Tadeusz A., Wysocki, Beata J.`），然后在页面上切换格式下拉：IEEE 形态（`Jason Uher, …`）↔ GB 形态（`UHER J, WYSOCKI T A, WYSOCKI B J. Review of distributed beamforming[J]. …`）**互斥生效**，徽标与持久化值同步，证明「解析 → 重排 → 著录」整条链路在真数据上正确；
   - 综述面板的两个选择器（课题域默认选中第一个课题并显示「· 5 篇」、阅读范围默认「仅已读」）与生成按钮的**禁用→可用**状态机；
   - 点生成后请求**真的发到 `/api/ai-review`**，且返回的错误是「尚未配置 LLM API Key」而**不是**入参错误或 `NO_CONTEXT` —— 这反过来证明新路由的 topic/scope/focus 校验与取料在该课题+仅已读范围内全部通过、一路走到了 LLM 调用（本机未配 Key，故走错误分支）。
4. 截图留档 `.recon/out/density-{compact,standard,paper}.png`、`citation-ieee.png`、`citation-gbt7714.png`、`review-draft-panel.png`。
5. 验证用的临时稿件（1 条）已用应用自身的 DELETE 接口删除，并以「接口 + 直查 SQLite」双重复核回到 **0 稿件**的原始状态。
6. **一处如实说明**：`.recon/verify-planner/run.mjs`（研究规划 / 通知模块的接口级 E2E）本轮**未能运行**。
   `next dev` 是**每目录单例** —— 本机开发用的实例正占着该目录，脚本自己打印了
   `Another next dev server is already running`（已有实例：端口 3111 / PID 42148），于是它连服务都没起来。
   它覆盖的研究规划模块**本轮未改动任何文件**（本轮集中在写作 / 引文 / AI 综述 / 结果密度），
   而为了跑它去停掉用户正在使用的服务并不合适。⇒ 这一项是**环境受限**，不是回归。
   顺手把脚本改成遇此情形给**专用退出码 3 + 明确诊断**，不再伪装成「服务未能启动」的功能失败。

## [1.3.7] - 2026-09-20

**这一版做三件事：把界面从「AI 生成的仪表盘」改成「能长时间读的科研工具」、把运行时手感与打包体积收一遍、给桌面壳层做一轮安全加固。**

起因是两条用户反馈：一是 *「主要功能具备了，但是还是像 demo」*（并要求「科研风的页面排版」），二是 *「优化下运行时的手感和加载速度 …… 重视下软件安全，防止有人拿到软件逆向破解」*。第一条是体量主体（**全部 12 个页面一次改完**，方向定为学术论文风：干净白底、衬线正文、细分割线、大留白、单色强调）；后两条不改变任何功能语义，只让**同样的功能跑得更快、更小、更难被逆向**。

### 为什么"像 demo" —— 诊断结论

不是配色问题，是**信息层级与排版语法**的问题：

| 症状 | 证据 | 为什么显得像模板 |
|---|---|---|
| 字号全线偏小 | 实测 `text-[9px]` 16 处、`text-[10px]` 126 处、`text-xs` 263 处 | 正文普遍 10–12px，是「控件说明面板」的密度，不是阅读密度 |
| 卡片套卡片 | 每个 section 都是 `Card > CardHeader > CardContent` | 屏幕被切成等大方块，视觉上没有主次 |
| 装饰过载 | 7 处渐变、7 处 hover 上浮阴影、脉冲绿点、渐变标题文字 | 营销落地页的语言，不是工具 |
| 首屏被零值占据 | 4 个统计卡显示「0 已读 / 0 评审」 | 无数据时这些卡是纯噪音 |

### 改造 — 设计令牌层（`src/app/globals.css` 重写）

- **字体切到系统字体栈，彻底移除 `next/font/google`。** 这是本次唯一的功能性修复：本应用是**离线桌面客户端**，`next/font/google` 断网时拉不到字体。改用系统自带的 **Noto Serif SC（思源宋体）** 做正文、Noto Sans SC 做界面、Cascadia Mono 做数字。
- **字号阶梯重建**：正文 14px、长文 15px/行高 1.75、页标题 24px 衬线。并在令牌层把 Tailwind `text-xs` 从 12px 抬到 13px —— 代码里有 400+ 处此类 class，**在令牌层抬高比在 class 层逐处改更彻底**。
- **配色收敛**：改为纸感暖白 + 墨色文字 + 单一墨蓝强调色；深色主题改为阅读器夜间模式。清掉全部彩色渐变。
- 新增排版原子类：`.eyebrow` / `.page-title` / `.display-title` / `.section-title` / `.prose-research` / `.caption` / `.rule` / `.tabular`。

### 改造 — 结构与组件

- **新增 `src/components/section-header.tsx`**：把原先寄生在 `papers-section.tsx` 里、被 11 个页面 import 的 `SectionHeader` 抽成独立组件并重设计（眉标 + 衬线标题 + 说明行 + 分割线），同时提供 `SubSection` 与 `EmptyState`。消除页面间互相 import 的耦合。
- **`app-shell.tsx`**：顶栏从 14 行压到 12 行，去掉 logo 渐变与脉冲点；侧边栏导航由「中文 + 英文副标题双行」改为单行中文、英文降级为 hover 提示；新增面包屑给阅读定位感；版心宽度统一为 1180px。
- **`overview-section.tsx`**：首屏改为论文式题头 + 摘要段落；统计条改为**分割线网格**并在**全为 0 时整体收起**；「三层架构」从彩色渐变卡片改为学术表格式线性表达。
- **其余 10 个页面**：批量提级过小字号 **142 处**，清掉全部装饰性渐变与 hover 上浮阴影，改用边框高亮表达可交互。

### 性能 — 加载速度与运行时手感

- **12 个功能页全部改为 `next/dynamic` 按需加载（`src/app/page.tsx`）。** 这是个单页工作台，改造前 12 个 section 是**静态 import** ⇒ 打包器把它们连同各自的重量级依赖压进同一个入口 chunk：打开应用哪怕只想看首页，也得先下载并解析**全部** 12 个页面的 JS。实测首屏前端 JS 达 **1.8 MB**，其中 recharts 一块就占 **1.1 MB**（全站前端 JS 的六成）。改造后每个 section 是独立 chunk，首屏只加载「总览」一块，其余在点击时按需拉取 —— 这是**首屏收益最大的一处改动**。
- **把 recharts 从首屏关键路径上摘掉（新增 `src/components/stats-charts.tsx`）。** 图表原先内联在 `overview-section.tsx` 里，导致「总览」自己的 chunk 就绑着 1.1 MB 的图表库。现已抽成独立组件、与同样依赖 recharts 的阅读历史一起改为 `dynamic()` 延迟加载：**统计区没数据时连这个 chunk 都不会被请求**。
- **切换页面时不再有白屏。** 每个懒加载 section 都配了保持版心与留白的骨架占位（`SectionFallback`），避免「点一下 → 布局塌掉 → 内容跳出」的跳动感。
- **核对了「运行时手感」的另一半：没有发现无意义的持续开销。** 全量扫过 `setInterval` / 轮询 / 高频重渲染路径后确认：唯一的定时器是阅读计时器（语义上必须有），不存在后台轮询接口的行为。**这一条是结论，不是遗漏** —— 没有为了「优化」去动本来就不慢的地方。

### 性能 — 打包体积与体积泄漏

- **修掉一处隐蔽的体积泄漏：`pruneStandalone()` 对符号链接目录完全无效。** 它跑在 `dereferenceSymlinks()` **之前**，而 `readdirSync` 不穿透符号链接 —— walk 进去看到的是空目录，于是「清理过了」的假象下，`@prisma/client-<hash>/runtime/` 在解引用**之后**又整个变回 **73.4 MB**。新增 `pruneLinkedDeps()` 排在解引用之后执行，这一轮才真正清得掉。
- **Prisma：按可达性闭包裁剪（`collectRequireClosure`）。** 判据来自实测而非猜测：`.prisma/client/index.js` → `require('@prisma/client/runtime/library.js')`，而 `library.js` 的全部 require 都是 Node 内置模块，**不引用 runtime 目录里的任何兄弟文件**。也就是说 73.4 MB 里真正必需的是 `library.js` **一个文件（197.8 KB）**，其余是 5 种数据库 × 2 种模块格式的 `*.wasm-base64.*`、四套平台 runtime（edge / wasm-engine-edge / binary / react-native）与全部 sourcemap。删 `wasm-base64`（含 sqlite 那份）是安全的：生成的 client 走 **native 引擎**（`query_engine-windows.dll.node`），WASM 路径只有 `wasm.js` / `wasm-engine-edge.js` / `edge.js` 三个入口用得上，已确认它们**从未被任何编译产物 require**。
- **pdfkit：刻意不用闭包裁剪，改走保守白名单。** 它是 **Yarn workspace 快照**（11.1 MB），里面混着构建工具链（`.yarn/releases/yarn-4.16.0.cjs` 2.9 MB、`install-state.gz`、`tools/`）和四份并列产物。**不能照搬闭包裁剪的原因**：`js/pdfkit.js` 里有运行时 `fs.readFileSync`，读的是 `./data/*.icc` 这类**非 JS 资源**，静态 require 图根本看不见 —— 闭包算法会得出「只需 pdfkit.js 一个文件」并据此删掉数据目录，那是个定时炸弹（PDF/A 的 `endSubset()` 会读 ICC）。所以只删构建工具链 + 明显走不到的备用入口 + sourcemap，**数据目录一律保留**。
- **闭包算法的安全性质：解析不到就整体放弃。** `collectRequireClosure` 遇到任何**相对** specifier 解析不出落点时**返回 `null`**，调用方据此放弃这个包的裁剪 —— 因为删除是 `recursive: true` 的，一个解析不到的 `require('./x')` 若其实指向 `./x/index.js`，整个目录就会被误删。**宁可多留，也不赌。**（裸模块名不受此限：它们本来就不在待裁目录里。）另外按「保留路径的顶层段」而非「名字相等」决定删不删，否则目录式 require 的父目录会被连坐删掉 —— 这两条都是被单测当场抓出来的真 bug。
- **关闭服务端 source map（`next.config.ts` 的 `serverSourceMaps: false`）。** Next 默认会在 `.next/server` 下为每个 route 生成 `.js.map`（实测 **191 个**），而它们带 `sourcesContent` —— 即**完整的原始 TypeScript 源码与注释**。对一个要防止逆向的桌面客户端，这等于把后端逻辑连同注释一起送出去。关掉后收益是双份的：少约 190 个文件（体积与解压时间同降）+ 逆向者只能读到压缩后的产物。
- **实测回收 95.6 MB（120.9 MB → 25.3 MB）。** 在真实产物副本上干跑 `pruneLinkedDeps` 并逐项断言：必需文件（`library.js`、包顶层入口、pdfkit 的 `js/data/**` 与 `js/standard-fonts/**`）全在，废料（`*.wasm-base64.*`、`.yarn/`、`tools/`、`*.js.map`）全清。
- **落到用户看得到的那个数字上：安装包 144.2 MB → 114.8 MB（−29.4 MB，约小 20%）。** ⚠️ 两个数字不一样不是矛盾 —— 上面 95.6 MB 是**解压后的产物体积**，而安装包是压缩过的，被删的内容里占比最大的 `*.wasm-base64.*` 本身就是 base64 文本、压缩比极高（87 MB 的 Prisma 载荷压完只剩二十几 MB）。**要报「装得更小」就报 29.4 MB，别拿 95.6 MB 去说安装包。**

### 安全 — 防止逆向破解（新增 `desktop/hardening.js`）

**基线是本来就有的**（`contextIsolation: true` / `nodeIntegration: false` / `sandbox: true` / 无应用菜单 / 外链交系统浏览器 / 每个 IPC handler 校验调用方来源）；本模块补齐其余部分，集中在一处便于审阅与回归：

- **生产态 DevTools 关死（两层）。** ① `devtools-opened` → 立刻 `closeDevTools()`，兜住所有「已经开出来」的路径（含外部插件、命令行开关）；② `before-input-event` 拦掉 F12 / `Ctrl+Shift+I|J|C` / `Ctrl+U`。两层都要的原因：只靠 ① 会有「闪一下又关」的观感，而且 **DevTools 一开就已经能读到内存里的 API Key、能改前端逻辑绕过校验**，闪一下可能就够用。
- **导航白名单。** `will-navigate` / `will-frame-navigate` 只放行受信任源，外部 http(s) 一律 `preventDefault()` 后交系统浏览器。要拦的不是页面里的 `<a target="_blank">`（那些走 `setWindowOpenHandler`），而是**当前窗口自身被导航走** —— 一旦导航到外部站点，那个站点的脚本就跑在一个挂着我们 preload 的窗口里，能直接调 `electronSaveFile` / `electronInstallUpdate` 这些通道（`guardSender` 会因来源不符拒绝，但安全性不该只押在一层上）。
- **权限全拒。** `request` / `check` / `device` 三路 handler 一律 `false`（摄像头、麦克风、定位、通知、剪贴板读、USB/串口/HID）。科研工作台不需要这些，全关比逐个评估更安全。
- **CSP 响应头（生产态生效）。** `default-src 'self'`、`connect-src 'self'`、`object-src 'none'`、`base-uri 'none'`、`form-action 'none'`、`frame-ancestors 'none'`，**不启用 `unsafe-eval`**。同时覆盖而非追加同名头（重复 CSP 在浏览器里是取交集，会让策略变得难以预测），并补 `X-Content-Type-Options: nosniff`。
  - **唯一的让步是 `script-src` 里的 `'unsafe-inline'`**，且是必需的：Next App Router 会在 HTML 里内联引导脚本（本项目的主题初始化也是内联脚本），无法用 nonce 覆盖所有情况。之所以可接受：页面内容全部来自本地打包产物，**「能往页面里插脚本」这个前提在当前架构下并不成立**。
  - **开发态不启用 CSP**：`next dev` 的 Turbopack HMR 走 eval，没有 `'unsafe-eval'` 会直接把开发服务器打死。代价（「CSP 在开发期不受检验」）由两道补偿兜住：`ANL_FORCE_CSP=1` 可在开发态强行打开；打包态挂 `watchCspViolations`，真有资源被拦时日志里直接给出行令与 URL，而不是只对着白屏猜。
- **`webPreferences` 把默认值显式写死。** `nodeIntegrationInWorker` / `nodeIntegrationInSubFrames` / `webviewTag` / `allowRunningInsecureContent` / `experimentalFeatures` 在 Electron 里默认就是关的，写出来是为了**改不回去**（任何一项打开都等于在渲染进程上开一个逃逸口）；另外关掉 `spellcheck`（本应用没有需要拼写检查的输入场景，顺带避免输入内容被系统检查器读走）。
- **`app.zip` 里的构建机符号链接断言保持不变**（§6.12）：打包前 `dereferenceSymlinks()` + 对最终 zip 断言 0 条链接 —— 宁可打包失败，也不发一个所有用户都装不起来的包。

> **这一轮的边界要讲清楚**：以上都是**提高逆向成本**，不是「无法破解」。Electron 应用的代码最终一定在用户机器上，能做的只有把「读内存里的密钥」「改前端绕过校验」「拿到带注释的原始后端源码」这几条路一条条堵上。本轮把最容易被顺手利用的几处（DevTools、源码 map、无 CSP、权限默认放开）全部处理掉了。

### 修复

- **`next.config.ts` 新增 `allowedDevOrigins`。** Next 16 默认拒绝非 `localhost` 来源的开发资源请求，导致本机用 `127.0.0.1` 抓图时「页面 200 但 JS 全被拦」—— 表现为截图只有空壳 HTML、注入状态后仍停在同一页，**极易被误判成「样式没生效」**。这个坑排查了很久，记在此处。
- **`papers-section.tsx` 的 `SectionHeader` 引用**：抽出组件后文件自身仍在使用 `<SectionHeader>`，而 re-export 不产生本地绑定，导致运行时 `ReferenceError: SectionHeader is not defined`（整页白屏）。已改为正常 import。
- 本地 dev 库缺 `Paper.topicIds` / `Note.topicIds` 列导致 `/api/notifications` 等接口 500，已用 `prisma db push` 补齐（改动前已备份 `db/custom.db`）。

### 验证

- `tsc --noEmit` 通过（rc=0）；`eslint .` 通过（rc=0）。
- `vitest run`：**32 文件 / 573 用例全过**（1.3.6 是 31 / 519），无回归。新增 `tests/desktop/hardening.test.ts`（26 例：CSP 指令逐条、`applyCsp` 只对受信任源生效、权限三路全拒、DevTools 锁定只在打包态生效、导航白名单、`openExternal` 抛错不影响主流程），并把 `tests/desktop/prepare-standalone.test.ts` 扩到 36 例（补 `collectRequireClosure` / `pruneLinkedDeps` / `isDeadPdfkitAsset` 三组）。
- **CSP 用真实服务响应验证过兼容性，不是「写了就算」**：拉取 9 个前端 chunk 逐一扫过，`eval` / `new Function` **0 处**（唯一命中是 lodash 的 `Function("return this")()` 短路 idiom，正常路径走不到）、无外部 CSS `url()`、唯一的外部引用（favicon 指向 CDN）已改为本地 `/logo.svg`。**这三条正是 `'unsafe-eval'` 与 `connect-src 'self'` 敢收这么紧的依据。**
- **裁剪做了「功能验证」，不只是比对文件清单。** 把运行时**真正加载的那份** pdfkit（`.next/node_modules/pdfkit-d5967b64ee09fcf0`，11.13 MB / 323 个文件）复制成夹具，先跑一次基线：能生成 PDF（1615 B，头 `%PDF-1.3`）；再跑 `pruneLinkedDeps`（移除 121 项、回收 9.35 MB → 1.79 MB），**裁剪后再生成一次，仍然成功**（1612 B，头 `%PDF-1.3`），且 `js/data/*.icc`、`js/data/*.afm`、`js/standard-fonts/**`、嵌套的 `node_modules/@noble/hashes/**` 与两个入口文件全部保留。prisma 侧同理：`require(runtime/library.js)` 在纯 Node 进程里载入成功（导出 30 项含 `getPrismaClient`），其 11 处 `require` 全为 `node:*` 内置模块。
  - ⚠️ 排查途中踩到一个**假警报**，记下来免得下次重踩：`node_modules/pdfkit`（tracer 复制的那份）里的 `@noble/hashes` 是被**掏空**的（只剩 `esm/` 子集），直接 `require` 它会报 `Cannot find module '@noble/hashes/utils.js'`。但那**不是运行时那一份** —— 编译产物用的是 `e.y("pdfkit-d5967b64ee09fcf0")`（Turbopack 外部化），运行时加载的是 `.next/node_modules/` 下带哈希的副本，它的嵌套 `node_modules/@noble/hashes` 是完整的。**判定「哪一份在跑」必须看编译产物里的外部化名，不能按目录名猜。**
- 用无头 Edge 逐页截图核对浅色与深色两套主题。
- **本机没有跑 `npm run desktop:build`**：`next build` 的 typecheck 阶段在本机无限挂起（实测挂过 2h20m），打包一律交给打 tag 后的 CI。体积裁剪的本地证据是**在真实产物副本上干跑 + 逐项断言 + 功能验证**（见上），产物级验证由 CI 的打包自检完成。

## [1.3.6] - 2026-09-18

**这一版回答两个问题：「更新过程完全看不懂」和「AI 功能拿不到该拿的原料」。** 用户跑通 1.3.4 → 1.3.5 的自更新后反馈：*「不知道怎么下的，需要重启安装，然后安装没有进度条之类的」*；紧接着又提了两条：*「打分应该是 AI 打的吧，自己打分有点难」* 与 *「AI 研究分析应该要加一个课题选择，多个同时分析内容少不说还容易在课题多了以后互相干扰」*。前者的结论是**三点里只有一点能在架构上修**，另两点只能把话说清楚；后两条是这版的功能主体。

### 更新体验（用户反馈「不知道怎么下的 / 需要重启 / 没有进度条」）

| 用户说的 | 真相 | 这版怎么办 |
|---|---|---|
| 不知道怎么下的 | 下载进度**早就有数据**（`percent`/`speed`/`transferred`/`total`），但只渲染成一个数字，且只存在于设置页与窗口标题里 | 补真正的进度条 + 传输量 + 速度 + 剩余时间；下载完成后给出**安装包本机路径** |
| 需要重启安装 | electron-updater 的固有行为（安装要替换正在运行的程序文件），改不掉 | 把「为什么」和「会花多久」提前讲清楚 |
| 安装没有进度条 | **架构上给不了**：`quitAndInstall(true, true)` 以 NSIS `/S`（静默）调起安装器，静默安装不绘制任何界面；且应用此时已退出，前端连一次渲染机会都没有。而 `/S` 又不能去掉 —— assisted 安装器里「装完自动拉回应用」的条件是 `${isForceRun} AND ${Silent}`，去掉就变成「点更新 → 窗口消失 → 不回来」 | **把反馈前移到退出之前**：安装前新增确认框，明说「窗口会关闭、没有进度条是正常的、约 10–60 秒后自己回来、一分钟后没回来怎么办」 |

### 新增 — AI 打分（「自己打分有点难」）

- **`src/lib/methodology/topic-ai.ts` —— 打分矩阵的 AI 支撑层（纯函数）。** 选题评估共 4 个维度 / 13 个细项，以前全靠用户逐项拖滑杆，新增课题还一律预设 5 分。现在 AI 一次把全表铺好，用户只改不认同的。关键取舍：**它不是「AI 替你决定课题好坏」**，所以路由**只算分、不落库** —— 前端拿到后走既有的 `PUT /api/topics/[id]`，用户改过哪几项、什么时候改的，全部留在同一条数据路径上
- **区分「AI 有资格判」与「只有你知道」的细项。** 判据不是「AI 会不会答」，而是**事实存在于谁手里**：数据/仿真平台可得性、计算资源需求、个人能力匹配度、是否与毕业论文方向一致 —— 这 4 项是私有事实，模型只能给同类样本均值。UI 上给它们打「确认」徽章，提示词里也显式要求注明是估计，避免模型用确定的语气说「你匹配度 8 分」而用户信以为真
- **`POST /api/ai-topic-score`。** 打分依据**限本课题**（复用同一套课题域筛选），避免拿全库数据给单个课题打分时把别的方向的趋势算进来。两道硬校验：模型没吐出可解析的 JSON → 502 `LLM_BAD_OUTPUT`；一项都没识别出来 → 同样 502。**绝不回 200 让前端把一整表 5 分当成 AI 结果写进库**（用户会以为「AI 认为全项中等」）
- **打分依据的可见性。** 返回 `evidence:{paperCount,noteCount,unlinkedPapers,unlinkedNotes}`，界面直说「本次依据 N 篇论文、M 条笔记」，并提示「另有 K 篇论文未归到本课题，未参与打分」。一个课题还没挂料时，用户能看到 AI 是**凭课题名硬猜**的，而不是以为它「读了资料」

### 新增 — AI 研究分析的课题选择（「多个同时分析 … 容易互相干扰」）

- **`Paper.topicIds` / `Note.topicIds` 两列。** 这是修「互相干扰」的地基：旧实现是**拿全库最新 20 篇**去分析，课题一多，不同课题的论文互相稀释；而且按年份取，会把某个课题相关但年份较老的论文直接挤掉。论文/笔记现在可手动挂到课题上（`TopicLinker` 组件，多选、勾选即存）
- **`src/lib/methodology/topic-scope.ts` —— 两级课题域筛选（纯函数）。** 一级按用户手挂的 `topicIds`，二级用关键词兜底（课题名/方向/描述切词，英文词 + 中文 2-4 字滑窗 + 停用词过滤）。**任何一条命中都算命中**，手挂的排前面。只用一级不行（没打标时分析无料），只用二级也不行（中英不对应必然漏），所以两者都要
- **`/api/ai-gap-analysis` 重写为按课题域分析。** 请求体新增 `topicId`；显式选了不存在的课题 → 400，**不静默降级成全库分析**（那会让用户以为看的是这个课题的结论，其实混着全库）；按**相关度**而非年份取料，年份不再是「谁进得来」的决定因素；回传 `used:{papers,notes,relatedPapers,unlinkedPapers}` 让界面显示「基于 N 篇 / M 条」
- **无材料时如实拒绝（`NO_CONTEXT`）。** 旧实现无论有没有料都会调模型，模型只能凭记忆编 research gap —— 这正是「没有原料的幻觉」。现在返回 400 + `NO_CONTEXT`，且测试断言 `chatComplete` **不得被调用**
- **`/api/topics?withCounts=1`。** 每个课题附论文数与笔记数，选题卡片直接显示「N 篇 · M 条」；为 0 时给橙色警示 —— 免得用户点到 AI 分析才发现这个课题根本没料
- **结果按课题分桶缓存。** 切换课题后旧结果**不能**显示成新课题的结论 —— 那比「没结果」更坏。前端用 `${topicId}:${type}` 作缓存键

### 修复

- **`clampScore` 把空字符串静默变成 0 分。** `Number('')` 是 `0` 而不是 `NaN`，所以模型把某一项写成 `""` 时会被当成「这项 0 分」。0 分在矩阵里的含义是「教科书内容 / 无任何参考实现」，是极强的负面判断，不该由一次空值事故产生。现在显式判为非法、走回退值并记进 `missing`
- **`extractJsonObject` 会把数组伪装成对象。** 「取第一个 `{` 到最后一个 `}`」这一层退让，遇上 `[{"a":1}]` 会切出 `{"a":1}` 并解析成功，于是调用方拿到一个「看起来合法但实为数组元素」的对象。现在先确认第一个 `{` 之前没有 `[` 再切
- **下载进度在日志里一行都没有。** `download-progress` 以前只走 IPC 给界面，`update.log` 里只有「开始下载」和「下载完成」两行。实测首次下载花了 **3 分 20 秒**（05:44:49 → 05:48:09），事后翻日志完全无法判断「是一直在慢慢下」还是「中途卡了很久又恢复」。现在按 **10% 一档**落盘（`downloadLoggedBucket`，避免每帧刷爆日志文件）

### 验证

- `tsc --noEmit` 0 错误 · `eslint src tests --max-warnings=0` 0 问题 · `vitest` **31 文件 / 519 用例全过**（1.3.5 是 27 / 402）
- 新增 `tests/lib/topic-ai.test.ts`（打分容错）、`tests/lib/topic-scope.test.ts`（课题域筛选）、`tests/lib/topic-routes-contract.test.ts`（**真实调用 handler** 的接口契约）三个文件
- 新增 `tests/lib/update-progress.test.ts`（16 用例）锁住格式化逻辑，重点覆盖「数据缺失时不许编数字」与「极慢连接不能显示成 0 KB/s」
- 新增 `tests/desktop/updater-contract.test.ts` 中 3 条契约：安装前**必须**先弹确认框、文案**必须**承认没有进度条、用户选「稍后」时**不得**调用 `quitAndInstall`
- ⚠️ **测试里不要硬编细项个数。** 本轮踩到：全篇按「14 项」写死，而矩阵实际是 **13** 项（创新性 3 + 可行性 4 + 发表价值 3 + 可持续性 3），文案与断言全错。现在统一从 `ALL_SUB_ITEMS.length` 推导 —— 该钉住的性质是「与 methodology 的定义一致」，不是某个具体数字

### 说明：为什么不做「带进度条的安装」

第一版想法是给 NSIS 换成非静默安装，让用户看到安装向导的进度条。**这条路走不通**：本项目用 assisted 安装器（`nsis.oneClick=false`），electron-builder 模板里「装完自动拉起应用」的条件是 `${isForceRun} AND ${Silent}` —— 只有静默安装才会把应用拉回来。去掉 `/S` 换来的是一条进度条，代价是「装完应用不回来、用户还得自己开」，比现在更糟。所以选择保守方案：**不改安装行为，只把预期讲清楚**。


## [1.3.5] - 2026-09-18

**这一版回答的是「AI 的回答直接把所有东西复制回来」。** 排查后发现，真正的问题不是模型不听话，而是**它手里根本没有原料**：论文的摘要以前是被人**当成笔记**塞进 `notes` 的，AI 摘要因此只能对着标题和作者编。所以这版先把原料补上，再把它接到真检索源上。

### 新增

- **`Paper.abstract` 独立列，与 `notes` 语义分离。** 此前摘要和「你自己的阅读笔记」共用 `notes` 一列，两者语义完全不同（导出、展示、覆盖策略都不一样），混写的结果是**下一次同步会把其中一方冲掉**。三处历史混写行为一并修掉：Zotero 导入（`notes: d.abstractNote`）、RIS（`AB` 摘要 / `N1` 笔记）、BibTeX（`abstract` / `note`）现在各归各位；`MergeStats` 增加 `abstracts` 计数，合并时仍然「已有内容优先保留」
- **`src/lib/library/retrieval.ts` —— 真实的文献检索源（Crossref）。** `retrieveRelatedPapers()` 真打 `api.crossref.org/works`，让「相关论文」有可核实的事实来源，而不是让模型凭记忆背标题。几处刻意的取舍：**没有 DOI 的结果直接丢弃**（DOI 是唯一能核实「这篇真存在」的锚点）；`limit` 夹在 1..20；12 秒超时；`select` 白名单字段；**任何环节出错都收敛成空数组、绝不抛**
- **`/api/ai-related-papers` 改为「只许抄、不许编」。** 检索成功时把结果格式化成一份清单喂给模型，提示词明确要求**只能从这份清单里挑**，且标题/作者/年份/期刊/DOI **必须逐字照抄**。响应新增 `source` 字段（`crossref` / `model-knowledge`），前端据此显示不同提示 —— 有真东西时给真东西，没有时不装
- **摘要原料状态提示。** AI 摘要面板会明确告诉你这次是**基于摘要正文**还是**只有元数据**（`basedOn`），元数据模式下的约束文案也换成「只许转述已知字段」的版本

### 修复

- **接口挂掉时通知铃铛谎报「一切就绪」。** `useFetch` 返回的 `error` 从来没有被读取，于是 `/api/notifications` 返回 500 时，界面显示的是绿勾 +「暂无通知 · 一切就绪！」—— **把「接口坏了」伪装成「确实没有待办」**，用户会以为自己没有逾期提醒。现在改为显式的失败态：琥珀色警示 + 失败原因 + 重试按钮
- **数据库模板与 schema 漂移。** `resources/db-template/custom.db` 是按**文件**分发的，它落后于 `prisma/schema.prisma` 时（缺 `Paper.abstract`），Prisma Client 一读就抛 `P2022: column main.Paper.abstract does not exist`，整个 `/api/notifications` 500。新增 `.recon/sync-template.mjs` 做双向核对（逐表比对 schema 与模板的列集合），失配时备份并补列

### 验证

- `tsc --noEmit` 0 错误 · `eslint .` 0 问题 · `vitest` **27 文件 / 402 用例全过**
- `verify-planner/run.mjs` 端到端 **158 通过 / 0 失败**（上一轮是 150 / 6）
- 端到端脚本此前会在复制模板后**直接起服务**，跳过了桌面端启动时的 `migrateDatabase`，导致它验证的不是用户真实的启动条件。现已改成先跑真实迁移，并把「接口整体挂掉」也做成断言（不再只看单个通知在不在）

### 关于「上游报错」的诚实说明

本轮全量验证时，`verify-planner` 有 6 条失败。表面看是「通知反向联动坏了」，追下去发现是**验证脚本自己的盲区**：它复制的模板缺列，而桌面端启动时会补列、长期跑 dev 的本机库也早就补过列，只有这个临时库没有。**产品代码没有改**（只额外加了「接口 500 就不能安静过去」的断言）。记在这里是因为：**是脚本的验证条件不真实，不是被测的代码有 bug** —— 这类失败最容易被误读成产品缺陷。

## [1.3.4] - 2026-09-18

**这一版修的是「装了 1.3.3 之后应用根本打不开」。** 这不是个别环境问题 —— 1.3.3 的安装包对**所有**用户都是坏的，而且它骗过了当时所有的检查。

### 修复

- **打包产物里带着指向构建机路径的符号链接**（真因）。Next 的 `outputFileTracing` 会在 `.next/standalone/.next/node_modules/` 下，为被外部化的依赖创建**指向构建机项目根 `node_modules` 的绝对符号链接**。1.3.3 的包里实测是这两条：
  ```
  .next/node_modules/pdfkit-<hash>          -> //?/D:/a/glm-test/glm-test/node_modules/pdfkit
  .next/node_modules/@prisma/client-<hash>  -> //?/D:/a/glm-test/glm-test/node_modules/@prisma/client
  ```
  （`D:/a/<org>/<repo>` 是 GitHub Actions windows runner 的固定工作目录 —— 所以这个缺陷只在 CI 打包时产生，本地开发机上看不出来。）而 **bsdtar 会把符号链接原样存进 zip**。用户机器上 `D:/a/glm-test/...` 并不存在，解压时建不出链接，于是**退化成 0 字节的空文件**：
  ```
  require('@prisma/client-<hash>') 拿到空模块
    → TypeError: r.PrismaClient is not a constructor
    → GET /api/settings/llm 返回裸 500（这条路由没有 try/catch）
    → 壳层探针 waitForServer() 只认 statusCode < 500，永远等不到成功
    → 90 秒后弹出「内部服务启动超时」，应用退出
  ```
  这也解释了 1.3.3 首次启动时那个看起来完全不同的报错 —— `tar.exe: .next/node_modules/pdfkit-<hash>: Can't create ...: Invalid argument`。**两条报错同一个根因**：`Invalid argument` 正是「建不出这个链接」的报错。1.3.3 加的退避重试只是让解压那一步侥幸过去了，应用随即换下一个症状继续死。
- **`prepare-standalone.js`：打包前把符号链接落成真实副本。** 新增 `dereferenceSymlinks()`，在 `pruneStandalone()` 之后遍历 standalone，把所有符号链接替换成从真实目标复制来的普通目录；**断链不能一删了之**（删掉就变成 `Cannot find module`），单独收集后由新增的 `assertNoBrokenLinks()` 以 `exit 1` 拒绝出包
- **`prepare-standalone.js`：对最终 zip 加硬断言。** `packStandalone()` 打包完成后用新增的 `listZip()` + `findSymlinkEntries()` 再验一遍**最终产物**里符号链接条目必须为 0，否则打印命中的条目并拒绝出包。宁可打包失败，也不再发一个所有用户都装不起来的包

### 为什么之前的检查都没发现

**这个故障能骗过字节级比对。** 把 `app.zip` 解到干净目录再逐文件比 SHA-256 会得到「完全一致」—— 因为两边同样是 **0 字节的空文件**，哈希当然相同。同理，`resources/app/` 里的文件也「都在」。唯一能暴露它的办法是**真的把内部服务跑起来，探一次 `/api/settings/llm` 要求 200**。

### 如果你已经装了 1.3.3（不用重装即可恢复）

把 `<安装目录>\resources\app\.next\node_modules\` 下那两个 0 字节文件删掉，从**同一棵目录树**里的 `node_modules\pdfkit` 与 `node_modules\@prisma\client` 整目录复制过去（后者 41 个文件 / 14.55 MB，**必须包含 `runtime\query_engine-windows.dll.node`**）。注意别触发重新解压，否则会被坏 zip 覆盖回 0 字节。

### 验证

- 新增 `tests/desktop/prepare-standalone.test.ts`（8 例）：用 1.3.3 真实 `tar -tvf` 输出的那两行做**回归指纹**；junction 夹具下验证链接落成真实副本、且**真实 `node_modules` 不被连坐破坏**（`fs.rmSync(链接, {recursive:true})` 是否跟随链接已实测排除）；断链被拦下且保留原样；对真实 `resources/app.zip` 端到端跑通 `listZip`
- 全量单测 22 个文件全通过，`tsc --noEmit` 零错误
- 本机起真服务验收：剥掉宿主注入的 `ELECTRON_RUN_AS_NODE` 后启动客户端，5 个进程、窗口标题 `AI Network Lab 1.3.3`、内部服务就绪，`/`、`/api/settings/llm`、`/api/papers`、`/api/notes`、`/api/topics`、`/api/experiments` 全部 200

## [1.3.3] - 2026-09-17

**这一版修「点了更新就闪退、版本还是旧的」。** 下载从来就没问题（1.3.2 的安装包完整躺在更新缓存里，字节数与 Release 资产一致）；问题全在**安装那一步**：应用退出了，安装器却没装成。

### 修复

- **`quitAndInstall()` 少了两个参数，导致安装器装完不会把应用拉回来。** electron-builder 的 NSIS 模板里（`templates/nsis/installSection.nsh` 末尾），`oneClick: false`（本项目如此）的安装器执行「装完自动启动应用」的条件是 `${if} ${isForceRun} ${andIf} ${Silent}` —— **只有静默安装才拉得起来**。原先调的是无参 `quitAndInstall()`（等价 `isSilent=false`），用户看到的正是「点一下更新 → 应用消失 → 手动打开还是旧版本」。现改为 `quitAndInstall(true, true)`，等价命令行 `--updated /S --force-run`
- **「点完更新，界面显示异常」的真因：在确认安装会启动之前就把内部服务杀了。** `applyUpdateAndRestart()` 原先先 `serverProc.kill()` 并置 `app.isQuitting`，再调 `quitAndInstall`。但 `quitAndInstall` 是「立即返回、随后才去拉起安装器」，而 `install()` 可能失败（更新缓存被清、安装器被安全软件拦下、spawn 报 EACCES 等）—— 失败时应用并不会退出，而此时内部 Next 服务已经被杀掉，界面上所有接口一起失败，看起来就是整个界面坏掉。现在把服务交给正常退出流程（`before-quit`）去收：`app.quit()` 紧随 `install()` 之后，释放 `resources/app` 句柄的时机依然早于安装器动手
- **新增「安装没启动」守护**：`quitAndInstall` 只在 `install()` 成功时才会真的退出应用。现在 5 秒后复查，应用还活着就明确回传 `install-not-started` 并弹框说明原因与下一步，而不是让用户对着一个「点了没反应的窗口」猜
- **更新链路第一次有了落盘日志**：新增 `%APPDATA%\ai-network-lab\logs\update.log`（electron-updater 的内部日志也接进同一文件），记录版本、检查结果、**安装包真实落盘路径**、`quitAndInstall` 收到的参数。打包后的应用没有控制台，本次排查时应用侧一行痕迹都没有，只能靠安装目录里一个 178 字节的 `debug.log` 和更新缓存残留倒推
- **下载 / 安装阶段的失败现在会回传到界面**（此前 `error` 事件只写日志）。后台静默检查失败仍然不打扰用户 —— 开机就弹错误框是不可接受的 —— 但用户主动点过按钮之后的失败必须让他看见
- **状态行不再自相矛盾**：手动检查的结论此前会永久压住之后推来的状态，于是「已下载完成、按钮已是『立即重启并安装』」的卡片里还写着「点『下载更新』」。现在一旦进入下载 / 已下载 / 出错 / 版本冲突，就清掉那份过期的检查结论
- **更新卡片底部加了手动兜底入口**：直达发布页。桌面端安装器要先清理旧版本目录，只要还有程序占着安装目录，这一步就会卡住 —— 这种情况应用内更新无解，必须留一条能走通的路

### 排查记录：这次到底卡在哪

本机装的是 **v1.2.4**（一个从未发布过的本地构建）。四条现场证据：

1. `%LOCALAPPDATA%\ai-network-lab-updater\pending\` 里躺着 `AI-Network-Lab-Setup-1.3.2.exe`，**125,009,264 字节，与 Release 上的资产逐字节一致**，`update-info.json` 里的 `sha512` 也在 ⇒ **下载是成功的**，问题不在下载
2. 安装目录里出现一个 `debug.log`，只有两行 `FATAL:gin\v8_initializer.cc:675] Error loading V8 startup snapshot file` ⇒ 有一个 Electron 进程从安装目录启动后**直接 FATAL 退出**（这就是「闪退」本体）：那一刻目录处于不一致状态，`snapshot_blob.bin` 不在原位
3. **安装器进程始终没有退出**（`AI-Network-Lab-Setup-1.3.2.exe`，窗口标题「AI Network Lab 安装」，CPU 只消耗了 1.6 秒，无子进程），`%TEMP%\nsXXXX.tmp` 里留着 `old-uninstaller.exe` ⇒ 卡在 NSIS **「先跑旧卸载器清空旧目录」**这一步
4. 机制在模板里写得很明白（`templates/nsis/uninstaller.nsh`）：更新时旧卸载器要把 `$INSTDIR` 整个**改名**到 `$PLUGINSDIR\old-install`（`un.atomicRMDir`），失败则 `restoreFiles` 再 `Abort`。而 **Windows 不允许改名一个「内部还有文件被别的进程打开」的目录** —— 只要有任何程序占着安装目录（把它当工作目录的编辑器 / 知识库工具、同步盘、索引服务、杀软），这一步就会被挡下，留下一个半还原的目录，应用下次启动便 FATAL 在 V8 快照上

⇒ 结论是**代码缺陷（上面前三条）+ 环境约束（安装目录被占用）**。后者无法在应用侧修复，只能在 UI 与配置注释里给出可执行指引：不要把安装目录当工作目录用；安装器卡住时可以直接结束那个 `AI-Network-Lab-Setup-*.exe` 进程 —— 它握着安装互斥量，不结束的话之后每次安装都会立刻被中止（本次排查就是这么处理的）

### 验证

- 新增 `tests/desktop/updater-contract.test.ts`（8 例）：用 `vm` 把 `desktop/main.js` 载入受控上下文后直接断言 IPC handler —— `quitAndInstall` 必须收到 `(true, true)`、安装前不得杀内部服务、开发模式不得安装、失败要回传 `install-not-started`、日志要落盘、`electron-builder.yml` 的 `publish` 段必须保留。这些约束**不会**让类型检查或任何既有用例变红，只能靠契约断言守住
- 全量单测 277/277 通过（原 269 + 新增 8），`tsc --noEmit` 无错
- 本机核实：终止卡死的安装器后，安装目录 1.2.4 各文件（`AI Network Lab.exe` / `snapshot_blob.bin` / `v8_context_snapshot.bin` / `resources\app\server.js`）完好，应用仍可用；1.3.2 安装包仍留在 `pending/` 缓存中，重试无需重新下载

## [1.3.2] - 2026-09-17

**这一版只有一个目的：让安装包真的出现在 Release 里。** v1.3.0 与 v1.3.1 连续两次「job 全绿但 Release 里只有 `.exe.blockmap`」，用户根本下载不到安装包。本版把发布链路的上传环节整个换掉，并加上能拦住这类问题的硬自检。

### 修复

- **弃用 `electron-builder --publish always`，上传改由 `gh` CLI 显式完成**。根因是 electron-publish 的上传路径存在**多处静默放弃**，而它们都不影响退出码（源码 `electron-publish/out/githubPublisher.js`、`app-builder-lib/out/publish/PublishManager.js`）：
  - `getOrCreateRelease()` 在「已存在的 Release `published_at` 超过 2 小时」（除非设 `EP_GH_IGNORE_TIME=1`）、「Release 类型与 `releaseType` 不匹配」等情况下返回 `null`；随后 `doUpload()` 只打一条 `log.warn("skipped publishing")` 就 **return**，不算失败
  - 构建报错时 `app-builder-lib/out/index.js` 会 `publishManager.cancelTasks()` 并把结果换成 `Promise.resolve(null)`，上传任务被丢弃且**不报错**
  - `PublishManager.awaitTasks()` 在 cancellation token 被取消时**直接 return**，连 `latest.yml` 都不会写出来
  现在的分工是：`npx electron-builder --win --publish never` 只负责构建（`publish` 段保留在配置里，`latest.yml` / `app-update.yml` 照常生成），上传交给 `gh release upload --clobber`（失败必然非 0 退出，且同 tag 重跑幂等）
- **上传前新增「本地产物自检」**：断言 `release/*.exe` 与 `release/latest.yml` 都存在，缺失即失败。这一步专门拦「没有更新清单的发布」——`latest.yml` 是 electron-updater 判断有无新版本的唯一依据
- **发布后自检升级为「按字节数核对」**：原先只查 Release 里有没有 `*.exe` 与 `latest.yml`（能发现 v1.3.0 那种全缺），现在还会解析本地 `latest.yml` 里声明的 `path` / `size`，与实际资产的**名字和字节数**逐一比对 —— 这样连「传了一半」的截断上传也拦得住
- **备份工件改为 `if-no-files-found: error`**：此前是 `warn`，产物缺失时只打一条警告就滑过去了
- **新增 `release-cleanup.yml`（手动触发）**：用于删掉「发了但没发成」的残缺 Release（只删 Release、保留 tag）。Releases 页面上残缺版本和平常版本长得一样，点进去却没有包可下，删掉比留着解释便宜

### 关于 v1.3.0 与 v1.3.1 两次发布（如实记录）

两次的 Release 都**只有**一个 `.exe.blockmap`。已确认：v1.3.1 的资产上传发生在该次 run 的时间窗内（run 约 03:22Z 起，blockmap 资产时间 `03:25:42Z`），排除了「Release 已存在超 2 小时」这一条；单次运行里只传上 blockmap 的确切触发点**未能 100% 复现**（读 job 日志需要仓库管理员权限，本机只能读到 run 的注解）。因此本次采取的修法是**不再依赖那条路径 + 加上可信自检**，而不是继续猜 electron-publish 的内部状态。

### 验证

- `release.yml` 的发布段改为「构建 → 本地产物自检 → `gh release upload` → 远程资产核对（名字 + 字节数）」，并保留 `concurrency` 锁
- 通过 `gh` 与 Release 资产页确定性核对：v1.3.0 / v1.3.1 的 Release 资产均为 1 个（`.exe.blockmap`），`*.exe` 与 `latest.yml` 的下载地址均返回 404
- 实际验收标准：本版 Release 里同时存在 `AI-Network-Lab-Setup-1.3.2.exe`、`latest.yml`、`*.blockmap`，且 exe 字节数与 `latest.yml` 中 `size` 一致

## [1.3.1] - 2026-09-17

修补 v1.3.0 发布之后才暴露出来的问题。**v1.3.0 的 Release 实际是残缺的（既没有安装包、也没有 `latest.yml`），请直接装这一版。**

### 修复

- **安装包文件名去掉空格**。`nsis.artifactName` 原为 `${productName}-Setup-${version}.${ext}`，而 `productName` 是 "AI Network Lab"，所以磁盘上生成的文件名带空格；但传到 GitHub Release 后资产名里的空格被规范化成了连字符（v1.3.0 的 Release 里看到的正是 `AI-Network-Lab-Setup-1.3.0.exe.blockmap`）。**而 electron-updater 是照着 `latest.yml` 里记录的 `path` 去拼下载地址的** —— `latest.yml` 由 electron-builder 生成、记的是带空格的原名，与 GitHub 上的实际资产名对不上，更新会卡在「下载」这一步，且报错很难指向真正原因。现改为 `AI-Network-Lab-Setup-${version}.${ext}`，让**磁盘文件名 / GitHub 资产名 / `latest.yml` 里的 path 三者字面一致**
- **发布流程新增「发布后资产自检」**：`release.yml` 在 publish 之后会核对 Release 里是否**同时**存在 `*.exe` 与 `latest.yml`（带 6 次重试，容忍资产短暂延迟），缺任何一个就让 job **失败**。自检刻意放在上传备份工件**之前** —— 这样自检失败时完整的 `release/` 仍会作为 `windows-installer` 工件留下，可以手动补挂，不必重新构建
- **发布加并发锁**：`concurrency: release-<ref>`，避免同一 tag 的两次发布会互相覆盖 Release 资产
- **CI 三个 job 全挂在一个 PDF 导出单测**：`buildSimplePdf` 找不到中文字体时会**显式抛错**（这是刻意的，绝不静默产出一份只有拉丁字形的「中国字」PDF），而 ubuntu runner 默认不带 CJK 字体 —— 本地是 Windows、有 `msyh.ttf`，所以一直没暴露。`ci.yml` 的 `verify` 与 `e2e` 两个 job 各加一步安装 `fonts-noto-cjk`（该包正好提供代码里写死要找的 `/usr/share/fonts/opentype/noto/` 路径）
- **`db-version.test.ts` 在 Node 20 崩**：`node:sqlite` 是 Node 22.5 才有的内置模块，Node 20 上 `process.getBuiltinModule('node:sqlite')` 返回 undefined，于是报 `Cannot read properties of undefined (reading 'DatabaseSync')`。同目录的 `migration.test.ts` 早就有 `describe.skipIf(!sqlite)`，这个文件漏了同一句，补上

### 关于 v1.3.0 那次发布（如实记录）

v1.3.0 的发布 job **所有步骤全是绿灯**（`Release #3`，2m59s），但 GitHub Release 里最终只有一个 `.exe.blockmap` —— 既没有安装包、也没有 `latest.yml`。用户点下载什么也拿不到，客户端也检测不到更新。同一个 run 的 `windows-installer` 工件有 **119 MB**，说明安装包确实构建出来了、只是没能进 Release。批量提交此前从未被 push 过（1.2.3 / 1.2.4 都没发过），所以 CI 与发布链路的问题是一次性集中暴露的。

### 验证

- 两个 workflow 的 YAML 均通过 `js-yaml` 解析；`db-version.test.ts` 在本机（有 `node:sqlite`）照常跑满 5 例、未被 `skipIf` 跳过
- ⚠️ 本机跑单测时磁盘 I/O 被占满（整套从 1.56 s 变成 41.4 s，`rng.test.ts` 从 0.5 s 变成 20.4 s），导致两条走 `VACUUM INTO` 备份的迁移用例 `Test timed out in 30000ms` —— 属**环境问题、非代码回归**（同一份代码几分钟前还是 269/269 全绿）。完整验证以 CI 为准

## [1.3.0] - 2026-09-17

研究规划模块补完（数据层 / 联动 / 偏差复盘 / AI 助手 / 日历集成）。**建议升级** —— 这一版把全项目唯一「只有界面、没有数据」的模块补成了真正能用的模块，标签页从 5 个增到 8 个。

「研究规划」此前是全项目唯一没接完数据层的模块：5 个标签页只有 2 个能写，UI 做完了但「数据化」没做完 —— 它是从一个「方法论脚本集」（一堆 .py 静态出图）直译过来的。本次把五个方向全部补齐。

### 新增 —— D1：补齐数据层

- **`WeeklyTask` 模型（第 13 个）+ `/api/weekly-tasks`、`/api/weekly-tasks/[id]`**。原先周计划是组件里的 `useState(WEEKLY_PLAN_TEMPLATE…)`，`add/remove/toggle` 全在内存 —— **刷新即丢**，是全项目唯一「纯内存」的功能。现在真落库：
  - `GET ?week=YYYY-MM-DD`：传周中任意一天都会归一到该周周一；参数非法则退回本周，不返回空列表
  - `POST`：`order` 缺省时自动追加到该周末尾（不再依赖前端算序号）
  - `PUT`：白名单局部更新，可勾选完成、改工时/优先级、**跨周移动**
  - 越界数值一律截断（hours 99→24、priority 9→5）而不是 500 —— 用户填 12 小时不该被脏数据判定挡住
- **项目配置 `project.config`（`Setting` KV）+ `/api/settings/project`**。这是 D1 的关键：Gantt 里程碑的 `startDate/endDate` 存的是**周序号字符串**（"0".."39"，同样是从脚本集直译来的表示法），没有项目起始日时「第 12 周」是悬空概念 —— 既答不出是哪个月，也判断不了「现在落后没有」。现在：
  - Gantt 轴显示**真实日期区间**（`01-05 ~ 02-01`），并画出**当前周游标**
  - 「本周可用工时」由配置算出（默认 44h/周），不再是写死的 `available = 44`
  - 未设置起始日时退回只显示周序号，不假装知道日期
- **修复 Gantt 行序错乱**：原先 `orderBy: { startDate: 'asc' }` 对 "0".."39" 是**字符串排序**，"10" 会排在 "2" 前面。改为按**数值**周序号排序（`sortByWeekIndex`），40 行甘特图的顺序才正确
- **首访 seed 补上周计划**：新用户第一次进「研究规划」不再是空表（原先只 seed 了里程碑）
- 组件新增 `ProgressStepper`（±5% 步进，到边界自动禁用）作为统一的**进度写入口**：Gantt、写作时间线、投稿时间表都能直接改进度 —— 原先写作时间线**没有任何写入口**，且用 `title === name` 字符串匹配取进度 + seed 里 7 条 `type='writing'` 里程碑 `progress: 0`，导致「总工时完成度」**永远是 0%**

### 新增 —— D2：枢纽化联动（里程碑 ⇄ 实验/稿件）

- `Milestone` 新增 `refType` / `refId` / `autoProgress`：里程碑可以指向一个**实验**或**稿件**
- `POST /api/planner/sync`：按关联实体的状态派生里程碑进度
  - 实验 `planned→0 / running→60 / completed→100 / failed→0`（**失败不推进** —— 失败要人来看，不能替用户宣布完成）
  - 稿件：已投稿 → 100；草稿按字数比例，**封顶 95%**（不投出去就永远不显示「完成」，避免「初稿写完 = 完成」的假象）
- **两条硬规则，避免自动同步变成数据事故**：
  1. **默认关闭**（`autoProgress` 默认 false）。没打开时同步只返回「建议推进到 X%」的提示，**绝不写入** —— 用户手工填的进度不会被一个关联悄悄改掉
  2. **只推进、不回退**。实验被改回 `running` 也不会把里程碑从 100 拉下来
- 为什么做成显式 POST 而不是在 GET 里顺手算完写回去：隐藏写入会让「甘特图自己变了」变得无法解释。现在每一次推进都是用户可见的动作，且返回「改了哪几条、从多少到多少」
- 进度到 100% 时**自动补记实际完成日**（D3 的偏差报告依赖它）
- **通知反向联动**：`/api/notifications` 新增「计划落后提醒」—— 拿项目起始日把周序号换算成真实日期，逾期的里程碑给 `high` 优先级提醒、14 天内的给 `low`。**拿不到起始日就整段跳过**：宁可少一条提醒，也不要按错误的日期催人；逾期超过 90 天的历史残留不再天天催
- Gantt 列表接口批量解析关联实体并附带 `refLabel`（显示「⇄ 实验：xxx」）与 `derivedProgress`（可推进到的值），一次 `in` 查询而不是 N 次

### 新增 —— D3：计划 vs 实际偏差复盘

- `Milestone` 新增 `actualEndDate`（实际完成日）
- `GET /api/planner/deviations`：
  - 默认 JSON（页面用）；`?format=md` 导出 Markdown 报告（可直接贴进组会材料或交给导师）；`?state=behind` 只看落后项
  - 五种状态：提前完成 / 按时完成 / 落后 / 进行中 / 无法判定
  - **已完成但没有实际完成日 → 「无法判定」**，不假称按时
  - 汇总含各状态计数、平均偏差天数、**「最需要处理的」前 3 条**，排序为「落后优先」
  - 与 `/api/notes/export`、`/api/writing/*/export` 一致：**不支持的格式显式 400**（不静默回退）；中文文件名走 RFC 5987 `filename*`
  - 页面与导出**共用同一个计算函数**，保证「看到的」和「导出的」不会各算各的
- 研究规划新增第 6 个标签页「计划 vs 实际」

### 新增 —— D4：AI 规划助手

- **`POST /api/planner/assist` + `src/lib/planner/ai.ts`**（纯逻辑，便于单测）。三种模式：`weekly` 生成本周计划 / `risk` 进度风险体检 / `breakdown` 里程碑拆解。复用既有的 `src/lib/llm` 网关，因此任何 OpenAI 兼容接口（GLM / DeepSeek / OpenAI / Ollama）都能用，Key 仍是用户自己的
- **把「本周可用工时」作为硬约束写进提示词**：不写这条，模型会热情地排出一个 60 小时的一周（提示词里明说「这是硬约束」）。上下文还带上按项目起始日换算后的真实日期，以及每个里程碑的偏差判定（复用 D3 的计算结果）—— 而不是把 Prisma 行原样丢给模型：里程碑行上有 color / category / createdAt 这类纯 UI 字段，既费 token 又容易把模型带偏
- **`extractJsonBlock` 容错解析**：模型经常不听话 —— 套一层 ```json 围栏、前面加一句「好的，这是任务：」。这里逐级降级：先去围栏直接 `JSON.parse`，失败再找配对的 `[...]` / `{...}`。两个容易写错的细节：**括号匹配必须跳过字符串字面量**（否则 `{"name":"[实验 A]"}` 会被截在方括号上）；**必须按出现位置优先试最外层的括号**（`{"tasks":[...]}` 里内层数组虽然更「像数组」，但先试 `[` 会把外层包装丢掉，解析成裸数组 —— 结果碰巧还能用，但语义已经错了）
- **`parseWeeklyPlan` 把模型输出当脏数据处理**：每条都过一遍 `normalizeTaskInput` —— `hours: 999` 截成 24、`priority: 99` 截成 5，缺 `name` 的条目直接丢弃，总数封顶 30 条。**不把越界值写进库**
- **接口刻意无副作用**：只生成、不写库。写入由前端拿返回的 `tasks` 逐条调 `/api/weekly-tasks` 完成 —— 「写进去的就是屏幕上看到的那几条」。如果在接口里顺手写库，用户点第二次「生成」会得到一份**不同**的计划，而库里已经躺了上一份，两边对不上且没人能解释那些任务从哪来。副作用只留在用户明确点击的那个动作上
- **解析失败返回 200 + `parseError` + 原文，而不是 500**：报错会把最有用的信息（模型到底说了什么）丢掉。前端把原文摊开给用户看，可据此手工添加，而不是只看到一句「失败」
- **错误码可判定**：没配 Key 时返回 `400 { code: 'LLM_NOT_CONFIGURED' }`（不是 401 —— 这根本不是鉴权失败，而是功能前置条件没满足），前端据此给出「去设置里填 API Key」的按钮，而不是甩用户一句 400；上游调用失败返回 `502 { code: 'LLM_CALL_FAILED' }`
- **第 7 个标签页「AI 助手」**：选模式 → 填补充要求 → 生成 → 核对 → 「写入本周计划（N）」。逐条写入，中途失败会如实说「已成功 k / N 条」，不假装全成功

### 新增 —— D5：日历集成

- **`GET /api/planner/calendar` + `src/lib/planner/calendar.ts`**：默认返回事件 JSON（月历视图用）；`?format=ics` 导出 `.ics`，可直接导入 Google 日历 / Apple 日历 / Outlook
- **为什么用 ICS 而不是接某个日历 API**：ICS 是 RFC 5545 定义的纯文本，**不需要账号、OAuth、任何网络请求**；而且导出结果是一个字符串 —— 意味着能被单测逐字符锁住。代价是细节极多，所以每个细节单独成函数：
  - **换行一律 CRLF**（RFC 5545 §3.1，只写 `\n` 会被部分客户端判为非法）
  - **按 75 octets 折行，且必须按字节而不是按字符** —— 中文一个字 3 字节，按字符折会在中文标题上直接违反 RFC；续行的前导空格还要**占掉 1 个 octet 额度**
  - **`DTEND` 是排他的**：全天事件区间要写成「结束日 + 1 天」，否则最后一天会丢
  - **TEXT 转义顺序**：必须先转义反斜杠，否则后面为 `;` / `,` 补上的反斜杠会被再转一遍
  - **`UID` 由稳定 id 派生**（不是随机数）：重复导入是**更新**而不是堆一堆重复项
  - **提醒用 `TRIGGER;RELATED=END:-P1D`**（结束前 1 天）而不是默认的「开始前 1 天」—— 对里程碑来说，「截止前一天」才是有用的提醒
  - 全天事件标 `TRANSP:TRANSPARENT`，避免把一整周显示成「忙碌」
- **取不到日期的事件直接跳过，不猜**：未设置项目起始日时，甘特里程碑（存的是周序号）换算不出日期 —— 宁可日历里少一条，也不把「第 12 周」塞成一个错误的日期
- **第 8 个标签页「日历」**：6×7 月历网格，**以周一为一周之始**，与 `startOfWeekIso` 的周计划口径保持一致（两处周界不一致会让「本周任务」和日历上这一行对不上）；点某天在下方看当天事件详情；一键导出 `.ics`。网格在客户端本地算，切月不再打接口
- 页面与导出**共用同一个 `buildCalendarEvents`**，保证「看到的」和「导出的」同源

### 修复

- **`PUT /api/milestones/[id]` 改为白名单更新**。旧实现直接把请求体透传给 Prisma（`db.update({ data: body })`），前端多传一个 UI 用的字段就抛错 → 500。现在非法字段被忽略，`progress` 夹在 0–100（非法值 400），不存在的 id 返回 404（原先会冒成 500）
- **不允许写入「半截关联」**。`refType` 与 `refId` 必须成对：只给类型没给实体、或只给实体没给类型的，**整对置空**。否则 `/api/planner/sync` 会扫到一批永远解析不出实体的行，白白多查一次。`refType` 置空时会连带清掉 `refId`/`autoProgress`
- 新增 `refType`/`refId` 联合索引 `Milestone_refType_refId_idx`
- 给 `Milestone.startDate` 的**一字段两语义**（甘特图存周序号 / 投稿与写作存 ISO 日期）补上注释，并让读取端统一走 `plannedStartIso`/`plannedEndIso` 处理，不再靠 `type` 硬编码区分

### 迁移与打包

- `desktop/migrate-database.js`：新增 Milestone 的四列、`WeeklyTask` 表与其两个索引、`Milestone_refType_refId_idx`；**表不存在时跳过建索引**（避免在老库上 `no such table` 直接让启动失败）。DDL 由 `prisma migrate diff --from-empty --to-schema-datamodel` 生成后原样搬入，保证与 Prisma Client 预期一致。老库升级仍走 `VACUUM INTO` 备份 + 事务，**无损**
- **重新生成打包模板 `resources/db-template/custom.db`**（184 320 → 208 896 B，14 张表）：全新安装的用户**不跑迁移就能用**周计划与偏差复盘。已核对该模板跑 `migrateDatabase` 的结果为 `changed: false`
- 本机开发环境**没有重新构建前端、也没有打包**（`next build` 的类型检查阶段在本机会无限挂起，见 `KNOWN_ISSUES.md`）—— 前端构建与 NSIS 打包交给打 tag 后的发布 CI（`npm run desktop:build` + `electron-builder`），本地不重复跑一遍已知会挂的流程

### 验证

- `tsc --noEmit` 0 错、`eslint .` 0 错
- 单测 **269/269**（19 文件；新增 `planner-schedule.test.ts` 21 例、`planner-linkage.test.ts` 30 例、`planner-ai.test.ts` 27 例、`planner-calendar.test.ts` 38 例，并重写 `migration.test.ts`、修正 `db-version.test.ts` 的「干净库」fixture —— schema 增长后该 fixture 必须同步增长，否则会把「结构已最新」误判成需要迁移）
- **接口端到端 156/156**（`.recon/verify-planner/run.mjs`）：拿新模板复制一份临时库 → 真起 `next dev` → 真打 HTTP 接口 → **最后直接读 SQLite 文件**核对确实落库（证明不是又一个内存态）。断言覆盖：配置局部更新/脏数据归一化、周计划的按周隔离与跨周移动、白名单不写入多余字段、数值排序、半截关联、进度夹取与自动补记完成日、同步的「只推进不回退 / 幂等 / 关联不存在时不动」、偏差的日期换算与排序、Markdown 导出不含 `undefined`/`NaN`、不支持的导出格式 400、通知的逾期提醒
- **D4 / D5 的端到端另起一段本地假 LLM 服务**：脚本内用 `http.createServer` 起一个 OpenAI 兼容端点，再经 `PUT /api/settings/llm` **正规地**配置 baseUrl + apiKey，因此 AI 助手这条链路是「真发 HTTP 请求、真回 JSON、真解析」——而不是把 `chatComplete` mock 掉（mock 掉就测不到「提示词里到底写了什么」「Bearer 有没有带上」）。覆盖：未配 Key → 400+`LLM_NOT_CONFIGURED`、Bearer 与模型名确实取自配置、提示词含周可用工时/补充要求/换算日期、生成不写库、围栏+废话可解析、越界数值被截断、非 JSON 不返回 500 且保留原文、按返回值逐条写入后本周真的多出对应条数、breakdown 提示词点名里程碑、risk 返回 Markdown 且不误报 `parseError`、上游报错 → 502+`LLM_CALL_FAILED`、清空 Key 后立刻回到未配置提示（不会拿着旧 Key 悄悄发请求）。日历侧覆盖：事件数守恒、甘特按起始日换算真实区间、周任务铺满整周、ICS 的 CRLF / 排他 `DTEND` / 稳定 `UID` / `VALARM` / 每行 ≤75 octets / 无裸 CR LF、`format` 大小写不敏感、不支持格式 400
- **未做**：浏览器级 UI 冒烟（本机未安装 Playwright 浏览器，且 C 盘紧张，没有下载）。前端消费的字段名已与上面实测的响应结构逐项核对一致
- 新增脚本 `resources/db-template` 的单独重建工具 `.recon/make-db-template.cjs`（`desktop/prepare-standalone.js` 的 `makeDbTemplate()` 会连带 prune + pack standalone，而本轮只需重建模板、不需要碰 `.next/standalone`）

## [1.2.4] - 2026-09-16

把「检查更新」真正打通、补上应用图标，并给多版本并发装上闸门。**这一版修掉了自动更新长期不生效的真因，同时只允许一个版本、一个客户端在跑。**

### 修复

- **自动更新一直不生效的真因：CI 每次都只产出草稿 release。** `electron-builder.yml` 的 `publish` 没有写 `releaseType`，而 electron-builder 的**默认值就是 `draft`**。草稿 release 在 GitHub 上既不算「latest」、匿名也访问不到，于是：
  - `https://github.com/<owner>/<repo>/releases/latest` 不再指向任何 tag（实测它 302 到 releases 列表页）
  - electron-updater 的 `getLatestTagName()` 请求该地址并带 `Accept: application/json`，跟随跳转后拿到 **406**，报 `Cannot parse releases feed`，**整条检查更新链路直接抛错**
  - 而这条错误又被 `console.warn` 悄悄吞掉 —— 用户侧表现为「检查更新毫无反应」，实际上每次启动都在失败
  - 已显式写入 `releaseType: release`。**注意：已存在的历史 release 需要在 GitHub 上手动改成正式发布，或重新发一次 tag 让 CI 覆盖**

- **更新失败不再静默**：原先 `autoUpdater` 的 `error` 事件只打日志、返回值也只有一句 `e.message`。现在按 `no-release / no-channel / network / dev / no-updater` 分类，翻译成用户看得懂、能行动的中文说明（例如「更新源暂时没有可用的正式发布（GitHub Releases）」），并在设置页如实展示
- **单实例锁的退出竞态**：拿不到锁时原先只调 `app.quit()`。quit 是「请求退出」，要等 `before-quit` 走完才结束进程，而 `app.whenReady()` 在这个窗口期仍可能被触发 —— 那样第二个实例会照样走完 bootstrap、拉起第二份内部服务（多一批子进程 + 第二个 SQLite 句柄）。改为 `app.exit(0)` 立即终止，并给 `bootstrap()` 与启动钩子都加了短路兜底
  - 实测（win-unpacked 双开）：第二个实例会在打印启动警告后自行退出，进程总数不增加；关窗后 5 个进程全部归零、无残留

### 新增

- **应用图标**：`node scripts/make-icon.mjs` 生成 `build/icon.ico`（含 16/24/32/48/64/128/256 七个尺寸）与 `build/icon.png`，`win.icon` 已接入 —— 打包日志不再出现 `default Electron icon is used`
  - 图案为「中心枢纽 + 四卫星节点」，配色深蓝→青
  - **≤32px 用单独的简化几何（去掉连线、放大节点）**：实测带连线的完整版缩到 16px 时，连线会把节点糊成一个「十字」，看着像医疗标志；简化版在 16px 下能清楚认出是网络拓扑
- **检查更新的界面入口**（原先前端从未调用过壳层暴露的检查接口，等于没有入口）：
  - 设置页新增「软件更新」卡片：显示当前版本、手动检查、按状态给出「已是最新 / 发现新版本 / 具体失败原因」
  - 新增全局更新提醒横幅：发现新版本时常驻顶部（可忽略），并提供「下载更新」；下载完成提供「立即重启并安装」
  - 有新版时**系统对话框 + 界面横幅 + toast 三重提醒** —— 原先只有对话框，用户点「稍后」就再无痕迹
- 壳层新增 IPC：`app-info`、`download-update`、`install-update`，以及主进程 → 渲染层的 `update-status` 推送（preload 用 id 退订，避免 React 严格模式重复挂载导致重复提示）
- 渲染层 IPC 调用方校验抽成 `guardSender()`，四个 handler 共用同一套「本窗口主框架 + 受信任源」判断
- **单一版本使用限制（跨版本守卫）**：`requestSingleInstanceLock` 的互斥只在「双方都调用它」时成立，而 **v1.2.0 及更早版本里根本没有这段代码**（锁是 v1.2.1 才引入的），历史二进制改不了；它们与新版共用同一个 userData 与同一个 `custom.db`，同时运行就是两个写者。新增 `desktop/instance-guard.js`：
  - 启动时枚举同名进程，**只要发现另一个安装路径的同名客户端在跑，就弹框说明并 `app.exit(0)`**，连解压/建库都不做。判定只看「exe 绝对路径不同」——同路径的第二个实例仍交给 `requestSingleInstanceLock`，这样升级后自动重启时旧进程尚未退干净也不会把自己卡在启动对话框上
  - 进程鉴别靠命令行特征：排除带 `--type=` 的渲染/GPU/utility 子进程，以及跑 `server.js` 的内部服务子进程（同一个 exe 用 `ELECTRON_RUN_AS_NODE` 起服务），避免把自己刚拉起的子进程误判成第二个客户端
  - 反向场景（新版在跑、用户又去点旧版图标）无法在旧版内部拦截，改为窗口获得焦点时节流复检（60 s），发现后弹系统提醒 + 界面横幅提示关闭
  - 枚举走 PowerShell `Get-CimInstance Win32_Process`（`wmic` 已在 Windows 11 24H2 移除）；**查询失败时放行并只记日志**（fail-open），避免被安全策略挡住的机器一启动就被自己的弹窗拦住
  - ⚠️ **实测踩到「WMI 偶发返回空结果」导致守卫静默失效**：进程明明在跑，90 秒连续采样里却有两次查到 0 个（见 `.recon/debug-old-watch.mjs`）。而「空」在「有没有别的客户端在跑」这个问题上恰好等价于「没有冲突」，于是不报错、不弹窗，就是拦不住。现在空结果会用 `tasklist`（走另一条内核快照路径、不经 WMI）**交叉确认**并**最多重试 3 次**，只有两边都说「没有」才敢相信；一直拿不到可信结果则返回「查询失败」走 fail-open
  - 「同一路径但代码是旧版本」这一种不归守卫管，由**安装器**在覆盖文件前解决：electron-builder 的 NSIS 会执行 `FIND_PROCESS`/`KILL_PROCESS`（`templates/nsis/include/allowOnlyOneInstallerInstance.nsh`），按 `$_.Path.StartsWith('$INSTDIR')` 找出正在运行的旧进程，提示「应用正在运行」并结束它 —— 否则文件根本覆盖不了。所以「同路径不同代码」不会并存
- **版本一致性（数据库降级保护）**：把程序版本写进 SQLite 文件头自带的 `PRAGMA user_version`（无需建表，Prisma 也看不见）。启动时若「库里记录的版本 > 当前程序版本」，说明本机数据已被更新的版本写过，旧代码继续写就可能悄悄写坏新数据 —— 直接弹框拒绝启动并保留数据。老库从没写过该值（读到 0），因此升级方向永远放行
- **安装目录固定**：`nsis.allowToChangeInstallationDirectory` 由 `true` 改为 `false`。原先用户可以把新版本装到另一个目录，磁盘上就同时有两份不同版本 —— 这正是「多版本开并发」的入口；固定后升级会覆盖旧版本（NSIS 检出已安装版本时沿用注册表记录的目录），磁盘上永远只有一份
- **图标生成并入构建链**：新增 `npm run desktop:icon`，并前置到 `desktop:build`。原先 `electron-builder.yml` 引用的 `build/icon.ico` 只在本机手工生成过，CI 从未跑过这个脚本 —— 换个干净检出打包就会退回 Electron 默认图标。`build/icon.ico` 与 `build/icon.png`（由脚本确定性产出）一并入库作为兜底
- 新增 `tests/desktop/instance-guard.test.ts`（19 例，覆盖主进程/子进程鉴别、同路径放行、路径归一化、非法输入、`tasklist` CSV 解析、以及「CIM 空结果 → 交叉确认 → 重试」的时序）与 `tests/desktop/db-version.test.ts`（5 例，覆盖版本编码、写戳幂等、降级判定），单测总数 128 → 152
- 打包产物一致性校验：`.recon/verify-packed-shell.mjs` 逐个 sha256 比对 `app.asar` 里的 `desktop/*.js` 与仓库源码，并断言六个关键修复点确实打进去了 —— 防止「测的是新的、装的是旧的」

### 验证范围（如实说明）

- **已跑通**：`tsc --noEmit`、`eslint .` 全绿；单测 `152/152`；asar 与源码 sha256 逐文件一致；`app.zip` 内含全部前端改动且版本已注入为 `1.2.4`
- **未跑通**：跨版本守卫的**实机端到端**验证（`.recon/guard-live-test2.mjs`，用两段安装路径互相拒绝）。
  本机开发沙箱**禁止执行任意 exe、禁止 spawn `powershell.exe`/`taskkill`**，因此被起测的应用既拉不起来、
  守卫内部的进程枚举也必然拿不到结果（正好走 fail-open 分支，会被误读成"守卫没生效"）。
  脚本已留档，可在普通桌面会话里直接 `node .recon/guard-live-test2.mjs` 复核。
  **结论**：守卫的**判定逻辑**由 19 条单测覆盖（含 CIM 空结果 → `tasklist` 交叉确认 → 重试的时序），
  打包产物也已逐字节核对；但「两版本同时运行时会互相拒绝」这一条目前**只有逻辑证明，没有实机证明**。

## [1.2.3] - 2026-09-15

移除一个实测不可用的功能，并让笔记导出真正接入 Obsidian。**建议桌面版用户升级。**

### 移除

- **移除「智能组网实验室」（INET）**。实测结论：该功能有两个互相独立的阻塞点——① 前端从未提供 manifest 配置入口（只发 `scenarioType` + `parameters`，全前端搜索 `manifest` 在组件层零命中），服务端因此必然判定为 failed，**即使自行装好 OMNeT++/INET 也无法从界面运行**；② 依赖外部 OMNeT++/INET 工具链，需用户自行编译数 GB 环境。要求用户为此自建环境不划算，故整体移除
  - 删除 `src/lib/inet/`、`src/app/api/inet/`、`src/components/sections/inet-lab-section.tsx`、导航与分区注册、相关测试与文档
  - `prisma/schema.prisma` 移除 `InetScenario` / `InetRun` / `InetRunArtifact` 三个模型
  - `desktop/migrate-database.js` 不再创建这些表；改为**在升级时清理已建出的空表**（先子表后父表，避免外键阻挡），老数据不受影响
  - 真正的组网仿真能力由内置引擎的「组网仿真实验」承担（无需任何外部依赖，结果可复现）

### 新增

- **导出 Markdown 直接写入 Obsidian vault**：设置页新增「Obsidian 笔记库」（vault 目录 + vault 内子目录 + 开关，可用系统原生目录选择器）；导出菜单新增「同步这一篇 / 全部文献笔记同步到 vault」；「导出 Markdown」在 vault 可用时顺便写入。写盘由内部服务完成，只有「选目录」走 Electron IPC
  - 路径安全：绝对路径 / `..` / 盘符 / UNC 一律拒绝或净化，写入前用 `path.resolve` 二次校验必须仍在 vault 内（E2E 实测确认 vault 外目录不被写入）
  - 同名笔记自动追加短 id 后缀，批量同步不会互相覆盖

- **论文写作首次形成闭环（写作工作台）**：新增 `Manuscript` 模型与「论文写作 → 写作工作台」标签页，把「文献库 → 插入引用 → 写章节 → 引用自动编号 → 参考文献 → 导出」串成一条不断链的流程
  - **稿件管理**：新建稿件自动带 Abstract / Introduction / Related Work / System Model / Method / Experiments / Conclusion 默认骨架；可改标题、目标期刊、全稿目标字数与各章节目标字数
  - **写作体验**：自动保存（停笔 800 ms 落盘，`Ctrl/Cmd+S` 立即保存，保存失败保留待写内容并可点重试）；切走页面前把未落盘改动补写，不会「看着在、其实没存」
  - **引用**：右侧搜索文献库，点一下即把 `[@paperId]` 插到光标处并恢复光标位置；已引用文献打勾
  - **自动编号**：引用编号按正文**首次出现顺序**生成，删段或调序后自动重排；服务端 `resolveManuscriptReferences` 为唯一编号来源，**预览与导出用的是同一份数据**，不会出现两边对不上
  - **缺失引用可见**：`[@id]` 指向的文献在库里不存在时，仍占号并在面板与导出里标红提示，而不是静默丢弃
  - **导出**：`/api/writing/manuscripts/:id/export?format=md|txt`，md 带标题、章节层级与规范化参考文献（IEEE 风格）；不支持的格式显式 400，不做静默回退；中文文件名走 RFC 5987 `filename*=UTF-8''`，不出现乱码
  - 字数统计按中英混排分别计数（CJK 按字、拉丁按词），并自动剔除 `[@..]` 标记、代码块与链接
  - 新增 `tests/lib/writing-draft.test.ts`（29 例）覆盖计数、编号、缺失引用、导出与文件名净化；迁移测试补充 `Manuscript` 表 / 索引 / 列的存在性断言

### 修复

- **INET runner 启动失败会打崩整个后端**：`InetRunner.run` 未监听子进程的 `'error'` 事件。实测 `opp_run` 不存在时只 emit `'error'`、不再 emit `'close'`，EventEmitter 无监听者即抛未捕获异常 → 进程直接退出；而该调用位于 fire-and-forget 的异步 IIFE 中，等于一次失败的实验让整个内部服务消失（用户侧表现为界面失去响应）。现已统一收敛为「resolve 成 failed + 可操作提示」
- **测试套件跑完不退出，会让 CI 卡死**：`vitest run` 在本项目里全绿后进程不退出（既有问题，改动前的基线同样复现），会使发布工作流的 `Unit tests` 步骤一直挂到 GitHub 默认的 6 小时上限，安装包永远发不出来。改用 `pool: 'threads'`（实测连续多次稳定退出），并给发布 job 加 `timeout-minutes` 兜底
- **未知导出格式静默回退**：`/api/notes/export/:id?format=tex` 原先不报错、静默返回 md（用户以为拿到 tex，实际是 md），现改为显式 400 并列出支持的格式
- **E2E 分区断言失真**：`e2e/sections.spec.ts` 文案写死「11 个分区」而实际侧边栏有 12 项、且断言未覆盖「使用说明」，长期无人发现。改为数量从列表派生并补齐全部分区
- **`electron-builder.yml` 用了不存在的键 `win.locales`，导致打包直接失败**：electron-builder 26 的语言包选项叫 `win.electronLanguages`；写成 `locales` 会让 JSON schema 拒绝整个 `win` 段并终止打包，报错仅一句 `configuration.win should be one of these: null`，不指向具体字段。**CI 的发布 job 会因同样原因失败，即 v1.2.2 的 Release 从未产出可用安装包。** 已改为 `win.electronLanguages` 并在本机跑通完整打包链路

## [1.2.2] - 2026-09-15

- 新增：导出 Markdown 直接写入 Obsidian vault，交给 Obsidian 管理（详见 1.2.3 条目）
- 修复：INET runner 子进程启动失败导致后端进程退出
- 修复：测试套件全绿后进程不退出，改用 `pool: 'threads'`

## [1.2.1] - 2026-09-15

桌面端打包与升级链路的可靠性修复，并大幅削减安装包与运行时体积。**建议桌面版用户升级**——本次修复了"升级后不生效"的隐患，并解决内存占用偏高问题。

### 修复（桌面端 / 打包链路）

- **解压改为 fail-safe 原子替换**：`desktop/main.js` 的 `ensureAppExtracted()` 不再"先删后解压"。改为先解压到 `app.new` 并校验，通过后再原子改名替换，成功写入 `.extract-ok` 完整性标记；任一步失败均保留原目录，不会把可用安装破坏成打不开
- **standalone 裁剪由黑名单改为白名单**：`desktop/prepare-standalone.js` 的 `pruneStandalone()` 顶层仅保留 `server.js` / `package.json` / `node_modules` / `.next` / `public`，递归清除 `*.tmp*`、非 sqlite 的 `wasm-base64`、`*.map`、`*.d.ts`。实测 standalone 由 **607 MB 降至 92.9 MB**
- **Next tracing 补挡测试/开发目录**：`outputFileTracingExcludes` 增加 `test-results` / `playwright-report` / `e2e` / `tests` / `docs` / `.github` / `db` / `*.db`（曾实测 `test-results` 被 tracing 拷入 **366 MB**）
- **Chromium 语言包裁剪**：`electron-builder.yml` 仅保留 `zh-CN` / `en-US`，去掉其余 53 个语言包（约 **47 MB**）

### 工程卫生

- 移除已完全合并的 `feature/inet-lab` git 工作树与本地分支
- 归档并移除两个早期废弃仓库（初版四 demo 之一的 `AI-net` 教学仿真前端、更早的 `智谱AI` 分支）——功能已并入正式源码 v1.2，删除不造成功能缺失

## [1.2.0] - 2026-09-10

补齐「Zotero → 本软件 → Obsidian」单向断裂的科研工作流。导入/同步**不会**自动调用 LLM。

### 新增

- **论文阅读笔记导出 Markdown / PDF / TXT**：论文详情页「导出笔记」走 `/api/papers/:id/notes`，导出的是这一篇的阅读笔记正文（含三遍阅读记录），可直接丢进 Obsidian
- **科研笔记服务端导出 MD/PDF**：`/api/notes/export/:id`，桌面端不再依赖前端 Blob 拼文件
- **论文库 CSV 是论文列表**：UTF-8 BOM + 题名/作者/期刊/年份/DOI/状态/标签等列，不再把笔记正文当成导出主体
- **导入 RIS / BibTeX**：Zotero/EndNote 导出内容粘贴即写入论文列表，按 DOI / Zotero key / 标题去重合并
- **导入 PDF 入库**：PDF 落到本机 `library/pdfs/`，可挂到已有论文或新建条目；**不解析、不送 LLM**
- **Zotero Web API 同步**：设置页填写 User ID + API Key，论文库一键「同步 Zotero」拉条目元数据

### 修复

- 桌面端升级时对 `Paper.doi` / `zoteroKey` / `pdfPath` 做无损 `ALTER TABLE`
- 论文库文案从「Zotero 风格」改为真实工作流说明，避免误导成已对接 Zotero

## [1.1.0] - 2026-08-27

> 完整发布说明见 [RELEASE_NOTES.md](RELEASE_NOTES.md)。本版重点：科研笔记阅读思考模板 + Excel 导出、内置技术应用说明书、Electron 升级后不更新的修复。

### 新增

- **科研笔记「阅读思考模板」**：文献笔记（分类=文献笔记）升级为结构化思考模板文档，阅读时逐项填写——作者、题目、期刊、术语记录、参考文献导入、研究方法、研究对象、理论框架、创新点、局限性、对我的启发（`Note.structured` JSON 字段 + `lastReadAt` 记录最近阅读时间）
- **一键导出 Excel (.xlsx)**：文献笔记可一键导出为 xlsx，列含「作者 / 题目 / 期刊 / 最近一次读的日期」，服务端 SheetJS 生成（`GET /api/notes/export/xlsx`），单测锁定表头与字段映射
- **Electron 桌面应用封装**：`npm run desktop:start`（开发直跑）与 `npm run desktop:dist`（NSIS 安装包）。内部以 `ELECTRON_RUN_AS_NODE` 子进程拉起 Next standalone 服务，绑定 `127.0.0.1:<随机空闲端口>`——仅回环可达、不暴露固定端口；数据库模板随包携带、首次启动落位用户数据目录，目标机器无需安装 Node.js

### 修复（桌面端 / 数据库迁移）

- **修复桌面版升级后仍显示旧界面**：`ensureAppExtracted()` 原先只判断 `resources/app/server.js` 存在与否，导致升级重装时旧解压目录残留、新 zip 永不被解压（一直用旧代码）。现以 Next 的 `BUILD_ID` 为版本标识，启动时对比新 zip 与已解压目录的版本，不一致则删除旧目录重新解压，确保每次更新后加载最新代码
- **Next standalone 漏追 `xlsx` 依赖**：`outputFileTracingIncludes` 显式把 `node_modules/xlsx` 纳入 standalone，修复桌面版 `/api/notes/export/xlsx` 的 `Cannot find module 'xlsx'`
- **旧数据库缺新列的无损迁移**：`desktop/main.js` 新增 `migrateDatabase()`，启动时用 `node:sqlite` 检测缺列并 `ALTER TABLE` 补齐（`Note.structured`/`lastReadAt`），保留既有数据，升级桌面版不再因缺列报错

### 新增

- **技术应用说明书（内置使用说明文档页）**：新增「使用说明」功能区，DeepSeek API 文档风格——左侧章节导航 + 右侧正文，含面包屑、PARAM/VALUE 配置表（base_url/api_key/model）、服务商预置表、API 端点速查、代码示例（带复制）、FAQ 折叠。覆盖快速开始 / 功能模块地图 / 接入 AI 助手 / API 端点速查 / 数据与备份 / 常见问题 6 章节
- 入口集成：侧边栏「系统」组新增「使用说明」导航项；首页「总览仪表盘」hero 新增「使用说明」按钮；新手引导最后一步新增「查看使用说明」直达链接

### 文档

- `KNOWN_ISSUES.md`：记录测试中发现的工程问题与规避方法（xlsx 漏追、旧库迁移、Electron 二进制下载拦截、旧笔记结构化字段为空、控制台 GBK 乱码等）
- README 功能表新增「📖 内置文档」说明
- `next.config.ts` 启用 `output: "standalone"`（增量产物，Web 部署方式不受影响）
- 桌面壳层 `desktop/main.js`：空闲端口申请、内部服务健康等待、外部链接移交系统浏览器、服务异常退出联动关窗

### 修复

- 清零全部 6 条 ESLint 警告（`react-hooks/set-state-in-effect`）：`useFetch` 重构为 await 后赋值 + 卸载竞态守卫；`useIsMobile` 改用 `useSyncExternalStore` 订阅 matchMedia；命令面板防抖搜索的 setState 全部移入定时器回调；其余两处挂载取数与 shadcn/ui 上游模式加定向豁免注释

### 新增

- **浏览器端到端测试**（Playwright，15 用例）：11 个功能分区的导航渲染回归（历史运行时崩溃防线）+ 三条关键工作流（论文添加全流程、仿真实验出指标、设置页无 Key 中文引导），本地复用运行中的 dev server，CI 自动拉起全新实例
- **CI 新增 e2e job**：Node 22 上安装 Chromium 后执行单测 + 浏览器套件，失败自动上传 trace 报告产物

### 新增（测试基建）

- **单元测试套件**（Vitest，41 用例）：
  - 仿真引擎：同参数两次运行字节级一致的确定性快照回归（覆盖三种算法 × 三类拓扑 × Drop-Tail/RED × 优先级调度）、预热包剔除计数、拥塞物理合理性（大队列显著提升交付率）、故障收敛时间非空、指标体系形状完整性
  - Q-Learning："同一 Q 表先后训练两个目的地互不污染"的核心回归测试（锁定"状态含目的地"修复）、训练曲线 ε 单调性、成功率上界、失败如实回退
  - 拓扑/RNG：三拓扑种子化确定性生成（锁死 Math.random 缺陷不再复发）、流派生独立性
  - LLM 网关：配置优先级（数据库 > 环境变量 > 默认）、Key 脱敏、URL 尾斜杠归一、上游 401 错误消息透传、空回复/连接拒绝的中文错误映射
- **CI 工作流** `.github/workflows/ci.yml`：push / PR 时在 Node 20 与 22 双版本矩阵上自动执行 prisma generate → typecheck → lint → test → 生产构建
- `npm test` / `npm run test:watch` 脚本

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
