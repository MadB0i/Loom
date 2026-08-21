import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, X } from 'lucide-react'
import type { Identity } from '../identity/identity'
import { Avatar } from './Avatar'

interface ProfileModalProps {
  identity: Identity
  onClose: () => void
  onRename: (name: string) => Promise<void>
  onAvatarChange: (file: File) => Promise<void>
}

export function ProfileModal({ identity, onClose, onRename, onAvatarChange }: ProfileModalProps) {
  const [name, setName] = useState(identity.displayName)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(identity.loomId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      return
    }
  }

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onRename(name)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        className="glass-panel w-80 rounded-2xl p-5"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Your profile"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-sm font-semibold text-text">Your profile</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close profile"
            className="rounded-md p-1 text-text-faint transition hover:bg-white/5 hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center gap-3">
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onAvatarChange(file)
              event.target.value = ''
            }}
          />
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              const file = event.dataTransfer.files?.[0]
              if (file) void onAvatarChange(file)
            }}
            title="Set profile picture — click or drop an image"
            aria-label="Set profile picture"
            className="rounded-full transition hover:brightness-110 active:scale-95"
          >
            <Avatar name={identity.displayName} imageId={identity.avatarImageId} size="lg" />
          </button>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void save()
            }}
            aria-label="Display name"
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-text outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/40"
          />
        </div>
        <p className="mt-1.5 ml-15 text-[10px] leading-snug text-text-faint">
          Click the avatar to set a picture. Stored locally on this device.
        </p>
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-text-faint">
            Loom ID
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs text-accent-blue">
              {identity.loomId}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              aria-label="Copy Loom ID"
              title="Copy Loom ID"
              className="rounded-md p-1.5 text-text-faint transition hover:bg-white/5 hover:text-text"
            >
              {copied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
            </button>
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-text-faint">
            Share this ID so others can reach you. Keys stay on this device ({identity.algorithm},
            non-extractable).
          </p>
        </div>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!name.trim() || name.trim() === identity.displayName || saving}
          className="mt-4 w-full rounded-lg bg-linear-to-br from-accent to-accent-blue px-4 py-2 text-xs font-semibold text-white shadow-[0_0_14px_rgba(124,92,255,0.35)] transition enabled:hover:brightness-110 enabled:active:scale-[0.98] disabled:opacity-40"
        >
          Save name
        </button>
      </motion.div>
    </div>
  )
}