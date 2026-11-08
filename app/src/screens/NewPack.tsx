import { useEffect, useRef, useState } from 'react'
import { putPack } from '../lib/db'
import { decodeFile } from '../lib/decode'
import { titleFromFilename } from '../lib/lyrics'
import { SR } from '../lib/fingerprint'
import { uid } from '../lib/uid'
import type { ImportState, ShowPack, Song } from '../types'

type Props = {
  onCancel: () => void
  onDone: (packId: string) => void
}

type FpResult = { hashes: Int32Array; times: Int32Array; ms: number }

export default function NewPack({ onCancel, onDone }: Props) {
  const [name, setName] = useState('')
  const [artist, setArtist] = useState('')
  const [items, setItems] = useState<ImportState[]>([])
  const [songs, setSongs] = useState<Song[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const showSample = new URLSearchParams(location.search).has('sample')

  const workerRef = useRef<Worker | null>(null)
  const pending = useRef(new Map<string, { resolve: (r: FpResult) => void; reject: (e: Error) => void }>())

  useEffect(() => {
    const w = new Worker(new URL('../lib/fingerprint.worker.ts', import.meta.url), { type: 'module' })
    w.onmessage = (e: MessageEvent) => {
      const { id, hashes, times, ms, error: err } = e.data
      const p = pending.current.get(id)
      if (!p) return
      pending.current.delete(id)
      if (err) p.reject(new Error(err))
      else p.resolve({ hashes, times, ms })
    }
    workerRef.current = w
    return () => {
      w.terminate()
      workerRef.current = null
    }
  }, [])

  function runFingerprint(samples: Float32Array): Promise<FpResult> {
    return new Promise((resolve, reject) => {
      const w = workerRef.current
      if (!w) return reject(new Error('指纹线程没起来'))
      const id = uid()
      pending.current.set(id, { resolve, reject })
      w.postMessage({ id, samples }, [samples.buffer])
    })
  }

  const patch = (i: number, p: Partial<ImportState>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...p } : it)))

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return
    await processFiles(Array.from(list))
  }

  async function processFiles(files: File[]) {
    setError('')
    setBusy(true)
    setItems(files.map((f) => ({ file: f.name, status: 'pending' })))

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      patch(i, { status: 'decoding' })
      try {
        const samples = await decodeFile(f)
        const duration = samples.length / SR
        patch(i, { status: 'fingerprinting', duration })

        const { hashes, times, ms } = await runFingerprint(samples)
        const song: Song = {
          id: uid(),
          title: titleFromFilename(f.name),
          duration,
          hashes,
          times,
          lyrics: [],
        }
        setSongs((prev) => [...prev, song])
        patch(i, { status: 'done', hashCount: hashes.length, ms })
      } catch (e) {
        patch(i, { status: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
    setBusy(false)
  }

  /**
   * 仅在 URL 带 ?sample=1 时可用。
   * 用于绕开某些安卓/鸿蒙浏览器上失效的文件选择器：直接从站点取内置示例音频。
   */
  async function loadSample() {
    setError('')
    setBusy(true)
    try {
      const res = await fetch('/samples/refrain.mp3')
      if (!res.ok) throw new Error(`示例音频获取失败（HTTP ${res.status}）`)
      const blob = await res.blob()
      const file = new File([blob], 'Refrain - Aimer.mp3', { type: 'audio/mpeg' })
      await processFiles([file])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  async function save() {
    if (songs.length === 0) return    setBusy(true)
    try {
      const pack: ShowPack = {
        id: uid(),
        name: name.trim() || '未命名演出',
        artist: artist.trim(),
        createdAt: Date.now(),
        songs,
      }
      await putPack(pack)
      onDone(pack.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <button className="back" onClick={onCancel} disabled={busy}>
          ‹ 返回
        </button>
      </header>

      <h2 className="section-title">新建演出包</h2>

      <div className="field">
        <label htmlFor="pack-name">演出名称</label>
        <input
          id="pack-name"
          type="text"
          value={name}
          placeholder="例如：Charlie Puth 杭州站"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor="pack-artist">歌手</label>
        <input
          id="pack-artist"
          type="text"
          value={artist}
          placeholder="选填"
          onChange={(e) => setArtist(e.target.value)}
        />
      </div>

      <div className="field">
        <label>音频文件</label>
        <label className="file-drop">
          <input
            type="file"
            multiple
            accept="audio/*,.mp3,.m4a,.aac,.flac,.wav,.ogg,.opus"
            onChange={(e) => void handleFiles(e.target.files)}
            disabled={busy}
          />
          <span>{busy ? '处理中…' : '选择你要唱的歌（可多选）'}</span>
        </label>
        <p className="hint">文件只在这台设备上解析，不会上传。指纹生成后才存起来，音频本身不留。</p>

        {showSample && (
          <button className="secondary" onClick={() => void loadSample()} disabled={busy}>
            导入内置示例（Refrain）
          </button>
        )}
      </div>

      {items.length > 0 && (
        <ul className="import-list">
          {items.map((it, i) => (
            <li key={`${it.file}-${i}`} className="import-item">
              <span className="import-name">{it.file}</span>
              <span className={`status ${it.status}`}>
                {it.status === 'pending' && '等待'}
                {it.status === 'decoding' && '解码中'}
                {it.status === 'fingerprinting' && '生成指纹'}
                {it.status === 'done' && `${it.hashCount?.toLocaleString()} 点 · ${Math.round(it.ms ?? 0)}ms`}
                {it.status === 'error' && (it.message ?? '失败')}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}

      <div className="page-actions">
        <button className="primary" onClick={() => void save()} disabled={busy || songs.length === 0}>
          {songs.length === 0 ? '先导入至少一首歌' : `保存演出包（${songs.length} 首）`}
        </button>
      </div>
    </div>
  )
}
