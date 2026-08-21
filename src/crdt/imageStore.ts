export interface ImageRecord {
  imageId: string
  blob: Blob
  mimeType: string
}

const DB_NAME = 'loom-images'
const STORE_NAME = 'images'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'imageId' })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export class ImageStore {
  private dbPromise: Promise<IDBDatabase> | null = null
  private readonly subscribers = new Map<string, Set<() => void>>()
  private readonly allListeners = new Set<(imageId: string) => void>()

  private ensureDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDatabase()
    return this.dbPromise
  }

  async put(imageId: string, blob: Blob, mimeType: string): Promise<void> {
    const db = await this.ensureDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put({ imageId, blob, mimeType })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    this.notify(imageId)
  }

  async get(imageId: string): Promise<ImageRecord | undefined> {
    const db = await this.ensureDb()
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(imageId)
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  async listIds(): Promise<string[]> {
    const db = await this.ensureDb()
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).getAllKeys()
      request.onsuccess = () => resolve(request.result as unknown as string[])
      request.onerror = () => reject(request.error)
    })
  }

  async delete(imageId: string): Promise<void> {
    const db = await this.ensureDb()
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(imageId)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
  }

  subscribe(imageId: string, listener: () => void): () => void {
    let listeners = this.subscribers.get(imageId)
    if (!listeners) {
      listeners = new Set()
      this.subscribers.set(imageId, listeners)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  subscribeAll(listener: (imageId: string) => void): () => void {
    this.allListeners.add(listener)
    return () => {
      this.allListeners.delete(listener)
    }
  }

  private notify(imageId: string): void {
    for (const listener of this.subscribers.get(imageId) ?? []) listener()
    for (const listener of this.allListeners) listener(imageId)
  }
}

export const imageStore = new ImageStore()