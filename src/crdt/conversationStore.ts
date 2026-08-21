import * as Y from 'yjs'
import { IndexeddbPersistence, clearDocument } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'
import { Conversation, SIGNALING_URLS } from './conversation'

export const CONVERSATIONS_INDEX_DB = 'loom-conversations-index'
export const CONVERSATIONS_INDEX_ROOM = 'loom-conversations-index'

export interface ConversationMeta {
  name: string
  isGroup: boolean
  lastMessagePreview: string
  lastMessageAt: number
  createdAt: number
  unread: number
}

export interface ConversationSummary extends ConversationMeta {
  id: string
}

export interface SelfInfo {
  loomId: string
  displayName: string
}

export class ConversationStore {
  readonly doc: Y.Doc
  readonly conversations: Y.Map<ConversationMeta>
  readonly persistence: IndexeddbPersistence
  readonly sync: WebrtcProvider

  private readonly listeners = new Set<() => void>()
  private readonly loadedConversations = new Map<string, Conversation>()
  private readonly freshCounts = new Map<string, number>()
  private readonly startedAt = Date.now()
  private activeId: string | null = null
  private snapshot: ConversationSummary[] = []
  private destroyed = false

  constructor() {
    this.doc = new Y.Doc()
    this.conversations = this.doc.getMap<ConversationMeta>('conversations')
    this.persistence = new IndexeddbPersistence(CONVERSATIONS_INDEX_DB, this.doc)
    this.sync = new WebrtcProvider(CONVERSATIONS_INDEX_ROOM, this.doc, { signaling: SIGNALING_URLS })
    this.conversations.observe(this.handleConversationsChange)
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

  getSnapshot(): ConversationSummary[] {
    return this.snapshot
  }

  createConversation(
    options: { name: string; isGroup: boolean },
    self: SelfInfo,
  ): string {
    const id = crypto.randomUUID()
    const now = Date.now()
    this.conversations.set(id, {
      name: options.name,
      isGroup: options.isGroup,
      lastMessagePreview: '',
      lastMessageAt: now,
      createdAt: now,
      unread: 0,
    })
    const conversation = this.getConversation(id)
    conversation.initializeMeta(options.name, options.isGroup)
    conversation.ensureMember(self.loomId, self.displayName)
    return id
  }

  getConversation(id: string): Conversation {
    let conversation = this.loadedConversations.get(id)
    if (!conversation) {
      conversation = new Conversation(id)
      this.loadedConversations.set(id, conversation)
      conversation.subscribe(() => this.handleConversationActivity(id))
    }
    return conversation
  }

  setActiveConversation(id: string | null): void {
    this.activeId = id
    if (!id) return
    const current = this.conversations.get(id)
    if (current && current.unread !== 0) {
      this.conversations.set(id, { ...current, unread: 0 })
    }
  }

  updateMeta(
    id: string,
    patch: Partial<Pick<ConversationMeta, 'name' | 'lastMessagePreview' | 'lastMessageAt'>>,
  ): void {
    const current = this.conversations.get(id)
    if (!current) return
    this.conversations.set(id, { ...current, ...patch })
  }

  deleteConversation(id: string): void {
    if (!this.conversations.has(id)) return
    this.conversations.delete(id)
    this.unloadConversation(id)
    void clearDocument(`loom-conversation-${id}`)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.conversations.unobserve(this.handleConversationsChange)
    this.sync.destroy()
    this.persistence.destroy()
    for (const conversation of this.loadedConversations.values()) conversation.destroy()
    this.loadedConversations.clear()
    this.doc.destroy()
  }

  private readonly handleConversationsChange = (): void => {
    for (const [id, conversation] of this.loadedConversations) {
      if (!this.conversations.has(id)) {
        this.loadedConversations.delete(id)
        this.freshCounts.delete(id)
        conversation.destroy()
        void clearDocument(`loom-conversation-${id}`)
      }
    }
    this.refreshSnapshot()
  }

  private readonly handleConversationActivity = (id: string): void => {
    const conversation = this.loadedConversations.get(id)
    const meta = this.conversations.get(id)
    if (!conversation || !meta) return
    const fresh = conversation
      .getSnapshot()
      .messages.filter((message) => message.createdAt > this.startedAt).length
    const previous = this.freshCounts.get(id) ?? 0
    this.freshCounts.set(id, fresh)
    if (fresh > previous && id !== this.activeId) {
      this.conversations.set(id, { ...meta, unread: meta.unread + (fresh - previous) })
    }
  }

  private refreshSnapshot(): void {
    this.snapshot = Array.from(this.conversations.entries())
      .map(([id, meta]) => ({ id, ...meta }))
      .sort((a, b) => b.lastMessageAt - a.lastMessageAt)
    for (const listener of this.listeners) listener()
  }

  private unloadConversation(id: string): void {
    const conversation = this.loadedConversations.get(id)
    if (conversation) {
      this.loadedConversations.delete(id)
      this.freshCounts.delete(id)
      conversation.destroy()
    }
  }
}