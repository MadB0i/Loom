const DB_NAME = 'loom-identity'
const DB_VERSION = 1
const KEYS_STORE = 'keys'
const META_STORE = 'meta'

export interface Identity {
  loomId: string
  displayName: string
  algorithm: string
  avatarImageId: string | null
  publicKey: CryptoKey
  privateKey: CryptoKey
}

interface StoredMeta {
  loomId: string
  displayName: string
  algorithm: string
  avatarImageId?: string | null
}

const BASE32_ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'

let identityPromise: Promise<Identity> | null = null

export function getOrCreateIdentity(): Promise<Identity> {
  if (!identityPromise) {
    identityPromise = loadOrCreate().catch((error) => {
      identityPromise = null
      throw error
    })
  }
  return identityPromise
}

export async function setDisplayName(displayName: string): Promise<void> {
  const db = await openIdentityDb()
  try {
    const meta = await idbGet<StoredMeta>(db, META_STORE, 'self')
    if (!meta) throw new Error('Identity not initialized')
    await idbPut(db, META_STORE, 'self', { ...meta, displayName })
  } finally {
    db.close()
  }
}

export async function setAvatarImageId(
  imageId: string | null,
): Promise<string | null> {
  const db = await openIdentityDb()
  try {
    const meta = await idbGet<StoredMeta>(db, META_STORE, 'self')
    if (!meta) throw new Error('Identity not initialized')
    const previous = meta.avatarImageId ?? null
    await idbPut(db, META_STORE, 'self', { ...meta, avatarImageId: imageId })
    return previous
  } finally {
    db.close()
  }
}

export interface PairingPayload {
  loomId: string
  publicKey: CryptoKey
}

export async function exportPublicKeyBase64Url(key: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key))
  return bytesToBase64Url(raw)
}

export async function buildPairingCode(identity: Identity): Promise<string> {
  const key = await exportPublicKeyBase64Url(identity.publicKey)
  return `loom:v1:${identity.loomId}:${key}`
}

// Re-derives the Loom ID from the embedded public key; a mismatch means tampering.
export async function verifyPairingCode(code: string): Promise<PairingPayload> {
  const parts = code.trim().split(':')
  if (parts.length !== 4 || parts[0] !== 'loom' || parts[1] !== 'v1') {
    throw new Error('Not a Loom pairing code')
  }
  const [, , claimedId, keyPart] = parts
  const raw = base64UrlToBytes(keyPart)
  const publicKey = await importVerifyKey(raw)
  const derived = await deriveLoomId(publicKey)
  if (derived !== claimedId) {
    throw new Error('Code is invalid — key does not match the Loom ID')
  }
  return { loomId: claimedId, publicKey }
}

async function importVerifyKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await crypto.subtle.importKey(
      'raw',
      raw,
      { name: 'Ed25519' } as AlgorithmIdentifier,
      true,
      ['verify'],
    )
  } catch {
    return await crypto.subtle.importKey('raw', raw, { name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'verify',
    ])
  }
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function loadOrCreate(): Promise<Identity> {
  const db = await openIdentityDb()
  try {
    const meta = await idbGet<StoredMeta>(db, META_STORE, 'self')
    const publicKey = await idbGet<CryptoKey>(db, KEYS_STORE, 'publicKey')
    const privateKey = await idbGet<CryptoKey>(db, KEYS_STORE, 'privateKey')
    if (meta && publicKey && privateKey) {
      return {
        loomId: meta.loomId,
        displayName: meta.displayName,
        algorithm: meta.algorithm,
        avatarImageId: meta.avatarImageId ?? null,
        publicKey,
        privateKey,
      }
    }
    const { pair, algorithm } = await generateKeypair()
    const loomId = await deriveLoomId(pair.publicKey)
    const displayName = `Loomer-${randomSuffix(4)}`
    await idbPut(db, KEYS_STORE, 'publicKey', pair.publicKey)
    await idbPut(db, KEYS_STORE, 'privateKey', pair.privateKey)
    await idbPut(db, META_STORE, 'self', { loomId, displayName, algorithm })
    return {
      loomId,
      displayName,
      algorithm,
      avatarImageId: null,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    }
  } finally {
    db.close()
  }
}

async function generateKeypair(): Promise<{ pair: CryptoKeyPair; algorithm: string }> {
  try {
    const pair = (await crypto.subtle.generateKey(
      { name: 'Ed25519' } as AlgorithmIdentifier,
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    return { pair, algorithm: 'Ed25519' }
  } catch {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ])
    return { pair, algorithm: 'ECDSA-P256' }
  }
}

async function deriveLoomId(publicKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
  return `loom_${toBase32(digest.slice(0, 5))}`
}

function toBase32(bytes: Uint8Array): string {
  let value = 0
  let bits = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

function randomSuffix(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  let out = ''
  for (const byte of bytes) out += BASE32_ALPHABET[byte % 32]
  return out
}

function openIdentityDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(KEYS_STORE)) db.createObjectStore(KEYS_STORE)
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open identity database'))
  })
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readonly').objectStore(store).get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error ?? new Error('Identity read failed'))
  })
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = db.transaction(store, 'readwrite').objectStore(store).put(value, key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('Identity write failed'))
  })
}