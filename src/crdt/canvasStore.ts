import * as Y from 'yjs'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'
import { Canvas } from './canvas'

export const CANVAS_INDEX_DB = 'loom-canvases-index'
export const CANVAS_INDEX_ROOM = 'loom-canvases-index'

export interface CanvasMeta {
  title: string
  snippet: string
  createdAt: number
  updatedAt: number
}

export interface CanvasSummary extends CanvasMeta {
  id: string
}

export class CanvasStore {
  readonly doc: Y.Doc
  readonly meta: Y.Map<CanvasMeta>
  readonly persistence: IndexeddbPersistence
  readonly sync: WebrtcProvider

  private readonly listeners = new Set<() => void>()
  private readonly loadedCanvases = new Map<string, Canvas>()
  private snapshot: CanvasSummary[] = []
  private destroyed = false

  constructor() {
    this.doc = new Y.Doc()
    this.meta = this.doc.getMap<CanvasMeta>('canvases')
    this.persistence = new IndexeddbPersistence(CANVAS_INDEX_DB, this.doc)
    this.sync = new WebrtcProvider(CANVAS_INDEX_ROOM, this.doc)
    this.meta.observe(this.handleMetaChange)
    this.persistence.on('synced', () => this.refreshSnapshot())
    this.refreshSnapshot()
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

  getSnapshot(): CanvasSummary[] {
    return this.snapshot
  }

  createCanvas(): string {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.meta.set(id, { title: '', snippet: '', createdAt: now, updatedAt: now })
    return id
  }

  getCanvas(id: string): Canvas {
    let canvas = this.loadedCanvases.get(id)
    if (!canvas) {
      canvas = new Canvas(id)
      this.loadedCanvases.set(id, canvas)
    }
    return canvas
  }

  updateMeta(id: string, patch: Pick<CanvasMeta, 'title' | 'snippet'>): void {
    const current = this.meta.get(id)
    if (!current) return
    this.meta.set(id, { ...current, ...patch, updatedAt: Date.now() })
  }

  deleteCanvas(id: string): void {
    if (!this.meta.has(id)) return
    this.meta.delete(id)
    this.unloadCanvas(id)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.meta.unobserve(this.handleMetaChange)
    this.sync.destroy()
    this.persistence.destroy()
    for (const canvas of this.loadedCanvases.values()) canvas.destroy()
    this.loadedCanvases.clear()
    this.doc.destroy()
  }

  private readonly handleMetaChange = (): void => {
    for (const [id, canvas] of this.loadedCanvases) {
      if (!this.meta.has(id)) {
        this.loadedCanvases.delete(id)
        canvas.destroy()
        void clearDocument(id)
      }
    }
    this.refreshSnapshot()
  }

  private refreshSnapshot(): void {
    this.snapshot = Array.from(this.meta.entries())
      .map(([id, meta]) => ({ id, ...meta }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    for (const listener of this.listeners) listener()
  }

  private unloadCanvas(id: string): void {
    const canvas = this.loadedCanvases.get(id)
    if (canvas) {
      this.loadedCanvases.delete(id)
      canvas.destroy()
    }
    void clearDocument(id)
  }
}