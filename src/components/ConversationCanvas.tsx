import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { TransformComponent, TransformWrapper, useTransformContext } from 'react-zoom-pan-pinch'
import { motion } from 'framer-motion'
import type {
  Conversation,
  ElementData,
  ImageElementData,
  StrokePoint,
  TextElementData,
} from '../crdt/conversation'
import { imageStore } from '../crdt/imageStore'
import { CanvasToolbar } from './CanvasToolbar'
import { ImageBlock } from './ImageBlock'
import { TextBlock } from './TextBlock'

export type Tool = 'pan' | 'draw'

export const DEFAULT_STROKE_COLOR = '#7c5cff'
export const STROKE_WIDTH = 2.5
export const MIN_POINT_DISTANCE = 3
export const MAX_IMAGE_SIDE = 400

const GRID_SIZE = 24

function isTextElement(element: ElementData): element is TextElementData {
  return element.type === 'text'
}

function isImageElement(element: ElementData): element is ImageElementData {
  return element.type === 'image'
}

function buildPath(points: StrokePoint[]): string {
  if (points.length === 0) return ''
  let d = `M ${points[0].x} ${points[0].y}`
  for (let i = 1; i < points.length; i++) {
    d += ` L ${points[i].x} ${points[i].y}`
  }
  return d
}

async function readImageSize(file: File): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(file)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return size
  } catch {
    return await new Promise((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve({ width: img.naturalWidth, height: img.naturalHeight })
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('Invalid image'))
      }
      img.src = url
    })
  }
}

interface DrawingState {
  id: string
  lastX: number
  lastY: number
}

