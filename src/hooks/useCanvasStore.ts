import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Canvas } from '../crdt/canvas'
import { CanvasStore, type CanvasSummary } from '../crdt/canvasStore'

const EMPTY: CanvasSummary[] = []

export interface CanvasStoreApi {
  synced: boolean
  canvases: CanvasSummary[]
  activeId: string | null
  activeCanvas: Canvas | null
  select: (id: string) => void
  createCanvas: () => void
  deleteCanvas: (id: string) => void
  updateMeta: (id: string, meta: { title: string; snippet: string }) => void
}

export function useCanvasStore(store: CanvasStore | null): CanvasStoreApi {
  const canvases = useSyncExternalStore(
    (onChange) => (store ? store.subscribe(onChange) : () => {}),
    () => (store ? store.getSnapshot() : EMPTY),
  )

  const [synced, setSynced] = useState(() => store?.synced ?? false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    if (!store) return
    return store.subscribe(() => setSynced(store.synced))
  }, [store])

  const activeId = selectedId ?? canvases[0]?.id ?? null
  const activeCanvas = activeId ? (store?.getCanvas(activeId) ?? null) : null

  const select = (id: string) => setSelectedId(id)

  const createCanvas = () => {
    if (!store) return
    const id = store.createCanvas()
    setSelectedId(id)
  }

  const deleteCanvas = (id: string) => {
    if (!store) return
    if (!window.confirm('Delete this canvas?')) return
    if (selectedIdRef.current === id) setSelectedId(null)
    store.deleteCanvas(id)
  }

  const updateMeta = (id: string, meta: { title: string; snippet: string }) => {
    store?.updateMeta(id, meta)
  }

  return {
    synced,
    canvases,
    activeId,
    activeCanvas,
    select,
    createCanvas,
    deleteCanvas,
    updateMeta,
  }
}