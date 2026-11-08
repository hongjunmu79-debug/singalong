import { useEffect, useRef, useState } from 'react'
import { clearPerformance, deletePack, getPack, getPerformance, putPack } from '../lib/db'
import { hasTimestamps, parseLyrics } from '../lib/lyrics'
import type { Performance, ShowPack } from '../types'

type Props = {
  packId: string
  onBack: () => void
  onLive: () => void
  onSing: (songId: string) => void
}

export default function PackDetail({ packId, onBack, onLive, onSing }: Props) {
  const [pack, setPack] = useState<ShowPack | null>(null)
  const [perf, setPerf] = useState<Performance | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    void getPack(packId).then((p) => setPack(p ?? null))
    void getPerformance(packId).then((p) => setPerf(p ?? null))
  }, [packId])

  if (!pack) return <div className="page"><p className="muted">读取中…</p></div>

  const editingSong = pack.songs.find((s) => s.id === editing)

  function openEditor(songId: string) {
    const song = pack!.songs.find((s) => s.id === songId)
    setDraft((song?.lyrics ?? []).map((l) => l.text).join('\n'))
    setEditing(songId)
  }

  async function saveLyrics() {
    if (!editing) return
    const songs = pack!.songs.map((s) =>
      s.id === editing ? { ...s, lyrics: parseLyrics(draft) } : s,
    )
    const next = { ...pack!, songs }
    setPack(next)
    await putPack(next)
    setEditing(null)
  }

  async function loadLrc(file: File | undefined) {
    if (!file) return
    const text = await file.text()
    setDraft(text.split(/\r?\n/).map((l) => l.replace(/^\[.*?\]\s*/, '')).join('\n'))
  }

  async function removePack() {
    if (!confirm('删除这个演出包？')) return
    await deletePack(pack!.id)
    onBack()
  }

  function titleOf(songId: string): string {
    return pack?.songs.find((s) => s.id === songId)?.title ?? '（已移除的曲目）'
  }

  async function clearSetlist() {
    if (!confirm('清空本场曲目单？')) return
    await clearPerformance(pack!.id)
    setPerf(null)
  }

  function exportSetlist() {
    if (!pack || !perf) return
    const out: string[] = [pack.name]
    if (pack.artist) out.push(pack.artist)
    out.push(new Date(perf.startedAt).toLocaleDateString('zh-CN'), '')
    perf.entries.forEach((e, i) => {
      out.push(`${String(i + 1).padStart(2, '0')}  ${titleOf(e.songId)}  ${clock(e.startedAt)}`)
    })
    const blob = new Blob([out.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${pack.name}-曲目单.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="back" onClick={onBack}>‹ 返回</button>
        <button className="ghost-danger" onClick={() => void removePack()}>删除</button>
      </header>

      <h2 className="section-title">{pack.name}</h2>
      <p className="sub">
        {pack.artist ? `${pack.artist} · ` : ''}
        {pack.songs.length} 首 · 离线可用
      </p>

      <button className="primary live-entry" onClick={onLive}>
        进入现场
      </button>

      <ul className="song-list">
        {pack.songs.map((s, i) => {
          const timed = hasTimestamps(s.lyrics)
          return (
            <li key={s.id} className="song-row">
              <button className="song-main" onClick={() => onSing(s.id)} disabled={s.lyrics.length === 0}>
                <span className="song-index">{String(i + 1).padStart(2, '0')}</span>
                <span className="song-text">
                  <span className="song-title">{s.title}</span>
                  <span className="song-meta">
                    {fmt(s.duration)} · {s.hashes.length.toLocaleString()} 个指纹点 ·{' '}
                    {s.lyrics.length === 0
                      ? '还没有歌词'
                      : `歌词 ${s.lyrics.length} 行${timed ? '（带时间轴）' : ''}`}
                  </span>
                </span>
              </button>
              <button className="lyric-btn" onClick={() => openEditor(s.id)}>
                {s.lyrics.length === 0 ? '加歌词' : '改歌词'}
              </button>
            </li>
          )
        })}
      </ul>

      <section className="setlist">
        <div className="setlist-head">
          <h3>本场曲目单</h3>
          {perf && perf.entries.length > 0 && (
            <span className="setlist-count">{perf.entries.length} 首</span>
          )}
        </div>

        {!perf || perf.entries.length === 0 ? (
          <p className="hint setlist-empty">
            进现场确认过的歌会自动记在这里，按实际演唱顺序。
          </p>
        ) : (
          <>
            <ol className="setlist-list">
              {perf.entries.map((e, i) => (
                <li key={`${e.songId}-${e.startedAt}`}>
                  <span className="song-index">{String(i + 1).padStart(2, '0')}</span>
                  <span className="setlist-title">{titleOf(e.songId)}</span>
                  <span className="setlist-clock">{clock(e.startedAt)}</span>
                </li>
              ))}
            </ol>
            <div className="setlist-actions">
              <button className="secondary" onClick={exportSetlist}>导出 .txt</button>
              <button className="ghost-danger" onClick={() => void clearSetlist()}>清空</button>
            </div>
          </>
        )}
      </section>

      {editingSong && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setEditing(null)}>
          <div className="sheet">
            <h3>{editingSong.title}</h3>
            <p className="hint">一行一句。直接粘贴即可；带 [mm:ss.xx] 时间戳会保留。</p>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={'粘贴歌词，一行一句\n\n或者导入 .lrc 文件'}
              autoFocus
            />
            <div className="sheet-actions">
              <button className="secondary" onClick={() => fileRef.current?.click()}>
                导入 .lrc
              </button>
              <input
                ref={fileRef}
                type="file"
                accept=".lrc,.txt,text/plain"
                hidden
                onChange={(e) => void loadLrc(e.target.files?.[0])}
              />
              <button className="primary compact" onClick={() => void saveLyrics()}>
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function fmt(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function clock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
