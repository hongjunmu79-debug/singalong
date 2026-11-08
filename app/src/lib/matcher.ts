/**
 * 闭集检索：在用户导入的曲库内找最像的一段。
 * 与 experiment/fingerprint.py 的 Index.query 同一套投票逻辑。
 */
import type { Song } from '../types'

export type SearchIndex = {
  /** 升序排列，供二分查找 */
  hashes: Int32Array
  song: Int32Array
  time: Int32Array
  songIds: string[]
  titles: string[]
}

export type Match = {
  songIdx: number
  score: number
}

export const DT_TOL = 1

export function buildIndex(songs: Song[]): SearchIndex {
  let total = 0
  for (const s of songs) total += s.hashes.length

  const h = new Int32Array(total)
  const sg = new Int32Array(total)
  const tm = new Int32Array(total)

  let o = 0
  songs.forEach((s, i) => {
    h.set(s.hashes, o)
    tm.set(s.times, o)
    sg.fill(i, o, o + s.hashes.length)
    o += s.hashes.length
  })

  const order = new Int32Array(total)
  for (let i = 0; i < total; i++) order[i] = i
  order.sort((a, b) => h[a] - h[b] || a - b)

  const sh = new Int32Array(total)
  const ss = new Int32Array(total)
  const st = new Int32Array(total)
  for (let i = 0; i < total; i++) {
    sh[i] = h[order[i]]
    ss[i] = sg[order[i]]
    st[i] = tm[order[i]]
  }

  return {
    hashes: sh,
    song: ss,
    time: st,
    songIds: songs.map((s) => s.id),
    titles: songs.map((s) => s.title),
  }
}

function lowerBound(arr: Int32Array, v: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] < v) lo = mid + 1
    else hi = mid
  }
  return lo
}

function upperBound(arr: Int32Array, v: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid] <= v) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** 时差允许 ±dtTol 帧：混响会把峰值时间抹开几十毫秒 */
function expandDt(hashes: Int32Array, times: Int32Array, tol: number) {
  if (tol <= 0) return { hashes, times }
  const hs: number[] = []
  const ts: number[] = []
  for (let i = 0; i < hashes.length; i++) {
    const h = hashes[i]
    const dt = h & 63
    hs.push(h)
    ts.push(times[i])
    for (let d = 1; d <= tol; d++) {
      if (dt > d) {
        hs.push(h - d)
        ts.push(times[i])
      }
      if (dt < 63 - d) {
        hs.push(h + d)
        ts.push(times[i])
      }
    }
  }
  return { hashes: Int32Array.from(hs), times: Int32Array.from(ts) }
}

/**
 * 返回按得分降序的候选。score = 同一首歌、同一时间偏移上命中的哈希数最大值。
 */
export function queryIndex(
  index: SearchIndex,
  qHashes: Int32Array,
  qTimes: Int32Array,
  opts: { dtTol?: number; topk?: number } = {},
): Match[] {
  const dtTol = opts.dtTol ?? DT_TOL
  const topk = opts.topk ?? 3
  if (qHashes.length === 0 || index.hashes.length === 0) return []

  const { hashes, times } = expandDt(qHashes, qTimes, dtTol)
  const votes = new Map<number, number>()

  for (let i = 0; i < hashes.length; i++) {
    const lo = lowerBound(index.hashes, hashes[i])
    const hi = upperBound(index.hashes, hashes[i])
    for (let j = lo; j < hi; j++) {
      const offset = index.time[j] - times[i]
      const key = index.song[j] * 1_000_000 + (offset + 500_000)
      votes.set(key, (votes.get(key) ?? 0) + 1)
    }
  }

  const best = new Map<number, number>()
  for (const [key, count] of votes) {
    const songIdx = Math.floor(key / 1_000_000)
    if (count > (best.get(songIdx) ?? 0)) best.set(songIdx, count)
  }

  return [...best.entries()]
    .map(([songIdx, score]) => ({ songIdx, score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topk)
}
