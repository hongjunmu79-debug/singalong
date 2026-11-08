"""地标指纹（Shazam 式）：建库与检索。

设计目标：8 秒查询片段、闭集（几十首）、能在 WASM 里实现的纯 numpy 版本。
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field

import numpy as np
from scipy.ndimage import maximum_filter

SR = 11025
N_FFT = int(os.environ.get("SINGALONG_NFFT", "1024"))
HOP = int(os.environ.get("SINGALONG_HOP", "512"))
FMIN = 200
FMAX = 4000
FANOUT = 5
MAX_DT = 63


def stft_power(y: np.ndarray, n_fft: int = N_FFT, hop: int = HOP, chunk: int = 4096) -> np.ndarray:
    """返回 (freq, time) 的功率谱。"""
    win = np.hanning(n_fft).astype(np.float32)
    if len(y) < n_fft:
        y = np.pad(y, (0, n_fft - len(y)))
    n_frames = 1 + (len(y) - n_fft) // hop
    out = np.empty((n_fft // 2 + 1, n_frames), dtype=np.float32)
    base = np.arange(n_fft)[None, :]
    for s in range(0, n_frames, chunk):
        e = min(s + chunk, n_frames)
        idx = base + hop * np.arange(s, e)[:, None]
        frames = y[idx] * win
        out[:, s:e] = np.abs(np.fft.rfft(frames, axis=1)).T.astype(np.float32) ** 2
    return out


def find_peaks(
    S: np.ndarray,
    sr: int = SR,
    n_fft: int = N_FFT,
    fmin: int = FMIN,
    fmax: int = FMAX,
    freq_nb: int = 7,
    time_nb: int = 7,
    adaptive: bool = True,
    margin_db: float = 10.0,
    percentile: float = 94.0,
) -> tuple[np.ndarray, np.ndarray]:
    """时频局部极大值。返回 (freq_bin, time_frame)。

    adaptive=True 时用逐帧中位数 + margin 作为阈值：
    每帧的峰值数量与响度无关，噪声进来时不会被静音段拖垮。
    """
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    lo, hi = np.searchsorted(freqs, fmin), np.searchsorted(freqs, fmax)
    logS = 10.0 * np.log10(S[lo:hi] + 1e-10)

    mx = maximum_filter(logS, size=(freq_nb, time_nb), mode="nearest")
    if adaptive:
        thr = np.median(logS, axis=0, keepdims=True) + margin_db
    else:
        thr = np.percentile(logS, percentile)
    mask = (logS >= mx) & (logS > thr)

    fr, tt = np.nonzero(mask)
    return (fr + lo).astype(np.int32), tt.astype(np.int32)


def peaks_to_hashes(
    peak_f: np.ndarray,
    peak_t: np.ndarray,
    fanout: int = FANOUT,
    max_dt: int = MAX_DT,
) -> tuple[np.ndarray, np.ndarray]:
    """把峰值对组合成哈希。返回 (hash, 锚点时间帧)。"""
    if len(peak_t) == 0:
        return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int32)

    order = np.argsort(peak_t, kind="stable")
    f = peak_f[order]
    t = peak_t[order]

    keys, times = [], []
    for k in range(1, min(fanout, len(t) - 1) + 1):
        dt = t[k:] - t[:-k]
        valid = (dt > 0) & (dt <= max_dt)
        if not np.any(valid):
            continue
        f1 = f[:-k][valid].astype(np.int64)
        f2 = f[k:][valid].astype(np.int64)
        d = dt[valid].astype(np.int64)
        keys.append((f1 << 16) | (f2 << 6) | d)
        times.append(t[:-k][valid].astype(np.int32))

    if not keys:
        return np.empty(0, dtype=np.int64), np.empty(0, dtype=np.int32)
    return np.concatenate(keys), np.concatenate(times)


@dataclass
class Index:
    hashes: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=np.int64))
    song: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=np.int32))
    time: np.ndarray = field(default_factory=lambda: np.empty(0, dtype=np.int32))
    song_names: list[str] = field(default_factory=list)
    stats: dict = field(default_factory=dict)

    def add(self, song_id: int, hashes: np.ndarray, times: np.ndarray) -> None:
        self.hashes = np.concatenate([self.hashes, hashes])
        self.song = np.concatenate([self.song, np.full(len(hashes), song_id, dtype=np.int32)])
        self.time = np.concatenate([self.time, times])

    def finalize(self) -> None:
        order = np.argsort(self.hashes, kind="stable")
        self.hashes = self.hashes[order]
        self.song = self.song[order]
        self.time = self.time[order]

    def query(
        self,
        hashes: np.ndarray,
        times: np.ndarray,
        topk: int = 3,
        dt_tol: int = 1,
    ) -> list[tuple[int, float]]:
        """返回 [(song_id, 得分), ...]，按得分降序。

        得分 = 同一首歌里、同一时间偏移上命中的哈希数的最大值。

        dt_tol > 0 时允许多配 / 少配 1..dt_tol 帧的时间差。现场混响会把峰值
        时间抹开几十毫秒，精确配对会整片失效，放宽 dt 是标准做法。
        """
        if len(hashes) == 0 or len(self.hashes) == 0:
            return []

        if dt_tol > 0:
            h_parts, t_parts = [hashes], [times]
            dt = hashes & 63
            for d in range(1, dt_tol + 1):
                m = dt > d
                h_parts.append(hashes[m] - d)
                t_parts.append(times[m])
                m = dt < 63 - d
                h_parts.append(hashes[m] + d)
                t_parts.append(times[m])
            hashes = np.concatenate(h_parts)
            times = np.concatenate(t_parts)

        lo = np.searchsorted(self.hashes, hashes, side="left")
        hi = np.searchsorted(self.hashes, hashes, side="right")
        counts = hi - lo
        total = int(counts.sum())
        if total == 0:
            return []

        # 展开所有命中
        keep = counts > 0
        lo, counts = lo[keep], counts[keep]
        q_time = times[keep]
        starts = np.repeat(lo, counts)
        offs = np.arange(total) - np.repeat(np.cumsum(counts) - counts, counts)
        ref_idx = starts + offs

        song = self.song[ref_idx]
        offset = self.time[ref_idx].astype(np.int64) - np.repeat(q_time, counts).astype(np.int64)

        # 把 (song, offset) 编码成一个整数做计数
        span = int(offset.max() - offset.min() + 2)
        key = song.astype(np.int64) * span + (offset - offset.min())
        uniq, cnt = np.unique(key, return_counts=True)

        uniq_song = (uniq // span).astype(np.int32)
        best = {}
        for s, c in zip(uniq_song, cnt):
            si = int(s)
            if c > best.get(si, 0):
                best[si] = int(c)

        ranked = sorted(best.items(), key=lambda kv: -kv[1])[:topk]
        return [(si, float(c)) for si, c in ranked]

    def query_detail(self, hashes: np.ndarray, times: np.ndarray, dt_tol: int = 1):
        """返回 (song_id, 时间偏移帧, 得分)；没有命中返回 None。

        偏移是相对查询片段起点的帧数，可用于判断「是不是同一段音频」。
        """
        if len(hashes) == 0 or len(self.hashes) == 0:
            return None

        if dt_tol > 0:
            h_parts, t_parts = [hashes], [times]
            dt = hashes & 63
            for d in range(1, dt_tol + 1):
                m = dt > d
                h_parts.append(hashes[m] - d)
                t_parts.append(times[m])
                m = dt < 63 - d
                h_parts.append(hashes[m] + d)
                t_parts.append(times[m])
            hashes = np.concatenate(h_parts)
            times = np.concatenate(t_parts)

        lo = np.searchsorted(self.hashes, hashes, side="left")
        hi = np.searchsorted(self.hashes, hashes, side="right")
        counts = hi - lo
        total = int(counts.sum())
        if total == 0:
            return None

        keep = counts > 0
        lo, counts = lo[keep], counts[keep]
        q_time = times[keep]
        starts = np.repeat(lo, counts)
        offs = np.arange(total) - np.repeat(np.cumsum(counts) - counts, counts)
        ref_idx = starts + offs

        song = self.song[ref_idx]
        offset = self.time[ref_idx].astype(np.int64) - np.repeat(q_time, counts).astype(np.int64)

        off_min = int(offset.min())
        span = int(offset.max() - off_min + 2)
        key = song.astype(np.int64) * span + (offset - off_min)
        uniq, cnt = np.unique(key, return_counts=True)
        i = int(np.argmax(cnt))

        return int(uniq[i] // span), int(uniq[i] % span) + off_min, float(cnt[i])


def fingerprint_signal(y: np.ndarray, **peak_kw) -> tuple[np.ndarray, np.ndarray]:
    S = stft_power(y)
    pf, pt = find_peaks(S, **peak_kw)
    return peaks_to_hashes(pf, pt)
