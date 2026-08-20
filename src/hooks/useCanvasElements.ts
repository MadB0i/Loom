import { useSyncExternalStore } from 'react'
import type { Canvas, ElementData } from '../crdt/canvas'

export function useCanvasElements(canvas: Canvas): ElementData[] {
  return useSyncExternalStore(
    (onChange) => canvas.subscribe(onChange),
    () => canvas.getSnapshot(),
  )
}