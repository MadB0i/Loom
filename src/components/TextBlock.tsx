import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useTransformContext } from 'react-zoom-pan-pinch'
import type { Canvas, TextElementData } from '../crdt/canvas'
import type { Tool } from './CanvasEditor'

interface TextBlockProps {
  canvas: Canvas
  element: TextElementData
  editing: boolean
  tool: Tool
  onRequestEdit: (id: string) => void
  onStopEdit: () => void
}

interface DragState {
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

export function TextBlock({
  canvas,
  element,
  editing,
  tool,
  onRequestEdit,
  onStopEdit,
}: TextBlockProps) {
  const transform = useTransformContext()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const dragRef = useRef<DragState | null>(null)

  useEffect(() => {
    if (editing) textareaRef.current?.focus()
  }, [editing])

  const handlePointerDown = (event: React.PointerEvent) => {
    if (editing || tool === 'draw') return
    event.stopPropagation()
    event.preventDefault()
    dragRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: element.x,
      startY: element.y,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag || event.pointerId !== drag.pointerId) return
    const scale = transform.state.scale
    canvas.updateElement(element.id, {
      x: drag.startX + (event.clientX - drag.startClientX) / scale,
      y: drag.startY + (event.clientY - drag.startClientY) / scale,
    })
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const handleDoubleClick = (event: React.MouseEvent) => {
    event.stopPropagation()
    onRequestEdit(element.id)
  }

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation()
    canvas.deleteElement(element.id)
  }

  return (
    <div
      className={`group absolute left-0 top-0 select-none ${
        editing ? 'cursor-text' : tool === 'draw' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{ transform: `translate(${element.x}px, ${element.y}px)` }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      <div
        className={`min-w-[180px] max-w-[300px] rounded-lg border px-3.5 py-2.5 transition-colors duration-150 ${
          editing
            ? 'border-accent/50 bg-surface/95 shadow-lg shadow-black/40'
            : 'border-transparent bg-transparent hover:border-border hover:bg-surface/80'
        }`}
      >
        {editing ? (
          <textarea
            ref={textareaRef}
            value={element.content}
            rows={1}
            className="block w-full resize-none select-text bg-transparent text-sm leading-relaxed text-text outline-none"
            placeholder="Write something…"
            onChange={(event) => canvas.updateElement(element.id, { content: event.target.value })}
            onBlur={onStopEdit}
            onKeyDown={(event) => {
              if (event.key === 'Escape') onStopEdit()
            }}
          />
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-text">
            {element.content || (
              <span className="italic text-text-faint">Double-click to edit</span>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Delete element"
        className="absolute -right-2 -top-2 rounded-full border border-border bg-surface-2 p-1 text-text-faint opacity-0 shadow-md transition-opacity duration-150 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={handleDelete}
      >
        <X size={12} />
      </button>
    </div>
  )
}