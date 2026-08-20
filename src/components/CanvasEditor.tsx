import { useEffect, useRef, useState } from 'react'
import { TransformComponent, TransformWrapper, useTransformContext } from 'react-zoom-pan-pinch'
import { motion } from 'framer-motion'
import type { Canvas, ElementData } from '../crdt/canvas'
import { ConnectionStatus } from './ConnectionStatus'
import { TextBlock } from './TextBlock'
import { Toolbar } from './Toolbar'
import { useCanvasElements } from '../hooks/useCanvasElements'

const GRID_SIZE = 24

interface CanvasEditorProps {
  canvas: Canvas
  onEdited?: (meta: { title: string; snippet: string }) => void
}

function CanvasSurface({
  canvas,
  elements,
  editingId,
  onRequestEdit,
  onStopEdit,
}: {
  canvas: Canvas
  elements: ElementData[]
  editingId: string | null
  onRequestEdit: (id: string) => void
  onStopEdit: () => void
}) {
  const transform = useTransformContext()
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    return transform.onTransform(({ positionX, positionY }) => {
      if (gridRef.current) {
        gridRef.current.style.backgroundPosition = `${positionX}px ${positionY}px`
      }
    })
  }, [transform])

  const handleDoubleClick = (event: React.MouseEvent) => {
    const { scale, positionX, positionY } = transform.state
    const x = (event.clientX - positionX) / scale
    const y = (event.clientY - positionY) / scale
    onRequestEdit(canvas.addElement({ type: 'text', x, y, content: '' }))
  }

  return (
    <TransformComponent
      wrapperStyle={{ width: '100%', height: '100%' }}
      contentStyle={{ width: '100%', height: '100%' }}
      contentProps={{ onDoubleClick: handleDoubleClick }}
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
      {elements.map((element) => (
        <TextBlock
          key={element.id}
          canvas={canvas}
          element={element}
          editing={editingId === element.id}
          onRequestEdit={onRequestEdit}
          onStopEdit={onStopEdit}
        />
      ))}
    </TransformComponent>
  )
}

export function CanvasEditor({ canvas, onEdited }: CanvasEditorProps) {
  const elements = useCanvasElements(canvas)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const schedule = () => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        const list = canvas.getSnapshot()
        const first = list[0]
        onEdited?.({
          title: first ? first.content.split('\n')[0].slice(0, 60) : '',
          snippet: `${list.length} ${list.length === 1 ? 'element' : 'elements'}`,
        })
      }, 400)
    }
    return canvas.subscribe(schedule)
  }, [canvas, onEdited])

  const handleAddText = (x: number, y: number) => {
    setEditingId(canvas.addElement({ type: 'text', x, y, content: '' }))
  }

  return (
    <motion.div
      className="relative h-full w-full overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <TransformWrapper
        initialScale={1}
        minScale={0.1}
        maxScale={4}
        centerOnInit
        limitToBounds={false}
        doubleClick={{ disabled: true }}
        panning={{ allowLeftClickPan: true }}
        wheel={{ step: 0.12 }}
      >
        <CanvasSurface
          canvas={canvas}
          elements={elements}
          editingId={editingId}
          onRequestEdit={setEditingId}
          onStopEdit={() => setEditingId(null)}
        />
        <Toolbar onAddText={handleAddText} />
      </TransformWrapper>
      <ConnectionStatus sync={canvas.sync} />
    </motion.div>
  )
}