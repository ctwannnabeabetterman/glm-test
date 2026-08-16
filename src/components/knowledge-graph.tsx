'use client'

import { useFetch } from '@/lib/hooks'
import { useState, useMemo, useRef } from 'react'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Network, ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface GraphNode {
  id: string
  label: string
  type: 'paper' | 'topic' | 'note'
  weight: number
  meta?: string
}
interface GraphEdge {
  source: string
  target: string
  type: string
  weight: number
}
interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
  stats: { totalNodes: number; totalEdges: number; papers: number; topics: number; notes: number }
}

const TYPE_CONFIG = {
  paper: { color: '#10b981', radius: 8, label: '论文' },
  topic: { color: '#f59e0b', radius: 12, label: '课题' },
  note: { color: '#3b82f6', radius: 7, label: '笔记' },
}

const EDGE_COLORS: Record<string, string> = {
  'topic-paper': '#f59e0b40',
  'note-paper': '#3b82f640',
  'same-category': '#10b98130',
  'shared-tag': '#8b5cf640',
}

export function KnowledgeGraph() {
  const { data: graph, loading } = useFetch<GraphData>('/api/graph')
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const svgRef = useRef<SVGSVGElement>(null)

  // Simple force-directed layout (precomputed positions using circular layout with jitter)
  const layout = useMemo(() => {
    if (!graph) return { positions: {}, width: 800, height: 500 }
    const width = 800
    const height = 500
    const cx = width / 2
    const cy = height / 2
    const positions: Record<string, { x: number; y: number }> = {}

    // Group nodes by type for layout
    const papers = graph.nodes.filter((n) => n.type === 'paper')
    const topics = graph.nodes.filter((n) => n.type === 'topic')
    const notes = graph.nodes.filter((n) => n.type === 'note')

    // Place topics in center area
    topics.forEach((n, i) => {
      const angle = (i / Math.max(topics.length, 1)) * Math.PI * 2
      const r = 80
      positions[n.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
    })

    // Place papers in outer ring
    papers.forEach((n, i) => {
      const angle = (i / Math.max(papers.length, 1)) * Math.PI * 2
      const r = 200 + (n.weight % 50)
      positions[n.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
    })

    // Place notes in far outer ring
    notes.forEach((n, i) => {
      const angle = (i / Math.max(notes.length, 1)) * Math.PI * 2 + 0.5
      const r = 300
      positions[n.id] = { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }
    })

    // Run force simulation to improve layout (synchronously in useMemo)
    const iterations = 50
    const k = 50 // ideal spring length
    for (let iter = 0; iter < iterations; iter++) {
      const displacements: Record<string, { x: number; y: number }> = {}
      graph.nodes.forEach((n) => { displacements[n.id] = { x: 0, y: 0 } })

      // Repulsive forces between all nodes
      for (let i = 0; i < graph.nodes.length; i++) {
        for (let j = i + 1; j < graph.nodes.length; j++) {
          const n1 = graph.nodes[i]
          const n2 = graph.nodes[j]
          const p1 = positions[n1.id]
          const p2 = positions[n2.id]
          const dx = p1.x - p2.x
          const dy = p1.y - p2.y
          const dist = Math.sqrt(dx * dx + dy * dy) || 1
          const force = (k * k) / dist
          displacements[n1.id].x += (dx / dist) * force * 0.1
          displacements[n1.id].y += (dy / dist) * force * 0.1
          displacements[n2.id].x -= (dx / dist) * force * 0.1
          displacements[n2.id].y -= (dy / dist) * force * 0.1
        }
      }

      // Attractive forces for edges
      graph.edges.forEach((e) => {
        const p1 = positions[e.source]
        const p2 = positions[e.target]
        if (!p1 || !p2) return
        const dx = p1.x - p2.x
        const dy = p1.y - p2.y
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const force = (dist * dist) / k
        displacements[e.source].x -= (dx / dist) * force * 0.05
        displacements[e.source].y -= (dy / dist) * force * 0.05
        displacements[e.target].x += (dx / dist) * force * 0.05
        displacements[e.target].y += (dy / dist) * force * 0.05
      })

      // Apply displacements with temperature cooling
      const temp = 30 * (1 - iter / iterations)
      Object.keys(positions).forEach((id) => {
        const d = displacements[id]
        const dist = Math.sqrt(d.x * d.x + d.y * d.y) || 1
        positions[id].x += (d.x / dist) * Math.min(dist, temp)
        positions[id].y += (d.y / dist) * Math.min(dist, temp)
        // Keep within bounds
        positions[id].x = Math.max(30, Math.min(width - 30, positions[id].x))
        positions[id].y = Math.max(30, Math.min(height - 30, positions[id].y))
      })
    }

    return { positions, width, height }
  }, [graph])

  const positions = layout.positions

  // Find connected nodes for highlighting
  const connectedNodes = useMemo(() => {
    if (!graph || !selectedNode) return new Set<string>()
    const connected = new Set<string>([selectedNode])
    graph.edges.forEach((e) => {
      if (e.source === selectedNode) connected.add(e.target)
      if (e.target === selectedNode) connected.add(e.source)
    })
    return connected
  }, [graph, selectedNode])

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y })
  }
  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y })
  }
  const handleMouseUp = () => setIsDragging(false)

  const reset = () => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    setSelectedNode(null)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          构建知识图谱中...
        </CardContent>
      </Card>
    )
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-16 text-center text-sm text-muted-foreground">
          <Network className="h-10 w-10 mx-auto mb-2 opacity-30" />
          暂无数据构建知识图谱
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <Card className="bg-blue-500/5 border-blue-500/20">
        <CardContent className="p-3 text-xs text-muted-foreground">
          🕸️ <strong className="text-blue-700 dark:text-blue-400">知识图谱</strong>
          （方法论 §2.2.3 Obsidian 双向链接）—— 可视化论文、课题、笔记之间的关联关系
        </CardContent>
      </Card>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-2">
        <StatBadge label="总节点" value={graph.stats.totalNodes} color="text-primary" />
        <StatBadge label="论文" value={graph.stats.papers} color="text-emerald-600" />
        <StatBadge label="课题" value={graph.stats.topics} color="text-amber-600" />
        <StatBadge label="笔记" value={graph.stats.notes} color="text-blue-600" />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Network className="h-4 w-4 text-primary" />
                关系网络图
              </CardTitle>
              <CardDescription className="text-xs">
                {graph.stats.totalEdges} 条关联 · 点击节点查看关联 · 拖拽平移 · 滚轮缩放
              </CardDescription>
            </div>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={() => setZoom((z) => Math.min(2.5, z + 0.2))}>
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7 w-7 p-0" onClick={reset}>
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="relative w-full overflow-hidden rounded-md border border-border bg-gradient-to-br from-background to-muted/30"
            style={{ height: 500, cursor: isDragging ? 'grabbing' : 'grab' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMidYMid meet"
              style={{ transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)` }}
            >
              {/* Edges */}
              <g>
                {graph.edges.map((e, i) => {
                  const p1 = positions[e.source]
                  const p2 = positions[e.target]
                  if (!p1 || !p2) return null
                  const isHighlighted = selectedNode && (e.source === selectedNode || e.target === selectedNode)
                  return (
                    <line
                      key={i}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke={isHighlighted ? EDGE_COLORS[e.type]?.replace('40', 'ff').replace('30', 'ff') : EDGE_COLORS[e.type] || '#99999930'}
                      strokeWidth={isHighlighted ? 2 : 1}
                      strokeDasharray={e.type === 'shared-tag' ? '4,2' : 'none'}
                    />
                  )
                })}
              </g>

              {/* Nodes */}
              <g>
                {graph.nodes.map((n) => {
                  const pos = positions[n.id]
                  if (!pos) return null
                  const config = TYPE_CONFIG[n.type]
                  const isSelected = selectedNode === n.id
                  const isHovered = hoveredNode === n.id
                  const isConnected = connectedNodes.has(n.id)
                  const isDimmed = selectedNode && !isConnected

                  return (
                    <g
                      key={n.id}
                      transform={`translate(${pos.x}, ${pos.y})`}
                      style={{ cursor: 'pointer', opacity: isDimmed ? 0.3 : 1 }}
                      onMouseEnter={() => setHoveredNode(n.id)}
                      onMouseLeave={() => setHoveredNode(null)}
                      onClick={() => setSelectedNode(isSelected ? null : n.id)}
                    >
                      {/* Glow for selected/hovered */}
                      {(isSelected || isHovered) && (
                        <circle
                          r={config.radius + 6}
                          fill={config.color}
                          opacity={0.2}
                        />
                      )}
                      <circle
                        r={config.radius}
                        fill={config.color}
                        stroke={isSelected ? '#000' : 'white'}
                        strokeWidth={isSelected ? 2 : 1.5}
                      />
                      {/* Label - show on hover or if selected */}
                      {(isHovered || isSelected || graph.nodes.length <= 8) && (
                        <text
                          y={config.radius + 12}
                          textAnchor="middle"
                          fontSize={9}
                          fill="currentColor"
                          className="fill-foreground"
                          fontWeight={isSelected ? 600 : 400}
                        >
                          {n.label.length > 25 ? n.label.slice(0, 23) + '..' : n.label}
                        </text>
                      )}
                    </g>
                  )
                })}
              </g>
            </svg>

            {/* Legend */}
            <div className="absolute bottom-2 left-2 flex flex-col gap-1 bg-background/80 backdrop-blur rounded-md border border-border p-2 text-[10px]">
              <div className="font-medium text-muted-foreground mb-0.5">图例</div>
              {(Object.keys(TYPE_CONFIG) as Array<keyof typeof TYPE_CONFIG>).map((t) => (
                <div key={t} className="flex items-center gap-1.5">
                  <div
                    className="rounded-full"
                    style={{ background: TYPE_CONFIG[t].color, width: 8, height: 8 }}
                  />
                  <span>{TYPE_CONFIG[t].label}</span>
                </div>
              ))}
            </div>

            {/* Node info tooltip */}
            {selectedNode && (() => {
              const node = graph.nodes.find((n) => n.id === selectedNode)
              if (!node) return null
              const connectedCount = graph.edges.filter((e) => e.source === selectedNode || e.target === selectedNode).length
              return (
                <div className="absolute top-2 right-2 bg-background/95 backdrop-blur rounded-md border border-border p-3 text-xs max-w-[220px] shadow-lg">
                  <div className="flex items-center gap-2 mb-1.5">
                    <div
                      className="rounded-full"
                      style={{ background: TYPE_CONFIG[node.type].color, width: 10, height: 10 }}
                    />
                    <span className="font-medium">{TYPE_CONFIG[node.type].label}</span>
                    <Badge variant="outline" className="text-[9px] ml-auto">{connectedCount} 关联</Badge>
                  </div>
                  <div className="font-medium text-xs mb-1">{node.label}</div>
                  {node.meta && <div className="text-[10px] text-muted-foreground">{node.meta}</div>}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] w-full mt-2"
                    onClick={() => setSelectedNode(null)}
                  >
                    取消选择
                  </Button>
                </div>
              )
            })()}
          </div>
        </CardContent>
      </Card>

      {/* Edge type legend */}
      <Card>
        <CardContent className="p-3">
          <div className="text-xs font-medium mb-2">关联类型说明</div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
            <EdgeLegend color="#f59e0b" label="课题→论文" desc="课题关键词匹配" />
            <EdgeLegend color="#3b82f6" label="笔记→论文" desc="笔记提及论文" />
            <EdgeLegend color="#10b981" label="同分类论文" desc="相同研究类别" />
            <EdgeLegend color="#8b5cf6" label="共享标签" desc="论文有相同标签" dashed />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function StatBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="rounded-md border border-border/60 bg-card p-2 text-center">
      <div className={cn('text-lg font-bold', color)}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function EdgeLegend({ color, label, desc, dashed }: { color: string; label: string; desc: string; dashed?: boolean }) {
  return (
    <div className="flex items-start gap-2">
      <svg width="24" height="8" className="mt-0.5 shrink-0">
        <line
          x1="0" y1="4" x2="24" y2="4"
          stroke={color}
          strokeWidth="2"
          strokeDasharray={dashed ? '4,2' : 'none'}
        />
      </svg>
      <div>
        <div className="font-medium">{label}</div>
        <div className="text-muted-foreground">{desc}</div>
      </div>
    </div>
  )
}
