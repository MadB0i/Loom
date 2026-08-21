import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Copy, Keyboard, QrCode, ScanLine, X } from 'lucide-react'
import qrcode from 'qrcode-generator'
import jsQR from 'jsqr'

import { buildPairingCode, verifyPairingCode, type Identity } from '../identity/identity'
import { addContact, getContact } from '../lane/contacts'

// PHASE 10 Part B: QR pairing. The QR carries identity only (loom:v1:<id>:<key>);
// trust is established by re-deriving the Loom ID from the embedded public key.

interface QrPairModalProps {
  identity: Identity
  onClose: () => void
}

type PairMode = 'code' | 'scan'

interface PairResult {
  ok: boolean
  message: string
}

async function pairWithCode(code: string): Promise<PairResult> {
  try {
    const payload = await verifyPairingCode(code)
    if (getContact(payload.loomId)) {
      return { ok: true, message: `Already paired with ${payload.loomId}` }
    }
    addContact({ loomId: payload.loomId, displayName: payload.loomId })
    return { ok: true, message: `Paired with ${payload.loomId}` }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Invalid pairing code',
    }
  }
}

export function QrPairModal({ identity, onClose }: QrPairModalProps) {
  const [mode, setMode] = useState<PairMode>('code')
  const [pairingCode, setPairingCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [manualCode, setManualCode] = useState('')
  const [result, setResult] = useState<PairResult | null>(null)
  const [scanError, setScanError] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    void buildPairingCode(identity).then((code) => {
      if (!cancelled) setPairingCode(code)
    })
    return () => {
      cancelled = true
    }
  }, [identity])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const qrDataUrl = useMemo(() => {
    if (!pairingCode) return null
    const qr = qrcode(0, 'M')
    qr.addData(pairingCode)
    qr.make()
    return qr.createDataURL(8, 2)
  }, [pairingCode])

  useEffect(() => {
    if (mode !== 'scan') return
    let stopped = false
    let raf = 0
    let stream: MediaStream | null = null

    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        })
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        void video.play()
        const tick = () => {
          if (stopped) return
          const canvas = canvasRef.current
          if (videoRef.current?.readyState === 4 && canvas) {
            canvas.width = videoRef.current.videoWidth
            canvas.height = videoRef.current.videoHeight
            const context = canvas.getContext('2d', { willReadFrequently: true })
            if (context) {
              context.drawImage(videoRef.current, 0, 0)
              const image = context.getImageData(0, 0, canvas.width, canvas.height)
              const found = jsQR(image.data, image.width, image.height, {
                inversionAttempts: 'dontInvert',
              })
              if (found?.data) {
                stopped = true
                cancelAnimationFrame(raf)
                void pairWithCode(found.data).then((pairResult) => {
                  setResult(pairResult)
                  if (!pairResult.ok) {
                    stopped = false
                    raf = requestAnimationFrame(tick)
                  }
                })
                return
              }
            }
          }
          raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
      } catch {
        if (!stopped) setScanError('Camera unavailable — enter the code manually below.')
      }
    }

    void start()
    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [mode])

  const copy = async () => {
    if (!pairingCode) return
    try {
      await navigator.clipboard.writeText(pairingCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      return
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      <motion.div
        className="glass-panel w-96 rounded-2xl p-5"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.18 }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="Pair a device"
      >
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-sm font-semibold text-text">Pair a device</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close pairing"
            className="rounded-md p-1 text-text-faint transition hover:bg-white/5 hover:text-text"
          >
            <X size={14} />
          </button>
        </div>

        <div className="relative mb-4 flex rounded-xl bg-black/25 p-1" role="group" aria-label="Pairing mode">
          {(['code', 'scan'] as PairMode[]).map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => {
                setMode(entry)
                setResult(null)
                setScanError(null)
              }}
              aria-pressed={mode === entry}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold capitalize transition ${
                mode === entry
                  ? 'bg-linear-to-br from-accent to-accent-blue text-white shadow-[0_0_12px_rgba(124,92,255,0.4)]'
                  : 'text-text-muted hover:text-text'
              }`}
            >
              {entry === 'code' ? <QrCode size={13} /> : <ScanLine size={13} />}
              {entry === 'code' ? 'My code' : 'Scan'}
            </button>
          ))}
        </div>

        {mode === 'code' ? (
          <div className="flex flex-col items-center gap-3">
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Your pairing QR code"
                className="h-56 w-56 rounded-xl bg-white p-2 shadow-[0_0_24px_rgba(124,92,255,0.25)]"
              />
            ) : (
              <div className="flex h-56 w-56 items-center justify-center rounded-xl bg-black/25 text-xs text-text-faint">
                Generating…
              </div>
            )}
            <p className="max-w-72 text-center text-[11px] leading-relaxed text-text-faint">
              Let the other device scan this, or copy the code and send it manually. It contains
              your public key — never your private key.
            </p>
            <button
              type="button"
              onClick={() => void copy()}
              className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-black/25 px-3 py-1.5 text-xs font-medium text-text-muted transition hover:bg-surface-2 hover:text-text"
            >
              {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy my code'}
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="relative h-56 overflow-hidden rounded-xl bg-black/40">
              <video
                ref={videoRef}
                muted
                playsInline
                className="h-full w-full object-cover"
                aria-label="Camera view for scanning a pairing code"
              />
              <canvas ref={canvasRef} className="hidden" />
              {!scanError && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="h-40 w-40 rounded-xl border-2 border-accent/70 shadow-[0_0_18px_rgba(124,92,255,0.35)]" />
                </div>
              )}
              {scanError && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
                  <Keyboard size={18} className="text-text-muted" />
                  <p className="text-xs leading-relaxed text-text-muted">{scanError}</p>
                </div>
              )}
            </div>
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!manualCode.trim()) return
                void pairWithCode(manualCode).then(setResult)
              }}
            >
              <input
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="Paste a pairing code…"
                aria-label="Manual pairing code"
                className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-[11px] text-text outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/40"
              />
              <button
                type="submit"
                disabled={!manualCode.trim()}
                className="rounded-lg bg-linear-to-br from-accent to-accent-blue px-3 py-2 text-xs font-semibold text-white transition enabled:hover:brightness-110 enabled:active:scale-[0.98] disabled:opacity-40"
              >
                Pair
              </button>
            </form>
          </div>
        )}

        {result && (
          <p
            className={`mt-4 rounded-lg px-3 py-2 text-center text-xs font-medium ${
              result.ok
                ? 'bg-emerald-500/10 text-emerald-400'
                : 'bg-red-500/10 text-red-400'
            }`}
            role="status"
          >
            {result.message}
          </p>
        )}
      </motion.div>
    </div>
  )
}
