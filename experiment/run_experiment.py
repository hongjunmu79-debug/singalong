"""真实音频实验：闭集 top-1 命中率。

用法：
    ../.venv/Scripts/python.exe run_experiment.py

drop/studio/  放这个歌手的歌（文件名即歌名）
drop/live/    放现场录音（可选，但这一段才决定结论）
"""
from __future__ import annotations

import os
import re
import sys
import time
from pathlib import Path

import numpy as np

import audio
import fingerprint as fp

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

SR = audio.SR
AUDIO_EXT = {".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma", ".mp4", ".mov", ".mkv", ".webm"}
CLIP_S = 8.0
CLIPS_PER_SONG = 6
BASE = Path(__file__).resolve().parent
DROP = Path(os.environ.get("SINGALONG_DROP", BASE / "drop"))
OUT = BASE / "out"
DT_TOL = int(os.environ.get("SINGALONG_DT_TOL", "1"))


def norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def list_audio(d: Path) -> list[Path]:
    if not d.exists():
        return []
    return sorted(p for p in d.iterdir() if p.is_file() and p.suffix.lower() in AUDIO_EXT)


def extract_windows(y: np.ndarray, n: int, clip_s: float = CLIP_S) -> list[np.ndarray]:
    """在曲子里均匀取 n 段，避开开头结尾。"""
    L = int(clip_s * SR)
    if len(y) <= L + SR:
        return [y[:L]]
    starts = np.linspace(SR, len(y) - L - SR, n).astype(int)
    return [y[s:s + L] for s in starts]


def conditions(rng: np.random.Generator):
    return [
        ("干净", lambda q: q),
        ("噪声 10dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 99999))), 10)),
        ("噪声 5dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 99999))), 5)),
        ("噪声 0dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 99999))), 0)),
        ("噪声 -5dB", lambda q: audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 99999))), -5)),
        ("混响 RT60=1.5s", lambda q: audio.add_reverb(q, SR, 1.5, int(rng.integers(0, 99999)))[: len(q)]),
        ("混响 RT60=2.5s", lambda q: audio.add_reverb(q, SR, 2.5, int(rng.integers(0, 99999)))[: len(q)]),
        ("混响 1.5s + 噪声 0dB", lambda q: audio.mix_at_snr(
            audio.add_reverb(q, SR, 1.5, int(rng.integers(0, 99999)))[: len(q)],
            audio.crowd_noise(len(q), SR, int(rng.integers(0, 99999))), 0)),
        ("混响 2.5s + 噪声 -5dB", lambda q: audio.mix_at_snr(
            audio.add_reverb(q, SR, 2.5, int(rng.integers(0, 99999)))[: len(q)],
            audio.crowd_noise(len(q), SR, int(rng.integers(0, 99999))), -5)),
        ("AGC + 降噪 + 噪声 0dB", lambda q: audio.noise_gate(
            audio.agc(audio.mix_at_snr(q, audio.crowd_noise(len(q), SR, int(rng.integers(0, 99999))), 0)), SR)),
    ]


