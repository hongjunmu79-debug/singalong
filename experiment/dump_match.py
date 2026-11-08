"""导出 Python 版的匹配结果，供 TypeScript 版对拍。

用法：python dump_match.py <a.f32> <b.f32> <query_offset_sec> <out.json>
用 a 的第 offset 秒起 8 秒片段，去 a/b 两首歌里找。
"""
from __future__ import annotations

import json
import sys

import numpy as np

import fingerprint as fp

SR = fp.SR
CLIP_S = 8


def load(path: str) -> np.ndarray:
    y = np.fromfile(path, dtype=np.float32)
    peak = float(np.max(np.abs(y)))
    if peak > 1e-6:
        y = y / peak
    return y


def main(a: str, b: str, offset: float, out: str) -> None:
    ya, yb = load(a), load(b)

    idx = fp.Index()
    for sid, y in enumerate((ya, yb)):
        h, t = fp.fingerprint_signal(y)
        idx.add(sid, h, t)
    idx.finalize()

    start = int(offset * SR)
    clip = ya[start:start + CLIP_S * SR]
    h, t = fp.fingerprint_signal(clip)
    ranked = idx.query(h, t, topk=3)

    payload = {
        "queryHashes": int(len(h)),
        "ranked": [{"song": int(s), "score": float(sc)} for s, sc in ranked],
    }
    with open(out, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=1)
    print(f"Python: queryHashes={len(h)} ranked={payload['ranked']}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4])
