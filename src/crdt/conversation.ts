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

export interface StrokePoint {
  x: number
  y: number
}

export interface TextElementData {
  id: string
  type: 'text'
  x: number
  y: number
  content: string
}

export interface StrokeElementData {
  id: string
  type: 'stroke'
  points: StrokePoint[]
  color: string
  width: number
}

export interface ImageElementData {
  id: string
  type: 'image'
  x: number
  y: number
  width: number
  height: number
  imageId: string
}

export type ElementData = TextElementData | StrokeElementData | ImageElementData

export interface ConversationSnapshot {
  name: string
  isGroup: boolean
  members: Record<string, MemberInfo>
  messages: MessageData[]
  elements: ElementData[]
}

const EMPTY_SNAPSHOT: ConversationSnapshot = {
  name: '',
  isGroup: false,
  members: {},
  messages: [],
  elements: [],
}

export class Conversation {
  readonly id: string
  readonly doc: Y.Doc
  readonly meta: Y.Map<unknown>
  readonly members: Y.Map<MemberInfo>
  readonly messages: Y.Array<Y.Map<unknown>>
  readonly elements: Y.Array<Y.Map<unknown>>
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
    // Migration safety (Phase 9): conversations created before the canvas existed have no
    // 'elements' root on their persisted doc. Y.getArray() transparently creates an empty
    // array when missing, so old docs hydrate to an empty whiteboard instead of crashing.
    this.elements = this.doc.getArray('elements')
    this.persistence = new IndexeddbPersistence(`loom-conversation-${id}`, this.doc)
    this.sync = new WebrtcProvider(`loom-conversation-${id}`, this.doc, { signaling: SIGNALING_URLS })
    this.meta.observe(this.rebuild)
    this.members.observe(this.rebuild)
    this.messages.observe(this.rebuild)
    this.elements.observe(this.rebuild)
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

  addTextElement(data: Omit<TextElementData, 'id' | 'type'>): string {
    const id = crypto.randomUUID()
    const element = new Y.Map<unknown>()
    element.set('id', id)
    element.set('type', 'text')
    element.set('x', data.x)
    element.set('y', data.y)
    element.set('content', data.content)
    this.elements.push([element])
    return id
  }

  addStrokeElement(color: string, width: number): string {
    const id = crypto.randomUUID()
    const element = new Y.Map<unknown>()
    element.set('id', id)
    element.set('type', 'stroke')
    element.set('color', color)
    element.set('width', width)
    element.set('points', new Y.Array())
    this.elements.push([element])
    return id
  }

  addImageElement(data: Omit<ImageElementData, 'id' | 'type'>): string {
    const id = crypto.randomUUID()
    const element = new Y.Map<unknown>()
    element.set('id', id)
    element.set('type', 'image')
    element.set('x', data.x)
    element.set('y', data.y)
    element.set('width', data.width)
    element.set('height', data.height)
    element.set('imageId', data.imageId)
    this.elements.push([element])
    return id
  }

  appendStrokePoint(id: string, point: StrokePoint): void {
    const element = this.findElement(id)
    if (!element) return
    const points = element.get('points') as Y.Array<Y.Map<number>> | undefined
    if (!points) return
    const p = new Y.Map<number>()
    p.set('x', point.x)
    p.set('y', point.y)
    points.push([p])
  }

  updateElement(
    id: string,
    patch: Partial<
      Pick<TextElementData, 'x' | 'y' | 'content'> &
        Pick<ImageElementData, 'x' | 'y' | 'width' | 'height'>
    >,
  ): void {
    const element = this.findElement(id)
    if (!element) return
    for (const [key, value] of Object.entries(patch)) {
      element.set(key, value)
    }
  }

  deleteElement(id: string): void {
    const index = this.elements.toArray().findIndex((el) => el.get('id') === id)
    if (index !== -1) this.elements.delete(index)
  }

  // Dual-scan (Phase 9 Part D): chat images and canvas images are two independent uses of
  // the same transfer engine — both reference sets must be reported as needed.
  getNeededImageIds(): Set<string> {
    const ids = new Set<string>()
    for (const message of this.snapshot.messages) {
      if (message.type === 'image') ids.add(message.imageId)
    }
    for (const element of this.snapshot.elements) {
      if (element.type === 'image') ids.add(element.imageId)
    }
    return ids
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.meta.unobserve(this.rebuild)
    this.members.unobserve(this.rebuild)
    this.messages.unobserve(this.rebuild)
    this.elements.unobserve(this.rebuild)
    this.persistence.off('synced', this.rebuild)
    this.sync.destroy()
    this.persistence.destroy()
    this.doc.destroy()
  }

  private findElement(id: string): Y.Map<unknown> | undefined {
    return this.elements.toArray().find((el) => el.get('id') === id)
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
    const elements: ElementData[] = this.elements.toArray().map((el) => {
      const id = el.get('id') as string
      if (el.get('type') === 'text') {
        return {
          id,
          type: 'text',
          x: el.get('x') as number,
          y: el.get('y') as number,
          content: el.get('content') as string,
        } satisfies TextElementData
      }
      if (el.get('type') === 'image') {
        return {
          id,
          type: 'image',
          x: el.get('x') as number,
          y: el.get('y') as number,
          width: el.get('width') as number,
          height: el.get('height') as number,
          imageId: el.get('imageId') as string,
        } satisfies ImageElementData
      }
      return {
        id,
        type: 'stroke',
        color: el.get('color') as string,
        width: el.get('width') as number,
        points:
          (el.get('points') as Y.Array<Y.Map<number>> | undefined)
            ?.toArray()
            .map((p) => ({ x: p.get('x') as number, y: p.get('y') as number })) ?? [],
      } satisfies StrokeElementData
    })
    this.snapshot = {
      name: (this.meta.get('name') as string) ?? '',
      isGroup: Boolean(this.meta.get('isGroup')),
      members,
      messages,
      elements,
    }
    for (const listener of this.listeners) listener()
  }
}