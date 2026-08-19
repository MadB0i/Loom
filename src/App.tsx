import { useEffect, useState } from 'react'
import { NotesStore } from './crdt/notesStore'
import { NoteEditor } from './components/NoteEditor'
import { Sidebar } from './components/Sidebar'
import { useNotesStore } from './hooks/useNotesStore'

function Shell({ store }: { store: NotesStore }) {
  const { synced, notes, activeId, activeNote, select, createNote, deleteNote, updateMeta } =
    useNotesStore(store)

  if (!synced) {
    return <div className="loading">Loading notes&hellip;</div>
  }

  return (
    <div className="app">
      <Sidebar
        notes={notes}
        activeId={activeId}
        onSelect={select}
        onCreate={createNote}
        onDelete={deleteNote}
      />
      {activeNote ? (
        <NoteEditor
          note={activeNote}
          onEdited={(meta) => updateMeta(activeNote.id, meta)}
        />
      ) : (
        <div className="empty">Select or create a note</div>
      )}
    </div>
  )
}

function App() {
  const [store, setStore] = useState<NotesStore | null>(null)

  useEffect(() => {
    const instance = new NotesStore()
    // oxlint-disable-next-line react/set-state-in-effect -- store must be created per mount and paired with destroy(); lazy init would break under StrictMode's simulated unmount
    setStore(instance)
    return () => instance.destroy()
  }, [])

  if (!store) return null

  return <Shell store={store} />
}

export default App