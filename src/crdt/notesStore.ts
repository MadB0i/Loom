import * as Y from 'yjs'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'
import { Note } from './note'

export const NOTES_INDEX_DB = 'loom-notes-index'
export const NOTES_INDEX_ROOM = 'loom-notes-index'

export interface NoteMeta {
  title: string
  snippet: string
  createdAt: number
  updatedAt: number
}

export interface NoteSummary extends NoteMeta {
  id: string
}

export class NotesStore {
  readonly doc: Y.Doc
  readonly meta: Y.Map<NoteMeta>
  readonly persistence: IndexeddbPersistence
  readonly sync: WebrtcProvider

  private readonly listeners = new Set<() => void>()
  private readonly loadedNotes = new Map<string, Note>()
  private snapshot: NoteSummary[] = []
  private destroyed = false

  constructor() {
    this.doc = new Y.Doc()
    this.meta = this.doc.getMap<NoteMeta>('notes')
    this.persistence = new IndexeddbPersistence(NOTES_INDEX_DB, this.doc)
    this.sync = new WebrtcProvider(NOTES_INDEX_ROOM, this.doc)
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

  getSnapshot(): NoteSummary[] {
    return this.snapshot
  }

  createNote(): string {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.meta.set(id, { title: '', snippet: '', createdAt: now, updatedAt: now })
    return id
  }

  getNote(id: string): Note {
    let note = this.loadedNotes.get(id)
    if (!note) {
      note = new Note(id)
      this.loadedNotes.set(id, note)
    }
    return note
  }

  updateMeta(id: string, patch: Pick<NoteMeta, 'title' | 'snippet'>): void {
    const current = this.meta.get(id)
    if (!current) return
    this.meta.set(id, { ...current, ...patch, updatedAt: Date.now() })
  }

  deleteNote(id: string): void {
    if (!this.meta.has(id)) return
    this.meta.delete(id)
    this.unloadNote(id)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.meta.unobserve(this.handleMetaChange)
    this.sync.destroy()
    this.persistence.destroy()
    for (const note of this.loadedNotes.values()) note.destroy()
    this.loadedNotes.clear()
    this.doc.destroy()
  }

  private readonly handleMetaChange = (): void => {
    for (const [id, note] of this.loadedNotes) {
      if (!this.meta.has(id)) {
        this.loadedNotes.delete(id)
        note.destroy()
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

  private unloadNote(id: string): void {
    const note = this.loadedNotes.get(id)
    if (note) {
      this.loadedNotes.delete(id)
      note.destroy()
    }
    void clearDocument(id)
  }
}