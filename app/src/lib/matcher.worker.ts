import { fingerprintSignal } from './fingerprint'
import { buildIndex, queryIndex, type Match, type SearchIndex } from './matcher'
import type { Song } from '../types'

type LoadMsg = { type: 'load'; songs: Song[] }
type MatchMsg = { type: 'match'; id: string; samples: Float32Array }
type Req = LoadMsg | MatchMsg

let index: SearchIndex | null = null

self.onmessage = (e: MessageEvent<Req>) => {
  const msg = e.data

  if (msg.type === 'load') {
    try {
      index = buildIndex(msg.songs)
      ;(self as unknown as Worker).postMessage({ type: 'loaded', count: index.hashes.length })
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ type: 'error', error: String(err) })
    }
    return
  }

  if (msg.type === 'match') {
    const t0 = performance.now()
    try {
      const { hashes, times } = fingerprintSignal(msg.samples)
      const ranked: Match[] = index ? queryIndex(index, hashes, times) : []
      ;(self as unknown as Worker).postMessage({
        type: 'result',
        id: msg.id,
        ranked,
        queryHashes: hashes.length,
        ms: performance.now() - t0,
      })
    } catch (err) {
      ;(self as unknown as Worker).postMessage({ type: 'result', id: msg.id, error: String(err), ranked: [], queryHashes: 0, ms: 0 })
    }
  }
}
