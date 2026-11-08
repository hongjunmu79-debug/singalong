/**
 * 交叉验证：TypeScript 指纹与 Python 指纹是否产出同一批哈希。
 *
 * 用法：node scripts/fp-check.ts <raw.f32> <py_hashes.bin>
 *
 * 不要求逐项完全相同 —— Python 在 float64 下算对数、TS 在 float32 下算，
 * 临界峰值会有极小概率翻转。所以看的是多重集重合率。
 */
import { readFileSync } from 'node:fs'
import { fingerprintSignal } from '../src/lib/fingerprint.ts'

const [rawPath, binPath] = process.argv.slice(2)
if (!rawPath || !binPath) {
  console.error('用法: node scripts/fp-check.ts <raw.f32> <py_hashes.bin>')
  process.exit(2)
}

const raw = readFileSync(rawPath)
const samples = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4).slice()

let peak = 0
for (let i = 0; i < samples.length; i++) {
  const a = Math.abs(samples[i])
  if (a > peak) peak = a
}
if (peak > 1e-6) for (let i = 0; i < samples.length; i++) samples[i] /= peak

const t0 = performance.now()
const { hashes } = fingerprintSignal(samples)
const ms = performance.now() - t0

const bin = readFileSync(binPath)
const py = new Int32Array(bin.buffer, bin.byteOffset, bin.byteLength / 4)

const counts = new Map<number, number>()
for (let i = 0; i < py.length; i++) counts.set(py[i], (counts.get(py[i]) ?? 0) + 1)

let matched = 0
for (let i = 0; i < hashes.length; i++) {
  const c = counts.get(hashes[i])
  if (c) {
    matched++
    counts.set(hashes[i], c - 1)
  }
}

const overlap = matched / Math.max(hashes.length, py.length, 1)

console.log(`TS     ${hashes.length.toLocaleString()} hashes，耗时 ${ms.toFixed(0)}ms`)
console.log(`Python ${py.length.toLocaleString()} hashes`)
console.log(`重合率 ${(overlap * 100).toFixed(2)}%`)

if (overlap < 0.98) {
  console.error('不一致：重合率低于 98%，移植有偏差')
  process.exit(1)
}
console.log('通过：TypeScript 移植与 Python 等价')
