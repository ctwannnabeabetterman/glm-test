'use client'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { Download, FileText, FileCode, ChevronDown, FileJson } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Note {
  id: string
  title: string
  content: string
  tags: string
  category: string
  updatedAt: string
}

interface NotesExportProps {
  note: Note
}

export function NotesExport({ note }: NotesExportProps) {
  const exportMarkdown = () => {
    const tags = note.tags ? note.tags.split(',').map((t) => `#${t.trim()}`).join(' ') : ''
    const md = `---
title: "${note.title}"
date: ${new Date(note.updatedAt).toISOString()}
category: ${note.category}
tags: [${note.tags || ''}]
---

# ${note.title}

${note.content}

${tags ? `\n---\n*Tags: ${tags}*` : ''}
`
    downloadFile(md, `${sanitizeFilename(note.title)}.md`, 'text/markdown')
    toast.success('已导出为 Markdown 文件')
  }

  const exportPlainText = () => {
    const text = `${note.title}\n${'='.repeat(note.title.length)}\n\n${note.content}\n`
    downloadFile(text, `${sanitizeFilename(note.title)}.txt`, 'text/plain')
    toast.success('已导出为纯文本文件')
  }

  const exportJSON = () => {
    const json = JSON.stringify(note, null, 2)
    downloadFile(json, `${sanitizeFilename(note.title)}.json`, 'application/json')
    toast.success('已导出为 JSON 文件')
  }

  const downloadFile = (content: string, filename: string, mimeType: string) => {
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  const sanitizeFilename = (name: string) => {
    return name.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, '_').slice(0, 50)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 text-xs">
          <Download className="h-3 w-3 mr-1" />
          导出
          <ChevronDown className="h-3 w-3 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>选择导出格式</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={exportMarkdown}>
          <FileCode className="h-3.5 w-3.5 mr-2 text-primary" />
          <div>
            <div className="text-xs font-medium">Markdown (.md)</div>
            <div className="text-[9px] text-muted-foreground">含 YAML front matter</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportPlainText}>
          <FileText className="h-3.5 w-3.5 mr-2 text-muted-foreground" />
          <div>
            <div className="text-xs font-medium">纯文本 (.txt)</div>
            <div className="text-[9px] text-muted-foreground">仅标题和内容</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={exportJSON}>
          <FileJson className="h-3.5 w-3.5 mr-2 text-amber-600" />
          <div>
            <div className="text-xs font-medium">JSON (.json)</div>
            <div className="text-[9px] text-muted-foreground">完整数据结构</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
