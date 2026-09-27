import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { clearScoredInDb } from '@/lib/library/score-provenance-server'
import { recordActivity } from '@/lib/activity'
import { parseStringArray } from '@/lib/utils'
import { collectCitationIds, normalizeSections } from '@/lib/writing/draft'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const paper = await db.paper.findUnique({ where: { id } })
    if (!paper) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(paper)
  } catch (e) {
    console.error('GET paper error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

/**
 * PUT 的可写字段白名单。
 *
 * 原来是 `const data = { ...body }` —— 请求体里有什么就写什么，**连 `id` / `createdAt` 都能改**。
 * 本机 UI 不会这么干，所以它不是「已发生的故障」，而是一类「等着被踩」的缺陷：
 * 一次手写 curl、一个同步脚本、或者将来某次重构多传了一个字段，就能把主键/时间戳改成任意值，
 * 而且**不会有任何报错**（Prisma 照单全收）。
 *
 * 改成白名单，其余字段静默忽略（不报 500 —— 把无害的多余字段变成错误会让客户端更难用）。
 * 字段集合 = Paper 的可编辑标量列，去掉 `id` / `createdAt` / `updatedAt` / `dateAdded`
 * 以及由阅读会话事务递增的 `readingTime`（不能再用客户端绝对值覆盖）。
 */
const WRITABLE_FIELDS = [
  'title',
  'authors',
  'venue',
  'year',
  'citations',
  'relevance',
  'novelty',
  'priority',
  'status',
  'codeUrl',
  'pdfUrl',
  'doi',
  'zoteroKey',
  'pdfPath',
  'abstract',
  'topicIds',
  'tags',
  'category',
  'notes',
  'readingProgress',
  'dateRead',
] as const

function pickWritable(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const key of WRITABLE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, key)) data[key] = body[key]
  }
  return data
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const raw = (await request.json()) as Record<string, unknown>
    const body = pickWritable(raw)
    const data: Record<string, unknown> = { ...body }
    // Auto set dateRead when status becomes 'read'
    if (body.status === 'read') {
      data.dateRead = new Date()
    } else if (body.status && body.status !== 'read') {
      data.dateRead = null
    }
    // Convert numeric fields
    if (body.year !== undefined) data.year = Number(body.year)
    if (body.citations !== undefined) data.citations = Number(body.citations)
    if (body.relevance !== undefined) data.relevance = Number(body.relevance)
    if (body.novelty !== undefined) data.novelty = Number(body.novelty)

    const paper = await db.paper.update({ where: { id }, data })
    void recordActivity({ module: 'paper', action: 'update', title: `更新了论文「${paper.title}」`, refId: paper.id })

    // 人工改过「相关度/新颖度/优先级」⇒ 摘掉那条「分数来自 AI」的标记。
    // 不摘的后果是界面会继续显示 AI 徽标，用户会以为自己看到的仍是模型的判断
    // （而实际上已经是他自己改过的值）—— 这类「标记说谎」比不显示标记更糟。
    const touchedScores = ['relevance', 'novelty', 'priority'].some((k) =>
      Object.prototype.hasOwnProperty.call(raw, k),
    )
    if (touchedScores) await clearScoredInDb([id])

    return NextResponse.json(paper)
  } catch (e) {
    console.error('PUT paper error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    // SQLite 写事务串行化检查与删除；ReadingSession 是历史记录，不是活跃链接。
    const result = await db.$transaction(async (tx) => {
      const removed = await tx.paper.findUnique({ where: { id }, select: { title: true } })
      if (!removed) return { status: 404 as const }

      const citation = await tx.citation.findFirst({
        where: { OR: [{ citingPaperId: id }, { citedPaperId: id }] }, select: { id: true },
      })
      // 旧库的孤儿引用可能不在引用列表中显示，返回 id 方便用户定向解除。
      if (citation) return { status: 409 as const, link: `论文引用（关系 ID: ${citation.id}）` }

      const notes = await tx.note.findMany({ select: { paperIds: true } })
      if (notes.some((note) => parseStringArray(note.paperIds).includes(id))) {
        return { status: 409 as const, link: '笔记关联文献' }
      }

      const manuscripts = await tx.manuscript.findMany({ select: { sections: true } })
      if (manuscripts.some((m) => collectCitationIds(normalizeSections(m.sections)).includes(id))) {
        return { status: 409 as const, link: '稿件正文引用' }
      }

      // 删除的是数据库记录，不删磁盘 PDF：可能被其他 Paper 共用，且保留本地文件
      // 供用户手工恢复。旧附件的回收只在成功替换后按引用计数移入 .replaced。
      await tx.paper.delete({ where: { id } })
      return { status: 200 as const, title: removed.title }
    })
    if (result.status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (result.status === 409) {
      return NextResponse.json({ error: `论文仍被${result.link}使用，请先解除链接后再删除` }, { status: 409 })
    }
    void recordActivity({ module: 'paper', action: 'delete', title: `删除了论文「${result.title}」`, refId: id })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE paper error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
