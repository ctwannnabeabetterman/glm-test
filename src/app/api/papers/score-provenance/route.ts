import { NextResponse } from 'next/server'
import { readProvenance } from '@/lib/library/score-provenance-server'

/**
 * GET /api/papers/score-provenance
 *
 * 返回 `{ scored: { [paperId]: { at, note? } } }` —— 哪些论文的分数是 AI 给的、什么时候给的。
 *
 * 为什么不并进 `GET /api/papers`：那条接口的响应体**是一个数组**，
 * 加上来源映射就得改成对象，而 `writing-workbench` 等调用方都按数组解析
 * （会静默拿到 `undefined` 然后显示空列表）。为一个界面徽标去改一个被多处消费的接口形状，
 * 不值得 —— 单开一条只读接口，零扩散面。
 */
export async function GET() {
  try {
    return NextResponse.json({ scored: await readProvenance() })
  } catch (e) {
    console.error('GET score-provenance error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
