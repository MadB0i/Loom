import { motion } from 'framer-motion'
import { FileText, Plus, Trash2 } from 'lucide-react'
import type { CanvasSummary } from '../crdt/canvasStore'

interface SidebarProps {
  canvases: CanvasSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

function formatRelative(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(timestamp).toLocaleDateString()
}

export function Sidebar({ canvases, activeId, onSelect, onCreate, onDelete }: SidebarProps) {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-surface/80 backdrop-blur-xl">
      <header className="flex items-center justify-between border-b border-border px-4 py-3.5">
        <h1 className="text-[13px] font-semibold uppercase tracking-[0.14em] text-text-muted">
          Loom
        </h1>
        <button
          type="button"
          onClick={onCreate}
          className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-text transition hover:border-accent/50 hover:text-accent"
        >
          <Plus size={13} strokeWidth={2.5} />
          New
        </button>
      </header>
      <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {canvases.length === 0 && (
          <li className="px-3 py-4 text-center text-xs text-text-faint">
            No canvases yet — create one
          </li>
        )}
        {canvases.map((canvas) => (
          <motion.li key={canvas.id} layout>
            <div
              className={`group flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 transition-colors duration-150 ${
                canvas.id === activeId
                  ? 'border-border bg-surface-2'
                  : 'border-transparent hover:bg-surface-2/70'
              }`}
              onClick={() => onSelect(canvas.id)}
            >
              <FileText
                size={14}
                className={`mt-1 shrink-0 ${canvas.id === activeId ? 'text-accent' : 'text-text-faint'}`}
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-medium leading-snug text-text">
                  {canvas.title || 'Untitled canvas'}
                </div>
                <div className="truncate text-[11px] text-text-faint">
                  {canvas.snippet} · {formatRelative(canvas.updatedAt)}
                </div>
              </div>
              <button
                type="button"
                aria-label="Delete canvas"
                className="rounded-md p-1 text-text-faint opacity-0 transition hover:bg-red-500/15 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={(event) => {
                  event.stopPropagation()
                  onDelete(canvas.id)
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </motion.li>
        ))}
      </ul>
    </aside>
  )
}