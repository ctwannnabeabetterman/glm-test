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
import { Download, FileText, FileCode, ChevronDown, FileSpreadsheet, BookMarked, FolderSync, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { downloadFromApi } from '@/lib/download'
import { loadObsidianStatus, syncToObsidian } from '@/lib/obsidian-client'
import { useState } from 'react'

interface Note {
  id: string
  title: string
}

interface NotesExportProps {
  note: Note
  compact?: boolean
}

export function NotesExport({ note, compact }: NotesExportProps) {
  const [syncing, setSyncing] = useState<'note' | 'all' | null>(null)

  const exportViaApi = async (format: 'md' | 'pdf' | 'xlsx') => {
    try {
      const url = format === 'xlsx'
        ? `/api/notes/export/xlsx?category=literature`
        : `/api/notes/export/${note.id}?format=${format}`
      const fallback = format === 'xlsx' ? '文献阅读笔记.xlsx' : `${note.title}.${format}`
      if (!await downloadFromApi(url, fallback)) return
      toast.success(format === 'pdf' ? '已导出 PDF' : format === 'xlsx' ? '已导出 Excel' : '已导出 Markdown')

      // 「顺便」写入 Obsidian vault：vault 未配置或写入失败都不影响刚完成的下载
      if (format === 'md') {
        try {
          const cfg = await loadObsidianStatus()
          if (cfg.ready) {
            const r = await syncToObsidian('note', { id: note.id })
            if (r.writtenCount) {
              toast.success('已同步到 Obsidian vault', { description: r.dir })
            }
          }
        } catch {
          /* vault 是增强能力，静默失败 */
        }
      }
    } catch {
      toast.error('导出失败：请检查是否已打开一篇笔记')
    }
  }

  /** 写入 Obsidian vault —— 由 Obsidian 接管这些笔记，不再需要手动搬运文件 */
  const syncViaVault = async (scope: 'note' | 'all') => {
    setSyncing(scope)
    try {
      const result = await syncToObsidian(scope === 'note' ? 'note' : 'category', {
        id: note.id,
        category: 'literature',
      })
      if (result.code === 'VAULT_NOT_SET' || result.code === 'VAULT_MISSING' || result.code === 'VAULT_NOT_DIR') {
        toast.error(result.error || 'vault 未配置', { description: '到「设置 → Obsidian 笔记库」选择 vault 目录后再试' })
        return
      }
      if (!result.ok && !result.writtenCount) {
        toast.error(result.error || '写入 vault 失败')
        return
      }
      const n = result.writtenCount ?? 0
      if (result.skipped) {
        toast.warning(`已写入 ${n} 篇，跳过 ${result.skipped} 篇（文件名非法）`, {
          description: `目录：${result.dir}`,
        })
      } else {
        toast.success(scope === 'note' ? '已同步到 Obsidian' : `已同步 ${n} 篇笔记到 Obsidian`, {
          description: `目录：${result.dir}`,
        })
      }
    } catch (e) {
      toast.error('同步失败：' + (e as Error).message)
    } finally {
      setSyncing(null)
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

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[10px] text-muted-foreground">直接写入 Obsidian 笔记库</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={syncing !== null}
          onClick={() => void syncViaVault('note')}
        >
          <BookMarked className="h-3.5 w-3.5 mr-2 text-violet-600" />
          <div>
            <div className="text-xs font-medium flex items-center gap-1">
              同步这一篇到 vault
              {syncing === 'note' && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            <div className="text-[9px] text-muted-foreground">按标题命名，Obsidian 立即纳入索引</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={syncing !== null}
          onClick={() => void syncViaVault('all')}
        >
          <FolderSync className="h-3.5 w-3.5 mr-2 text-violet-600" />
          <div>
            <div className="text-xs font-medium flex items-center gap-1">
              全部文献笔记同步到 vault
              {syncing === 'all' && <Loader2 className="h-3 w-3 animate-spin" />}
            </div>
            <div className="text-[9px] text-muted-foreground">批量落盘，同名自动加后缀不覆盖</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
