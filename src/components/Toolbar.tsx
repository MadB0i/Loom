import { useEffect, useState } from 'react'
import { Image as ImageIcon, MessageSquare, PenLine, Plus } from 'lucide-react'
import { useTransformContext } from 'react-zoom-pan-pinch'
import { motion } from 'framer-motion'

const PLACEHOLDER_TOOLS = [
  { id: 'draw', label: 'Draw — coming in Phase 5', icon: PenLine },
  { id: 'image', label: 'Images — coming in Phase 6', icon: ImageIcon },
  { id: 'chat', label: 'Chat — coming in Phase 7', icon: MessageSquare },
]

interface ToolbarProps {
  onAddText: (x: number, y: number) => void
}

export function Toolbar({ onAddText }: ToolbarProps) {
  const transform = useTransformContext()
  const [zoom, setZoom] = useState(() => Math.round(transform.state.scale * 100))
  const [cascade, setCascade] = useState(0)

  useEffect(() => {
    return transform.onTransform(({ scale }) => setZoom(Math.round(scale * 100)))
  }, [transform])

  const handleAddText = () => {
    const { scale, positionX, positionY } = transform.state
    const offset = (cascade % 5) * 24
    const x = (window.innerWidth / 2 - positionX) / scale + offset
    const y = (window.innerHeight / 2 - positionY) / scale + offset
    setCascade((c) => c + 1)
    onAddText(x, y)
  }

  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 bottom-6 z-10 flex justify-center"
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.06] p-1.5 shadow-2xl shadow-black/50 backdrop-blur-xl">
        <button
          type="button"
          onClick={handleAddText}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.97]"
        >
          <Plus size={14} strokeWidth={2.5} />
          Add Text Block
        </button>
        <div className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />
        {PLACEHOLDER_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            disabled
            title={tool.label}
            aria-label={tool.label}
            className="cursor-not-allowed rounded-lg p-2 text-text-faint transition hover:bg-white/5 hover:text-text-muted"
          >
            <tool.icon size={16} />
          </button>
        ))}
        <span className="min-w-10 text-center text-[11px] tabular-nums text-text-muted">
          {zoom}%
        </span>
      </div>
    </motion.div>
  )
}