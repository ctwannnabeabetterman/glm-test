import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { db } from '@/lib/db'
import { pdfStorageDir, safePdfName } from '@/lib/library/paths'

function filenameFromTitle(title: string): string {
  const base = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60) || 'paper'
  return `${base}.pdf`
}

// POST /api/papers/pdf —— 把 PDF 文件落到本机 library/pdfs，并挂到论文记录。不调用 LLM。
export async function POST(request: NextRequest) {
  try {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: '请选择 PDF 文件' }, { status: 400 })
    if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') {
      return NextResponse.json({ error: '只接受 PDF 文件' }, { status: 400 })
    }

    const paperId = String(form.get('paperId') || '')
    const titleHint = String(form.get('title') || '').trim()
    const dir = pdfStorageDir()
    const stamp = Date.now()
    const storedName = `${stamp}-${safePdfName(file.name || filenameFromTitle(titleHint))}`
    const abs = path.join(dir, storedName)
    const buf = Buffer.from(await file.arrayBuffer())
    fs.writeFileSync(abs, buf)
    const rel = `pdfs/${storedName}`

    if (paperId) {
      const paper = await db.paper.update({
        where: { id: paperId },
        data: { pdfPath: rel },
      })
      return NextResponse.json({ success: true, paperId: paper.id, pdfPath: rel, created: false })
    }

    const title = titleHint || file.name.replace(/\.pdf$/i, '')
    const paper = await db.paper.create({
      data: {
        title,
        pdfPath: rel,
        status: 'unread',
        priority: 'medium',
        category: 'method',
      },
    })
    return NextResponse.json({ success: true, paperId: paper.id, pdfPath: rel, created: true })
  } catch (e) {
    console.error('upload pdf error', e)
    return NextResponse.json({ error: 'PDF 入库失败: ' + (e as Error).message }, { status: 500 })
  }
}

// GET /api/papers/pdf?id= —— 打开已入库的 PDF
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const paper = await db.paper.findUnique({ where: { id } })
  if (!paper?.pdfPath) return NextResponse.json({ error: '该论文尚未入库 PDF' }, { status: 404 })
  const abs = path.join(pdfStorageDir(), path.basename(paper.pdfPath))
  if (!fs.existsSync(abs)) return NextResponse.json({ error: 'PDF 文件不在本地库中' }, { status: 404 })
  const bytes = fs.readFileSync(abs)
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(path.basename(abs))}"`,
    },
  })
}
