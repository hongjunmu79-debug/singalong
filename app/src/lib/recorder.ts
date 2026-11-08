/**
 * 麦克风采集。
 *
 * 明确关掉浏览器的降噪、AGC、回声消除：它们会削掉指纹依赖的频谱细节。
 * Safari 只部分尊重这些约束，所以参考侧以后也要走同样的处理链路。
 */
export class MicRecorder {
  private ctx: AudioContext | null = null
  private stream: MediaStream | null = null
  private node: AudioWorkletNode | null = null

  sampleRate = 0
  onChunk: ((chunk: Float32Array) => void) | null = null

  async start(): Promise<number> {
    if (this.ctx) return this.sampleRate

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    })

    const ctx = new AudioContext()
    await ctx.audioWorklet.addModule('/recorder-worklet.js')

    const source = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'recorder')
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      this.onChunk?.(e.data)
    }

    // 必须接到 destination 才会被拉取；用 0 增益避免回授
    const mute = ctx.createGain()
    mute.gain.value = 0
    source.connect(node)
    node.connect(mute)
    mute.connect(ctx.destination)

    await ctx.resume()

    this.ctx = ctx
    this.stream = stream
    this.node = node
    this.sampleRate = ctx.sampleRate
    return this.sampleRate
  }

  stop(): void {
    this.node?.port.close()
    this.node?.disconnect()
    this.stream?.getTracks().forEach((t) => t.stop())
    if (this.ctx) void this.ctx.close()
    this.ctx = null
    this.stream = null
    this.node = null
    this.sampleRate = 0
  }
}

/** 短时 RMS，转 dBFS */
export function chunkLevelDb(chunk: Float32Array): number {
  let sum = 0
  for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
  const rms = Math.sqrt(sum / Math.max(1, chunk.length))
  return 20 * Math.log10(rms + 1e-9)
}
