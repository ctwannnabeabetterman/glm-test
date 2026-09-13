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
import { Download, FileText, FileCode, ChevronDown, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { downloadFromApi } from '@/lib/download'

interface Note {
  id: string
  title: string
}

interface NotesExportProps {
  note: Note
  compact?: boolean
}

export function NotesExport({ note, compact }: NotesExportProps) {
  const exportViaApi = async (format: 'md' | 'pdf' | 'xlsx') => {
    try {
      const url = format === 'xlsx'
        ? `/api/notes/export/xlsx?category=literature`
        : `/api/notes/export/${note.id}?format=${format}`
      const fallback = format === 'xlsx' ? '文献阅读笔记.xlsx' : `${note.title}.${format}`
      if (!await downloadFromApi(url, fallback)) return
      toast.success(format === 'pdf' ? '已导出 PDF' : format === 'xlsx' ? '已导出 Excel' : '已导出 Markdown')
    } catch {
      toast.error('导出失败：请检查是否已打开一篇笔记')
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={compact ? 'outline' : 'ghost'} className="h-7 text-xs">
          <Download className="h-3 w-3 mr-1" />
          导出
          <ChevronDown className="h-3 w-3 ml-0.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>导出这一篇笔记</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void exportViaApi('md')}>
          <FileCode className="h-3.5 w-3.5 mr-2 text-primary" />
          <div>
            <div className="text-xs font-medium">Markdown (.md)</div>
            <div className="text-[9px] text-muted-foreground">Obsidian 可直接打开</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportViaApi('pdf')}>
          <FileText className="h-3.5 w-3.5 mr-2 text-rose-600" />
          <div>
            <div className="text-xs font-medium">PDF (.pdf)</div>
            <div className="text-[9px] text-muted-foreground">含阅读思考模板字段</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void exportViaApi('xlsx')}>
          <FileSpreadsheet className="h-3.5 w-3.5 mr-2 text-emerald-600" />
          <div>
            <div className="text-xs font-medium">Excel 列表 (.xlsx)</div>
            <div className="text-[9px] text-muted-foreground">全部文献笔记的作者/题目/期刊</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
