"""峰值参数扫描：在合成数据上找一组合理的阈值、邻域与 fanout。

真实音乐要重跑一遍，这里的结论只用来确定搜索区间。
"""
from __future__ import annotations

import sys
import zlib

import numpy as np

import audio
import fingerprint as fp
from selfcheck import synth_song

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SR = audio.SR
CLIP_S = 8.0
PER_SONG = 4

CONFIGS = [
    (margin, nb, fanout)
    for margin in (6.0, 8.0, 10.0, 12.0)
    for nb in (7, 9)
    for fanout in (5, 8)
]

CONDITIONS = [
    ("clean", lambda q, rng: q),
    ("noise0", lambda q, rng: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 9999))), 0)),
    ("rev+0", lambda q, rng: audio.mix_at_snr(
        audio.add_reverb(q, SR, 1.5, int(rng.integers(0, 9999)))[: len(q)],
        audio.crowd_noise(len(q), SR, int(rng.integers(0, 9999))), 0)),
]


def main() -> None:
    songs = [synth_song(zlib.crc32(f"song{i}".encode()) % 100000 + i) for i in range(8)]
    ref_specs = [fp.stft_power(y) for y in songs]

    rng = np.random.default_rng(7)
    queries = {name: [] for name, _ in CONDITIONS}
    for sid, y in enumerate(songs):
        for _ in range(PER_SONG):
            start = int(rng.uniform(5, len(y) / SR - CLIP_S - 5) * SR)
            clip = y[start:start + int(CLIP_S * SR)]
            for name, fn in CONDITIONS:
                queries[name].append((sid, fp.stft_power(fn(clip, rng))))

    secs = sum(len(s) for s in songs) / SR
    print(f"{'margin':>6} {'nb':>3} {'fan':>4} {'peaks/s':>8} {'clean':>7} {'noise0':>7} {'rev+0':>7}")
    print("-" * 55)

    best = None
    for margin, nb, fanout in CONFIGS:
        peak_kw = {"margin_db": margin, "freq_nb": nb, "time_nb": nb}

        index = fp.Index()
        n_peaks = 0
        for sid, S in enumerate(ref_specs):
            pf, pt = fp.find_peaks(S, **peak_kw)
            h, t = fp.peaks_to_hashes(pf, pt, fanout=fanout)
            index.add(sid, h, t)
            n_peaks += len(pf)
        index.finalize()

        accs = []
        for name, _ in CONDITIONS:
            hits = 0
            for sid, S in queries[name]:
                pf, pt = fp.find_peaks(S, **peak_kw)
                h, t = fp.peaks_to_hashes(pf, pt, fanout=fanout)
                ranked = index.query(h, t)
                if ranked and ranked[0][0] == sid:
                    hits += 1
            accs.append(hits / len(queries[name]))

        dens = n_peaks / secs
        print(f"{margin:>6.1f} {nb:>3} {fanout:>4} {dens:>8.1f} "
              f"{accs[0] * 100:>6.1f}% {accs[1] * 100:>6.1f}% {accs[2] * 100:>6.1f}%")

        score = accs[0] * 0.2 + accs[1] * 0.4 + accs[2] * 0.4
        if best is None or score > best[0]:
            best = (score, margin, nb, fanout, dens)

    print()
    print(f"合成数据最优: margin={best[1]:.1f}dB, 邻域={best[2]}, fanout={best[3]}, 密度={best[4]:.1f}/s")


if __name__ == "__main__":
    main()
