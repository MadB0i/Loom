import { useEffect, useRef, useState } from 'react'
import type { Note } from '../crdt/note'
import { YTextArea } from './YTextArea'

type SaveStatus = 'saving' | 'saved'

interface NoteEditorProps {
  note: Note
  onEdited?: (meta: { title: string; snippet: string }) => void
}

export function NoteEditor({ note, onEdited }: NoteEditorProps) {
  const [loaded, setLoaded] = useState(() => note.persistence.synced)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('saved')
  const debounceTimer = useRef<number | null>(null)

  useEffect(() => {
    const onSynced = () => setLoaded(true)
    note.persistence.on('synced', onSynced)
    return () => {
      note.persistence.off('synced', onSynced)
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
    }
  }, [note])

  const handleEdit = () => {
    setSaveStatus('saving')
    if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
    debounceTimer.current = window.setTimeout(() => {
      setSaveStatus('saved')
      onEdited?.({
        title: note.title.toString(),
        snippet: note.content.toString().replace(/\s+/g, ' ').trim().slice(0, 60),
      })
    }, 500)
  }

  if (!loaded) {
    return <div className="loading">Loading note&hellip;</div>
  }

  return (
    <main className="note" onInput={handleEdit}>
      <header className="note-header">
        <YTextArea
          ytext={note.title}
          className="note-title"
          placeholder="Untitled"
          rows={1}
        />
        <span className={`save-status save-status--${saveStatus}`}>
          {saveStatus === 'saving' ? 'Saving…' : 'Saved ✓'}
        </span>
      </header>
      <YTextArea
        ytext={note.content}
        className="note-content"
        placeholder="Start writing…"
        rows={16}
      />
    </main>
  )
}