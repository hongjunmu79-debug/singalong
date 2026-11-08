import type { LyricLine } from '../types'

const TIME_TAG = /^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/
const META_TAG = /^\[[a-zA-Z]+:.*\]$/

/**
 * 解析歌词。
 * - 有 [mm:ss.xx] 时间戳就是 LRC，会带时间
 * - 没有就是纯文本，只能手动推进
 */
export function parseLyrics(raw: string): LyricLine[] {
  const out: LyricLine[] = []
  let timed = false

  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim()
    if (!text) continue

    const m = text.match(TIME_TAG)
    if (m) {
      timed = true
      const frac = m[3] ? Number(m[3].padEnd(3, '0').slice(0, 3)) / 1000 : 0
      out.push({
        text: m[4].trim(),
        time: Number(m[1]) * 60 + Number(m[2]) + frac,
      })
      continue
    }
    if (META_TAG.test(text)) continue
    out.push({ text })
  }

  if (timed) out.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
  // 去掉完全空白的歌词行（有些 LRC 用空行做间隔）
  return out.filter((l) => l.text.length > 0)
}

/** 从文件名猜标题：去掉序号和扩展名 */
export function titleFromFilename(name: string): string {
  return name
    .replace(/\.[^.]+$/, '')
    .replace(/^\s*\d{1,3}[\s._-]+/, '')
    .replace(/[_]+/g, ' ')
    .trim()
}

export function hasTimestamps(lines: LyricLine[]): boolean {
  return lines.some((l) => typeof l.time === 'number')
}

/** 每一行都有时间戳，自动滚动才有意义 */
export function fullyTimed(lines: LyricLine[]): boolean {
  return lines.length > 0 && lines.every((l) => typeof l.time === 'number')
}
