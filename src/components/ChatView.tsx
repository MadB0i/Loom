import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Paperclip, SendHorizontal, Users } from 'lucide-react'
import type { Conversation } from '../crdt/conversation'
import { imageStore } from '../crdt/imageStore'
import { ImageTransfer } from '../crdt/imageTransfer'
import type { ConversationStore } from '../crdt/conversationStore'
import type { Identity } from '../identity/identity'
import { Avatar } from './Avatar'
import { MessageBubble } from './MessageBubble'

interface ChatViewProps {
  conversation: Conversation
  store: ConversationStore
  identity: Identity
}

export function ChatView({ conversation, store, identity }: ChatViewProps) {
  const subscribe = useCallback((cb: () => void) => conversation.subscribe(cb), [conversation])
  const getSnapshot = useCallback(() => conversation.getSnapshot(), [conversation])
  const snapshot = useSyncExternalStore(subscribe, getSnapshot)

  const [draft, setDraft] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const attachInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    const transfer = new ImageTransfer(conversation, imageStore)
    transfer.start()
    return () => transfer.destroy()
  }, [conversation])

  useEffect(() => {
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [snapshot.messages.length])

  const sendText = () => {
    const content = draft.trim()
    if (!content) return
    conversation.addTextMessage(identity.loomId, content)
    setDraft('')
    store.updateMeta(conversation.id, {
      lastMessagePreview: content.slice(0, 60),
      lastMessageAt: Date.now(),
    })
  }

  const sendImage = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return
      const imageId = crypto.randomUUID()
      await imageStore.put(imageId, file, file.type)
      conversation.addImageMessage(identity.loomId, imageId)
      store.updateMeta(conversation.id, { lastMessagePreview: 'Photo', lastMessageAt: Date.now() })
    },
    [conversation, identity.loomId, store],
  )

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find((entry) =>
        entry.type.startsWith('image/'),
      )
      const file = item?.getAsFile()
      if (!file) return
      event.preventDefault()
      void sendImage(file)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [sendImage])

  const memberCount = Object.keys(snapshot.members).length
  const title = snapshot.name || 'Untitled chat'

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface/70 px-4 backdrop-blur-xl">
        <Avatar name={title} size="md" variant={snapshot.isGroup ? 'group' : 'direct'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-text">{title}</div>
          <div className="text-[11px] text-text-faint">
            {snapshot.isGroup ? `${memberCount} ${memberCount === 1 ? 'member' : 'members'}` : 'Local-only · test mode'}
          </div>
        </div>
        <button
          type="button"
          disabled
          title="Coming soon — peer pairing arrives in Phase 9"
          aria-label="Add participant (coming soon)"
          className="flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-xs font-medium text-text-faint"
        >
          <Users size={13} />
          Add participant
        </button>
      </header>
      <div
        ref={listRef}
        className={`flex-1 overflow-y-auto px-6 py-4 transition ${
          dragging ? 'ring-1 ring-inset ring-accent/50' : ''
        }`}
        onDragEnter={(event) => {
          event.preventDefault()
          dragDepthRef.current++
          setDragging(true)
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => {
          dragDepthRef.current--
          if (dragDepthRef.current <= 0) setDragging(false)
        }}
        onDrop={(event) => {
          event.preventDefault()
          dragDepthRef.current = 0
          setDragging(false)
          const file = event.dataTransfer.files?.[0]
          if (file) void sendImage(file)
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-1.5">
          {snapshot.messages.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-sm text-text-muted">No messages yet</p>
              <p className="mt-1 text-xs text-text-faint">
                Send yourself a message — text, or paste/drop an image
              </p>
            </div>
          )}
          {snapshot.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              mine={message.senderId === identity.loomId}
              senderLabel={snapshot.members[message.senderId]?.displayName ?? message.senderId}
              showSender={snapshot.isGroup}
            />
          ))}
        </div>
      </div>
      <div className="shrink-0 px-6 pb-5 pt-1">
        <div className="glass-panel mx-auto flex max-w-3xl items-center gap-2 rounded-2xl p-2">
          <input
            ref={attachInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void sendImage(file)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => attachInputRef.current?.click()}
            title="Attach image (paste or drop also work)"
            aria-label="Attach image"
            className="rounded-xl p-2.5 text-text-muted transition hover:bg-white/5 hover:text-text"
          >
            <Paperclip size={16} />
          </button>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') sendText()
            }}
            placeholder="Type a message"
            aria-label="Message"
            className="min-w-0 flex-1 rounded-xl bg-black/25 px-3.5 py-2.5 text-sm text-text outline-none placeholder:text-text-faint focus:ring-1 focus:ring-accent/50"
          />
          <button
            type="button"
            onClick={sendText}
            disabled={!draft.trim()}
            aria-label="Send message"
            className="rounded-xl bg-linear-to-br from-accent to-accent-blue p-2.5 text-white shadow-[0_0_14px_rgba(124,92,255,0.4)] transition enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-40"
          >
            <SendHorizontal size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}