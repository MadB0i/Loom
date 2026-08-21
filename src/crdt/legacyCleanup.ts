const KEEP_DATABASES = new Set(['loom-images', 'loom-identity', 'loom-conversations-index'])

export async function cleanupLegacyDatabases(): Promise<void> {
  const factory = indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }
  if (typeof factory.databases !== 'function') return
  try {
    const databases = await factory.databases()
    for (const { name } of databases) {
      if (name && !KEEP_DATABASES.has(name)) {
        indexedDB.deleteDatabase(name)
      }
    }
  } catch {
    return
  }
}