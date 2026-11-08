"""合成音频自检：先证明代码是对的，再谈真实命中率。

注意：合成音乐只验证「管线正确」，不能代表真实音乐/现场的效果。
"""
from __future__ import annotations

import sys
import zlib

import numpy as np

import audio
import fingerprint as fp

SR = audio.SR


def synth_song(seed: int, dur: float = 40.0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    y = np.zeros(n, dtype=np.float32)

    scale = np.array([0, 2, 4, 5, 7, 9, 11])
    root = int(rng.choice([0, 2, 3, 5, 7, 9, 10]))
    nh = int(rng.integers(3, 7))
    harm_w = rng.uniform(0.3, 1.0, size=nh) / np.arange(1, nh + 1)
    chord_len = float(rng.uniform(1.1, 2.6))

    pos = 0.0
    while pos < dur:
        deg = int(rng.integers(0, 7))
        base = 48 + root + scale[deg] + 12 * int(rng.integers(0, 2))
        notes = [base, base + 4, base + 7]
        i0, i1 = int(pos * SR), min(n, int((pos + chord_len) * SR))
        if i1 > i0:
            seg = (np.arange(i1 - i0) / SR).astype(np.float32)
            env = np.minimum(1.0, seg / 0.02) * np.exp(-seg * 0.35)
            for m in notes:
                f0 = 440.0 * 2 ** ((m - 69) / 12)
                for h in range(1, nh + 1):
                    y[i0:i1] += (
                        harm_w[h - 1]
                        * np.sin(2 * np.pi * f0 * h * seg + rng.uniform(0, 6))
                        * env
                    )
        pos += chord_len

    # 打击乐，给指纹提供时间锚点
    bpm = float(rng.uniform(80, 140))
    step = 60.0 / bpm / 2
    t = step
    while t < dur:
        i = int(t * SR)
        L = int(0.05 * SR)
        if i + L < n:
            burst = rng.normal(size=L) * np.exp(-np.linspace(0, 9, L))
            y[i:i + L] += burst * rng.uniform(0.15, 0.5)
        t += step

    y /= np.max(np.abs(y)) + 1e-9
    return y.astype(np.float32)


CONDITIONS = [
    ("干净", lambda q, rng: q),
    ("场馆噪声 10dB", lambda q, rng: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 9999))), 10)),
    ("场馆噪声 5dB", lambda q, rng: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 9999))), 5)),
    ("场馆噪声 0dB", lambda q, rng: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 9999))), 0)),
    ("场馆噪声 -5dB", lambda q, rng: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 9999))), -5)),
    ("混响 RT60=1.5s", lambda q, rng: audio.add_reverb(q, SR, 1.5, int(rng.integers(0, 9999)))[: len(q)]),
    ("混响+噪声 0dB", lambda q, rng: audio.mix_at_snr(
        audio.add_reverb(q, SR, 1.5, int(rng.integers(0, 9999)))[: len(q)],
        audio.crowd_noise(len(q), SR, int(rng.integers(0, 9999))), 0)),
]


def main() -> int:
    n_songs = 8
    clip_s = 8.0
    n_queries_per_song = 4
    print(f"合成 {n_songs} 首，每首取 {n_queries_per_song} 个 {clip_s}s 片段\n")

    songs = [synth_song(zlib.crc32(f"song{i}".encode()) % 100000 + i) for i in range(n_songs)]

    index = fp.Index(song_names=[f"song{i}" for i in range(n_songs)])
    total_hashes = 0
    total_peaks = 0
    total_frames = 0
    for sid, y in enumerate(songs):
        S = fp.stft_power(y)
        pf, pt = fp.find_peaks(S)
        h, t = fp.peaks_to_hashes(pf, pt)
        index.add(sid, h, t)
        total_hashes += len(h)
        total_peaks += len(pf)
        total_frames += S.shape[1]
    index.finalize()

    secs = sum(len(s) for s in songs) / SR
    print(f"峰值密度 {total_peaks / secs:.1f}/s，哈希密度 {total_hashes / secs:.1f}/s，"
          f"索引 {len(index.hashes):,} 条\n")

    rng = np.random.default_rng(1234)
    results = {}
    for name, fn in CONDITIONS:
        hits = 0
        total = 0
        for sid, y in enumerate(songs):
            for _ in range(n_queries_per_song):
                start = int(rng.uniform(5, len(y) / SR - clip_s - 5) * SR)
                clip = y[start:start + int(clip_s * SR)]
                q = fn(clip, rng)
                h, t = fp.fingerprint_signal(q)
                ranked = index.query(h, t)
                total += 1
                if ranked and ranked[0][0] == sid:
                    hits += 1
        acc = hits / total if total else 0.0
        results[name] = acc
        bar = "#" * int(acc * 40)
        print(f"{name:<16} {acc * 100:5.1f}%  {bar}")

    print()
    clean = results.get("干净", 0)
    if clean < 0.99:
        print("!! 干净条件下都不达标，说明管线本身有问题，先别管噪声。")
        return 1
    print("合成数据结论：管线正确。以上数字不代表真实音乐或现场表现。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
