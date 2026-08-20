import type { WebrtcProvider } from 'y-webrtc'
import type { Canvas } from './canvas'
import type { ImageStore } from './imageStore'

const PROTOCOL_TYPE = 0x69 // 'i' — first byte of every Loom image-protocol frame
const KIND_HAVE = 1
const KIND_REQUEST = 2
const KIND_META = 3
const KIND_CHUNK = 4

const CHUNK_SIZE = 16 * 1024 // 16KB — safe well under WebRTC message limits
const BUFFER_LOW_THRESHOLD = 64 * 1024
const IMAGE_ID_LENGTH = 36 // UUID string length, fixed-size in the chunk header

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

interface AssemblyState {
  remoteId: string
  mimeType: string
  total: number
  parts: Map<number, Uint8Array>
  received: number
}

export class ImageTransfer {
  private readonly canvas: Canvas
  private readonly sync: WebrtcProvider
  private readonly store: ImageStore

  private readonly peerChannels = new Map<string, RTCDataChannel>()
  private readonly assembling = new Map<string, AssemblyState>()
  private readonly inFlight = new Set<string>()
  private readonly bc = new BroadcastChannel('loom-images')

  private scanTimer: ReturnType<typeof setTimeout> | null = null
  private unsubscribeStore: (() => void) | null = null
  private unsubscribeCanvas: (() => void) | null = null
  private started = false

  constructor(canvas: Canvas, store: ImageStore) {
    this.canvas = canvas
    this.sync = canvas.sync
    this.store = store
    this.bc.onmessage = (event) => {
      const message = event.data
      if (message?.kind === 'image') {
        this.inFlight.delete(message.imageId)
        void this.store.put(message.imageId, message.blob, message.mimeType)
      } else if (message?.kind === 'have') {
        for (const imageId of message.ids as string[]) {
          void this.maybeRequestFromBc(imageId)
        }
      } else if (message?.kind === 'request') {
        void this.respondToBc(message.imageId)
      }
    }
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.sync.on('peers', this.handlePeers)
    this.unsubscribeStore = this.store.subscribeAll((imageId) => {
      void this.handleLocalImageStored(imageId)
    })
    this.unsubscribeCanvas = this.canvas.subscribe(() => this.scheduleScan())
    this.handlePeers()
    this.scheduleScan()
    void this.broadcastHaveToBc()
  }

  destroy(): void {
    if (!this.started) return
    this.started = false
    this.sync.off('peers', this.handlePeers)
    this.unsubscribeStore?.()
    this.unsubscribeCanvas?.()
    if (this.scanTimer !== null) clearTimeout(this.scanTimer)
    this.peerChannels.clear()
    this.assembling.clear()
    this.inFlight.clear()
    this.bc.close()
  }

  private readonly handlePeers = (): void => {
    const room = this.sync.room
    if (!room) return
    for (const [remoteId, conn] of room.webrtcConns) {
      if (this.peerChannels.has(remoteId)) continue
      this.setupPeer(remoteId, conn.peer)
    }
    for (const remoteId of [...this.peerChannels.keys()]) {
      if (!room.webrtcConns.has(remoteId)) this.teardownPeer(remoteId)
    }
  }

  private setupPeer(remoteId: string, peer: any): void {
    const channel = peer?._channel
    if (channel) {
      this.wrapChannel(remoteId, channel)
      return
    }
    peer?.on?.('connect', () => {
      const openChannel = peer._channel
      if (openChannel) this.wrapChannel(remoteId, openChannel)
    })
  }

  private wrapChannel(remoteId: string, channel: RTCDataChannel): void {
    if (this.peerChannels.get(remoteId) === channel) return
    this.peerChannels.set(remoteId, channel)
    channel.binaryType = 'arraybuffer'
    if (typeof channel.bufferedAmountLowThreshold === 'number') {
      channel.bufferedAmountLowThreshold = BUFFER_LOW_THRESHOLD
    }
    const originalOnMessage = channel.onmessage
    channel.onmessage = (event) => {
      const data = event.data as ArrayBuffer
      const buf = new Uint8Array(data)
      if (buf.length > 0 && buf[0] === PROTOCOL_TYPE) {
        this.handleFrame(remoteId, buf)
        return
      }
      if (typeof originalOnMessage === 'function') originalOnMessage.call(channel, event)
    }
    void this.advertiseTo(remoteId)
  }

