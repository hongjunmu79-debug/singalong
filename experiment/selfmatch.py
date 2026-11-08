"""现场录音自匹配：这条现场录音在加噪/加混响后，指纹还稳不稳。

不需要录音室参照，只用一个文件。

指标不是「认对了哪首歌」（曲库只有一首，恒对），而是
「票数峰值是否仍落在真实的时间偏移上」——这衡量的是指纹本身的时间稳定性。

注意：同一段录音自匹配，比「现场对录音室」容易得多，数字必然偏乐观。
它只能证伪，不能证成。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

import audio
import fingerprint as fp

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

CLIP_S = 8.0
TOL_FRAMES = 2  # hop=512 @11025 ≈ 46ms，容差约 ±93ms


def main(path: str) -> int:
    y = audio.load_audio(path)
    dur = len(y) / audio.SR
    print(f"文件 {Path(path).name}，{dur:.1f}s\n")

    index = fp.Index()
    h, t = fp.fingerprint_signal(y)
    index.add(0, h, t)
    index.finalize()
    print(f"索引 {len(index.hashes):,} 条哈希\n")

    L = int(CLIP_S * audio.SR)
    starts = [s for s in range(0, len(y) - L + 1, int(CLIP_S * audio.SR))]
    if not starts:
        print("片段太短，切不出 8 秒窗口")
        return 2

    rng = np.random.default_rng(0)
    conds = [
        ("干净", lambda q: q),
        ("噪声 10dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), audio.SR, int(rng.integers(0, 99999))), 10)),
        ("噪声 5dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), audio.SR, int(rng.integers(0, 99999))), 5)),
        ("噪声 0dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), audio.SR, int(rng.integers(0, 99999))), 0)),
        ("噪声 -5dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), audio.SR, int(rng.integers(0, 99999))), -5)),
        ("混响 1.5s", lambda q: audio.add_reverb(q, audio.SR, 1.5, int(rng.integers(0, 99999)))[: len(q)]),
        ("混响 2.5s", lambda q: audio.add_reverb(q, audio.SR, 2.5, int(rng.integers(0, 99999)))[: len(q)]),
        ("混响 1.5s + 噪声 0dB", lambda q: audio.mix_at_snr(
            audio.add_reverb(q, audio.SR, 1.5, int(rng.integers(0, 99999)))[: len(q)],
            audio.crowd_noise(len(q), audio.SR, int(rng.integers(0, 99999))), 0)),
    ]

    print(f"{'条件':<24}{'偏移命中':>10}{'中位得分':>10}{'中位匹配率':>12}")
    print("-" * 58)
    for name, fn in conds:
        hits, scores, ratios = 0, [], []
        for s in starts:
            w = y[s:s + L]
            true_off = s // fp.HOP
            hq, tq = fp.fingerprint_signal(fn(w))
            res = index.query_detail(hq, tq)
            if res is None:
                scores.append(0.0)
                ratios.append(0.0)
                continue
            _, off, score = res
            scores.append(score)
            ratios.append(score / max(1, len(hq)))
            if abs(off - true_off) <= TOL_FRAMES:
                hits += 1
        n = len(starts)
        print(f"{name:<24}{hits / n * 100:9.0f}%{np.median(scores):10.0f}"
              f"{np.median(ratios) * 100:11.2f}%")

    print(f"\n样本数 {len(starts)} 个窗口。自匹配数字必然偏乐观，只能证伪。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
