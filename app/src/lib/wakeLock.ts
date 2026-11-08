import { useEffect, useState } from 'react'

type Sentinel = {
  release: () => Promise<void>
  addEventListener?: (type: string, cb: () => void) => void
}

type WakeLockNav = Navigator & {
  wakeLock?: { request: (type: 'screen') => Promise<Sentinel> }
}

let sentinel: Sentinel | null = null
let holders = 0

async function acquire(): Promise<boolean> {
  const nav = navigator as WakeLockNav
  if (!nav.wakeLock) return false
  if (sentinel) return true
  try {
    sentinel = await nav.wakeLock.request('screen')
    // 系统可能在切后台、进低电量模式时主动释放
    sentinel.addEventListener?.('release', () => {
      sentinel = null
    })
    return true
  } catch {
    sentinel = null
    return false
  }
}

async function release(): Promise<void> {
  const s = sentinel
  sentinel = null
  if (!s) return
  try {
    await s.release()
  } catch {
    // 已经被系统释放过了，忽略
  }
}

/**
 * 在 active 为 true 期间保持屏幕常亮。返回 false 表示这台设备/这个浏览器不支持，
 * 或者用户拒绝——调用方应该给出提示，让用户自己把自动锁屏调长。
 */
export function useWakeLock(active: boolean): boolean {
  const [available, setAvailable] = useState(true)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    holders += 1

    void acquire().then((ok) => {
      if (cancelled) return
      if (ok) setAvailable(true)
      // 页面不可见时浏览器必然拒绝，这不是真的不支持，别吓唬用户
      else if (document.visibilityState === 'visible') setAvailable(false)
    })

    // 切回前台时重新申请：系统通常会在切后台时自动释放
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      void acquire().then((ok) => {
        if (!cancelled) setAvailable(ok)
      })
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      holders -= 1
      if (holders <= 0) {
        holders = 0
        void release()
      }
    }
  }, [active])

  return available
}
