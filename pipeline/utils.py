"""共通ユーティリティ: 設定読み込み、環境変数チェック、ffprobe/ffmpeg実行ヘルパー。"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any

logger = logging.getLogger("shorts_pipeline")

_ENV_PATTERN = re.compile(r"^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$")


class PipelineError(RuntimeError):
    """パイプライン内で発生した回復不能なエラー。"""


def _substitute_env(value: Any) -> Any:
    if isinstance(value, str):
        m = _ENV_PATTERN.match(value)
        if m:
            # 未設定でもここでは失敗させない。config.json内には使われていない
            # provider向けの'${...}'プレースホルダーも大量に存在するため、
            # 実際にその値を使うコード側(例: narration_elevenlabs.py)が
            # 必要になった時点で明示的にチェック・エラーにする。
            return os.environ.get(m.group(1)) or None
        return value
    if isinstance(value, dict):
        return {k: _substitute_env(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_substitute_env(v) for v in value]
    return value


def load_config(path: str | Path) -> dict:
    path = Path(path)
    if not path.exists():
        raise PipelineError(f"設定ファイルが見つかりません: {path}")
    with path.open("r", encoding="utf-8") as f:
        raw = json.load(f)
    return _substitute_env(raw)


def require_binaries(*names: str) -> None:
    missing = [n for n in names if shutil.which(n) is None]
    if missing:
        raise PipelineError(
            "必要な実行ファイルが見つかりません: "
            + ", ".join(missing)
            + " (例: `apt-get install ffmpeg` でインストールしてください)"
        )


def require_env(*names: str) -> None:
    missing = [n for n in names if not os.environ.get(n)]
    if missing:
        raise PipelineError(
            "必要な環境変数が設定されていません: "
            + ", ".join(missing)
            + " (.env または環境変数として設定してください。.env.example を参照)"
        )


def content_hash(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:20]


def run(cmd: list[str], *, check: bool = True) -> subprocess.CompletedProcess:
    logger.debug("実行コマンド: %s", " ".join(cmd))
    result = subprocess.run(cmd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise PipelineError(
            f"コマンド失敗 (exit={result.returncode}): {' '.join(cmd)}\n"
            f"--- stderr ---\n{result.stderr[-4000:]}"
        )
    return result


def ffprobe_duration_sec(path: str | Path) -> float:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ]
    )
    return float(result.stdout.strip())


def ffprobe_dimensions(path: str | Path) -> tuple[int, int]:
    result = run(
        [
            "ffprobe",
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=s=x:p=0",
            str(path),
        ]
    )
    w, h = result.stdout.strip().split("x")
    return int(w), int(h)


def setup_logging(verbose: bool = False) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="[%(asctime)s] %(levelname)s %(name)s: %(message)s",
        datefmt="%H:%M:%S",
    )
