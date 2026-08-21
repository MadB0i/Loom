import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import * as Y from 'yjs'

import type { Identity } from '../identity/identity'
import { getContact } from './contacts'
import { isTauri } from './contacts'
import {
  ConversationStore,
  deriveDirectConversationId,
} from '../crdt/conversationStore'

// PHASE 10: bridges Tauri TCP events to Yjs docs. On connect we push full doc
// state, then stream incremental updates; incoming updates are applied with a
// `lan:<loomId>` origin so they are never echoed back. Rust relays opaque
// payloads — all CRDT semantics live here.

interface LanDataPayload {
  c: string
  d: string
}

interface Wiring {
  doc: Y.Doc
  handler: (update: Uint8Array, origin: unknown) => void
}

const attachedPeers = new Map<string, Map<string, Wiring>>()

let identityRef: Identity | null = null
let storeRef: ConversationStore | null = null

export async function initLanSync(identity: Identity, store: ConversationStore): Promise<void> {
  if (!isTauri()) return
  if (storeRef === store && identityRef?.loomId === identity.loomId) return
  identityRef = identity
  storeRef = store
  await Promise.all([
    listen<{ loomId: string }>('lan-connected', (event) => {
      void handleConnected(event.payload.loomId)
    }),
    listen<{ loomId: string }>('lan-disconnected', (event) => {
      handleDisconnected(event.payload.loomId)
    }),
    listen<{ loomId: string; payload: string }>('lan-data', (event) => {
      void handleData(event.payload.loomId, event.payload.payload)
    }),
  ])
}

async function handleConnected(peerId: string): Promise<void> {
  const identity = identityRef
  const store = storeRef
  if (!identity || !store) return
  const displayName = getContact(peerId)?.displayName ?? peerId
  await store.ensureDirectConversation(
    { loomId: identity.loomId, displayName: identity.displayName },
    { loomId: peerId, displayName },
  )
  for (const summary of store.getSnapshot()) {
    const conversation = store.getConversation(summary.id)
    if (conversation.getSnapshot().members[peerId]) {
      attach(store, summary.id, peerId)
    }
  }
}

function attach(store: ConversationStore, conversationId: string, peerId: string): void {
  let wirings = attachedPeers.get(peerId)
  if (!wirings) {
    wirings = new Map()
    attachedPeers.set(peerId, wirings)
  }
  if (wirings.has(conversationId)) return

  const conversation = store.getConversation(conversationId)
  const origin = `lan:${peerId}`
  const send = (update: Uint8Array): void => {
    const payload: LanDataPayload = { c: conversationId, d: bytesToBase64(update) }
    void invoke('lan_send', { loomId: peerId, payload: JSON.stringify(payload) }).catch(() => {
      // Connection dropped mid-send; the reconnect path re-syncs full state.
    })
  }
  send(Y.encodeStateAsUpdate(conversation.doc))
  const handler = (update: Uint8Array, updateOrigin: unknown): void => {
    if (updateOrigin !== origin) send(update)
  }
  conversation.doc.on('update', handler)
  wirings.set(conversationId, { doc: conversation.doc, handler })
}

async function handleData(peerId: string, raw: string): Promise<void> {
  const identity = identityRef
  const store = storeRef
  if (!identity || !store) return
  let message: LanDataPayload
  try {
    message = JSON.parse(raw) as LanDataPayload
  } catch {
    return
  }

  const existing = attachedPeers.get(peerId)?.get(message.c)
  if (existing) {
    Y.applyUpdate(existing.doc, base64ToBytes(message.d), `lan:${peerId}`)
    return
  }

  // Race: remote data can arrive before our own connect handler finishes attaching.
  // If it targets our deterministic direct chat, materialize and attach right here.
  const directId = await deriveDirectConversationId(identity.loomId, peerId)
  if (message.c !== directId) return
  const displayName = getContact(peerId)?.displayName ?? peerId
  await store.ensureDirectConversation(
    { loomId: identity.loomId, displayName: identity.displayName },
    { loomId: peerId, displayName },
  )
  attach(store, directId, peerId)
  const wiring = attachedPeers.get(peerId)?.get(directId)
  if (wiring) {
    Y.applyUpdate(wiring.doc, base64ToBytes(message.d), `lan:${peerId}`)
  }
}

function handleDisconnected(peerId: string): void {
  const wirings = attachedPeers.get(peerId)
  if (!wirings) return
  for (const { doc, handler } of wirings.values()) doc.off('update', handler)
  attachedPeers.delete(peerId)
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}
