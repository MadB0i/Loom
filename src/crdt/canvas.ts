import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'

export type ElementType = 'text'

export interface ElementData {
  id: string
  type: ElementType
  x: number
  y: number
  content: string
}

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

  addElement(data: Omit<ElementData, 'id'>): string {
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

  updateElement(id: string, patch: Partial<Pick<ElementData, 'x' | 'y' | 'content'>>): void {
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
    this.snapshot = this.elements.toArray().map((el) => ({
      id: el.get('id') as string,
      type: el.get('type') as ElementType,
      x: el.get('x') as number,
      y: el.get('y') as number,
      content: el.get('content') as string,
    }))
    for (const listener of this.listeners) listener()
  }
}