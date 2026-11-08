import { openDB, type IDBPDatabase } from 'idb'
import type { Performance, ShowPack } from '../types'

const DB_NAME = 'singalong'
const DB_VERSION = 2
const PACKS = 'packs'
const PERFORMANCES = 'performances'

let dbp: Promise<IDBPDatabase> | null = null

function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(PACKS)) {
          d.createObjectStore(PACKS, { keyPath: 'id' })
        }
        if (!d.objectStoreNames.contains(PERFORMANCES)) {
          d.createObjectStore(PERFORMANCES, { keyPath: 'packId' })
        }
      },
    })
  }
  return dbp
}

export async function listPacks(): Promise<ShowPack[]> {
  const all = (await (await db()).getAll(PACKS)) as ShowPack[]
  return all.sort((a, b) => b.createdAt - a.createdAt)
}

export async function getPack(id: string): Promise<ShowPack | undefined> {
  return (await db()).get(PACKS, id) as Promise<ShowPack | undefined>
}

export async function putPack(pack: ShowPack): Promise<void> {
  await (await db()).put(PACKS, pack)
}

export async function deletePack(id: string): Promise<void> {
  const d = await db()
  await d.delete(PACKS, id)
  await d.delete(PERFORMANCES, id)
}

/** 粗略估计已占用空间，用来给用户一个体积感知 */
export async function estimateUsage(): Promise<string> {
  if (!navigator.storage?.estimate) return ''
  const { usage } = await navigator.storage.estimate()
  if (!usage) return ''
  return usage > 1024 * 1024
    ? `${(usage / 1024 / 1024).toFixed(1)} MB`
    : `${(usage / 1024).toFixed(0)} KB`
}

export async function getPerformance(packId: string): Promise<Performance | undefined> {
  return (await db()).get(PERFORMANCES, packId) as Promise<Performance | undefined>
}

/**
 * 记录一首歌开始。同一首连续进来会去重，避免重新渲染时重复写入。
 * 上一首如果还没结束，用当前时间补上 endedAt。
 */
export async function recordSongStart(packId: string, songId: string): Promise<void> {
  const now = Date.now()
  const cur: Performance =
    (await getPerformance(packId)) ?? { packId, startedAt: now, entries: [] }

  const last = cur.entries[cur.entries.length - 1]
  if (last && last.songId === songId) return
  if (last && !last.endedAt) last.endedAt = now

  cur.entries.push({ songId, startedAt: now })
  await (await db()).put(PERFORMANCES, cur)
}

export async function clearPerformance(packId: string): Promise<void> {
  await (await db()).delete(PERFORMANCES, packId)
}
