import { useEffect, useState } from 'react'
import type { WebrtcProvider } from 'y-webrtc'

interface ConnectionStatusProps {
  sync: WebrtcProvider
}

function countPeers(sync: WebrtcProvider): number {
  const room = sync.room
  if (!room) return 0
  return room.webrtcConns.size + room.bcConns.size
}

export function ConnectionStatus({ sync }: ConnectionStatusProps) {
  const [peerCount, setPeerCount] = useState(() => countPeers(sync))

  useEffect(() => {
    const onPeers = () => setPeerCount(countPeers(sync))
    sync.on('peers', onPeers)
    return () => sync.off('peers', onPeers)
  }, [sync])

  const connected = peerCount > 0

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-end px-4">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] backdrop-blur-xl ${
          connected ? 'text-emerald-400' : 'text-text-faint'
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-text-faint'}`}
          aria-hidden="true"
        />
        {connected
          ? `${peerCount} peer${peerCount === 1 ? '' : 's'} connected`
          : 'No peers connected'}
      </span>
    </div>
  )
}