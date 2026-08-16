import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/achievements - calculate and return achievements/badges
export async function GET() {
  try {
    const papers = await db.paper.findMany()
    const notes = await db.note.count()
    const experiments = await db.experiment.count()
    const topics = await db.topic.count()

    const readPapers = papers.filter((p) => p.status === 'read')
    const readingPapers = papers.filter((p) => p.status === 'reading')
    const highPriority = papers.filter((p) => p.priority === 'high')
    const totalTime = papers.reduce((sum, p) => sum + (p.readingTime || 0), 0)

    // Calculate streak from reading activity
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    let currentStreak = 0
    for (let i = 0; i < 365; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().slice(0, 10)
      const hasActivity = papers.some((p) => {
        const readDate = p.dateRead ? new Date(p.dateRead) : null
        return (readDate && readDate.toISOString().slice(0, 10) === dateStr) ||
               (p.status === 'reading' && new Date(p.dateAdded).toISOString().slice(0, 10) === dateStr)
      })
      if (hasActivity) {
        currentStreak++
      } else if (i > 0) {
        break
      }
    }

    // Define all achievements
    const achievements = [
      // Reading count achievements
      { id: 'first-paper', icon: '📖', title: '初出茅庐', desc: '阅读第一篇论文', category: 'reading', unlocked: readPapers.length >= 1, progress: Math.min(readPapers.length, 1), target: 1, color: 'emerald' },
      { id: 'five-papers', icon: '📚', title: '渐入佳境', desc: '阅读 5 篇论文', category: 'reading', unlocked: readPapers.length >= 5, progress: Math.min(readPapers.length, 5), target: 5, color: 'blue' },
      { id: 'ten-papers', icon: '🎓', title: '学富五车', desc: '阅读 10 篇论文', category: 'reading', unlocked: readPapers.length >= 10, progress: Math.min(readPapers.length, 10), target: 10, color: 'purple' },
      { id: 'twenty-papers', icon: '🏆', title: '论文大师', desc: '阅读 20 篇论文', category: 'reading', unlocked: readPapers.length >= 20, progress: Math.min(readPapers.length, 20), target: 20, color: 'amber' },

      // Streak achievements
      { id: 'streak-3', icon: '🔥', title: '三日打鱼', desc: '连续阅读 3 天', category: 'streak', unlocked: currentStreak >= 3, progress: Math.min(currentStreak, 3), target: 3, color: 'orange' },
      { id: 'streak-7', icon: '⚡', title: '一周不辍', desc: '连续阅读 7 天', category: 'streak', unlocked: currentStreak >= 7, progress: Math.min(currentStreak, 7), target: 7, color: 'red' },
      { id: 'streak-30', icon: '💎', title: '月度坚持', desc: '连续阅读 30 天', category: 'streak', unlocked: currentStreak >= 30, progress: Math.min(currentStreak, 30), target: 30, color: 'pink' },

      // Time achievements
      { id: 'time-1h', icon: '⏰', title: '一小时读者', desc: '累计阅读 1 小时', category: 'time', unlocked: totalTime >= 3600, progress: Math.min(totalTime, 3600), target: 3600, color: 'cyan' },
      { id: 'time-10h', icon: '🕰️', title: '专注学者', desc: '累计阅读 10 小时', category: 'time', unlocked: totalTime >= 36000, progress: Math.min(totalTime, 36000), target: 36000, color: 'indigo' },

      // Notes achievements
      { id: 'first-note', icon: '✍️', title: '笔记新手', desc: '创建第一篇笔记', category: 'notes', unlocked: notes >= 1, progress: Math.min(notes, 1), target: 1, color: 'emerald' },
      { id: 'ten-notes', icon: '📝', title: '笔记达人', desc: '创建 10 篇笔记', category: 'notes', unlocked: notes >= 10, progress: Math.min(notes, 10), target: 10, color: 'blue' },

      // Research achievements
      { id: 'first-topic', icon: '🎯', title: '选题起步', desc: '评估第一个课题', category: 'research', unlocked: topics >= 1, progress: Math.min(topics, 1), target: 1, color: 'amber' },
      { id: 'first-experiment', icon: '🔬', title: '实验开始', desc: '创建第一个实验', category: 'research', unlocked: experiments >= 1, progress: Math.min(experiments, 1), target: 1, color: 'purple' },
      { id: 'three-experiments', icon: '🧪', title: '实验丰富', desc: '创建 3 个实验', category: 'research', unlocked: experiments >= 3, progress: Math.min(experiments, 3), target: 3, color: 'pink' },

      // Collection achievements
      { id: 'high-priority-5', icon: '⭐', title: '精选收藏', desc: '收藏 5 篇高优先级论文', category: 'collection', unlocked: highPriority.length >= 5, progress: Math.min(highPriority.length, 5), target: 5, color: 'amber' },
      { id: 'library-20', icon: '📋', title: '文献库建设', desc: '论文库达到 20 篇', category: 'collection', unlocked: papers.length >= 20, progress: Math.min(papers.length, 20), target: 20, color: 'emerald' },
    ]

    const unlockedCount = achievements.filter((a) => a.unlocked).length
    const categories = ['reading', 'streak', 'time', 'notes', 'research', 'collection']

    return NextResponse.json({
      achievements,
      stats: {
        unlocked: unlockedCount,
        total: achievements.length,
        currentStreak,
        totalRead: readPapers.length,
        totalTime,
        totalNotes: notes,
        totalExperiments: experiments,
        totalTopics: topics,
      },
      categories,
    })
  } catch (e) {
    console.error('Achievements error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
