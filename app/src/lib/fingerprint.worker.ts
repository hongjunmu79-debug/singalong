import { fingerprintSignal } from './fingerprint'

type Req = { id: string; samples: Float32Array }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, samples } = e.data
  try {
    const t0 = performance.now()
    const { hashes, times } = fingerprintSignal(samples)
    const ms = performance.now() - t0
    ;(self as unknown as Worker).postMessage(
      { id, hashes, times, ms },
      [hashes.buffer, times.buffer],
    )
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: String(err) })
  }
}
