/**
 * 地标指纹（Shazam 式）的 TypeScript 版本。
 * 与 experiment/fingerprint.py 逐参数对齐，可用 scripts/fp-check.ts 交叉验证。
 *
 * 这里不依赖任何 DOM API，可以直接在 Web Worker 和 Node 里跑。
 */

export const SR = 11025
export const N_FFT = 1024
export const HOP = 512
export const FMIN = 200
export const FMAX = 4000
export const FANOUT = 5
export const MAX_DT = 63

/** 逐帧自适应阈值：帧内中位数 + 该余量（dB） */
export const MARGIN_DB = 10
/** 时频局部极大值邻域边长（奇数） */
export const PEAK_NB = 7

type Plan = {
  n: number
  rev: Uint16Array
  cos: Float32Array
  sin: Float32Array
}

const plans = new Map<number, Plan>()

function makePlan(n: number): Plan {
  const bits = Math.round(Math.log2(n))
  if (1 << bits !== n) throw new Error('FFT 长度必须是 2 的幂')
  const rev = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b)
    rev[i] = r
  }
  const half = n >> 1
  const cos = new Float32Array(half)
  const sin = new Float32Array(half)
  for (let i = 0; i < half; i++) {
    const a = (-2 * Math.PI * i) / n
    cos[i] = Math.cos(a)
    sin[i] = Math.sin(a)
  }
  return { n, rev, cos, sin }
}

function getPlan(n: number): Plan {
  let p = plans.get(n)
  if (!p) {
    p = makePlan(n)
    plans.set(n, p)
  }
  return p
}

function fft(re: Float32Array, im: Float32Array, plan: Plan): void {
  const { n, rev, cos, sin } = plan
  for (let i = 0; i < n; i++) {
    const j = rev[i]
    if (j > i) {
      let t = re[i]
      re[i] = re[j]
      re[j] = t
      t = im[i]
      im[i] = im[j]
      im[j] = t
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1
    const step = n / size
    for (let i = 0; i < n; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cos[k]
        const wi = sin[k]
        const ar = re[i + j + half]
        const ai = im[i + j + half]
        const tr = ar * wr - ai * wi
        const ti = ar * wi + ai * wr
        re[i + j + half] = re[i + j] - tr
        im[i + j + half] = im[i + j] - ti
        re[i + j] += tr
        im[i + j] += ti
      }
    }
  }
}

function hann(n: number): Float32Array {
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
  return w
}

export type Spectrogram = {
  /** 行优先：power[t * nBins + b] */
  power: Float32Array
  nFrames: number
  nBins: number
}

export function stftPower(samples: Float32Array): Spectrogram {
  const nBins = (N_FFT >> 1) + 1
  const nFrames = Math.max(1, 1 + Math.floor((samples.length - N_FFT) / HOP))
  const power = new Float32Array(nFrames * nBins)
  const win = hann(N_FFT)
  const plan = getPlan(N_FFT)
  const re = new Float32Array(N_FFT)
  const im = new Float32Array(N_FFT)

  for (let f = 0; f < nFrames; f++) {
    const off = f * HOP
    for (let i = 0; i < N_FFT; i++) {
      const s = off + i < samples.length ? samples[off + i] : 0
      re[i] = s * win[i]
      im[i] = 0
    }
    fft(re, im, plan)
    const row = f * nBins
    for (let b = 0; b < nBins; b++) {
      const rr = re[b]
      const ii = im[b]
      power[row + b] = rr * rr + ii * ii
    }
  }
  return { power, nFrames, nBins }
}

export type Peaks = { f: Int32Array; t: Int32Array }

/** 时频局部极大值。f 是绝对频点下标，t 是帧下标。 */
export function findPeaks(
  spec: Spectrogram,
  opts: { marginDb?: number; nb?: number } = {},
): Peaks {
  const { power, nFrames, nBins } = spec
  const marginDb = opts.marginDb ?? MARGIN_DB
  const nb = opts.nb ?? PEAK_NB
  const half = nb >> 1

  const lo = Math.ceil((FMIN * N_FFT) / SR)
  const hi = Math.ceil((FMAX * N_FFT) / SR)
  const band = hi - lo

  // 1) 带内对数谱 + 逐帧中位数阈值
  const logBand = new Float32Array(nFrames * band)
  const thr = new Float32Array(nFrames)
  const tmp = new Float32Array(band)
  for (let t = 0; t < nFrames; t++) {
    const src = t * nBins + lo
    const dst = t * band
    for (let b = 0; b < band; b++) {
      const v = 10 * Math.log10(power[src + b] + 1e-10)
      logBand[dst + b] = v
      tmp[b] = v
    }
    // 逐帧中位数（与 Python 的 np.median 一致：偶数个取中间两个的平均）
    tmp.sort()
    thr[t] = (band % 2 === 1 ? tmp[(band - 1) >> 1] : (tmp[band / 2 - 1] + tmp[band / 2]) / 2) + marginDb
  }

  // 2) 频率方向最大值
  const maxH = new Float32Array(nFrames * band)
  for (let t = 0; t < nFrames; t++) {
    const row = t * band
    for (let b = 0; b < band; b++) {
      let m = -Infinity
      const from = Math.max(0, b - half)
      const to = Math.min(band - 1, b + half)
      for (let k = from; k <= to; k++) if (logBand[row + k] > m) m = logBand[row + k]
      maxH[row + b] = m
    }
  }

  // 3) 时间方向最大值 + 阈值判定
  const outF: number[] = []
  const outT: number[] = []
  for (let t = 0; t < nFrames; t++) {
    const from = Math.max(0, t - half)
    const to = Math.min(nFrames - 1, t + half)
    const row = t * band
    for (let b = 0; b < band; b++) {
      const v = logBand[row + b]
      if (v <= thr[t]) continue
      let m = -Infinity
      for (let k = from; k <= to; k++) {
        const x = maxH[k * band + b]
        if (x > m) m = x
      }
      if (v >= m) {
        outF.push(b + lo)
        outT.push(t)
      }
    }
  }

  return { f: Int32Array.from(outF), t: Int32Array.from(outT) }
}

export type Hashes = { hashes: Int32Array; times: Int32Array }

/** 峰值对组合成哈希。times 记录锚点帧。 */
export function peaksToHashes(
  peaks: Peaks,
  fanout = FANOUT,
  maxDt = MAX_DT,
): Hashes {
  const n = peaks.t.length
  if (n === 0) return { hashes: new Int32Array(0), times: new Int32Array(0) }

  const order = new Array<number>(n)
  for (let i = 0; i < n; i++) order[i] = i
  order.sort((a, b) => peaks.t[a] - peaks.t[b] || a - b)

  const f = new Int32Array(n)
  const t = new Int32Array(n)
  for (let i = 0; i < n; i++) {
    f[i] = peaks.f[order[i]]
    t[i] = peaks.t[order[i]]
  }

  const hs: number[] = []
  const ts: number[] = []
  const kMax = Math.min(fanout, n - 1)
  for (let k = 1; k <= kMax; k++) {
    for (let i = 0; i + k < n; i++) {
      const dt = t[i + k] - t[i]
      if (dt > 0 && dt <= maxDt) {
        hs.push((f[i] << 16) | (f[i + k] << 6) | dt)
        ts.push(t[i])
      }
    }
  }
  return { hashes: Int32Array.from(hs), times: Int32Array.from(ts) }
}

export function fingerprintSignal(samples: Float32Array): Hashes {
  const spec = stftPower(samples)
  const peaks = findPeaks(spec)
  return peaksToHashes(peaks)
}
