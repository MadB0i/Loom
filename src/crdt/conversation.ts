import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'

export const SIGNALING_URLS: string[] = []

export interface MemberInfo {
  displayName: string
  joinedAt: number
}

export interface TextMessageData {
  id: string
  senderId: string
  type: 'text'
  content: string
  createdAt: number
}

export interface ImageMessageData {
  id: string
  senderId: string
  type: 'image'
  imageId: string
  createdAt: number
}

export type MessageData = TextMessageData | ImageMessageData

export interface ConversationSnapshot {
  name: string
  isGroup: boolean
  members: Record<string, MemberInfo>
  messages: MessageData[]
}

const EMPTY_SNAPSHOT: ConversationSnapshot = { name: '', isGroup: false, members: {}, messages: [] }

export class Conversation {
  readonly id: string
  readonly doc: Y.Doc
  readonly meta: Y.Map<unknown>
  readonly members: Y.Map<MemberInfo>
  readonly messages: Y.Array<Y.Map<unknown>>
  readonly persistence: IndexeddbPersistence
  readonly sync: WebrtcProvider

  private readonly listeners = new Set<() => void>()
  private snapshot: ConversationSnapshot = EMPTY_SNAPSHOT
  private destroyed = false

  constructor(id: string) {
    this.id = id
    this.doc = new Y.Doc()
    this.meta = this.doc.getMap('meta')
    this.members = this.doc.getMap<MemberInfo>('members')
    this.messages = this.doc.getArray('messages')
    this.persistence = new IndexeddbPersistence(`loom-conversation-${id}`, this.doc)
    this.sync = new WebrtcProvider(`loom-conversation-${id}`, this.doc, { signaling: SIGNALING_URLS })
    this.meta.observe(this.rebuild)
    this.members.observe(this.rebuild)
    this.messages.observe(this.rebuild)
    this.persistence.on('synced', this.rebuild)
    this.rebuild()
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

  getSnapshot(): ConversationSnapshot {
    return this.snapshot
  }

  initializeMeta(name: string, isGroup: boolean): void {
    if (this.meta.has('isGroup')) return
    this.meta.set('isGroup', isGroup)
    this.meta.set('name', name)
  }

  ensureMember(loomId: string, displayName: string): void {
    const existing = this.members.get(loomId)
    if (existing) {
      if (existing.displayName !== displayName) {
        this.members.set(loomId, { ...existing, displayName })
      }
      return
    }
    this.members.set(loomId, { displayName, joinedAt: Date.now() })
  }

  addTextMessage(senderId: string, content: string): string {
    const id = crypto.randomUUID()
    const row = new Y.Map<unknown>()
    row.set('id', id)
    row.set('senderId', senderId)
    row.set('type', 'text')
    row.set('content', content)
    row.set('createdAt', Date.now())
    this.messages.push([row])
    return id
  }

  addImageMessage(senderId: string, imageId: string): string {
    const id = crypto.randomUUID()
    const row = new Y.Map<unknown>()
    row.set('id', id)
    row.set('senderId', senderId)
    row.set('type', 'image')
    row.set('imageId', imageId)
    row.set('createdAt', Date.now())
    this.messages.push([row])
    return id
  }

  getNeededImageIds(): Set<string> {
    const ids = new Set<string>()
    for (const message of this.snapshot.messages) {
      if (message.type === 'image') ids.add(message.imageId)
    }
    return ids
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.meta.unobserve(this.rebuild)
    this.members.unobserve(this.rebuild)
    this.messages.unobserve(this.rebuild)
    this.persistence.off('synced', this.rebuild)
    this.sync.destroy()
    this.persistence.destroy()
    this.doc.destroy()
  }

  private readonly rebuild = (): void => {
    const messages: MessageData[] = []
    for (const row of this.messages.toArray()) {
      const base = {
        id: row.get('id') as string,
        senderId: row.get('senderId') as string,
        createdAt: row.get('createdAt') as number,
      }
      if (row.get('type') === 'image') {
        messages.push({ ...base, type: 'image', imageId: row.get('imageId') as string })
      } else {
        messages.push({ ...base, type: 'text', content: (row.get('content') as string) ?? '' })
      }
    }
    const members: Record<string, MemberInfo> = {}
    for (const [loomId, info] of this.members.entries()) {
      members[loomId] = info
    }
    this.snapshot = {
      name: (this.meta.get('name') as string) ?? '',
      isGroup: Boolean(this.meta.get('isGroup')),
      members,
      messages,
    }
    for (const listener of this.listeners) listener()
  }
}