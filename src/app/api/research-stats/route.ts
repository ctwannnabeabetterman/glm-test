import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/research-stats - advanced research analytics
export async function GET() {
  try {
    const [papers, topics, experiments, notes, milestones, sessions] = await Promise.all([
      db.paper.findMany(),
      db.topic.findMany(),
      db.experiment.findMany(),
      db.note.findMany(),
      db.milestone.findMany(),
      db.readingSession.findMany(),
    ])

    // Papers by year
    const byYear: Record<number, number> = {}
    papers.forEach((p) => {
      byYear[p.year] = (byYear[p.year] || 0) + 1
    })
    const yearData = Object.entries(byYear)
      .map(([year, count]) => ({ year: Number(year), count }))
      .sort((a, b) => a.year - b.year)

    // Papers by category
    const byCategory: Record<string, number> = {}
    papers.forEach((p) => {
      const cat = p.category || 'other'
      byCategory[cat] = (byCategory[cat] || 0) + 1
    })
    const categoryData = Object.entries(byCategory).map(([cat, count]) => ({ category: cat, count }))

    // Papers by status
    const byStatus: Record<string, number> = {}
    papers.forEach((p) => {
      byStatus[p.status] = (byStatus[p.status] || 0) + 1
    })
    const statusData = Object.entries(byStatus).map(([status, count]) => ({ status, count }))

    // Tag frequency
    const tagFreq: Record<string, number> = {}
    papers.forEach((p) => {
      if (p.tags) {
        p.tags.split(',').forEach((t) => {
          const tag = t.trim().toLowerCase()
          if (tag) tagFreq[tag] = (tagFreq[tag] || 0) + 1
        })
      }
    })
    const topTags = Object.entries(tagFreq)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)

    // Relevance vs Novelty scatter
    const scatterData = papers.map((p) => ({
      name: p.title.length > 20 ? p.title.slice(0, 18) + '..' : p.title,
      relevance: p.relevance,
      novelty: p.novelty,
      year: p.year,
    }))

    // Experiment status
    const expByStatus: Record<string, number> = {}
    experiments.forEach((e) => {
      expByStatus[e.status] = (expByStatus[e.status] || 0) + 1
    })
    const expStatusData = Object.entries(expByStatus).map(([status, count]) => ({ status, count }))

    // Reading time by paper (top 5)
    const readingTimeByPaper = papers
      .filter((p) => (p.readingTime || 0) > 0)
      .map((p) => ({
        title: p.title.length > 25 ? p.title.slice(0, 23) + '..' : p.title,
        time: Math.round((p.readingTime || 0) / 60), // minutes
      }))
      .sort((a, b) => b.time - a.time)
      .slice(0, 5)

    // Topic score distribution
    const topicScores = topics.map((t) => ({
      name: t.name.length > 15 ? t.name.slice(0, 13) + '..' : t.name,
      score: t.totalScore,
    }))

    // Milestone progress
    const milestoneProgress = milestones.map((m) => ({
      title: m.title.length > 20 ? m.title.slice(0, 18) + '..' : m.title,
      progress: m.progress,
      type: m.type,
    }))

    // Overall stats
    const totalReadingTime = papers.reduce((sum, p) => sum + (p.readingTime || 0), 0)
    const totalSessions = sessions.length
    const avgRelevance = papers.length > 0 ? papers.reduce((s, p) => s + p.relevance, 0) / papers.length : 0
    const avgNovelty = papers.length > 0 ? papers.reduce((s, p) => s + p.novelty, 0) / papers.length : 0

    return NextResponse.json({
      yearData,
      categoryData,
      statusData,
      topTags,
      scatterData,
      expStatusData,
      readingTimeByPaper,
      topicScores,
      milestoneProgress,
      summary: {
        totalPapers: papers.length,
        totalTopics: topics.length,
        totalExperiments: experiments.length,
        totalNotes: notes.length,
        totalMilestones: milestones.length,
        totalReadingTime, // seconds
        totalSessions,
        avgRelevance: Math.round(avgRelevance * 10) / 10,
        avgNovelty: Math.round(avgNovelty * 10) / 10,
      },
    })
  } catch (e) {
    console.error('Research stats error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
