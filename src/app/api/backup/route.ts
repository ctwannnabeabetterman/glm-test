import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/backup/export - export all data as JSON
export async function GET() {
  try {
    const [papers, topics, experiments, milestones, notes, searchLogs, keywords] = await Promise.all([
      db.paper.findMany(),
      db.topic.findMany(),
      db.experiment.findMany(),
      db.milestone.findMany(),
      db.note.findMany(),
      db.searchLog.findMany(),
      db.keyword.findMany(),
    ])

    const backup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      meta: {
        papers: papers.length,
        topics: topics.length,
        experiments: experiments.length,
        milestones: milestones.length,
        notes: notes.length,
        searchLogs: searchLogs.length,
        keywords: keywords.length,
      },
      data: {
        papers,
        topics,
        experiments,
        milestones,
        notes,
        searchLogs,
        keywords,
      },
    }

    return NextResponse.json(backup)
  } catch (e) {
    console.error('Export error', e)
    return NextResponse.json({ error: 'Export failed' }, { status: 500 })
  }
}

// POST /api/backup/import - import data from JSON
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { data, mode = 'merge' } = body // mode: 'merge' (default) or 'replace'

    if (!data) {
      return NextResponse.json({ error: 'No data provided' }, { status: 400 })
    }

    const results: Record<string, number> = {}

    // If replace mode, clear all existing data first
    if (mode === 'replace') {
      await Promise.all([
        db.paper.deleteMany({}),
        db.topic.deleteMany({}),
        db.experiment.deleteMany({}),
        db.milestone.deleteMany({}),
        db.note.deleteMany({}),
        db.searchLog.deleteMany({}),
        db.keyword.deleteMany({}),
      ])
    }

    // Import papers
    if (Array.isArray(data.papers)) {
      let count = 0
      for (const p of data.papers) {
        try {
          // Check if exists (by id) for merge mode
          if (mode === 'merge') {
            const existing = await db.paper.findUnique({ where: { id: p.id } })
            if (existing) {
              await db.paper.update({ where: { id: p.id }, data: p })
            } else {
              await db.paper.create({ data: p })
            }
          } else {
            await db.paper.create({ data: p })
          }
          count++
        } catch (e) {
          console.error('Paper import error:', e)
        }
      }
      results.papers = count
    }

    // Import topics
    if (Array.isArray(data.topics)) {
      let count = 0
      for (const t of data.topics) {
        try {
          if (mode === 'merge') {
            const existing = await db.topic.findUnique({ where: { id: t.id } })
            if (existing) {
              await db.topic.update({ where: { id: t.id }, data: t })
            } else {
              await db.topic.create({ data: t })
            }
          } else {
            await db.topic.create({ data: t })
          }
          count++
        } catch (e) {
          console.error('Topic import error:', e)
        }
      }
      results.topics = count
    }

    // Import experiments
    if (Array.isArray(data.experiments)) {
      let count = 0
      for (const e of data.experiments) {
        try {
          if (mode === 'merge') {
            const existing = await db.experiment.findUnique({ where: { id: e.id } })
            if (existing) {
              await db.experiment.update({ where: { id: e.id }, data: e })
            } else {
              await db.experiment.create({ data: e })
            }
          } else {
            await db.experiment.create({ data: e })
          }
          count++
        } catch (err) {
          console.error('Experiment import error:', err)
        }
      }
      results.experiments = count
    }

    // Import milestones
    if (Array.isArray(data.milestones)) {
      let count = 0
      for (const m of data.milestones) {
        try {
          if (mode === 'merge') {
            const existing = await db.milestone.findUnique({ where: { id: m.id } })
            if (existing) {
              await db.milestone.update({ where: { id: m.id }, data: m })
            } else {
              await db.milestone.create({ data: m })
            }
          } else {
            await db.milestone.create({ data: m })
          }
          count++
        } catch (e) {
          console.error('Milestone import error:', e)
        }
      }
      results.milestones = count
    }

    // Import notes
    if (Array.isArray(data.notes)) {
      let count = 0
      for (const n of data.notes) {
        try {
          if (mode === 'merge') {
            const existing = await db.note.findUnique({ where: { id: n.id } })
            if (existing) {
              await db.note.update({ where: { id: n.id }, data: n })
            } else {
              await db.note.create({ data: n })
            }
          } else {
            await db.note.create({ data: n })
          }
          count++
        } catch (e) {
          console.error('Note import error:', e)
        }
      }
      results.notes = count
    }

    // Import searchLogs
    if (Array.isArray(data.searchLogs)) {
      let count = 0
      for (const s of data.searchLogs) {
        try {
          await db.searchLog.create({ data: s })
          count++
        } catch (e) {
          console.error('SearchLog import error:', e)
        }
      }
      results.searchLogs = count
    }

    // Import keywords
    if (Array.isArray(data.keywords)) {
      let count = 0
      for (const k of data.keywords) {
        try {
          if (mode === 'merge') {
            const existing = await db.keyword.findUnique({ where: { id: k.id } })
            if (existing) {
              await db.keyword.update({ where: { id: k.id }, data: k })
            } else {
              await db.keyword.create({ data: k })
            }
          } else {
            await db.keyword.create({ data: k })
          }
          count++
        } catch (e) {
          console.error('Keyword import error:', e)
        }
      }
      results.keywords = count
    }

    return NextResponse.json({ success: true, results, mode })
  } catch (e) {
    console.error('Import error', e)
    return NextResponse.json({ error: 'Import failed' }, { status: 500 })
  }
}
