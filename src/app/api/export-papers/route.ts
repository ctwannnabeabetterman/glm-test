import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/export-papers?format=csv|endnote|json - export papers in various formats
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const format = searchParams.get('format') || 'csv'
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (status) where.status = status

    const papers = await db.paper.findMany({ where, orderBy: [{ year: 'desc' }, { title: 'asc' }] })

    if (format === 'csv') {
      const headers = ['ID', 'Title', 'Authors', 'Venue', 'Year', 'Citations', 'Relevance', 'Novelty', 'Priority', 'Status', 'Category', 'Tags', 'CodeURL', 'DateAdded', 'DateRead']
      const rows = papers.map((p) => [
        p.id,
        `"${p.title.replace(/"/g, '""')}"`,
        `"${p.authors.replace(/"/g, '""')}"`,
        `"${p.venue.replace(/"/g, '""')}"`,
        p.year,
        p.citations,
        p.relevance,
        p.novelty,
        p.priority,
        p.status,
        p.category,
        `"${p.tags.replace(/"/g, '""')}"`,
        `"${p.codeUrl.replace(/"/g, '""')}"`,
        p.dateAdded.toISOString().slice(0, 10),
        p.dateRead ? p.dateRead.toISOString().slice(0, 10) : '',
      ])
      const csv = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n')
      return new NextResponse(csv, {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="papers-${new Date().toISOString().slice(0, 10)}.csv"`,
        },
      })
    }

    if (format === 'endnote') {
      // EndNote/RIS format
      const ris = papers.map((p) => {
        const type = /journal|transactions|letters|TCOM|TWC|TVT|CL|ACCESS/i.test(p.venue) ? 'JOUR' : 'CONF'
        const lines = [
          `TY  - ${type}`,
          `TI  - ${p.title}`,
          `AU  - ${p.authors}`,
          `PY  - ${p.year}`,
          `T2  - ${p.venue}`,
          `KW  - ${p.tags}`,
          `M1  - Citations: ${p.citations}`,
        ]
        if (p.codeUrl) lines.push(`UR  - ${p.codeUrl.startsWith('http') ? p.codeUrl : `https://${p.codeUrl}`}`)
        if (p.notes) lines.push(`N1  - ${p.notes.slice(0, 200)}`)
        lines.push('ER  - ')
        return lines.join('\n')
      }).join('\n\n')
      return new NextResponse(ris, {
        headers: {
          'Content-Type': 'application/x-research-info-systems; charset=utf-8',
          'Content-Disposition': `attachment; filename="papers-${new Date().toISOString().slice(0, 10)}.ris"`,
        },
      })
    }

    if (format === 'bibtex') {
      const bibtex = papers.map((p) => {
        const key = generateBibtexKey(p)
        const isJournal = /journal|transactions|letters|TCOM|TWC|TVT|CL|ACCESS/i.test(p.venue)
        const entryType = isJournal ? 'article' : 'inproceedings'
        const venueField = isJournal ? 'journal' : 'booktitle'
        const lines = [
          `@${entryType}{${key},`,
          `  title     = {{{${p.title}}}},`,
          `  author    = {${p.authors}},`,
          `  year      = {${p.year}},`,
          `  ${venueField} = {${p.venue}},`,
        ]
        if (p.citations > 0) lines.push(`  note      = {Citations: ${p.citations}},`)
        if (p.codeUrl) lines.push(`  url       = {${p.codeUrl.startsWith('http') ? p.codeUrl : `https://${p.codeUrl}`}},`)
        lines.push('}')
        return lines.join('\n')
      }).join('\n\n')
      return new NextResponse(bibtex, {
        headers: {
          'Content-Type': 'application/x-bibtex; charset=utf-8',
          'Content-Disposition': `attachment; filename="papers-${new Date().toISOString().slice(0, 10)}.bib"`,
        },
      })
    }

    // Default: JSON
    return NextResponse.json({ papers, count: papers.length })
  } catch (e) {
    console.error('Export error', e)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

function generateBibtexKey(p: { authors: string; year: number; title: string }): string {
  const firstAuthor = (p.authors || 'unknown').split(',')[0].trim().split(' ').pop()?.toLowerCase() || 'unknown'
  const titleWords = p.title.split(/\s+/).filter((w) => !/^(the|a|an|for|of|in|on|with|and|to)$/i.test(w)).slice(0, 2).join('').toLowerCase().replace(/[^a-z0-9]/g, '')
  return `${firstAuthor}${p.year}${titleWords}`
}
