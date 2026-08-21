import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'

import {
  getContacts,
  isTauri,
  setContactDisplayName,
  subscribe as subscribeContacts,
} from '../lane/contacts'

// PHASE 10: live Nearby list. Rust emits `lan-peer` on first sight / rename and
// `lan-peer-lost` after the 10s silence timeout; this hook also sweeps locally so
// a missed lost-event cannot leave a ghost entry.

export interface LanPeer {
  loomId: string
  displayName: string
  paired: boolean
}

const PEER_TIMEOUT_MS = 10_000

interface PeerEntry {
  displayName: string
  lastSeen: number
}

export function useLanPeers(): LanPeer[] {
  const [peers, setPeers] = useState<Map<string, PeerEntry>>(new Map())
  const [contactsVersion, setContactsVersion] = useState(0)

  useEffect(() => {
    if (!isTauri()) return
    const unlisteners: Promise<() => void>[] = [
      listen<{ loomId: string; displayName: string }>('lan-peer', (event) => {
        setContactDisplayName(event.payload.loomId, event.payload.displayName)
        setPeers((previous) => {
          const next = new Map(previous)
          next.set(event.payload.loomId, {
            displayName: event.payload.displayName,
            lastSeen: Date.now(),
          })
          return next
        })
      }),
      listen<{ loomId: string }>('lan-peer-lost', (event) => {
        setPeers((previous) => {
          if (!previous.has(event.payload.loomId)) return previous
          const next = new Map(previous)
          next.delete(event.payload.loomId)
          return next
        })
      }),
    ]
    const sweep = window.setInterval(() => {
      setPeers((previous) => {
        const now = Date.now()
        let changed = false
        const next = new Map(previous)
        for (const [id, entry] of next) {
          if (now - entry.lastSeen > PEER_TIMEOUT_MS) {
            next.delete(id)
            changed = true
          }
        }
        return changed ? next : previous
      })
    }, 1000)
    const unsubscribe = subscribeContacts(() => setContactsVersion((v) => v + 1))
    return () => {
      window.clearInterval(sweep)
      unsubscribe()
      void Promise.all(unlisteners).then((offs) => offs.forEach((off) => off()))
    }
  }, [])

  const contactIds = new Set(getContacts().map((c) => c.loomId))
  void contactsVersion

  return Array.from(peers.entries())
    .map(([loomId, entry]) => ({
      loomId,
      displayName: entry.displayName,
      paired: contactIds.has(loomId),
    }))
    .sort((a, b) => Number(b.paired) - Number(a.paired) || a.displayName.localeCompare(b.displayName))
}
