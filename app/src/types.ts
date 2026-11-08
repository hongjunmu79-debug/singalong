export type LyricLine = {
  text: string
  /** 秒。没有时间戳时为 undefined，只能手动推进 */
  time?: number
}

export type Song = {
  id: string
  title: string
  duration: number
  hashes: Int32Array
  times: Int32Array
  lyrics: LyricLine[]
}

export type ShowPack = {
  id: string
  name: string
  artist: string
  createdAt: number
  songs: Song[]
}

export type PerformanceEntry = {
  songId: string
  startedAt: number
  /** 下一首开始时补上；最后一首可能一直为空，表示「正在进行」 */
  endedAt?: number
}

export type Performance = {
  packId: string
  startedAt: number
  entries: PerformanceEntry[]
}

export type ImportState = {
  file: string
  status: 'pending' | 'decoding' | 'fingerprinting' | 'done' | 'error'
  message?: string
  hashCount?: number
  duration?: number
  ms?: number
}
