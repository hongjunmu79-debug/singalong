/**
 * 交叉验证：TypeScript 检索结果与 Python 检索结果是否一致。
 *
 * 用法：node scripts/match-check.ts <a.f32> <b.f32> <offsetSec> <py_result.json>
 */
import { readFileSync } from 'node:fs'
import { fingerprintSignal } from '../src/lib/fingerprint.ts'
import { buildIndex, queryIndex } from '../src/lib/matcher.ts'

const [aPath, bPath, offsetArg, jsonPath] = process.argv.slice(2)
if (!aPath || !bPath || !offsetArg || !jsonPath) {
  console.error('用法: node scripts/match-check.ts <a.f32> <b.f32> <offsetSec> <py_result.json>')
  process.exit(2)
}

function load(path: string): Float32Array {
  const buf = readFileSync(path)
  const y = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4).slice()
  let peak = 0
  for (let i = 0; i < y.length; i++) {
    const v = Math.abs(y[i])
    if (v > peak) peak = v
  }
  if (peak > 1e-6) for (let i = 0; i < y.length; i++) y[i] /= peak
  return y
}

const SR = 11025
const CLIP = 8 * SR

const ya = load(aPath)
const yb = load(bPath)

const songs = [ya, yb].map((samples, i) => {
  const { hashes, times } = fingerprintSignal(samples)
  return { id: `s${i}`, title: `song${i}`, duration: samples.length / SR, hashes, times, lyrics: [] }
})

const index = buildIndex(songs)

const start = Math.round(Number(offsetArg) * SR)
const clip = ya.slice(start, start + CLIP)
const q = fingerprintSignal(clip)
const ranked = queryIndex(index, q.hashes, q.times, { topk: 3 })

const py = JSON.parse(readFileSync(jsonPath, 'utf8')) as {
  queryHashes: number
  ranked: { song: number; score: number }[]
}

const tsRanked = ranked.map((m) => ({ song: m.songIdx, score: m.score }))
const same =
  py.queryHashes === q.hashes.length &&
  py.ranked.length === tsRanked.length &&
  py.ranked.every((p, i) => p.song === tsRanked[i].song && Math.abs(p.score - tsRanked[i].score) < 1e-6)

console.log(`TS     queryHashes=${q.hashes.length} ranked=${JSON.stringify(tsRanked)}`)
console.log(`Python queryHashes=${py.queryHashes} ranked=${JSON.stringify(py.ranked)}`)
console.log(`索引 ${index.hashes.length.toLocaleString()} 条`)

if (!same) {
  console.error('不一致：检索结果与 Python 版不同')
  process.exit(1)
}
console.log('通过：TypeScript 检索与 Python 一致')
