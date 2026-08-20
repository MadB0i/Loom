import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText } from 'lucide-react'
import { CanvasStore } from './crdt/canvasStore'
import { CanvasEditor } from './components/CanvasEditor'
import { Sidebar } from './components/Sidebar'
import { useCanvasStore } from './hooks/useCanvasStore'

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        className="flex flex-col items-center gap-4"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <FileText size={22} />
        </div>
        <p className="text-sm text-text-muted">No canvases yet — create your first one</p>
        <button
          type="button"
          onClick={onCreate}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
        >
          Create canvas
        </button>
      </motion.div>
    </div>
  )
}

function Shell({ store }: { store: CanvasStore }) {
  const {
    synced,
    canvases,
    activeId,
    activeCanvas,
    select,
    createCanvas,
    deleteCanvas,
    updateMeta,
  } = useCanvasStore(store)

  if (!synced) {
    return <div className="flex h-full items-center justify-center text-sm text-text-faint">Loading canvases…</div>
  }

  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      <Sidebar
        canvases={canvases}
        activeId={activeId}
        onSelect={select}
        onCreate={createCanvas}
        onDelete={deleteCanvas}
      />
      <main className="relative flex-1">
        {activeCanvas ? (
          <CanvasEditor
            key={activeCanvas.id}
            canvas={activeCanvas}
            onEdited={(meta) => updateMeta(activeCanvas.id, meta)}
          />
        ) : (
          <EmptyState onCreate={createCanvas} />
        )}
      </main>
    </div>
  )
}

function App() {
  const [store, setStore] = useState<CanvasStore | null>(null)

  useEffect(() => {
    const instance = new CanvasStore()
    // oxlint-disable-next-line react/set-state-in-effect -- store must be created per mount and paired with destroy(); lazy init would break under StrictMode's simulated unmount
    setStore(instance)
    return () => instance.destroy()
  }, [])

  if (!store) return null

  return <Shell store={store} />
}

export default App