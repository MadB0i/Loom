import { useEffect, useState } from 'react'
import { Hand, Image as ImageIcon, MessageSquare, PenLine, Plus } from 'lucide-react'
import { useTransformContext } from 'react-zoom-pan-pinch'
import { motion } from 'framer-motion'
import type { Tool } from './CanvasEditor'

const STROKE_COLORS = ['#7c5cff', '#34d399', '#fbbf24', '#fb7185']

const PLACEHOLDER_TOOLS = [
  { id: 'chat', label: 'Chat — coming in Phase 7', icon: MessageSquare },
]

interface ToolbarProps {
  tool: Tool
  color: string
  onToolChange: (tool: Tool) => void
  onColorChange: (color: string) => void
  onAddText: (x: number, y: number) => void
  onAddImage: () => void
}

export function Toolbar({
  tool,
  color,
  onToolChange,
  onColorChange,
  onAddText,
  onAddImage,
}: ToolbarProps) {
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
        <div className="flex items-center gap-0.5 rounded-lg bg-black/20 p-0.5" role="group" aria-label="Tools">
          <button
            type="button"
            onClick={() => onToolChange('pan')}
            title="Pan (move canvas)"
            aria-label="Pan tool"
            aria-pressed={tool === 'pan'}
            className={`rounded-md p-2 transition ${
              tool === 'pan'
                ? 'bg-accent text-white shadow-md'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
            }`}
          >
            <Hand size={16} />
          </button>
          <button
            type="button"
            onClick={() => onToolChange('draw')}
            title="Draw freehand"
            aria-label="Draw tool"
            aria-pressed={tool === 'draw'}
            className={`rounded-md p-2 transition ${
              tool === 'draw'
                ? 'bg-accent text-white shadow-md'
                : 'text-text-muted hover:bg-white/5 hover:text-text'
            }`}
          >
            <PenLine size={16} />
          </button>
        </div>
        <div className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />
        {tool === 'draw' && (
          <motion.div
            className="flex items-center gap-1.5 px-1.5"
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.15 }}
            role="group"
            aria-label="Stroke color"
          >
            {STROKE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => onColorChange(c)}
                aria-label={`Color ${c}`}
                aria-pressed={color === c}
                className={`h-4 w-4 rounded-full transition active:scale-90 ${
                  color === c
                    ? 'ring-2 ring-white/60 ring-offset-1 ring-offset-black'
                    : 'hover:scale-110'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </motion.div>
        )}
        <button
          type="button"
          onClick={onAddImage}
          title="Add image (Ctrl+V or drag-and-drop an image file also work)"
          aria-label="Add image"
          className="rounded-lg p-2 text-text-muted transition hover:bg-white/5 hover:text-text"
        >
          <ImageIcon size={16} />
        </button>
        <button
          type="button"
          onClick={handleAddText}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition hover:brightness-110 active:scale-[0.97]"
        >
          <Plus size={14} strokeWidth={2.5} />
          Add Text Block
        </button>
        <div className="mx-1 h-5 w-px bg-white/10" aria-hidden="true" />
        {PLACEHOLDER_TOOLS.map((placeholder) => (
          <button
            key={placeholder.id}
            type="button"
            disabled
            title={placeholder.label}
            aria-label={placeholder.label}
            className="cursor-not-allowed rounded-lg p-2 text-text-faint transition hover:bg-white/5 hover:text-text-muted"
          >
            <placeholder.icon size={16} />
          </button>
        ))}
        <span className="min-w-10 text-center text-[11px] tabular-nums text-text-muted">
          {zoom}%
        </span>
      </div>
    </motion.div>
  )
}