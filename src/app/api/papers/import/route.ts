import { NextRequest, NextResponse } from 'next/server'
import { normalizeRecords, parseBibliography } from '@/lib/library/bibliography'
import { mergeBibliography } from '@/lib/library/merge'
import { recordActivity } from '@/lib/activity'

// POST /api/papers/import —— 导入文献。不调用 LLM。
//
// 两种入参，二选一（同时给时以 `records` 为准）：
//  - `{ text }`      RIS / BibTeX 文本（用户从 Zotero 导出后粘贴）
//  - `{ records }`   已经是结构化对象（AI 相关论文面板的 Crossref 检索结果）
//
// 为什么加 `records`：让结构化的来源去拼 RIS 再解析回来，中间要处理换行与转义，
// 任何一处没转干净就会**静默丢字段**。直接收对象没有这层损耗。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const text = typeof body.text === 'string' ? body.text : ''

    let records = normalizeRecords(body.records)
    let source = 'records'
    if (records.length === 0) {
      if (!text.trim()) {
        return NextResponse.json({ error: '请粘贴 RIS 或 BibTeX 内容' }, { status: 400 })
      }
      records = parseBibliography(text)
      source = 'text'
      if (records.length === 0) {
        return NextResponse.json({ error: '未解析到文献条目。请导出 Zotero 的 RIS 或 BibTeX 后再导入。' }, { status: 400 })
      }
    }

    const stats = await mergeBibliography(records)
    // 埋点放在合并之后：没真正入库就不该在时间线里留下「导入了 N 篇」。
    // 只在确有新增时记，避免反复导入同一批把记录刷满。
    if (stats.created > 0) {
      void recordActivity({
        module: 'paper',
        action: 'import',
        title: `导入了 ${stats.created} 篇文献`,
        detail: source === 'records' ? '来自 AI 相关论文检索结果' : '来自 RIS / BibTeX 文本',
      })
    }
    return NextResponse.json({ success: true, parsed: records.length, ...stats })
  } catch (e) {
    console.error('import papers error', e)
    return NextResponse.json({ error: '导入失败: ' + (e as Error).message }, { status: 500 })
  }
}
