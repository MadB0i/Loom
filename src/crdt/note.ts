import * as Y from 'yjs'
import { IndexeddbPersistence } from 'y-indexeddb'
import { WebrtcProvider } from 'y-webrtc'

export class Note {
  readonly id: string
  readonly doc: Y.Doc
  readonly title: Y.Text
  readonly content: Y.Text
  readonly persistence: IndexeddbPersistence
  readonly sync: WebrtcProvider

  constructor(id: string) {
    this.id = id
    this.doc = new Y.Doc()
    this.title = this.doc.getText('title')
    this.content = this.doc.getText('content')
    this.persistence = new IndexeddbPersistence(id, this.doc)
    this.sync = new WebrtcProvider(id, this.doc)
  }

  destroy(): void {
    this.sync.destroy()
    this.persistence.destroy()
    this.doc.destroy()
  }
}