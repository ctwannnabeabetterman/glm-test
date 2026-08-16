import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { KEYWORDS } from '@/lib/methodology-data'

// GET /api/recommendations - get paper recommendations based on reading history and tags
export async function GET() {
  try {
    // Get all papers to analyze reading patterns
    const papers = await db.paper.findMany()

    // Build tag frequency from read and high-priority papers
    const readPapers = papers.filter((p) => p.status === 'read' || p.status === 'reading' || p.priority === 'high')
    const tagFreq: Record<string, number> = {}
    const categoryFreq: Record<string, number> = {}
    const authorFreq: Record<string, number> = {}

    for (const p of readPapers) {
      // Count tags
      if (p.tags) {
        p.tags.split(',').forEach((t) => {
          const tag = t.trim().toLowerCase()
          if (tag) tagFreq[tag] = (tagFreq[tag] || 0) + 1
        })
      }
      // Count categories
      if (p.category) {
        categoryFreq[p.category] = (categoryFreq[p.category] || 0) + 1
      }
      // Count authors
      if (p.authors) {
        p.authors.split(',').forEach((a) => {
          const author = a.trim().toLowerCase()
          if (author.length > 2) authorFreq[author] = (authorFreq[author] || 0) + 1
        })
      }
    }

    // Sort by frequency
    const topTags = Object.entries(tagFreq).sort((a, b) => b[1] - a[1]).slice(0, 5)
    const topCategories = Object.entries(categoryFreq).sort((a, b) => b[1] - a[1]).slice(0, 3)
    const topAuthors = Object.entries(authorFreq).sort((a, b) => b[1] - a[1]).slice(0, 3)

    // Find unread papers that match top tags/categories
    const unreadPapers = papers.filter((p) => p.status === 'unread')
    const recommendations = unreadPapers.map((p) => {
      let score = 0
      const reasons: string[] = []

      // Score by tag overlap
      if (p.tags) {
        const paperTags = p.tags.split(',').map((t) => t.trim().toLowerCase())
        for (const [tag, freq] of topTags) {
          if (paperTags.includes(tag)) {
            score += freq * 10
            reasons.push(`标签 "${tag}" 匹配`)
          }
        }
      }

      // Score by category
      if (p.category && topCategories.find(([c]) => c === p.category)) {
        score += 5
        reasons.push(`分类 "${p.category}" 你常读`)
      }

      // Score by author
      if (p.authors) {
        const paperAuthors = p.authors.split(',').map((a) => a.trim().toLowerCase())
        for (const [author, freq] of topAuthors) {
          if (paperAuthors.includes(author)) {
            score += freq * 8
            reasons.push(`作者 "${author}" 你关注`)
          }
        }
      }

      // Bonus for high priority
      if (p.priority === 'high') {
        score += 15
        reasons.push('高优先级论文')
      }

      // Bonus for recency
      if (p.year >= 2023) score += 3
      if (p.year >= 2024) score += 2

      return {
        id: p.id,
        title: p.title,
        authors: p.authors,
        venue: p.venue,
        year: p.year,
        tags: p.tags,
        priority: p.priority,
        relevance: p.relevance,
        novelty: p.novelty,
        score,
        reasons: reasons.slice(0, 3),
      }
    }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)

    // Generate keyword combination suggestions based on top tags
    const keywordSuggestions: Array<{ scenario: string; method: string; problem: string }> = []
    const topTagSet = topTags.map(([t]) => t)
    if (topTagSet.length >= 2) {
      // Match tags to keyword dimensions
      const scenarios = KEYWORDS.scenario.filter((s) => topTagSet.some((t) => s.toLowerCase().includes(t) || t.includes(s.toLowerCase().split(' ')[0])))
      const methods = KEYWORDS.method.filter((m) => topTagSet.some((t) => m.toLowerCase().includes(t) || t.includes(m.toLowerCase().split(' ')[0])))
      const problems = KEYWORDS.problem.filter((p) => topTagSet.some((t) => p.toLowerCase().includes(t) || t.includes(p.toLowerCase().split(' ')[0])))

      // Generate up to 3 combinations
      const sList = scenarios.length > 0 ? scenarios : KEYWORDS.scenario.slice(0, 3)
      const mList = methods.length > 0 ? methods : KEYWORDS.method.slice(0, 3)
      const pList = problems.length > 0 ? problems : KEYWORDS.problem.slice(0, 3)

      for (let i = 0; i < Math.min(3, Math.max(sList.length, mList.length, pList.length)); i++) {
        keywordSuggestions.push({
          scenario: sList[i % sList.length],
          method: mList[i % mList.length],
          problem: pList[i % pList.length],
        })
      }
    }

    return NextResponse.json({
      recommendations,
      readingProfile: {
        topTags: topTags.map(([tag, count]) => ({ tag, count })),
        topCategories: topCategories.map(([cat, count]) => ({ cat, count })),
        topAuthors: topAuthors.map(([author, count]) => ({ author, count })),
        totalRead: readPapers.length,
        totalPapers: papers.length,
      },
      keywordSuggestions,
    })
  } catch (e) {
    console.error('Recommendations error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
