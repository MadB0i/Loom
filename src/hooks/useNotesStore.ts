import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Note } from '../crdt/note'
import { NotesStore, type NoteSummary } from '../crdt/notesStore'

const EMPTY: NoteSummary[] = []

export interface NotesStoreApi {
  synced: boolean
  notes: NoteSummary[]
  activeId: string | null
  activeNote: Note | null
  select: (id: string) => void
  createNote: () => void
  deleteNote: (id: string) => void
  updateMeta: (id: string, meta: { title: string; snippet: string }) => void
}

export function useNotesStore(store: NotesStore | null): NotesStoreApi {
  const notes = useSyncExternalStore(
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

  const activeId = selectedId ?? notes[0]?.id ?? null
  const activeNote = activeId ? (store?.getNote(activeId) ?? null) : null

  const select = (id: string) => setSelectedId(id)

  const createNote = () => {
    if (!store) return
    const id = store.createNote()
    setSelectedId(id)
  }

  const deleteNote = (id: string) => {
    if (!store) return
    if (!window.confirm('Delete this note?')) return
    if (selectedIdRef.current === id) setSelectedId(null)
    store.deleteNote(id)
  }

  const updateMeta = (id: string, meta: { title: string; snippet: string }) => {
    store?.updateMeta(id, meta)
  }

  return { synced, notes, activeId, activeNote, select, createNote, deleteNote, updateMeta }
}