  private teardownPeer(remoteId: string): void {
    this.peerChannels.delete(remoteId)
    for (const [imageId, state] of [...this.assembling]) {
      if (state.remoteId === remoteId) {
        this.assembling.delete(imageId)
        this.inFlight.delete(imageId)
      }
    }
    for (const imageId of [...this.inFlight]) {
      if (!this.assembling.has(imageId)) this.inFlight.delete(imageId)
    }
  }

  private async maybeRequestFromBc(imageId: string): Promise<void> {
    if (this.inFlight.has(imageId)) return
    const existing = await this.store.get(imageId)
    if (existing) return
    this.inFlight.add(imageId)
    this.bc.postMessage({ kind: 'request', imageId })
  }

  private async respondToBc(imageId: string): Promise<void> {
    const record = await this.store.get(imageId)
    if (!record) return
    this.bc.postMessage({ kind: 'image', imageId, mimeType: record.mimeType, blob: record.blob })
  }

  private async broadcastHaveToBc(): Promise<void> {
    const ids = await this.store.listIds()
    if (ids.length > 0) this.bc.postMessage({ kind: 'have', ids })
  }

  private async handleLocalImageStored(imageId: string): Promise<void> {
    const record = await this.store.get(imageId)
    if (!record) return
    this.bc.postMessage({ kind: 'image', imageId, mimeType: record.mimeType, blob: record.blob })
    this.broadcastJson(KIND_HAVE, { ids: [imageId] })
  }

