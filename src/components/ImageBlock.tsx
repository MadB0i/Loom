import { useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useTransformContext } from 'react-zoom-pan-pinch'
import type { Conversation, ImageElementData } from '../crdt/conversation'
import { imageStore } from '../crdt/imageStore'
import type { Tool } from './ConversationCanvas'

const MIN_SIZE = 40

interface ImageBlockProps {
  conversation: Conversation
  element: ImageElementData
  tool: Tool
}

interface DragState {
  pointerId: number
  startClientX: number
  startClientY: number
  startX: number
  startY: number
}

interface ResizeState {
  pointerId: number
  startClientX: number
  startClientY: number
  startWidth: number
  startHeight: number
}

export function ImageBlock({ conversation, element, tool }: ImageBlockProps) {
  const transform = useTransformContext()
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const dragRef = useRef<DragState | null>(null)
  const resizeRef = useRef<ResizeState | null>(null)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const load = async () => {
      const record = await imageStore.get(element.imageId)
      if (cancelled) return
      if (record) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = URL.createObjectURL(record.blob)
        setUrl(objectUrl)
        setMissing(false)
      } else {
        setMissing(true)
      }
    }
    void load()
    const unsubscribe = imageStore.subscribe(element.imageId, () => {
      void load()
    })
    return () => {
      cancelled = true
      unsubscribe()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [element.imageId])

  const handlePointerDown = (event: React.PointerEvent) => {
    if (tool === 'draw') return
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
    conversation.updateElement(element.id, {
      x: drag.startX + (event.clientX - drag.startClientX) / scale,
      y: drag.startY + (event.clientY - drag.startClientY) / scale,
    })
  }

  const handlePointerUp = (event: React.PointerEvent) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null
  }

  const handleResizeDown = (event: React.PointerEvent) => {
    event.stopPropagation()
    event.preventDefault()
    resizeRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startWidth: element.width,
      startHeight: element.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleResizeMove = (event: React.PointerEvent) => {
    const resize = resizeRef.current
    if (!resize || event.pointerId !== resize.pointerId) return
    const scale = transform.state.scale
    const ratio = resize.startHeight / resize.startWidth
    const width = Math.max(MIN_SIZE, resize.startWidth + (event.clientX - resize.startClientX) / scale)
    conversation.updateElement(element.id, { width, height: width * ratio })
  }

  const handleResizeUp = (event: React.PointerEvent) => {
    if (resizeRef.current?.pointerId === event.pointerId) resizeRef.current = null
  }

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation()
    conversation.deleteElement(element.id)
  }

  return (
    <div
      className={`group absolute left-0 top-0 select-none ${
        tool === 'draw' ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'
      }`}
      style={{
        transform: `translate(${element.x}px, ${element.y}px)`,
        width: element.width,
        height: element.height,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {missing ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface/60">
          <Loader2 size={16} className="animate-spin text-text-faint" />
          <span className="text-[11px] text-text-faint">Fetching from peer…</span>
        </div>
      ) : (
        url && (
          <img
            src={url}
            alt=""
            draggable={false}
            className="h-full w-full rounded-lg border border-transparent transition-colors duration-150 group-hover:border-border"
          />
        )
      )}
      <button
        type="button"
        aria-label="Delete image"
        className="pointer-events-none absolute -right-2 -top-2 rounded-full border border-border bg-surface-2 p-1 text-text-faint opacity-0 shadow-md transition-opacity duration-150 hover:text-red-400 focus-visible:pointer-events-auto focus-visible:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={handleDelete}
      >
        <X size={12} />
      </button>
      <div
        role="presentation"
        aria-label="Resize image"
        className="pointer-events-none absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-border bg-surface-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100"
        onPointerDown={handleResizeDown}
        onPointerMove={handleResizeMove}
        onPointerUp={handleResizeUp}
      />
    </div>
  )
}
