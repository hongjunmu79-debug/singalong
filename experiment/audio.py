"""音频读取、现场条件模拟。

所有解码走 ffmpeg，避免依赖具体编码库。
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
from scipy.signal import fftconvolve

SR = 11025


def load_audio(path: str | Path, sr: int = SR, normalize: bool = True) -> np.ndarray:
    """任意格式 -> 单声道 float32。normalize=False 时保留原始电平。"""
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin", "-i", str(path),
        "-f", "f32le", "-ac", "1", "-ar", str(sr), "-",
    ]
    res = subprocess.run(cmd, capture_output=True)
    if res.returncode != 0:
        raise RuntimeError(f"ffmpeg 解码失败: {path}\n{res.stderr.decode('utf-8', 'ignore')[:400]}")
    y = np.frombuffer(res.stdout, dtype=np.float32).copy()
    if y.size < sr:
        raise RuntimeError(f"音频过短或为空: {path}")
    if normalize:
        peak = float(np.max(np.abs(y)))
        if peak > 1e-6:
            y /= peak
    return y


def rms(x: np.ndarray) -> float:
    return float(np.sqrt(np.mean(x.astype(np.float64) ** 2) + 1e-12))


def pink_noise(n: int, rng: np.random.Generator | None = None) -> np.ndarray:
    """1/f 噪声，用来近似场馆里的人声底噪。"""
    rng = rng or np.random.default_rng(0)
    white = rng.normal(size=n)
    spec = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n, 1.0)
    freqs[0] = freqs[1] if len(freqs) > 1 else 1.0
    spec /= np.sqrt(freqs)
    out = np.fft.irfft(spec, n=n)
    return out / (np.max(np.abs(out)) + 1e-12)


def crowd_noise(n: int, sr: int = SR, seed: int = 0) -> np.ndarray:
    """人群噪声：粉噪 + 缓慢起伏 + 随机欢呼/尖叫脉冲。"""
    rng = np.random.default_rng(seed)
    base = pink_noise(n, rng)

    # 缓慢的欢呼起伏（0.1-0.4 Hz）
    t = np.arange(n) / sr
    swell = np.zeros(n)
    for _ in range(rng.integers(3, 7)):
        f = rng.uniform(0.08, 0.4)
        ph = rng.uniform(0, 2 * np.pi)
        swell += rng.uniform(0.2, 0.6) * np.sin(2 * np.pi * f * t + ph)
    env = 0.55 + 0.45 * np.tanh(swell)

    # 随机尖峰（口哨、鼓掌）
    spikes = np.zeros(n)
    n_spikes = max(1, int(n / sr * 1.2))
    for _ in range(n_spikes):
        i = rng.integers(0, max(1, n - sr // 5))
        L = int(rng.uniform(0.02, 0.12) * sr)
        burst = rng.normal(size=L) * np.exp(-np.linspace(0, 6, L))
        spikes[i:i + L] += burst * rng.uniform(0.5, 2.5)

    out = base * env + spikes
    return out / (np.max(np.abs(out)) + 1e-12)


def add_reverb(y: np.ndarray, sr: int = SR, rt60: float = 1.5, seed: int = 0, wet: float = 0.5) -> np.ndarray:
    """合成脉冲响应做卷积混响。rt60 单位秒，wet 是混响占比。

    wet=0 为干声，wet=1 为纯混响（没有直达声，现实中不存在）。
    真实现场直达声占主导，混响只是尾巴，所以默认 0.5。
    """
    rng = np.random.default_rng(seed)
    n_ir = int(rt60 * sr)
    t = np.arange(n_ir) / sr
    ir = rng.normal(size=n_ir)
    ir[0] = 1.0  # 保留一个直达分量，避免把整条脉冲抹平
    ir *= np.exp(-6.9 * t / rt60)
    ir = np.convolve(ir, np.ones(4) / 4, mode="same")
    ir /= np.sqrt(np.sum(ir ** 2)) + 1e-12

    wet_sig = fftconvolve(y, ir, mode="full")
    n_out = len(wet_sig)
    dry = np.pad(y, (0, n_out - len(y)))[:n_out]
    out = (1.0 - wet) * dry + wet * wet_sig
    peak = float(np.max(np.abs(out)))
    if peak > 1.0:
        out /= peak
    return out


def mix_at_snr(signal: np.ndarray, noise: np.ndarray, snr_db: float) -> np.ndarray:
    """按目标 SNR 混合，noise 会循环/截断到与 signal 等长。"""
    n = len(signal)
    if len(noise) < n:
        reps = int(np.ceil(n / len(noise)))
        noise = np.tile(noise, reps)[:n]
    else:
        noise = noise[:n]
    ps, pn = rms(signal), rms(noise)
    target_pn = ps / (10 ** (snr_db / 20.0))
    noise = noise * (target_pn / (pn + 1e-12))
    return signal + noise


def agc(y: np.ndarray, sr: int = SR, win_s: float = 0.3, target_rms: float = 0.08) -> np.ndarray:
    """模拟手机/浏览器的自动增益：把短时 RMS 拉到目标值附近。"""
    win = max(1, int(win_s * sr))
    n = len(y)
    env = np.ones(n, dtype=np.float32)
    for i in range(0, n, win):
        seg = y[i:i + win]
        if seg.size == 0:
            continue
        g = target_rms / (rms(seg) + 1e-9)
        env[i:i + seg.size] = np.clip(g, 0.2, 8.0)
    # 平滑，避免段间跳变
    k = np.ones(win, dtype=np.float32) / win
    env = np.convolve(env, k, mode="same")
    return y * env


def noise_gate(y: np.ndarray, sr: int = SR, n_fft: int = 512, hop: int = 128, floor_db: float = -25.0) -> np.ndarray:
    """模拟降噪：逐帧把明显低于帧内峰值的频点压掉。

    这是近似，真实降噪（如 iOS）是自适应谱减，效果更激进。
    """
    win = np.hanning(n_fft).astype(np.float32)
    if len(y) < n_fft:
        return y
    n_frames = 1 + (len(y) - n_fft) // hop
    out = np.zeros_like(y)
    wsum = np.zeros_like(y)

    for s in range(n_frames):
        i = s * hop
        frame = y[i:i + n_fft]
        spec = np.fft.rfft(frame * win)
        mag = np.abs(spec) + 1e-10
        thr = np.max(mag) * (10 ** (floor_db / 20.0))
        spec = np.where(mag < thr, 0, spec)
        rec = np.fft.irfft(spec, n=n_fft).astype(np.float32) * win
        out[i:i + n_fft] += rec
        wsum[i:i + n_fft] += win ** 2

    wsum[wsum < 1e-6] = 1.0
    return out / wsum
