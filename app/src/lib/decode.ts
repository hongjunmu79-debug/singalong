import { SR } from './fingerprint'

function readError(e: unknown): string {
  const name = (e as DOMException)?.name
  if (name === 'NotFoundError') return '读不到这个文件，可能已被移动或删除。重新下载后再选一次。'
  if (name === 'NotReadableError') return '系统没给读取权限。试试把文件移到「下载」目录再选。'
  if (name === 'SecurityError') return '浏览器的安全策略不允许读取这个位置。'
  if (name === 'AbortError') return '读取被中断了，再试一次。'
  return `读取文件失败：${(e as Error)?.message ?? String(e)}`
}

/**
 * 把用户选择的音频文件解码成 11025Hz 单声道。
 *
 * 用 OfflineAudioContext 而不是 AudioContext：decodeAudioData 会按上下文
 * 采样率重采样，这样两端的特征才一致；也不需要用户手势就能创建。
 */
export async function decodeFile(file: File): Promise<Float32Array> {
  let buf: ArrayBuffer
  try {
    buf = await file.arrayBuffer()
  } catch (e) {
    // 安卓/鸿蒙上很常见：选中的是一个已失效的 content:// 引用
    throw new Error(readError(e))
  }

  const ctx = new OfflineAudioContext(1, 1, SR)
  let audio: AudioBuffer
  try {
    audio = await ctx.decodeAudioData(buf)
  } catch {
    throw new Error('无法解码这个文件，换 mp3 / m4a / wav 再试')
  }

  const n = audio.length
  const out = new Float32Array(n)
  const ch = audio.numberOfChannels
  for (let c = 0; c < ch; c++) {
    const d = audio.getChannelData(c)
    const g = 1 / ch
    for (let i = 0; i < n; i++) out[i] += d[i] * g
  }

  let peak = 0
  for (let i = 0; i < n; i++) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  if (peak > 1e-6) for (let i = 0; i < n; i++) out[i] /= peak

  return out
}

/**
 * 把现场采集的一段音频重采样到 11025。
 *
 * 刻意用 OfflineAudioContext 而不是自己写插值：这样和 decodeFile 走的是
 * 浏览器同一套重采样实现，参考侧和查询侧的信道才一致。
 */
export async function resampleTo11025(samples: Float32Array, srcRate: number): Promise<Float32Array> {
  if (Math.abs(srcRate - SR) < 1) return samples

  const outLen = Math.max(1, Math.round((samples.length * SR) / srcRate))
  const ctx = new OfflineAudioContext(1, outLen, SR)
  const buf = ctx.createBuffer(1, samples.length, srcRate)
  buf.copyToChannel(samples, 0)

  const src = ctx.createBufferSource()
  src.buffer = buf
  src.connect(ctx.destination)
  src.start()

  const rendered = await ctx.startRendering()
  const out = rendered.getChannelData(0).slice()

  let peak = 0
  for (let i = 0; i < out.length; i++) {
    const a = Math.abs(out[i])
    if (a > peak) peak = a
  }
  if (peak > 1e-6) for (let i = 0; i < out.length; i++) out[i] /= peak

  return out
}