function CanvasSurface({
  conversation,
  elements,
  editingId,
  tool,
  color,
  imagePick,
  onRequestEdit,
  onStopEdit,
}: {
  conversation: Conversation
  elements: ElementData[]
  editingId: string | null
  tool: Tool
  color: string
  imagePick: number
  onRequestEdit: (id: string) => void
  onStopEdit: () => void
}) {
  const transform = useTransformContext()
  const gridRef = useRef<HTMLDivElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const imageCascadeRef = useRef(0)
  const drawingRef = useRef<DrawingState | null>(null)
  const moveCountRef = useRef(0)
  const appendedCountRef = useRef(0)

  useEffect(() => {
    return transform.onTransform(({ positionX, positionY }) => {
      if (gridRef.current) {
        gridRef.current.style.backgroundPosition = `${positionX}px ${positionY}px`
      }
    })
  }, [transform])

  useEffect(() => {
    if (imagePick === 0) return
    imageInputRef.current?.click()
  }, [imagePick])

  const toWorld = (clientX: number, clientY: number): StrokePoint => {
    const { scale, positionX, positionY } = transform.state
    return { x: (clientX - positionX) / scale, y: (clientY - positionY) / scale }
  }

  const addImageFromFile = useCallback(
    async (file: File, target: StrokePoint | null) => {
      if (!file.type.startsWith('image/')) return
      const size = await readImageSize(file)
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(size.width, size.height))
      const width = Math.max(1, Math.round(size.width * scale))
      const height = Math.max(1, Math.round(size.height * scale))
      const imageId = crypto.randomUUID()
      await imageStore.put(imageId, file, file.type)
      let x: number
      let y: number
      if (target) {
        x = target.x - width / 2
        y = target.y - height / 2
      } else {
        const { scale: zoom, positionX, positionY } = transform.state
        const rect = transform.wrapperComponent?.getBoundingClientRect()
        const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2
        const centerY = rect ? rect.top + rect.height / 2 : window.innerHeight / 2
        const offset = (imageCascadeRef.current % 5) * 24
        imageCascadeRef.current++
        x = (centerX - positionX) / zoom - width / 2 + offset
        y = (centerY - positionY) / zoom - height / 2 + offset
      }
      conversation.addImageElement({ x: Math.round(x), y: Math.round(y), width, height, imageId })
    },
    [conversation, transform],
  )

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
        entry.type.startsWith('image/'),
      )
      const file = item?.getAsFile()
      if (!file) return
      event.preventDefault()
      void addImageFromFile(file, null)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImageFromFile])

  const handleImageInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) void addImageFromFile(file, null)
    event.target.value = ''
  }

  const handleDoubleClick = (event: React.MouseEvent) => {
    const { x, y } = toWorld(event.clientX, event.clientY)
    onRequestEdit(conversation.addTextElement({ x, y, content: '' }))
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file) void addImageFromFile(file, toWorld(event.clientX, event.clientY))
  }

  const handlePointerDown = (event: React.PointerEvent) => {
    if (tool !== 'draw') return
    if ((event.target as HTMLElement).tagName === 'TEXTAREA') return
    event.stopPropagation()
    const point = toWorld(event.clientX, event.clientY)
    const id = conversation.addStrokeElement(color, STROKE_WIDTH)
    conversation.appendStrokePoint(id, point)
    drawingRef.current = { id, lastX: point.x, lastY: point.y }
    moveCountRef.current = 0
    appendedCountRef.current = 1
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: React.PointerEvent) => {
    const drawing = drawingRef.current
    if (!drawing) return
    moveCountRef.current++
    const point = toWorld(event.clientX, event.clientY)
    if (Math.hypot(point.x - drawing.lastX, point.y - drawing.lastY) >= MIN_POINT_DISTANCE) {
      conversation.appendStrokePoint(drawing.id, point)
      drawing.lastX = point.x
      drawing.lastY = point.y
      appendedCountRef.current++
    }
  }

  const handlePointerUp = () => {
    if (!drawingRef.current) return
    drawingRef.current = null
    if (import.meta.env.DEV && moveCountRef.current > 0) {
      console.debug(
        `[thinning] pointer moves: ${moveCountRef.current}, points appended: ${appendedCountRef.current} (kept ${Math.round(
          (appendedCountRef.current / moveCountRef.current) * 100,
        )}%)`,
      )
    }
  }

  return (
    <TransformComponent
      wrapperStyle={{ width: '100%', height: '100%' }}
      contentStyle={{ width: '100%', height: '100%' }}
      contentProps={{
        className: tool === 'draw' ? 'cursor-crosshair' : 'cursor-default',
        onDoubleClick: handleDoubleClick,
        onDrop: handleDrop,
        onDragOver: (event) => event.preventDefault(),
        onPointerDown: handlePointerDown,
        onPointerMove: handlePointerMove,
        onPointerUp: handlePointerUp,
      }}
    >
      <div
        ref={gridRef}
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, var(--color-grid-dot) 1.2px, transparent 1.2px)',
          backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
        }}
      />
      <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
        {elements
          .filter(
            (element): element is Extract<ElementData, { type: 'stroke' }> =>
              element.type === 'stroke',
          )
          .map((element) => (
            <path
              key={element.id}
              d={buildPath(element.points)}
              fill="none"
              stroke={element.color}
              strokeWidth={element.width}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          ))}
      </svg>
      {elements.filter(isTextElement).map((element) => (
        <TextBlock
          key={element.id}
          conversation={conversation}
          element={element}
          editing={editingId === element.id}
          tool={tool}
          onRequestEdit={onRequestEdit}
          onStopEdit={onStopEdit}
        />
      ))}
      {elements.filter(isImageElement).map((element) => (
        <ImageBlock key={element.id} conversation={conversation} element={element} tool={tool} />
      ))}
      <input
        ref={imageInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageInput}
      />
    </TransformComponent>
  )
}

interface ConversationCanvasProps {
  conversation: Conversation
}

export function ConversationCanvas({ conversation }: ConversationCanvasProps) {
  const subscribe = useCallback((cb: () => void) => conversation.subscribe(cb), [conversation])
  const getSnapshot = useCallback(() => conversation.getSnapshot(), [conversation])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('pan')
  const [color, setColor] = useState(DEFAULT_STROKE_COLOR)
  const [imagePick, setImagePick] = useState(0)

  const handleAddText = (x: number, y: number) => {
    setEditingId(conversation.addTextElement({ x, y, content: '' }))
  }

  const handleAddImage = () => {
    setImagePick((pick) => pick + 1)
  }

  return (
    <motion.div
      className="relative h-full w-full overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
    >
      <TransformWrapper
        initialScale={1}
        minScale={0.1}
        maxScale={4}
        centerOnInit
        limitToBounds={false}
        doubleClick={{ disabled: true }}
        panning={{ allowLeftClickPan: tool === 'pan' }}
        wheel={{ step: 0.12 }}
      >
        <CanvasSurface
          conversation={conversation}
          elements={snapshot.elements}
          editingId={editingId}
          tool={tool}
          color={color}
          imagePick={imagePick}
          onRequestEdit={setEditingId}
          onStopEdit={() => setEditingId(null)}
        />
        <CanvasToolbar
          tool={tool}
          color={color}
          onToolChange={setTool}
          onColorChange={setColor}
          onAddText={handleAddText}
          onAddImage={handleAddImage}
        />
      </TransformWrapper>
    </motion.div>
  )
}
