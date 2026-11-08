# 把音频放进这里

目录结构：

```
drop/
  studio/    这个歌手每首歌的音频（mp3 / m4a / flac / wav 都行），文件名就是歌名
  live/      可选：现场录音或手机拍的视频，文件名里带歌名，用于测真实场景
```

## studio/ 放什么

20–30 个文件，覆盖你预计这场会唱到的歌。文件名用歌名即可，例如：

```
Attention.mp3
We Don't Talk Anymore.mp3
How Long.mp3
```

## live/ 放什么（这一段才决定实验结论）

任意几段**同一批歌的现场录音**，最好是你自己手机在演唱会拍的视频。文件名里要包含歌名，例如：

```
Attention_杭州现场.mp4
How_Long_2024巡演.mp4
```

没有 live 录音也能跑，但那样只能测出「录音室版对录音室版」的命中率，
**测不出「现场版对录音室版」这个真正的难点**。如果实在没有，退一步可以用
线上演唱会录像的音轨，但要注明来源。

## 跑

```bash
cd experiment
../.venv/Scripts/python.exe run_experiment.py
```
