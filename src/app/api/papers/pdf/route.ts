import { NextRequest, NextResponse } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { db } from '@/lib/db'
import { pdfStorageDir, safePdfName } from '@/lib/library/paths'

function filenameFromTitle(title: string): string {
  const base = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 60) || 'paper'
  return `${base}.pdf`
}

// 仅回收本路由生成的旧路径；用户通过 PUT 关联的自有文件不能被移动。
async function archiveReplacedPdf(oldPath: string, currentPath: string, dir: string) {
  // 旧格式（仅时间戳）的所有权无法确认，原地保留；只归档本版上传的 UUID 文件。
  if (oldPath === currentPath || !/^pdfs\/\d{13}-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}-[^/\\]+\.pdf$/i.test(oldPath)) return
  try {
    if (await db.paper.count({ where: { pdfPath: oldPath } })) return
    const original = path.basename(oldPath)
    const source = path.join(dir, original)
    if (!fs.lstatSync(source).isFile()) return
    const archiveDir = path.join(dir, '.replaced')
    fs.mkdirSync(archiveDir, { recursive: true })
    // 保留原文件名与内容，用户可以从 .replaced 手工恢复；绝不直接永久删除。
    fs.renameSync(source, path.join(archiveDir, `${randomUUID()}--${original}`))
  } catch (e) {
    // 回收失败不影响已经提交的 DB 引用；保留原文件比丢失 PDF 安全。
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') console.error('archive replaced pdf error', e)
  }
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
    const previous = paperId
      ? await db.paper.findUnique({ where: { id: paperId }, select: { pdfPath: true } })
      : null
    if (paperId && !previous) return NextResponse.json({ error: '论文不存在' }, { status: 404 })

    const dir = pdfStorageDir()
    const storedName = `${Date.now()}-${randomUUID()}-${safePdfName(file.name || filenameFromTitle(titleHint))}`
    const abs = path.join(dir, storedName)
    const buf = Buffer.from(await file.arrayBuffer())
    const rel = `pdfs/${storedName}`
    let written = false
    try {
      const fd = fs.openSync(abs, 'wx')
      written = true
      try {
        fs.writeFileSync(fd, buf)
      } finally {
        fs.closeSync(fd)
      }
      if (paperId) {
        // CAS：并发替换时不能把后写入的附件当作自己的旧附件回收。
        const result = await db.paper.updateMany({
          where: { id: paperId, pdfPath: previous!.pdfPath },
          data: { pdfPath: rel },
        })
        if (result.count !== 1) return NextResponse.json({ error: 'PDF 已由其他操作更新，请重试' }, { status: 409 })
        written = false
        await archiveReplacedPdf(previous!.pdfPath, rel, dir)
        return NextResponse.json({ success: true, paperId, pdfPath: rel, created: false })
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
      written = false
      return NextResponse.json({ success: true, paperId: paper.id, pdfPath: rel, created: true })
    } finally {
      // 数据库未接受新路径时只删除本次新建的文件，绝不碰旧附件。
      if (written) fs.rmSync(abs, { force: true })
    }
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
