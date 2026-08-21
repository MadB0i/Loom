import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Conversation } from '../crdt/conversation'
import {
  ConversationStore,
  type ConversationSummary,
  type SelfInfo,
} from '../crdt/conversationStore'
import type { Identity } from '../identity/identity'

const EMPTY: ConversationSummary[] = []

export interface ConversationsApi {
  synced: boolean
  chats: ConversationSummary[]
  activeId: string | null
  activeConversation: Conversation | null
  select: (id: string) => void
  createChat: () => void
  createGroup: () => void
  deleteChat: (id: string) => void
  updateMeta: (id: string, patch: { lastMessagePreview?: string; lastMessageAt?: number }) => void
}

export function useConversations(
  store: ConversationStore | null,
  identity: Identity,
): ConversationsApi {
  const chats = useSyncExternalStore(
    (onChange) => (store ? store.subscribe(onChange) : () => {}),
    () => (store ? store.getSnapshot() : EMPTY),
  )

  const [synced, setSynced] = useState(() => store?.synced ?? false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)

  useEffect(() => {
    selectedIdRef.current = selectedId
  }, [selectedId])

  useEffect(() => {
    if (!store) return
    return store.subscribe(() => setSynced(store.synced))
  }, [store])

  useEffect(() => {
    if (!store) return
    store.setActiveConversation(selectedId)
    return () => store.setActiveConversation(null)
  }, [store, selectedId])

  const self = useMemo<SelfInfo>(
    () => ({ loomId: identity.loomId, displayName: identity.displayName }),
    [identity.loomId, identity.displayName],
  )

  const activeId = selectedId
  const activeConversation = activeId ? (store?.getConversation(activeId) ?? null) : null

  const select = (id: string) => setSelectedId(id)

  const createChat = () => {
    if (!store) return
    setSelectedId(store.createConversation({ name: 'Note to self', isGroup: false }, self))
  }

  const createGroup = () => {
    if (!store) return
    setSelectedId(store.createConversation({ name: 'New Group', isGroup: true }, self))
  }

  const deleteChat = (id: string) => {
    if (!store) return
    if (!window.confirm('Delete this chat?')) return
    if (selectedIdRef.current === id) setSelectedId(null)
    store.deleteConversation(id)
  }

  const updateMeta = (id: string, patch: { lastMessagePreview?: string; lastMessageAt?: number }) => {
    store?.updateMeta(id, patch)
  }

  return {
    synced,
    chats,
    activeId,
    activeConversation,
    select,
    createChat,
    createGroup,
    deleteChat,
    updateMeta,
  }
}