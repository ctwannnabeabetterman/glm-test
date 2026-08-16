import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/notifications - get all notifications (deadline reminders, goal status, etc.)
export async function GET() {
  try {
    const notifications: Array<{
      id: string
      type: 'deadline' | 'goal' | 'streak' | 'info'
      priority: 'high' | 'medium' | 'low'
      title: string
      desc: string
      action?: string
      daysLeft?: number
    }> = []

    const now = new Date()

    // 1. Check submission deadlines (milestones with type='submission' and endDate)
    const submissions = await db.milestone.findMany({
      where: { type: 'submission' },
    })
    for (const s of submissions) {
      if (s.endDate) {
        const deadline = new Date(s.endDate)
        const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / 86400000)
        if (daysLeft >= -7 && daysLeft <= 30) {
          notifications.push({
            id: `submission-${s.id}`,
            type: 'deadline',
            priority: daysLeft < 0 ? 'high' : daysLeft <= 7 ? 'high' : daysLeft <= 14 ? 'medium' : 'low',
            title: `投稿截止: ${s.title}`,
            desc: `目标: ${s.targetVenue || '未指定'}`,
            action: '查看投稿计划',
            daysLeft,
          })
        }
      }
    }

    // 2. Check writing milestones
    const writingMilestones = await db.milestone.findMany({
      where: { type: 'writing' },
    })
    for (const w of writingMilestones) {
      if (w.endDate && w.progress < 100) {
        const deadline = new Date(w.endDate)
        const daysLeft = Math.ceil((deadline.getTime() - now.getTime()) / 86400000)
        if (daysLeft >= -7 && daysLeft <= 14) {
          notifications.push({
            id: `writing-${w.id}`,
            type: 'deadline',
            priority: daysLeft < 0 ? 'high' : daysLeft <= 3 ? 'high' : 'medium',
            title: `写作里程碑: ${w.title}`,
            desc: `进度: ${w.progress}% · ${w.targetVenue ? '目标: ' + w.targetVenue : ''}`,
            action: '查看写作时间线',
            daysLeft,
          })
        }
      }
    }

    // 3. Check reading goals
    const weekNum = getWeekNumber(now)
    const weekPeriod = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
    const monthPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    const weeklyGoal = await db.readingGoal.findUnique({ where: { type_period: { type: 'weekly', period: weekPeriod } } })
    if (weeklyGoal) {
      const weekStart = getWeekStart(now)
      const weeklyRead = await db.paper.count({
        where: { status: 'read', dateRead: { gte: weekStart } },
      })
      if (weeklyRead < weeklyGoal.target) {
        const daysLeft = 7 - ((now.getDay() + 6) % 7)
        notifications.push({
          id: 'weekly-goal',
          type: 'goal',
          priority: daysLeft <= 2 ? 'high' : 'medium',
          title: `本周阅读目标: ${weeklyRead}/${weeklyGoal.target} 篇`,
          desc: `还差 ${weeklyGoal.target - weeklyRead} 篇 · 剩余 ${daysLeft} 天`,
          action: '去阅读论文',
          daysLeft,
        })
      }
    }

    // 4. Check reading streak
    const papers = await db.paper.findMany()
    let currentStreak = 0
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    for (let i = 0; i < 365; i++) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().slice(0, 10)
      const hasActivity = papers.some((p) => {
        const readDate = p.dateRead ? new Date(p.dateRead) : null
        return (readDate && readDate.toISOString().slice(0, 10) === dateStr)
      })
      if (hasActivity) {
        currentStreak++
      } else if (i > 0) {
        break
      }
    }

    if (currentStreak === 0) {
      notifications.push({
        id: 'streak-broken',
        type: 'streak',
        priority: 'low',
        title: '阅读连续记录已中断',
        desc: '今天还没有阅读记录，保持连续阅读习惯',
        action: '开始阅读',
      })
    } else if (currentStreak >= 3) {
      notifications.push({
        id: 'streak-active',
        type: 'streak',
        priority: 'low',
        title: `🔥 连续阅读 ${currentStreak} 天`,
        desc: '保持这个节奏，继续加油！',
      })
    }

    // 5. Check for unread high-priority papers
    const highPriorityUnread = await db.paper.count({
      where: { priority: 'high', status: 'unread' },
    })
    if (highPriorityUnread > 0) {
      notifications.push({
        id: 'high-priority-unread',
        type: 'info',
        priority: 'medium',
        title: `${highPriorityUnread} 篇高优先级论文待阅读`,
        desc: '优先阅读高优先级论文',
        action: '查看论文库',
      })
    }

    // Sort by priority (high > medium > low)
    const priorityOrder = { high: 0, medium: 1, low: 2 }
    notifications.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])

    return NextResponse.json({
      notifications,
      stats: {
        total: notifications.length,
        high: notifications.filter((n) => n.priority === 'high').length,
        medium: notifications.filter((n) => n.priority === 'medium').length,
        low: notifications.filter((n) => n.priority === 'low').length,
      },
    })
  } catch (e) {
    console.error('Notifications error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getWeekStart(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (day - 1))
  return date
}
