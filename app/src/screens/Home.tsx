import { useEffect, useState } from 'react'
import { deletePack, estimateUsage, listPacks } from '../lib/db'
import type { ShowPack } from '../types'

type Props = {
  onOpen: (id: string) => void
  onCreate: () => void
}

export default function Home({ onOpen, onCreate }: Props) {
  const [packs, setPacks] = useState<ShowPack[] | null>(null)
  const [usage, setUsage] = useState('')

  async function refresh() {
    setPacks(await listPacks())
    setUsage(await estimateUsage())
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function remove(id: string, name: string) {
    if (!confirm(`删除「${name}」？离线数据和歌词都会一起删掉。`)) return
    await deletePack(id)
    await refresh()
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1 className="brand">跟唱</h1>
          <p className="sub">演出前准备好曲库，现场断网也能用</p>
        </div>
        {usage && <span className="usage">{usage}</span>}
      </header>

      {packs === null ? (
        <p className="muted">读取中…</p>
      ) : packs.length === 0 ? (
        <div className="empty">
          <p>还没有演出包。</p>
          <p className="muted">建一个，导入你要看的演出的歌。</p>
        </div>
      ) : (
        <ul className="pack-list">
          {packs.map((p) => (
            <li key={p.id} className="pack-card">
              <button className="pack-main" onClick={() => onOpen(p.id)}>
                <span className="pack-name">{p.name}</span>
                <span className="pack-meta">
                  {p.artist ? `${p.artist} · ` : ''}
                  {p.songs.length} 首 · {new Date(p.createdAt).toLocaleDateString('zh-CN')}
                </span>
              </button>
              <button className="icon-btn" aria-label="删除" onClick={() => remove(p.id, p.name)}>
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="page-actions">
        <button className="primary" onClick={onCreate}>
          新建演出包
        </button>
      </div>
    </div>
  )
}
