import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'
import { pickWritableNote } from '@/lib/notes/payload'

export async function GET() {
  try {
    const notes = await db.note.findMany({ orderBy: [{ updatedAt: 'desc' }] })
    // 结构化字段以 JSON 字符串落库，读出时解析为对象便于前端使用
    const parsed = notes.map((n) => {
      let structured: Record<string, unknown> = {}
      try {
        structured = JSON.parse(n.structured || '{}')
      } catch {
        structured = {}
      }
      return { ...n, structured }
    })
    return NextResponse.json(parsed)
  } catch (e) {
    console.error('GET notes error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>
    // 标题是唯一必填项。缺了直接 400 —— 让 Prisma 抛的话用户只会看到一个 500，
    // 分不清是自己少填了还是服务坏了。
    if (typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 })
    }
    const writable = pickWritableNote(body)
    const note = await db.note.create({
      data: {
        // 这里的默认值必须与 Prisma schema 的 @default 一致，否则「建出来」与
        // 「补列出来」的笔记会带着不同的初始值（Provenance 类问题很难查）
        content: '',
        tags: '',
        links: '[]',
        category: 'literature',
        structured: '{}',
        // 所属课题：JSON 数组字符串。缺省为空数组 = 不参与任何课题的 AI 分析。
        topicIds: '[]',
        // 关联文献：JSON 数组字符串。缺省为空 = 未关联任何论文。
        paperIds: '[]',
        ...writable,
        // 显式放在最后：标题以校验过的值为准，不让 body 里的覆盖
        title: body.title,
      },
    })
    void recordActivity({ module: 'note', action: 'create', title: `写了笔记「${note.title}」`, refId: note.id })
    return NextResponse.json(note, { status: 201 })
  } catch (e) {
    console.error('POST notes error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
