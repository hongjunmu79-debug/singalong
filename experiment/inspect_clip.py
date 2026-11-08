"""检查一段现场录音/视频的可用性：时长、电平、削波、完整频段分布。

在 44.1kHz 上分析，保留原始电平 —— 归一化会掩盖削波和高频缺失。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

import audio

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SR_ANALYZE = 44100


def band_ratios(y: np.ndarray, sr: int) -> dict[str, float]:
    n = len(y)
    # 取一段 2 的幂长度做 FFT（用整段的三分之一，避免过长）
    seg = y[: min(n, sr * 20)]
    n_fft = 1 << int(np.log2(len(seg)))
    spec = np.abs(np.fft.rfft(seg[:n_fft] * np.hanning(n_fft))) ** 2
    freqs = np.fft.rfftfreq(n_fft, 1.0 / sr)
    total = spec.sum() + 1e-12
    bands = {
        "<300Hz": spec[freqs < 300].sum(),
        "300-1k": spec[(freqs >= 300) & (freqs < 1000)].sum(),
        "1k-3k": spec[(freqs >= 1000) & (freqs < 3000)].sum(),
        "3k-8k": spec[(freqs >= 3000) & (freqs < 8000)].sum(),
        ">8k": spec[freqs >= 8000].sum(),
    }
    out = {k: float(v / total) for k, v in bands.items()}
    out["_centroid"] = float((spec * freqs).sum() / total)
    return out


def main(path: str) -> None:
    y = audio.load_audio(path, sr=SR_ANALYZE, normalize=False)
    dur = len(y) / SR_ANALYZE
    peak = float(np.max(np.abs(y)))
    # 16-bit 录音接近满刻度的采样占比
    clip_frac = float(np.mean(np.abs(y) > 0.995))

    frame = int(0.5 * SR_ANALYZE)
    env = np.array([audio.rms(y[i:i + frame]) for i in range(0, len(y) - frame, frame)])
    env_db = 20 * np.log10(env + 1e-9)

    bands = band_ratios(y, SR_ANALYZE)

    print(f"文件        {Path(path).name}")
    print(f"时长        {dur:.1f}s  采样率 {SR_ANALYZE}")
    print(f"峰值        {peak:.3f}（接近满刻度采样占比 {clip_frac * 100:.2f}%）")
    print(f"原始电平    p10 {np.percentile(env_db, 10):.1f} / "
          f"p50 {np.percentile(env_db, 50):.1f} / p90 {np.percentile(env_db, 90):.1f} dBFS")
    print(f"动态范围    p90-p10 = {np.percentile(env_db, 90) - np.percentile(env_db, 10):.1f} dB")
    print("频谱分布    " + "  ".join(
        f"{k} {bands[k] * 100:.1f}%" for k in ("<300Hz", "300-1k", "1k-3k", "3k-8k", ">8k")))
    print(f"频谱质心    {bands['_centroid']:.0f} Hz")
    print()

    warn = []
    if clip_frac > 0.01:
        warn.append("削波严重，麦克风过载，指纹会受损")
    if np.percentile(env_db, 90) - np.percentile(env_db, 10) < 4:
        warn.append("动态范围极窄，可能是重度过压缩或几乎全是稳态噪声")
    if bands["3k-8k"] + bands[">8k"] < 0.02:
        warn.append("高频几乎为零，录音明显发闷（可能隔着口袋/手指挡麦）")
    if bands["<300Hz"] > 0.6:
        warn.append("能量过度集中在低频，人声和乐器可能被淹没")
    if peak < 0.05:
        warn.append("电平很低，可能是远处收音")
    for w in warn:
        print(f"!! {w}")
    if not warn:
        print("没有明显问题。")


if __name__ == "__main__":
    main(sys.argv[1])
