import { useCallback, useEffect, useRef, useState } from 'react'
import { getPack, recordSongStart } from '../lib/db'
import { fullyTimed } from '../lib/lyrics'
import { useWakeLock } from '../lib/wakeLock'
import type { ShowPack } from '../types'

type Props = {
  packId: string
  songId: string
  /** 从现场页确认进来、或在曲目单里切歌时为 true；只是浏览歌词时为 false */
  record: boolean
  onExit: () => void
  onSwitch: (songId: string) => void
}

const LONG_PRESS_MS = 600
const SWIPE_MIN = 40

export default function Stage({ packId, songId, record, onExit, onSwitch }: Props) {
  const [pack, setPack] = useState<ShowPack | null>(null)
  const [idx, setIdx] = useState(0)
  const [showList, setShowList] = useState(false)
  const [auto, setAuto] = useState(false)
  const wakeOk = useWakeLock(true)

  const start = useRef<{ x: number; y: number; t: number } | null>(null)
  const longTimer = useRef<number | null>(null)
  const longFired = useRef(false)
  const autoAnchor = useRef<{ at: number; baseTime: number } | null>(null)

  useEffect(() => {
    void getPack(packId).then((p) => setPack(p ?? null))
  }, [packId])

  useEffect(() => {
    setIdx(0)
    setAuto(false)
  }, [songId])

  const recordedRef = useRef('')
  useEffect(() => {
    if (!record || !pack) return
    const key = `${packId}:${songId}`
    if (recordedRef.current === key) return
    recordedRef.current = key
    void recordSongStart(packId, songId)
  }, [record, pack, packId, songId])

  const song = pack?.songs.find((s) => s.id === songId)
  const lines = song?.lyrics ?? []
  const total = lines.length

  const next = useCallback(() => {
    setAuto(false)
    setIdx((i) => Math.min(i + 1, Math.max(total - 1, 0)))
  }, [total])
  const back = useCallback(() => {
    setAuto(false)
    setIdx((i) => Math.max(i - 1, 0))
  }, [])

  /**
   * 自动滚动。不是从第 0 句开始——现场多半是中途进歌，我们从「当前这句」的
   * 时间戳起算，所以必须由用户先手动点到位，再打开自动。
   * 任何一次点击/滑动都会立刻交还手动。
   */
  useEffect(() => {
    if (!auto) return
    const anchorTime = lines[idx]?.time
    autoAnchor.current = {
      at: performance.now(),
      baseTime: typeof anchorTime === 'number' ? anchorTime : 0,
    }

    const id = window.setInterval(() => {
      const a = autoAnchor.current
      if (!a) return
      const elapsed = a.baseTime + (performance.now() - a.at) / 1000
      setIdx((cur) => {
        let n = cur
        while (n + 1 < lines.length && (lines[n + 1].time ?? Infinity) <= elapsed) n += 1
        return n
      })
    }, 150)

    return () => window.clearInterval(id)
    // idx 只在启动那一刻取值，不放进依赖，否则每前进一句都会重建定时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight' || e.key === ' ') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      } else if (e.key === 'Escape') {
        onExit()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, onExit])

  function clearTimer() {
    if (longTimer.current !== null) {
      window.clearTimeout(longTimer.current)
      longTimer.current = null
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY, t: Date.now() }
    longFired.current = false
    clearTimer()
    longTimer.current = window.setTimeout(() => {
      longFired.current = true
      setAuto(false)
      setShowList(true)
    }, LONG_PRESS_MS)
  }

  function onPointerUp(e: React.PointerEvent) {
    clearTimer()
    const s = start.current
    start.current = null
    if (!s || longFired.current) return

    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (Math.abs(dx) > SWIPE_MIN && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) back()
      else next()
      return
    }
    if (Date.now() - s.t < LONG_PRESS_MS) next()
  }

  function onPointerCancel() {
    clearTimer()
    start.current = null
  }

  if (!pack) {
    return (
      <div className="stage">
        <p className="muted">读取中…</p>
      </div>
    )
  }

  if (!song) {
    return (
      <div className="stage">
        <p className="muted">找不到这首歌</p>
        <button className="secondary" onClick={onExit}>
          返回
        </button>
      </div>
    )
  }

  if (total === 0) {
    return (
      <div className="stage">
        <div className="stage-top">
          <button className="stage-back" onClick={onExit} aria-label="返回">
            ‹
          </button>
          <span className="stage-title">{song.title}</span>
          <span className="stage-count" />
        </div>
        <div className="stage-body empty-stage">
          <p className="muted">这首歌还没有歌词。</p>
          <p className="hint">回到上一页，点「加歌词」粘贴或导入 .lrc。</p>
        </div>
      </div>
    )
  }

  const cur = lines[idx]
  const nextLine = lines[idx + 1]
  const prevLine = idx > 0 ? lines[idx - 1] : undefined
  const timed = fullyTimed(lines)

  return (
    <div className="stage" onContextMenu={(e) => e.preventDefault()}>
      <div className="stage-top">
        <button className="stage-back" onClick={onExit} aria-label="返回">
          ‹
        </button>
        <span className="stage-title">{song.title}</span>
        {timed && (
          <button
            className={`auto-btn ${auto ? 'on' : ''}`}
            onClick={() => setAuto((v) => !v)}
            aria-pressed={auto}
          >
            {auto ? '自动中' : '自动'}
          </button>
        )}
        <span className="stage-count">
          {idx + 1} / {total}
        </span>
      </div>

      <div
        className="stage-body"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {prevLine && <div className="line prev">{prevLine.text}</div>}
        <div className="line current">{cur.text}</div>
        {nextLine && <div className="line next">{nextLine.text}</div>}
        {!nextLine && <div className="line next end">— 完 —</div>}
      </div>

      <div className="stage-hint">
        {auto ? '自动滚动中 · 点一下接管' : '轻点下一句 · 左滑上一句 · 长按曲目单'}
        {!wakeOk && <span className="stage-warn"> · 屏幕可能自动熄灭，建议把系统自动锁屏调长</span>}
      </div>

      {showList && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setShowList(false)}>
          <div className="sheet">
            <h3>{pack.name}</h3>
            {pack.songs.map((s, i) => (
              <button
                key={s.id}
                className={`song-option ${s.id === songId ? 'active' : ''}`}
                onClick={() => {
                  setShowList(false)
                  if (s.id !== songId) onSwitch(s.id)
                }}
              >
                <span className="song-index">{String(i + 1).padStart(2, '0')}</span>
                {s.title}
                {s.lyrics.length === 0 && <span className="tag">无歌词</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
