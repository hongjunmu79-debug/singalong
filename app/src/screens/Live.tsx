import { useEffect, useRef, useState } from 'react'
import { getPack } from '../lib/db'
import { resampleTo11025 } from '../lib/decode'
import { chunkLevelDb, MicRecorder } from '../lib/recorder'
import { uid } from '../lib/uid'
import { useWakeLock } from '../lib/wakeLock'
import type { Match } from '../lib/matcher'
import type { ShowPack } from '../types'

type Props = {
  packId: string
  onExit: () => void
  onSing: (songId: string) => void
}

type Phase = 'off' | 'calibrating' | 'listening' | 'capturing' | 'matching' | 'suggest' | 'unknown' | 'error'

const CLIP_SECONDS = 8
const CALIBRATE_MS = 1500
const TRIGGER_OVER_FLOOR_DB = 10
const TRIGGER_MIN_DBFS = -50
const TRIGGER_HOLD_MS = 400
const REARM_QUIET_MS = 2000

/**
 * 置信度阈值。
 *
 * 1% 来自 2026-11-06 的真实音乐实验（见 experiment/NOTES.md）：
 * 在该条件下覆盖 89.7% 的正确结果，误报 17.6%。原来是 2%，只覆盖 40%，
 * 会让大部分识别退化成「没听清」。
 *
 * 但这仍然是临时值 —— 实验用的是同一段录音自查询，真实「现场对录音室」
 * 得分会更低，拿到真实现场录音后必须重标。
 */
const CONFIDENT_RATE = 0.01
const DOMINANCE = 1.4

