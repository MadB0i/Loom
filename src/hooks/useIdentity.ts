import { useCallback, useEffect, useState } from 'react'
import {
  getOrCreateIdentity,
  setAvatarImageId,
  setDisplayName,
  type Identity,
} from '../identity/identity'
import { imageStore } from '../crdt/imageStore'

interface IdentityState {
  identity: Identity | null
  error: string | null
  rename: (name: string) => Promise<void>
  setAvatar: (file: File) => Promise<void>
}

export function useIdentity(): IdentityState {
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getOrCreateIdentity()
      .then((result) => {
        if (!cancelled) setIdentity(result)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Identity init failed')
      })
    return () => {
      cancelled = true
    }
  }, [])

  const rename = useCallback(async (name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    await setDisplayName(trimmed)
    setIdentity((current) => (current ? { ...current, displayName: trimmed } : current))
  }, [])

  // Local-only for now: peer-syncing of avatars is a Phase 9+ follow-up once the
  // networking layer exists. Until then the picture never leaves this device.
  const setAvatar = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return
    const imageId = crypto.randomUUID()
    await imageStore.put(imageId, file, file.type)
    const previous = await setAvatarImageId(imageId)
    if (previous) void imageStore.delete(previous)
    setIdentity((current) => (current ? { ...current, avatarImageId: imageId } : current))
  }, [])

  return { identity, error, rename, setAvatar }
}