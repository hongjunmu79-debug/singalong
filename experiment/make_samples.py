"""生成合成音频，用来端到端冒烟测试 run_experiment.py。

产物放进 sample_drop/studio，不污染 drop/（那是放真实音乐的目录）。
"""
from __future__ import annotations

import sys
import zlib
from pathlib import Path

import numpy as np
import soundfile as sf

import audio
from selfcheck import synth_song

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = Path(__file__).resolve().parent
OUT = BASE / "sample_drop" / "studio"
NAMES = ["Attention", "How Long", "We Don't Talk Anymore", "One Call Away",
         "Left and Right", "That's Hilarious"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(NAMES):
        y = synth_song(zlib.crc32(name.encode()) % 100000 + i, dur=70.0)
        path = OUT / f"{name}.wav"
        sf.write(path, y, audio.SR, subtype="PCM_16")
        print(f"  {path.name}  {len(y) / audio.SR:.0f}s")
    print(f"\n{len(NAMES)} 个文件已生成到 {OUT}")


if __name__ == "__main__":
    main()