export default function Live({ packId, onExit, onSing }: Props) {
  const [pack, setPack] = useState<ShowPack | null>(null)
  const [phase, setPhase] = useState<Phase>('off')
  const [level, setLevel] = useState(-100)
  const [result, setResult] = useState<{ ranked: Match[]; rate: number; ms: number; queryHashes: number } | null>(null)
  const [error, setError] = useState('')
  const [showPicker, setShowPicker] = useState(false)
  const [workerReady, setWorkerReady] = useState(false)
  const [floorDb, setFloorDb] = useState<number | null>(null)
  const [captureSec, setCaptureSec] = useState(0)
  const wakeOk = useWakeLock(true)

  const workerRef = useRef<Worker | null>(null)
  const recRef = useRef<MicRecorder | null>(null)
  const phaseRef = useRef<Phase>('off')
  const setP = (p: Phase) => {
    phaseRef.current = p
    setPhase(p)
  }

  const noiseFloor = useRef(-60)
  const calib = useRef({ n: 0, sum: 0 })
  const capture = useRef<{ chunks: Float32Array[]; len: number; rate: number } | null>(null)
  const loudMs = useRef(0)
  const quietMs = useRef(0)
  const lastLevelAt = useRef(0)

  useEffect(() => {
    void getPack(packId).then((p) => setPack(p ?? null))
  }, [packId])

  useEffect(() => {
    const w = new Worker(new URL('../lib/matcher.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent) => {
      const msg = e.data
      if (msg.type === 'loaded') {
        setWorkerReady(true)
        return
      }
      if (msg.type === 'result') {
        const ranked = (msg.ranked ?? []) as Match[]
        const rate = ranked.length ? ranked[0].score / Math.max(1, msg.queryHashes) : 0
        setResult({ ranked, rate, ms: msg.ms ?? 0, queryHashes: msg.queryHashes ?? 0 })
        const confident =
          ranked.length > 0 &&
          rate >= CONFIDENT_RATE &&
          (ranked.length === 1 || ranked[0].score >= ranked[1].score * DOMINANCE)
        setP(confident ? 'suggest' : 'unknown')
      }
    }
    workerRef.current = w
    return () => {
      w.terminate()
      workerRef.current = null
      setWorkerReady(false)
    }
  }, [])

  useEffect(() => {
    if (pack && workerReady) {
      workerRef.current?.postMessage({ type: 'load', songs: pack.songs })
    }
  }, [pack, workerReady])

  useEffect(() => {
    return () => {
      recRef.current?.stop()
      recRef.current = null
    }
  }, [])

  function handleChunk(chunk: Float32Array) {
    const now = performance.now()
    const db = chunkLevelDb(chunk)
    if (now - lastLevelAt.current > 100) {
      lastLevelAt.current = now
      setLevel(db)
    }

    const rate = recRef.current?.sampleRate ?? 0
    const ms = rate ? (chunk.length / rate) * 1000 : 0
    const p = phaseRef.current

    if (p === 'calibrating') {
      calib.current.n += 1
      calib.current.sum += db
      if (calib.current.n * ms >= CALIBRATE_MS) {
        noiseFloor.current = calib.current.sum / calib.current.n
        setFloorDb(noiseFloor.current)
        loudMs.current = 0
        quietMs.current = 0
        setP('listening')
      }
      return
    }

    const threshold = Math.max(TRIGGER_MIN_DBFS, noiseFloor.current + TRIGGER_OVER_FLOOR_DB)

    if (p === 'listening') {
      if (db > threshold) {
        loudMs.current += ms
        if (loudMs.current >= TRIGGER_HOLD_MS) {
          capture.current = { chunks: [], len: 0, rate }
          setCaptureSec(0)
          loudMs.current = 0
          setP('capturing')
        }
      } else {
        loudMs.current = 0
      }
      return
    }

    if (p === 'capturing') {
      const c = capture.current
      if (!c) return
      c.chunks.push(chunk)
      c.len += chunk.length
      if (now - lastLevelAt.current < 100) {
        // 同一帧内顺带更新录音进度，避免额外触发渲染
      }
      setCaptureSec(c.len / c.rate)
      if (c.len >= CLIP_SECONDS * c.rate) void finishCapture()
      return
    }

    if (p === 'suggest' || p === 'unknown') {
      // 歌曲换场：安静超过阈值后重新进入监听
      if (db < threshold - 6) {
        quietMs.current += ms
        if (quietMs.current >= REARM_QUIET_MS) {
          quietMs.current = 0
          setResult(null)
          setP('listening')
        }
      } else {
        quietMs.current = 0
      }
    }
  }

  async function finishCapture() {
    const c = capture.current
    capture.current = null
    if (!c) return
    setP('matching')

    const total = new Float32Array(c.len)
    let o = 0
    for (const ch of c.chunks) {
      total.set(ch, o)
      o += ch.length
    }

    const samples = await resampleTo11025(total, c.rate)
    workerRef.current?.postMessage({ type: 'match', id: uid(), samples }, [samples.buffer])
  }

  async function start() {
    setError('')
    setResult(null)
    try {
      if (!recRef.current) {
        const rec = new MicRecorder()
        rec.onChunk = handleChunk
        recRef.current = rec
      }
      await recRef.current.start()
      calib.current = { n: 0, sum: 0 }
      noiseFloor.current = -60
      setP('calibrating')
    } catch (e) {
      setError(e instanceof Error ? e.message : '无法打开麦克风')
      setP('error')
    }
  }

  function stop() {
    recRef.current?.stop()
    recRef.current = null
    capture.current = null
    setResult(null)
    setLevel(-100)
    setP('off')
  }

  function retry() {
    setResult(null)
    quietMs.current = 0
    setP('listening')
  }

  const levelPct = Math.max(0, Math.min(1, (level + 60) / 60))
  const top = result?.ranked[0]

  return (
    <div className="live">
      <div className="stage-top">
        <button className="stage-back" onClick={onExit} aria-label="返回">
          ‹
        </button>
        <span className="stage-title">{pack?.name ?? '现场'}</span>
        <span className="stage-count">{phaseLabel(phase)}</span>
      </div>

      <div className="live-body">
        {phase === 'off' && (
          <>
            <p className="live-headline">准备好了就开始</p>
            <p className="hint">
              把手机举到能听清舞台的位置。识别只在本地进行，音频不上传，也不留档。
            </p>
          </>
        )}

        {phase === 'error' && (
          <>
            <p className="live-headline">打不开麦克风</p>
            <p className="hint">{error}</p>
            <p className="hint">检查一下浏览器权限，或者换成 https 打开。</p>
          </>
        )}

        {(phase === 'calibrating' || phase === 'listening') && (
          <>
            <p className="live-headline">
              {phase === 'calibrating' ? '正在适应环境噪声…' : '正在听'}
            </p>
            <div className="level-meter">
              <div className="level-fill" style={{ width: `${levelPct * 100}%` }} />
            </div>
            <p className="hint">
              {phase === 'listening' ? '等到台上开始唱，我会自动听 8 秒。' : '别说话，一秒半就好。'}
            </p>
          </>
        )}

        {phase === 'capturing' && (
          <>
            <p className="live-headline">正在听这 8 秒</p>
            <div className="level-meter">
              <div className="level-fill" style={{ width: `${levelPct * 100}%` }} />
            </div>
          </>
        )}

        {phase === 'matching' && <p className="live-headline">匹配中…</p>}

        {phase === 'suggest' && top && pack && (
          <>
            <p className="live-kicker">疑似</p>
            <p className="live-song">{pack.songs[top.songIdx]?.title}</p>
            <p className="hint">
              匹配度 {(result!.rate * 100).toFixed(1)}% · {Math.round(result!.ms)}ms
              {result!.ranked[1] &&
                ` · 次选「${pack.songs[result!.ranked[1].songIdx]?.title}」`}
            </p>
          </>
        )}

        {phase === 'unknown' && (
          <>
            <p className="live-headline">没听清是哪首</p>
            {result && result.ranked.length > 0 && pack ? (
              <ul className="candidate-list">
                {result.ranked.map((m) => (
                  <li key={m.songIdx}>
                    <button className="song-option" onClick={() => onSing(pack.songs[m.songIdx].id)}>
                      {pack.songs[m.songIdx]?.title}
                      <span className="tag">{((m.score / Math.max(1, result.ranked[0].score)) * 100).toFixed(0)}%</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hint">可能是歌太小众，或者离得太远。</p>
            )}
          </>
        )}
        {(phase === 'calibrating' ||
          phase === 'listening' ||
          phase === 'capturing' ||
          phase === 'matching') && (
          <p className="live-debug">
            {phase === 'calibrating'
              ? '校准中…'
              : phase === 'capturing'
                ? `正在录 ${captureSec.toFixed(1)} / 8.0 秒 · 当前 ${level.toFixed(0)} dB`
                : phase === 'matching'
                  ? '正在比对…'
                  : floorDb !== null
                    ? `底噪 ${floorDb.toFixed(0)} dB · 当前 ${level.toFixed(0)} dB · 触发线 ${Math.max(TRIGGER_MIN_DBFS, floorDb + TRIGGER_OVER_FLOOR_DB).toFixed(0)} dB`
                    : ''}
          </p>
        )}

        {result && (phase === 'suggest' || phase === 'unknown') && (
          <p className="live-debug">
            查询 {result.queryHashes} 个指纹 · 最高 {result.ranked[0]?.score ?? 0} 票 ·{' '}
            {(result.rate * 100).toFixed(2)}% · {Math.round(result.ms)}ms
          </p>
        )}
      </div>

      <div className="live-actions">
        {!wakeOk && (
          <p className="live-warn">屏幕可能自动熄灭，建议把系统自动锁屏调长</p>
        )}
        {phase === 'off' || phase === 'error' ? (
          <button className="primary" onClick={() => void start()}>
            开始识别
          </button>
        ) : phase === 'suggest' && top && pack ? (
          <>
            <button className="primary" onClick={() => onSing(pack.songs[top.songIdx].id)}>
              就是这首
            </button>
            <button className="secondary" onClick={retry}>
              不是，再听
            </button>
          </>
        ) : phase === 'unknown' ? (
          <>
            <button className="primary" onClick={retry}>
              再听一次
            </button>
            <button className="secondary" onClick={() => setShowPicker(true)}>
              手动选歌
            </button>
          </>
        ) : (
          <button className="secondary" onClick={stop}>
            停止
          </button>
        )}
      </div>

      {showPicker && pack && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setShowPicker(false)}>
          <div className="sheet">
            <h3>选一首</h3>
            {pack.songs.map((s) => (
              <button
                key={s.id}
                className="song-option"
                onClick={() => {
                  setShowPicker(false)
                  onSing(s.id)
                }}
              >
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

function phaseLabel(p: Phase): string {
  switch (p) {
    case 'off':
      return '待机'
    case 'calibrating':
      return '校准'
    case 'listening':
      return '监听中'
    case 'capturing':
      return '录音'
    case 'matching':
      return '匹配'
    case 'suggest':
      return '待确认'
    case 'unknown':
      return '未识别'
    default:
      return ''
  }
}