def main() -> int:
    studio_dir = DROP / "studio"
    live_dir = DROP / "live"
    files = list_audio(studio_dir)
    if not files:
        print(f"没找到音频。把歌放进 {studio_dir}（看 drop/README.md）")
        return 2

    rng = np.random.default_rng(20261105)
    t0 = time.time()

    print(f"曲库 {len(files)} 首，开始建索引…")
    index = fp.Index()
    names: list[str] = []
    peaks_total = 0
    secs_total = 0.0
    for sid, path in enumerate(files):
        y = audio.load_audio(path)
        pf, pt = fp.find_peaks(fp.stft_power(y))
        h, t = fp.peaks_to_hashes(pf, pt)
        index.add(sid, h, t)
        names.append(path.stem)
        peaks_total += len(pf)
        secs_total += len(y) / SR
        print(f"  [{sid + 1:>2}/{len(files)}] {path.stem[:40]:<42} {len(h):>7,} hashes")
    index.finalize()
    print(f"索引完成：{len(index.hashes):,} 条，峰值密度 {peaks_total / max(secs_total, 1):.1f}/s，"
          f"耗时 {time.time() - t0:.1f}s\n")

    # ---- 阶段一/二：同一批录音做查询 ----
    # 每首歌只解码一次，避免真实曲库（几十首 4 分钟）重复解码拖慢实验
    conds = conditions(rng)
    acc = {c: {"hits": 0, "total": 0, "margins": [], "cs": [], "ws": []} for c, _ in conds}
    query_ms: list[float] = []

    for sid, path in enumerate(files):
        y = audio.load_audio(path)
        windows = extract_windows(y, CLIPS_PER_SONG)
        for w in windows:
            for cname, cfn in conds:
                st = acc[cname]
                t_start = time.perf_counter()
                h, t = fp.fingerprint_signal(cfn(w))
                ranked = index.query(h, t, topk=2, dt_tol=DT_TOL)
                query_ms.append((time.perf_counter() - t_start) * 1000)
                st["total"] += 1
                if not ranked:
                    st["ws"].append(0.0)
                    continue
                top_sid, top_score = ranked[0]
                second = ranked[1][1] if len(ranked) > 1 else 0.0
                st["margins"].append(top_score - second)
                ratio = top_score / max(1, len(h))
                if top_sid == sid:
                    st["hits"] += 1
                    st["cs"].append(ratio)
                else:
                    st["ws"].append(ratio)

    rows = []
    score_rows = {}
    for cname, _ in conds:
        st = acc[cname]
        a = st["hits"] / st["total"] if st["total"] else 0.0
        med_margin = float(np.median(st["margins"])) if st["margins"] else 0.0
        rows.append((cname, a, st["total"], med_margin))
        score_rows[cname] = (np.array(st["cs"]), np.array(st["ws"]))
        print(f"{cname:<24} {a * 100:5.1f}%  (n={st['total']}, 中位分差 {med_margin:.0f})")

    if query_ms:
        print(f"\n单次查询耗时：中位 {np.median(query_ms):.0f}ms，"
              f"p95 {np.percentile(query_ms, 95):.0f}ms（Python 实现，WASM 会更快）")

    # ---- 阶段三：真实现场录音 ----
    live_files = list_audio(live_dir)
    live_rows = []
    if live_files:
        print(f"\n现场录音 {len(live_files)} 段：")
        for lf in live_files:
            ln = norm(lf.stem)
            cands = [i for i, n in enumerate(names) if norm(n) and norm(n) in ln]
            if len(cands) != 1:
                print(f"  {lf.name[:40]:<42} 跳过（文件名匹配不到唯一曲目）")
                continue
            true_sid = cands[0]
            y = audio.load_audio(lf)
            windows = extract_windows(y, 3)
            hits = 0
            for w in windows:
                h, t = fp.fingerprint_signal(w)
                ranked = index.query(h, t, dt_tol=DT_TOL)
                if ranked and ranked[0][0] == true_sid:
                    hits += 1
            acc = hits / len(windows)
            live_rows.append((lf.name, names[true_sid], acc))
            print(f"  {lf.name[:40]:<42} -> {names[true_sid][:24]:<26} {acc * 100:5.1f}%")
    else:
        print("\n（drop/live/ 为空，跳过现场录音阶段 —— 这一段的结论才是关键）")

    # ---- 确认阈值建议 ----
    print("\n置信度阈值参考（匹配率 = 命中哈希数 / 查询哈希数）：")
    key = "混响 1.5s + 噪声 0dB"
    cs, ws = score_rows[key]
    for thr in (0.005, 0.01, 0.02, 0.03, 0.05, 0.08):
        if cs.size == 0:
            continue
        cov = float(np.mean(cs >= thr))
        fp_rate = float(np.mean(ws >= thr)) if ws.size else 0.0
        print(f"  阈值 {thr * 100:4.1f}%: 正确结果覆盖率 {cov * 100:5.1f}%   误报率 {fp_rate * 100:5.1f}%")

    write_report(rows, live_rows, names, len(index.hashes), peaks_total / max(secs_total, 1))
    print(f"\n报告已写入 {OUT / 'report.md'}")
    return 0


def write_report(rows, live_rows, names, n_index, density) -> None:
    OUT.mkdir(exist_ok=True)
    lines = [
        "# 闭集指纹命中率实验报告",
        "",
        f"- 曲库：{len(names)} 首，索引 {n_index:,} 条哈希，峰值密度 {density:.1f}/s",
        f"- 查询片段：{CLIP_S:.0f}s，每首 {CLIPS_PER_SONG} 段",
        "",
        "## 录音室版自查询",
        "",
        "| 条件 | top-1 命中率 | 样本数 |",
        "|---|---|---|",
    ]
    for cname, acc, total, _ in rows:
        lines.append(f"| {cname} | {acc * 100:.1f}% | {total} |")
    lines += ["", "## 现场录音", ""]
    if live_rows:
        lines += ["| 文件 | 匹配曲目 | top-1 命中率 |", "|---|---|---|"]
        for fn, song, acc in live_rows:
            lines.append(f"| {fn} | {song} | {acc * 100:.1f}% |")
    else:
        lines.append("未提供现场录音，本项未测。")
    (OUT / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
