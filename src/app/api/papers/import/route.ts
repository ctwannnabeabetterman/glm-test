import { NextRequest, NextResponse } from 'next/server'
import { parseBibliography } from '@/lib/library/bibliography'
import { mergeBibliography } from '@/lib/library/merge'

// POST /api/papers/import —— 导入 RIS / BibTeX 文本。不调用 LLM。
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) return NextResponse.json({ error: '请粘贴 RIS 或 BibTeX 内容' }, { status: 400 })
    const records = parseBibliography(text)
    if (records.length === 0) {
      return NextResponse.json({ error: '未解析到文献条目。请导出 Zotero 的 RIS 或 BibTeX 后再导入。' }, { status: 400 })
    }
    const stats = await mergeBibliography(records)
    return NextResponse.json({ success: true, parsed: records.length, ...stats })
  } catch (e) {
    console.error('import papers error', e)
    return NextResponse.json({ error: '导入失败: ' + (e as Error).message }, { status: 500 })
  }
}
