'use client'

import { useFetch } from '@/lib/hooks'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Lightbulb, TrendingUp, Tag, User, BookOpen, ArrowRight, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/lib/store'

interface Recommendation {
  id: string
  title: string
  authors: string
  venue: string
  year: number
  tags: string
  priority: string
  relevance: number
  novelty: number
  score: number
  reasons: string[]
}
interface RecommendationData {
  recommendations: Recommendation[]
  readingProfile: {
    topTags: Array<{ tag: string; count: number }>
    topCategories: Array<{ cat: string; count: number }>
    topAuthors: Array<{ author: string; count: number }>
    totalRead: number
    totalPapers: number
  }
  keywordSuggestions: Array<{ scenario: string; method: string; problem: string }>
}

export function PaperRecommendations() {
  const { data, loading } = useFetch<RecommendationData>('/api/recommendations')
  const setSection = useAppStore((s) => s.setSection)

  if (loading || !data) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          生成推荐中...
        </CardContent>
      </Card>
    )
  }

  const { recommendations, readingProfile, keywordSuggestions } = data

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-500" />
              个性化推荐
            </CardTitle>
            <CardDescription className="text-xs">
              基于你的阅读历史和标签偏好 · 智能推荐论文
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px]">
            <Sparkles className="h-2.5 w-2.5 mr-0.5" />
            {recommendations.length} 篇推荐
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Reading profile */}
        {readingProfile.totalRead > 0 && (
          <div className="rounded-md bg-muted/30 p-3">
            <div className="text-[11px] font-medium text-muted-foreground mb-2 flex items-center gap-1.5">
              <TrendingUp className="h-3 w-3" />
              你的阅读画像
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {readingProfile.topTags.length > 0 && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                    <Tag className="h-2.5 w-2.5" /> 热门标签
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {readingProfile.topTags.map((t) => (
                      <Badge key={t.tag} variant="secondary" className="text-[9px] bg-primary/10 text-primary">
                        {t.tag} ({t.count})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {readingProfile.topCategories.length > 0 && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                    <BookOpen className="h-2.5 w-2.5" /> 常读分类
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {readingProfile.topCategories.map((c) => (
                      <Badge key={c.cat} variant="secondary" className="text-[9px] bg-emerald-500/10 text-emerald-600">
                        {c.cat} ({c.count})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {readingProfile.topAuthors.length > 0 && (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1 flex items-center gap-1">
                    <User className="h-2.5 w-2.5" /> 关注作者
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {readingProfile.topAuthors.map((a) => (
                      <Badge key={a.author} variant="secondary" className="text-[9px] bg-blue-500/10 text-blue-600">
                        {a.author} ({a.count})
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Recommended papers */}
        {recommendations.length > 0 ? (
          <div className="space-y-2">
            <div className="text-[11px] font-medium text-muted-foreground flex items-center gap-1.5">
              <Lightbulb className="h-3 w-3 text-amber-500" />
              推荐你接下来读这些论文
            </div>
            {recommendations.map((r, i) => (
              <div
                key={r.id}
                className="group rounded-md border border-border p-2.5 hover:border-primary/40 transition-all cursor-pointer"
                onClick={() => setSection('papers')}
              >
                <div className="flex items-start gap-2">
                  <div className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold',
                    i === 0 ? 'bg-amber-500 text-white' : i === 1 ? 'bg-slate-400 text-white' : i === 2 ? 'bg-orange-700 text-white' : 'bg-muted text-muted-foreground'
                  )}>
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium leading-snug line-clamp-2">{r.title}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {r.authors} · {r.venue} · {r.year}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {r.reasons.map((reason, idx) => (
                        <Badge key={idx} variant="outline" className="text-[9px] bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/20">
                          {reason}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-col items-end shrink-0">
                    <Badge variant="secondary" className="text-[9px] bg-primary/15 text-primary font-bold">
                      {r.score}
                    </Badge>
                    <ArrowRight className="h-3 w-3 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all mt-1" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-xs text-muted-foreground">
            <Lightbulb className="h-8 w-8 mx-auto mb-2 opacity-30" />
            {readingProfile.totalRead === 0
              ? '先阅读一些论文，我们将为你生成个性化推荐'
              : '暂无匹配的推荐论文'}
          </div>
        )}

        {/* Keyword suggestions */}
        {keywordSuggestions.length > 0 && (
          <div className="rounded-md bg-blue-500/5 border border-blue-500/20 p-2.5">
            <div className="text-[11px] font-medium text-blue-700 dark:text-blue-400 mb-1.5 flex items-center gap-1">
              <Sparkles className="h-3 w-3" />
              基于你的兴趣，建议探索这些关键词组合
            </div>
            <div className="space-y-1">
              {keywordSuggestions.map((k, i) => (
                <button
                  key={i}
                  onClick={() => setSection('search')}
                  className="block w-full text-left rounded bg-background/60 p-1.5 text-[10px] hover:bg-background transition-colors group"
                >
                  <span className="text-emerald-600">{k.scenario}</span>
                  <span className="text-muted-foreground mx-1">×</span>
                  <span className="text-amber-600">{k.method}</span>
                  <span className="text-muted-foreground mx-1">×</span>
                  <span className="text-red-600">{k.problem}</span>
                  <ArrowRight className="h-2.5 w-2.5 inline ml-2 text-muted-foreground/40 group-hover:text-primary transition-colors" />
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
