import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'

export interface StrokePoint {
  x: number
  y: number
}

export interface TextElementData {
  id: string
  type: 'text'
  x: number
  y: number
  content: string
}

export interface StrokeElementData {
  id: string
  type: 'stroke'
  points: StrokePoint[]
  color: string
  width: number
}

export interface ImageElementData {
  id: string
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  imageId: string
}

export type ElementData = TextElementData | StrokeElementData | ImageElementData

export class Canvas {
  readonly id: string
  readonly doc: Y.Doc
  readonly elements: Y.Array<Y.Map<unknown>>
  readonly persistence: IndexeddbPersistence
  readonly sync: WebrtcProvider

  private readonly listeners = new Set<() => void>()
  private snapshot: ElementData[] = []
  private destroyed = false

  constructor(id: string) {
    this.id = id
    this.doc = new Y.Doc()
    this.elements = this.doc.getArray<Y.Map<unknown>>('elements')
    this.persistence = new IndexeddbPersistence(id, this.doc)
    this.sync = new WebrtcProvider(id, this.doc)
    this.elements.observe(this.handleElementsChange)
    this.handleElementsChange()
  }

  get synced(): boolean {
    return this.persistence.synced
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): ElementData[] {
    return this.snapshot
  }

  addElement(data: Omit<TextElementData, 'id'>): string {
    const id = crypto.randomUUID()
    const element = new Y.Map()
    element.set('id', id)
    element.set('type', data.type)
    element.set('x', data.x)
    element.set('y', data.y)
    element.set('content', data.content)
    this.elements.push([element])
    return id
  }

  addStrokeElement(color: string, width: number): string {
    const id = crypto.randomUUID()
    const element = new Y.Map()
    element.set('id', id)
    element.set('type', 'stroke')
    element.set('color', color)
    element.set('width', width)
    element.set('points', new Y.Array())
    this.elements.push([element])
    return id
  }

  addImageElement(data: Omit<ImageElementData, 'id' | 'type'>): string {
    const id = crypto.randomUUID()
    const element = new Y.Map()
    element.set('id', id)
    element.set('type', 'image')
    element.set('x', data.x)
    element.set('y', data.y)
    element.set('width', data.width)
    element.set('height', data.height)
    element.set('imageId', data.imageId)
    this.elements.push([element])
    return id
  }

  appendStrokePoint(id: string, point: StrokePoint): void {
    const element = this.findElement(id)
    if (!element) return
    const points = element.get('points') as Y.Array<Y.Map<number>> | undefined
    if (!points) return
    const p = new Y.Map<number>()
    p.set('x', point.x)
    p.set('y', point.y)
    points.push([p])
  }

  updateElement(
    id: string,
    patch: Partial<
      Pick<TextElementData, 'x' | 'y' | 'content'> & Pick<ImageElementData, 'x' | 'y' | 'width' | 'height'>
    >,
  ): void {
    const element = this.findElement(id)
    if (!element) return
    for (const [key, value] of Object.entries(patch)) {
      element.set(key, value)
    }
  }

  deleteElement(id: string): void {
    const index = this.elements.toArray().findIndex((el) => el.get('id') === id)
    if (index !== -1) this.elements.delete(index)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.elements.unobserve(this.handleElementsChange)
    this.sync.destroy()
    this.persistence.destroy()
    this.doc.destroy()
  }

  private findElement(id: string): Y.Map<unknown> | undefined {
    return this.elements.toArray().find((el) => el.get('id') === id)
  }

  private readonly handleElementsChange = (): void => {
    this.snapshot = this.elements.toArray().map((el) => {
      const id = el.get('id') as string
      if (el.get('type') === 'text') {
        return {
          id,
          type: 'text',
          x: el.get('x') as number,
          y: el.get('y') as number,
          content: el.get('content') as string,
        } satisfies TextElementData
      }
      if (el.get('type') === 'image') {
        return {
          id,
          type: 'image',
          x: el.get('x') as number,
          y: el.get('y') as number,
          width: el.get('width') as number,
          height: el.get('height') as number,
          imageId: el.get('imageId') as string,
        } satisfies ImageElementData
      }
      return {
        id,
        type: 'stroke',
        color: el.get('color') as string,
        width: el.get('width') as number,
        points: (el.get('points') as Y.Array<Y.Map<number>> | undefined)
          ?.toArray()
          .map((p) => ({ x: p.get('x') as number, y: p.get('y') as number })) ?? [],
      } satisfies StrokeElementData
    })
    for (const listener of this.listeners) listener()
  }
}