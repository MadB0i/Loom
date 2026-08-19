import type { NoteSummary } from '../crdt/notesStore'

interface SidebarProps {
  notes: NoteSummary[]
  activeId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

function formatRelative(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(timestamp).toLocaleDateString()
}

export function Sidebar({ notes, activeId, onSelect, onCreate, onDelete }: SidebarProps) {
  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <h1>Loom</h1>
        <button type="button" className="new-note" onClick={onCreate}>
          + New note
        </button>
      </header>
      <ul className="note-list">
        {notes.length === 0 && <li className="note-list-empty">No notes yet</li>}
        {notes.map((note) => (
          <li key={note.id} className="note-item-wrap">
            <button
              type="button"
              className={`note-item${note.id === activeId ? ' note-item--active' : ''}`}
              onClick={() => onSelect(note.id)}
            >
              <span className="note-item-title">{note.title || 'Untitled'}</span>
              <span className="note-item-snippet">{note.snippet}</span>
              <span className="note-item-time">{formatRelative(note.updatedAt)}</span>
            </button>
            <button
              type="button"
              className="note-item-delete"
              aria-label="Delete note"
              onClick={() => onDelete(note.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}