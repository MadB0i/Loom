import { motion } from 'framer-motion'
import { Check, Loader2 } from 'lucide-react'
import type { MessageData } from '../crdt/conversation'
import { useImage } from '../hooks/useImage'

interface MessageBubbleProps {
  message: MessageData
  mine: boolean
  senderLabel: string
  showSender: boolean
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function MessageBubble({ message, mine, senderLabel, showSender }: MessageBubbleProps) {
  const time = formatTime(message.createdAt)
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={`flex ${mine ? 'justify-end' : 'justify-start'}`}
    >
      <div className={`flex max-w-[75%] flex-col ${mine ? 'items-end' : 'items-start'}`}>
        {showSender && !mine && (
          <span className="mb-0.5 ml-1 text-[11px] font-semibold text-accent-blue">
            {senderLabel}
          </span>
        )}
        {message.type === 'text' ? (
          <div
            className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm leading-relaxed ${
              mine
                ? 'rounded-br-md bg-linear-to-br from-accent to-accent-blue text-white shadow-[0_2px_14px_rgba(124,92,255,0.35)]'
                : 'rounded-bl-md border border-white/[0.08] bg-surface-2/90 text-text shadow-[0_1px_4px_rgba(0,0,0,0.25)]'
            }`}
          >
            {message.content}
            <span
              className={`ml-2 inline-flex items-center gap-0.5 align-bottom text-[10px] tabular-nums ${
                mine ? 'text-white/60' : 'text-text-faint'
              }`}
            >
              {time}
              {mine && <Check size={11} aria-label="Sent" />}
            </span>
          </div>
        ) : (
          <ImageBubble imageId={message.imageId} time={time} mine={mine} />
        )}
      </div>
    </motion.div>
  )
}

function ImageBubble({ imageId, time, mine }: { imageId: string; time: string; mine: boolean }) {
  const { url, missing } = useImage(imageId)
  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-black/30 ${
        mine ? 'rounded-br-md border-accent/30' : 'rounded-bl-md border-white/10'
      }`}
    >
      {missing ? (
        <div className="flex h-40 w-56 flex-col items-center justify-center gap-2">
          <Loader2 size={16} className="animate-spin text-text-faint" />
          <span className="text-[11px] text-text-faint">Fetching from peer…</span>
        </div>
      ) : url ? (
        <>
          <img src={url} alt="" draggable={false} className="max-h-72 max-w-full object-contain" />
          <div className="flex items-center justify-end gap-0.5 px-2.5 py-1 text-[10px] tabular-nums text-text-faint">
            {time}
            {mine && <Check size={11} aria-label="Sent" />}
          </div>
        </>
      ) : null}
    </div>
  )
}