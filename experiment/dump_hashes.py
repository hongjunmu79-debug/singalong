"""把 Python 版指纹结果导出成二进制，供 TypeScript 版交叉验证。

用法：python dump_hashes.py <raw.f32> <out.bin>
raw.f32 是 ffmpeg 导出的 11025Hz 单声道 float32 裸数据。
"""
from __future__ import annotations

import sys

import numpy as np

import fingerprint as fp


def main(src: str, dst: str) -> None:
    y = np.fromfile(src, dtype=np.float32)
    peak = float(np.max(np.abs(y)))
    if peak > 1e-6:
        y = y / peak
    hashes, _ = fp.fingerprint_signal(y)
    hashes = np.sort(hashes).astype(np.int32)
    hashes.tofile(dst)
    print(f"Python: {len(hashes):,} hashes -> {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