  private scheduleScan(): void {
    if (this.scanTimer !== null) clearTimeout(this.scanTimer)
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null
      this.scanMissingImages()
    }, 150)
  }

  private scanMissingImages(): void {
    const ids = new Set<string>()
    for (const element of this.canvas.getSnapshot()) {
      if (element.type === 'image') ids.add(element.imageId)
    }
    for (const imageId of ids) {
      if (this.inFlight.has(imageId)) continue
      this.inFlight.add(imageId)
      void this.request(imageId)
    }
  }

  private async request(imageId: string): Promise<void> {
    if (this.peerChannels.size === 0) {
      this.inFlight.delete(imageId)
      return
    }
    this.broadcastJson(KIND_REQUEST, { imageId })
  }

  private async handleFrame(remoteId: string, buf: Uint8Array): Promise<void> {
    const kind = buf[1]
    if (kind === KIND_HAVE) {
      const { ids } = JSON.parse(textDecoder.decode(buf.subarray(2))) as { ids: string[] }
      for (const imageId of ids) {
        const existing = await this.store.get(imageId)
        if (!existing && !this.inFlight.has(imageId)) {
          this.inFlight.add(imageId)
          void this.request(imageId)
        }
      }
      return
    }
    if (kind === KIND_REQUEST) {
      const { imageId } = JSON.parse(textDecoder.decode(buf.subarray(2))) as { imageId: string }
      const record = await this.store.get(imageId)
      if (record) await this.sendImage(remoteId, record)
      return
    }
    if (kind === KIND_META) {
      const { imageId, mimeType, total } = JSON.parse(textDecoder.decode(buf.subarray(2))) as {
        imageId: string
        mimeType: string
        total: number
      }
      this.assembling.set(imageId, { remoteId, mimeType, total, parts: new Map(), received: 0 })
      return
    }
    if (kind === KIND_CHUNK) {
      const imageId = textDecoder.decode(buf.subarray(2, 2 + IMAGE_ID_LENGTH))
      const index = (buf[2 + IMAGE_ID_LENGTH] << 24) | (buf[3 + IMAGE_ID_LENGTH] << 16) | (buf[4 + IMAGE_ID_LENGTH] << 8) | buf[5 + IMAGE_ID_LENGTH]
      const payload = buf.subarray(6 + IMAGE_ID_LENGTH)
      const state = this.assembling.get(imageId)
      if (!state || state.remoteId !== remoteId) return
      state.parts.set(index, payload)
      state.received++
      if (state.received === state.total) {
        this.assembling.delete(imageId)
        this.inFlight.delete(imageId)
        const parts = [...state.parts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, part]) => part)
        const blob = new Blob(parts as BlobPart[], { type: state.mimeType })
        await this.store.put(imageId, blob, state.mimeType)
      }
    }
  }

  private async sendImage(remoteId: string, record: { imageId: string; blob: Blob; mimeType: string }): Promise<void> {
    const channel = this.peerChannels.get(remoteId)
    if (!channel) return
    const buffer = await record.blob.arrayBuffer()
    const total = Math.max(1, Math.ceil(buffer.byteLength / CHUNK_SIZE))
    const ok = await this.sendJsonFrame(channel, KIND_META, {
      imageId: record.imageId,
      mimeType: record.mimeType,
      total,
      size: buffer.byteLength,
    })
    if (!ok) return
    for (let i = 0; i < total; i++) {
      const start = i * CHUNK_SIZE
      const end = Math.min(buffer.byteLength, start + CHUNK_SIZE)
      const frame = buildChunkFrame(record.imageId, i, new Uint8Array(buffer, start, end - start))
      const sent = await this.sendWithBackpressure(channel, frame)
      if (!sent) break
    }
  }

  private broadcastJson(kind: number, payload: object): void {
    const frame = buildJsonFrame(kind, payload)
    for (const channel of this.peerChannels.values()) {
      void this.sendWithBackpressure(channel, frame)
    }
  }

  private async sendJsonFrame(channel: RTCDataChannel, kind: number, payload: object): Promise<boolean> {
    return this.sendWithBackpressure(channel, buildJsonFrame(kind, payload))
  }

  private async sendWithBackpressure(
    channel: RTCDataChannel,
    frame: Uint8Array<ArrayBuffer>,
  ): Promise<boolean> {
    if (channel.readyState !== 'open') return false
    if (channel.bufferedAmount + frame.byteLength > BUFFER_LOW_THRESHOLD) {
      await this.waitForBufferedLow(channel)
    }
    try {
      channel.send(frame)
      return true
    } catch {
      return false
    }
  }

  private waitForBufferedLow(channel: RTCDataChannel): Promise<void> {
    return new Promise((resolve) => {
      const onLow = () => {
        channel.removeEventListener('bufferedamountlow', onLow)
        resolve()
      }
      channel.addEventListener('bufferedamountlow', onLow)
      setTimeout(() => {
        channel.removeEventListener('bufferedamountlow', onLow)
        resolve()
      }, 1000)
    })
  }

  private async advertiseTo(remoteId: string): Promise<void> {
    const channel = this.peerChannels.get(remoteId)
    if (!channel) return
    const ids = await this.store.listIds()
    await this.sendJsonFrame(channel, KIND_HAVE, { ids })
  }
}

function buildJsonFrame(kind: number, payload: object): Uint8Array<ArrayBuffer> {
  const body = textEncoder.encode(JSON.stringify(payload))
  const frame = new Uint8Array(2 + body.length)
  frame[0] = PROTOCOL_TYPE
  frame[1] = kind
  frame.set(body, 2)
  return frame
}

function buildChunkFrame(imageId: string, index: number, payload: Uint8Array): Uint8Array<ArrayBuffer> {
  const idBytes = textEncoder.encode(imageId)
  const frame = new Uint8Array(2 + IMAGE_ID_LENGTH + 4 + payload.length)
  frame[0] = PROTOCOL_TYPE
  frame[1] = KIND_CHUNK
  frame.set(idBytes, 2)
  frame[2 + IMAGE_ID_LENGTH] = (index >>> 24) & 0xff
  frame[3 + IMAGE_ID_LENGTH] = (index >>> 16) & 0xff
  frame[4 + IMAGE_ID_LENGTH] = (index >>> 8) & 0xff
  frame[5 + IMAGE_ID_LENGTH] = index & 0xff
  frame.set(payload, 6 + IMAGE_ID_LENGTH)
  return frame
}