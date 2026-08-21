import { Fragment } from 'react'
import { motion } from 'framer-motion'
import { MessageSquarePlus, Trash2, Users } from 'lucide-react'
import type { ConversationSummary } from '../crdt/conversationStore'
import type { Identity } from '../identity/identity'
import { Avatar } from './Avatar'

export type SidebarTab = 'chats' | 'nearby'

interface SidebarProps {
  tab: SidebarTab
  chats: ConversationSummary[]
  activeId: string | null
  identity: Identity
  onTabChange: (tab: SidebarTab) => void
  onSelect: (id: string) => void
  onCreateChat: () => void
  onCreateGroup: () => void
  onDelete: (id: string) => void
  onOpenProfile: () => void
}

function formatRelative(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  return new Date(timestamp).toLocaleDateString()
}

const TABS: SidebarTab[] = ['chats', 'nearby']

export function Sidebar({
  tab,
  chats,
  activeId,
  identity,
  onTabChange,
  onSelect,
  onCreateChat,
  onCreateGroup,
  onDelete,
  onOpenProfile,
}: SidebarProps) {
  return (
    <aside className="relative flex w-80 shrink-0 flex-col border-r border-border bg-surface/80 backdrop-blur-xl">
      <div
        aria-hidden
        className="absolute inset-y-0 right-0 w-px bg-linear-to-b from-accent/50 via-accent-blue/25 to-transparent"
      />
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-gradient text-sm font-bold uppercase tracking-[0.14em]">Loom</h1>
        <button
          type="button"
          onClick={onOpenProfile}
          title="Your profile"
          aria-label="Open your profile"
          className="rounded-full shadow-[0_0_12px_rgba(124,92,255,0.4)] transition hover:brightness-110 active:scale-95"
        >
          <Avatar name={identity.displayName} imageId={identity.avatarImageId} size="sm" />
        </button>
      </header>
      <div className="px-3 pt-3">
        <div className="relative flex rounded-xl bg-black/25 p-1" role="group" aria-label="Sections">
          {TABS.map((entry) => (
            <Fragment key={entry}>
              {tab === entry && (
                <motion.div
                  layoutId="sidebar-tab-pill"
                  className="absolute inset-y-1 w-[calc(50%-4px)] rounded-lg bg-linear-to-br from-accent to-accent-blue shadow-[0_0_12px_rgba(124,92,255,0.4)]"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  style={{ left: entry === 'chats' ? 4 : 'calc(50%)' }}
                />
              )}
              <button
                type="button"
                onClick={() => onTabChange(entry)}
                aria-pressed={tab === entry}
                className={`relative z-10 flex-1 rounded-lg py-1.5 text-xs font-semibold capitalize transition ${
                  tab === entry ? 'text-white' : 'text-text-muted hover:text-text'
                }`}
              >
                {entry}
              </button>
            </Fragment>
          ))}
        </div>
      </div>
      {tab === 'chats' ? (
        <ul className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {chats.length === 0 && (
            <li className="px-3 py-6 text-center text-xs text-text-faint">
              No chats yet — create one below
            </li>
          )}
          {chats.map((chat) => {
            const active = chat.id === activeId
            return (
              <motion.li key={chat.id} layout whileHover={{ x: 2 }}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(chat.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelect(chat.id)
                  }}
                  className={`group flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 transition-all duration-150 ${
                    active
                      ? 'border-accent/40 bg-surface-2 shadow-[0_0_18px_rgba(124,92,255,0.14)]'
                      : 'border-transparent hover:bg-surface-2/70'
                  }`}
                >
                  <Avatar name={chat.name || '?'} size="sm" variant={chat.isGroup ? 'group' : 'direct'} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span
                        className={`truncate text-[13px] leading-snug ${
                          chat.unread > 0 ? 'font-bold text-text' : 'font-semibold text-text'
                        }`}
                      >
                        {chat.name || 'Untitled chat'}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-text-faint">
                        {formatRelative(chat.lastMessageAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`truncate text-[11px] ${
                          chat.unread > 0 ? 'text-text-muted' : 'text-text-faint'
                        }`}
                      >
                        {chat.lastMessagePreview || 'No messages yet'}
                      </span>
                      {chat.unread > 0 ? (
                        <span
                          aria-label={`${chat.unread} unread`}
                          className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-linear-to-br from-accent to-accent-blue px-1.5 text-[10px] font-bold tabular-nums text-white shadow-[0_0_10px_rgba(124,92,255,0.45)]"
                        >
                          {chat.unread > 99 ? '99+' : chat.unread}
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-label="Delete chat"
                          className="rounded-md p-1 text-text-faint opacity-0 transition hover:bg-red-500/15 hover:text-red-400 focus-visible:opacity-100 group-hover:opacity-100"
                          onClick={(event) => {
                            event.stopPropagation()
                            onDelete(chat.id)
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </motion.li>
            )
          })}
        </ul>
      ) : (
        <div className="flex flex-1 items-center justify-center px-6 text-center">
          <p className="text-xs leading-relaxed text-text-faint">
            Devices on your network will appear here once discovery lands.
          </p>
        </div>
      )}
      <footer className="space-y-0.5 border-t border-border p-2">
        <button
          type="button"
          onClick={onCreateChat}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-text-muted transition hover:bg-surface-2/70 hover:text-text"
        >
          <MessageSquarePlus size={15} />
          New chat
        </button>
        <button
          type="button"
          onClick={onCreateGroup}
          className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-text-muted transition hover:bg-surface-2/70 hover:text-text"
        >
          <Users size={15} />
          New group
        </button>
      </footer>
    </aside>
  )
}