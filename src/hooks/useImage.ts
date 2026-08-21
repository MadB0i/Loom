import { useEffect, useState } from 'react'
import { imageStore } from '../crdt/imageStore'

export function useImage(imageId: string): { url: string | null; missing: boolean } {
  const [url, setUrl] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const load = async () => {
      const record = await imageStore.get(imageId)
      if (cancelled) return
      if (record) {
        if (objectUrl) URL.revokeObjectURL(objectUrl)
        objectUrl = URL.createObjectURL(record.blob)
        setUrl(objectUrl)
        setMissing(false)
      } else {
        setMissing(true)
      }
    }
    void load()
    const unsubscribe = imageStore.subscribe(imageId, () => {
      void load()
    })
    return () => {
      cancelled = true
      unsubscribe()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [imageId])

  return { url, missing }
}