import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, MessagesSquare, QrCode, Radar, TriangleAlert } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { ConversationStore } from './crdt/conversationStore'
import { cleanupLegacyDatabases } from './crdt/legacyCleanup'
import { ChatView } from './components/ChatView'
import { ConnectionStatus } from './components/ConnectionStatus'
import { ProfileModal } from './components/ProfileModal'
import { QrPairModal } from './components/QrPairModal'
import { Sidebar, type SidebarTab } from './components/Sidebar'
import { useConversations } from './hooks/useConversations'
import { useIdentity } from './hooks/useIdentity'
import { useLanPeers, type LanPeer } from './hooks/useLanPeers'
import type { Identity } from './identity/identity'
import { isTauri, pushToRust } from './lane/contacts'
import { initLanSync } from './lane/lanSync'

function StaticWashes() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      <div
        className="absolute -left-32 -top-40 h-[420px] w-[420px]"
        style={{ background: 'radial-gradient(circle, rgba(124,92,255,0.13), transparent 65%)' }}
      />
      <div
        className="absolute -bottom-48 -right-36 h-[520px] w-[520px]"
        style={{ background: 'radial-gradient(circle, rgba(77,159,255,0.10), transparent 65%)' }}
      />
      <div
        className="absolute left-[45%] top-[55%] h-[360px] w-[360px]"
        style={{ background: 'radial-gradient(circle, rgba(244,114,182,0.07), transparent 65%)' }}
      />
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        className="flex flex-col items-center gap-3 text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-accent to-accent-blue text-white shadow-[0_0_24px_rgba(124,92,255,0.35)]">
          <MessagesSquare size={22} />
        </div>
        <p className="text-sm text-text-muted">Select a chat or create one</p>
        <p className="text-xs text-text-faint">New chat and New group live in the sidebar footer</p>
      </motion.div>
    </div>
  )
}

