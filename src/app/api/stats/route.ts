import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const [
      totalPapers,
      readPapers,
      readingPapers,
      unreadPapers,
      topics,
      experiments,
      plannedExperiments,
      completedExperiments,
      milestones,
      notes,
    ] = await Promise.all([
      db.paper.count(),
      db.paper.count({ where: { status: 'read' } }),
      db.paper.count({ where: { status: 'reading' } }),
      db.paper.count({ where: { status: 'unread' } }),
      db.topic.findMany({ orderBy: [{ totalScore: 'desc' }], take: 5 }),
      db.experiment.count(),
      db.experiment.count({ where: { status: 'planned' } }),
      db.experiment.count({ where: { status: 'completed' } }),
      db.milestone.findMany(),
      db.note.count(),
    ])

    const highPriorityPapers = await db.paper.count({ where: { priority: 'high' } })

    return NextResponse.json({
      papers: { total: totalPapers, read: readPapers, reading: readingPapers, unread: unreadPapers, highPriority: highPriorityPapers },
      topics: { total: topics.length, top: topics },
      experiments: { total: experiments, planned: plannedExperiments, completed: completedExperiments },
      milestones: { total: milestones.length, gantt: milestones.filter(m => m.type === 'gantt').length, writing: milestones.filter(m => m.type === 'writing').length, submission: milestones.filter(m => m.type === 'submission').length },
      notes: { total: notes },
    })
  } catch (e) {
    console.error('GET stats error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
