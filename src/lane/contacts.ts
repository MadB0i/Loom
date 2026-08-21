import { invoke } from '@tauri-apps/api/core'

// PHASE 10: trusted contacts. A peer must be in this list for the Rust side to
// accept inbound TCP connections or dial out — pairing (QR scan) is the only way
// in. Persisted to localStorage and mirrored to Rust via `update_contacts`.

export interface Contact {
  loomId: string
  displayName: string
  addedAt: number
}

const STORAGE_KEY = 'loom-contacts'

let contacts: Contact[] = load()
const listeners = new Set<() => void>()

function load(): Contact[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as Contact[]) : []
  } catch {
    return []
  }
}

function persist(): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contacts))
}

function notify(): void {
  pushToRust()
  for (const listener of listeners) listener()
}

export function getContacts(): Contact[] {
  return contacts
}

export function getContact(loomId: string): Contact | undefined {
  return contacts.find((c) => c.loomId === loomId)
}

export function addContact(contact: Omit<Contact, 'addedAt'>): void {
  if (contacts.some((c) => c.loomId === contact.loomId)) return
  contacts = [...contacts, { ...contact, addedAt: Date.now() }]
  persist()
  notify()
}

// Discovery announces carry the peer's current display name; QR pairing stores the
// Loom ID as a placeholder until then, so enrich it here.
export function setContactDisplayName(loomId: string, displayName: string): void {
  const existing = contacts.find((c) => c.loomId === loomId)
  if (!existing || existing.displayName === displayName) return
  contacts = contacts.map((c) => (c.loomId === loomId ? { ...c, displayName } : c))
  persist()
  notify()
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function pushToRust(): void {
  if (!isTauri()) return
  void invoke('update_contacts', { ids: contacts.map((c) => c.loomId) }).catch((err) => {
    console.warn('[contacts] failed to sync to Rust:', err)
  })
}