function NearbyView({
  peers,
  onOpenPairing,
  onOpenChatWith,
}: {
  peers: LanPeer[]
  onOpenPairing: () => void
  onOpenChatWith: (peer: { loomId: string; displayName: string }) => void
}) {
  return (
    <div className="flex flex-1 items-center justify-center">
      <motion.div
        className="flex flex-col items-center gap-3 text-center"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
      >
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-linear-to-br from-accent to-accent-blue text-white shadow-[0_0_24px_rgba(124,92,255,0.35)]">
          <Radar size={22} />
        </div>
        <p className="text-sm font-semibold text-text">
          {peers.length === 0
            ? 'Searching your network…'
            : `${peers.length} device${peers.length === 1 ? '' : 's'} nearby`}
        </p>
        {peers.length === 0 ? (
          <p className="max-w-60 text-xs leading-relaxed text-text-faint">
            Devices running Loom on this WiFi will appear here automatically.
          </p>
        ) : (
          <ul className="w-72 space-y-1">
            {peers.map((peer) => (
              <li key={peer.loomId}>
                <button
                  type="button"
                  onClick={() => onOpenChatWith(peer)}
                  className="flex w-full items-center gap-2.5 rounded-xl border border-white/10 bg-surface-2/60 px-3 py-2.5 text-left transition hover:border-accent/40 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-text">
                      {peer.displayName}
                    </span>
                    <span className="block truncate font-mono text-[10px] text-text-faint">
                      {peer.loomId}
                    </span>
                  </span>
                  {peer.paired && (
                    <span className="shrink-0 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-400">
                      Paired
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={onOpenPairing}
          className="mt-1 flex items-center gap-2 rounded-lg bg-linear-to-br from-accent to-accent-blue px-4 py-2 text-xs font-semibold text-white shadow-[0_0_14px_rgba(124,92,255,0.35)] transition hover:brightness-110 active:scale-[0.98]"
        >
          <QrCode size={14} />
          Scan to pair
        </button>
      </motion.div>
    </div>
  )
}

function IdentityLoading({ error }: { error: string | null }) {
  return (
    <div className="flex h-full items-center justify-center">
      {error ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <TriangleAlert size={20} className="text-red-400" />
          <p className="text-sm text-text-muted">Identity init failed</p>
          <p className="text-xs text-text-faint">{error}</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Loader2 size={20} className="animate-spin text-accent" />
          <p className="text-xs text-text-faint">Preparing your identity…</p>
        </div>
      )}
    </div>
  )
}

function Shell({
  identity,
  rename,
  setAvatar,
}: {
  identity: Identity
  rename: (name: string) => Promise<void>
  setAvatar: (file: File) => Promise<void>
}) {
  const [store, setStore] = useState<ConversationStore | null>(null)
  const [tab, setTab] = useState<SidebarTab>('chats')
  const [profileOpen, setProfileOpen] = useState(false)
  const [pairingOpen, setPairingOpen] = useState(false)
  const nearbyPeers = useLanPeers()

  useEffect(() => {
    void cleanupLegacyDatabases()
    const instance = new ConversationStore()
    // oxlint-disable-next-line react/set-state-in-effect -- store must be created per mount and paired with destroy(); lazy init would break under StrictMode's simulated unmount
    setStore(instance)
    return () => instance.destroy()
  }, [])

  useEffect(() => {
    pushToRust()
    if (!isTauri()) return
    void invoke('set_discovery_identity', {
      loomId: identity.loomId,
      displayName: identity.displayName,
    }).catch((err) => console.warn('[lan] identity push failed:', err))
  }, [identity.loomId, identity.displayName])

  useEffect(() => {
    if (!store) return
    void initLanSync(identity, store)
  }, [store, identity])

  const { chats, activeId, activeConversation, select, createChat, createGroup, deleteChat } =
    useConversations(store, identity)

  if (!store) return null

  const openChatWith = async (peer: { loomId: string; displayName: string }) => {
    const id = await store.ensureDirectConversation(
      { loomId: identity.loomId, displayName: identity.displayName },
      peer,
    )
    select(id)
    setTab('chats')
  }

  return (
    <div className="flex h-full overflow-hidden bg-bg text-text">
      <Sidebar
        tab={tab}
        chats={chats}
        nearbyPeers={nearbyPeers}
        activeId={activeId}
        identity={identity}
        onTabChange={setTab}
        onSelect={(id) => {
          setTab('chats')
          select(id)
        }}
        onCreateChat={createChat}
        onCreateGroup={createGroup}
        onDelete={deleteChat}
        onOpenProfile={() => setProfileOpen(true)}
        onOpenPairing={() => setPairingOpen(true)}
        onOpenChatWith={(peer) => void openChatWith(peer)}
      />
      <main className="relative min-w-0 flex-1">
        <StaticWashes />
        <div className="relative z-10 flex h-full">
          {tab === 'nearby' ? (
            <NearbyView
              peers={nearbyPeers}
              onOpenPairing={() => setPairingOpen(true)}
              onOpenChatWith={(peer) => void openChatWith(peer)}
            />
          ) : activeConversation ? (
            <ChatView
              key={activeConversation.id}
              conversation={activeConversation}
              store={store}
              identity={identity}
            />
          ) : (
            <EmptyState />
          )}
        </div>
        {activeConversation && (
          <ConnectionStatus key={activeConversation.id} sync={activeConversation.sync} />
        )}
      </main>
      {profileOpen && (
        <ProfileModal
          identity={identity}
          onClose={() => setProfileOpen(false)}
          onRename={rename}
          onAvatarChange={setAvatar}
          onOpenPairing={() => {
            setProfileOpen(false)
            setPairingOpen(true)
          }}
        />
      )}
      {pairingOpen && (
        <QrPairModal identity={identity} onClose={() => setPairingOpen(false)} />
      )}
    </div>
  )
}

function App() {
  const { identity, error, rename, setAvatar } = useIdentity()

  if (!identity) return <IdentityLoading error={error} />

  return <Shell identity={identity} rename={rename} setAvatar={setAvatar} />
}

export default App