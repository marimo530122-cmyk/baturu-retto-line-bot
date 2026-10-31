#!/usr/bin/env python3
"""声の感情の実験: 録音ファイルを数秒ずつに切り、声の感情(怒り・恐れ・驚き など)の割合を出す。

本番(Render)や見守り画面とは関係のない、手元の実験用。「声の感情を足すと、詐欺の見分けがよくなるか」を
数字で確かめるための道具。結果だけを見て本番に入れることはしない(決まりは README.md)。

    python analyze.py sample_fraud.wav
    python analyze.py samples/            # フォルダの中の音声を全部
    python analyze.py samples/ --label-from-folder   # samples/fraud/ と samples/normal/ を比べる

使うモデル:
- emotion2vec+(既定): 声の感情を9種類の割合(合計100%)で出す。「焦り」という種類は無いので、
  話す速さ・声の大きさ・声の高さの揺れを別に測って、焦りの手がかりにする。
- SenseVoice(--sensevoice): 文字起こしと、感情の判定(1つだけ)。話す速さ(1秒あたりの文字数)も出す。

音声は保存しない(一時ファイルは処理のあとすぐ消す)。結果のCSVに文字起こしが入るので、
自分の家族の電話などを分析したときは、CSVをGitやSNSに上げないこと。
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict

import numpy as np
import soundfile as sf

SR = 16000
AUDIO_EXT = (".wav", ".mp3", ".m4a", ".aac", ".mp4", ".ogg", ".flac", ".webm")

# emotion2vec+ の9種類(モデルが返す名前 "生气/angry" の英語の部分)→ 日本語
EMOTIONS = {
    "angry": "怒り",
    "fearful": "恐れ",
    "surprised": "驚き",
    "sad": "悲しみ",
    "disgusted": "嫌悪",
    "happy": "喜び",
    "neutral": "平静",
    "other": "その他",
    "unknown": "不明",
}
# 詐欺の電話で出そうだと考えている感情(仮説)。当たるかどうかを確かめるのがこの実験
ALERT = ("angry", "fearful", "surprised")

# 電話の音声向けの前処理(ffmpeg)。電話は 300〜3400Hz しか通さないので、その外を落として音量をそろえる
FILTERS = {
    "none": None,
    "light": "highpass=f=150,lowpass=f=3800,loudnorm=I=-20:TP=-2",
    "denoise": "highpass=f=150,lowpass=f=3800,afftdn=nf=-25,loudnorm=I=-20:TP=-2",
}


def load_audio(path: str, filt: str | None) -> np.ndarray:
    """ffmpeg で 16kHz・モノラルにそろえて読み込む(前処理つき)。"""
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg が見つかりません。README.md の手順で入れてください。")
    fd, tmp = tempfile.mkstemp(suffix=".wav")
    os.close(fd)
    try:
        cmd = ["ffmpeg", "-y", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR)]
        if filt:
            cmd += ["-af", filt]
        subprocess.run(cmd + [tmp], check=True)
        audio, _ = sf.read(tmp, dtype="float32")
        return audio
    finally:
        os.remove(tmp)


def windows(audio: np.ndarray, win_sec: float, hop_sec: float, min_db: float):
    """win_sec 秒ずつ(hop_sec 秒ずらして)切り出す。ほとんど無音の区間は飛ばす。"""
    win, hop = int(win_sec * SR), int(hop_sec * SR)
    starts = range(0, max(1, len(audio) - win + 1), hop) if len(audio) > win else [0]
    for s in starts:
        seg = audio[s : s + win]
        if len(seg) < SR * 1.5:
            continue
        db = 20 * np.log10(np.sqrt(np.mean(seg**2)) + 1e-9)
        if db < min_db:
            continue
        yield s / SR, (s + len(seg)) / SR, seg, db


def pitch_spread(seg: np.ndarray) -> float | None:
    """声の高さの揺れ(半音の標準偏差)。抑揚が大きいほど大きい。測れないときは None。"""
    try:
        import librosa

        f0 = librosa.yin(seg, fmin=70, fmax=400, sr=SR, frame_length=1024)
        f0 = f0[(f0 > 75) & (f0 < 390)]
        if len(f0) < 10:
            return None
        return float(np.std(12 * np.log2(f0 / np.median(f0))))
    except Exception:
        return None


class Emotion2Vec:
    def __init__(self, hub: str):
        from funasr import AutoModel

        name = "emotion2vec/emotion2vec_plus_base" if hub == "hf" else "iic/emotion2vec_plus_base"
        self.model = AutoModel(model=name, hub=hub, disable_update=True, disable_pbar=True)

    def __call__(self, seg: np.ndarray) -> dict[str, float]:
        res = self.model.generate(seg, granularity="utterance", extract_embedding=False, disable_pbar=True)[0]
        out = {k: 0.0 for k in EMOTIONS}
        for label, score in zip(res["labels"], res["scores"]):
            key = label.split("/")[-1].strip().lower()
            if key in out:
                out[key] += float(score)
        return out


class SenseVoice:
    TAG = re.compile(r"<\|([^|]+)\|>")

    def __init__(self, hub: str):
        from funasr import AutoModel

        name = "FunAudioLLM/SenseVoiceSmall" if hub == "hf" else "iic/SenseVoiceSmall"
        self.model = AutoModel(model=name, hub=hub, disable_update=True, disable_pbar=True)

    def __call__(self, seg: np.ndarray) -> tuple[str, str]:
        raw = self.model.generate(seg, language="ja", use_itn=False, disable_pbar=True)[0]["text"]
        tags = [t.upper() for t in self.TAG.findall(raw)]
        emo = next((t for t in tags if t in {"HAPPY", "SAD", "ANGRY", "NEUTRAL", "FEARFUL", "DISGUSTED", "SURPRISED"}), "")
        return emo.lower(), self.TAG.sub("", raw).strip()


def collect(paths: list[str]) -> list[str]:
    files = []
    for p in paths:
        if os.path.isdir(p):
            for root, _, names in os.walk(p):
                files += [os.path.join(root, n) for n in sorted(names) if n.lower().endswith(AUDIO_EXT)]
        elif os.path.isfile(p):
            files.append(p)
        else:
            print(f"見つかりません: {p}", file=sys.stderr)
    return files


def pct(x: float) -> str:
    return f"{x * 100:5.1f}%"


def main() -> None:
    ap = argparse.ArgumentParser(description="録音ファイルの声の感情を調べる(実験用)")
    ap.add_argument("paths", nargs="+", help="音声ファイルかフォルダ")
    ap.add_argument("--label-from-folder", action="store_true", help="1つ上のフォルダ名(fraud/normal など)をラベルにして比べる")
    ap.add_argument("--label", default="", help="全部のファイルに付けるラベル(例: fraud)")
    ap.add_argument("--filter", choices=FILTERS, default="light", help="前処理(none / light / denoise)")
    ap.add_argument("--window", type=float, default=6.0, help="何秒ずつ調べるか")
    ap.add_argument("--hop", type=float, default=3.0, help="何秒ずつずらすか")
    ap.add_argument("--min-db", type=float, default=-45.0, help="これより小さい音の区間は無音として飛ばす")
    ap.add_argument("--max-sec", type=float, default=600.0, help="1本あたり先頭から何秒まで調べるか")
    ap.add_argument("--sensevoice", action="store_true", help="SenseVoice で文字起こしと話す速さも出す(遅くなる)")
    ap.add_argument("--hub", choices=["ms", "hf"], default="ms", help="モデルの取得先(ms: ModelScope / hf: Hugging Face)")
    ap.add_argument("--out", default="emotion_results.csv", help="区間ごとの結果のCSV")
    ap.add_argument("--summary", default="emotion_summary.md", help="まとめ(Markdown)")
    args = ap.parse_args()

    files = collect(args.paths)
    if not files:
        sys.exit("音声ファイルがありません。")
    print(f"{len(files)}本の音声を調べます(前処理: {args.filter})。初回はモデルのダウンロードに数分かかります。")
    emo = Emotion2Vec(args.hub)
    sv = SenseVoice(args.hub) if args.sensevoice else None

    rows, per_file = [], []
    for path in files:
        label = os.path.basename(os.path.dirname(path)) if args.label_from_folder else args.label
        audio = load_audio(path, FILTERS[args.filter])[: int(args.max_sec * SR)]
        segs = []
        for start, end, seg, db in windows(audio, args.window, args.hop, args.min_db):
            scores = emo(seg)
            row = {
                "file": os.path.basename(path),
                "label": label,
                "start": round(start, 1),
                "end": round(end, 1),
                "loudness_db": round(db, 1),
                "pitch_spread": (lambda v: "" if v is None else round(v, 2))(pitch_spread(seg)),
                **{k: round(v, 4) for k, v in scores.items()},
                "top": max(scores, key=scores.get),
            }
            if sv:
                sv_emo, text = sv(seg)
                row["sv_emotion"] = sv_emo
                row["chars_per_sec"] = round(len(re.sub(r"\s", "", text)) / max(0.1, end - start), 2)
                row["text"] = text
            rows.append(row)
            segs.append(row)
        if not segs:
            print(f"  {os.path.basename(path)}: 声の区間が見つかりませんでした")
            continue
        mean = {k: float(np.mean([r[k] for r in segs])) for k in EMOTIONS}
        peak = {k: float(np.max([r[k] for r in segs])) for k in ALERT}
        neutral_share = sum(r["top"] == "neutral" for r in segs) / len(segs)
        per_file.append({"file": os.path.basename(path), "label": label, "n": len(segs), "mean": mean, "peak": peak, "neutral_share": neutral_share})
        top3 = sorted(mean.items(), key=lambda kv: -kv[1])[:3]
        print(f"  {os.path.basename(path)} [{label or '-'}] {len(segs)}区間: " + " / ".join(f"{EMOTIONS[k]} {pct(v)}" for k, v in top3)
              + f"  (「平静」がいちばん多い区間 {pct(neutral_share)})")

    if rows:
        keys = list(dict.fromkeys(k for r in rows for k in r))
        with open(args.out, "w", newline="", encoding="utf-8-sig") as f:
            w = csv.DictWriter(f, fieldnames=keys)
            w.writeheader()
            w.writerows(rows)

    lines = ["# 声の感情の実験結果", "", f"- 前処理: {args.filter} / 区間: {args.window}秒(ずらし {args.hop}秒)", f"- モデル: emotion2vec+ base" + (" + SenseVoice Small" if sv else ""), ""]
    lines += ["## ファイルごと(区間の平均)", "", "| ファイル | ラベル | 区間 | " + " | ".join(EMOTIONS[k] for k in ALERT) + " | 平静 | 「平静」が最多の区間 |", "|---|---|---|" + "---|" * (len(ALERT) + 2)]
    for p in per_file:
        lines.append(f"| {p['file']} | {p['label'] or '-'} | {p['n']} | " + " | ".join(pct(p["mean"][k]) for k in ALERT) + f" | {pct(p['mean']['neutral'])} | {pct(p['neutral_share'])} |")
    groups = defaultdict(list)
    for p in per_file:
        groups[p["label"] or "-"].append(p)
    if len(groups) > 1:
        lines += ["", "## ラベルごとの比べ(ファイル平均)", "", "| ラベル | 本数 | " + " | ".join(EMOTIONS[k] for k in ALERT) + " | 平静 |", "|---|---|" + "---|" * (len(ALERT) + 1)]
        for g, ps in groups.items():
            lines.append(f"| {g} | {len(ps)} | " + " | ".join(pct(np.mean([p['mean'][k] for p in ps])) for k in ALERT) + f" | {pct(np.mean([p['mean']['neutral'] for p in ps]))} |")
    lines += ["", "※ 感情の割合はモデルの推定で、確率として較正されたものではありません。数本だけで結論を出さないこと。"]
    with open(args.summary, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"\n区間ごとの結果: {args.out}\nまとめ: {args.summary}")


if __name__ == "__main__":
    main()
