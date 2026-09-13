"""医療AI ローカル完結アプリ（バックエンド）。

このファイルは外部のクラウドAI API（OpenAI等）を一切呼び出さない。
- 音声文字起こし: faster-whisper（このPC上で実行、モデル重みのダウンロードのみ初回にネット接続が必要）
- カルテ生成: ローカルLLM（Ollama、http://localhost:11434 に対してHTTP接続。これもこのPC上で動作）

Ollamaが起動していない場合は、動作確認用のダミー（[MOCK]）内容を返す。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import tempfile
from pathlib import Path

import httpx
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("medical-ai-local")

# ---- 設定（すべて環境変数で上書き可能） ----
WHISPER_MODEL_SIZE = os.environ.get("WHISPER_MODEL_SIZE", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "ja")
OLLAMA_URL = os.environ.get("OLLAMA_URL", "http://localhost:11434")
OLLAMA_MODEL = os.environ.get("OLLAMA_MODEL", "llama3.2")

app = FastAPI(title="医療AI ローカル完結アプリ")

INDEX_HTML_PATH = Path(__file__).parent / "index.html"


@app.get("/")
def index() -> FileResponse:
    return FileResponse(INDEX_HTML_PATH)


# ---------------------------------------------------------------------------
# Whisper（音声文字起こし）: 遅延ロード。初回リクエスト時にのみモデルをメモリに読み込む。
# ---------------------------------------------------------------------------
_whisper_model = None
_whisper_load_lock = asyncio.Lock()


def _load_whisper_sync():
    from faster_whisper import WhisperModel

    logger.info(
        "Whisperモデルを読み込んでいます (size=%s, device=%s, compute_type=%s)...",
        WHISPER_MODEL_SIZE,
        WHISPER_DEVICE,
        WHISPER_COMPUTE_TYPE,
    )
    return WhisperModel(WHISPER_MODEL_SIZE, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE_TYPE)


async def _get_whisper_model():
    global _whisper_model
    if _whisper_model is None:
        async with _whisper_load_lock:
            if _whisper_model is None:
                loop = asyncio.get_event_loop()
                _whisper_model = await loop.run_in_executor(None, _load_whisper_sync)
    return _whisper_model


def _transcribe_file_sync(model, path: str) -> str:
    segments, _info = model.transcribe(path, language=WHISPER_LANGUAGE, vad_filter=True)
    return "".join(seg.text for seg in segments).strip()


# ---------------------------------------------------------------------------
# 状態（プロトタイプのため単一セッションのインメモリ状態。複数患者管理は行わない）
# ---------------------------------------------------------------------------
class TranscriptSegment(BaseModel):
    speaker: str = "unknown"
    text: str


transcript: list[TranscriptSegment] = []

live_draft: dict = {
    "chief_complaint": "",
    "clinical_reasoning": "",
    "prescription_draft": "",
    "referral_letter": "",
    "engine": "none",
}


@app.post("/api/transcribe-chunk")
async def transcribe_chunk(audio: UploadFile = File(...), speaker: str = Form("unknown")) -> dict:
    """ブラウザから送られてきた数秒分の音声チャンクをローカルWhisperで文字起こしする。"""
    suffix = Path(audio.filename or "chunk.webm").suffix or ".webm"
    raw = await audio.read()

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(raw)
        tmp_path = tmp.name

    try:
        model = await _get_whisper_model()
        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(None, _transcribe_file_sync, model, tmp_path)
    except Exception:  # noqa: BLE001
        logger.exception("音声チャンクの文字起こしに失敗しました")
        text = ""
    finally:
        os.unlink(tmp_path)

    if text:
        transcript.append(TranscriptSegment(speaker=speaker, text=text))

    return {"text": text, "transcript": [t.model_dump() for t in transcript]}


class ManualTextIn(BaseModel):
    speaker: str = "unknown"
    text: str


@app.post("/api/manual-text")
def add_manual_text(body: ManualTextIn) -> dict:
    """マイクを使わない開発/デモ用の手動テキスト入力（シミュレーション機能）。"""
    text = body.text.strip()
    if text:
        transcript.append(TranscriptSegment(speaker=body.speaker, text=text))
    return {"transcript": [t.model_dump() for t in transcript]}


@app.get("/api/transcript")
def get_transcript() -> dict:
    return {"transcript": [t.model_dump() for t in transcript]}


@app.post("/api/reset")
def reset() -> dict:
    transcript.clear()
    live_draft.update(
        chief_complaint="",
        clinical_reasoning="",
        prescription_draft="",
        referral_letter="",
        engine="none",
    )
    return {"ok": True}


# ---------------------------------------------------------------------------
# ローカルLLM（Ollama）によるライブカルテドラフト生成
# ---------------------------------------------------------------------------
LIVE_DRAFT_SYSTEM_PROMPT = """あなたは日本の診察室で動作する、完全ローカル動作のAIカルテ書記です。
医師と患者の会話全文（ここまでの分）から、手動入力なしで以下4項目のJSONを更新してください。
まだ会話に出ていない項目は空文字にしてください。会話に含まれていない事実（診断名・薬剤名・数値など）を
創作しないでください。出力は次のキーだけを持つJSONオブジェクトのみとしてください。

{
  "chief_complaint": "主訴・症状の要約",
  "clinical_reasoning": "医師の思考に沿った治療方針・提案",
  "prescription_draft": "処方内容・生活指導のドラフト",
  "referral_letter": "紹介状・診療情報提供書ドラフト（他院連携の話題が無ければ空文字）"
}"""


def _extract_json(content: str) -> dict:
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.lower().startswith("json"):
            content = content[4:]
    return json.loads(content)


async def _call_ollama(transcript_text: str) -> dict:
    payload = {
        "model": OLLAMA_MODEL,
        "messages": [
            {"role": "system", "content": LIVE_DRAFT_SYSTEM_PROMPT},
            {"role": "user", "content": transcript_text},
        ],
        "format": "json",
        "stream": False,
    }
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
        resp.raise_for_status()
        data = resp.json()
    content = data.get("message", {}).get("content", "")
    return _extract_json(content)


def _transcript_text() -> str:
    label = {"doctor": "医師", "patient": "患者", "staff": "スタッフ", "unknown": "話者不明"}
    return "\n".join(f"{label.get(t.speaker, '話者不明')}: {t.text}" for t in transcript)


@app.post("/api/live-draft/refresh")
async def refresh_live_draft() -> dict:
    text = _transcript_text()
    if not text.strip():
        return live_draft

    try:
        result = await _call_ollama(text)
        live_draft.update(
            chief_complaint=result.get("chief_complaint", ""),
            clinical_reasoning=result.get("clinical_reasoning", ""),
            prescription_draft=result.get("prescription_draft", ""),
            referral_letter=result.get("referral_letter", ""),
            engine=f"ollama:{OLLAMA_MODEL}",
        )
    except Exception as e:  # noqa: BLE001
        logger.warning("ローカルLLM(Ollama)の呼び出しに失敗しました。Ollamaが起動しているか確認してください: %s", e)
        live_draft.update(
            chief_complaint="[MOCK] " + text.splitlines()[0][:60],
            clinical_reasoning="[MOCK] Ollamaに接続できないため、ダミー内容を表示しています",
            prescription_draft="[MOCK] Ollamaを起動すると実際のローカルLLM生成に切り替わります",
            referral_letter="",
            engine="mock",
        )
    return live_draft


@app.get("/api/live-draft")
def get_live_draft() -> dict:
    return live_draft


@app.get("/api/status")
async def status() -> dict:
    ollama_reachable = False
    try:
        async with httpx.AsyncClient(timeout=2) as client:
            r = await client.get(f"{OLLAMA_URL}/api/tags")
            ollama_reachable = r.status_code == 200
    except Exception:  # noqa: BLE001
        ollama_reachable = False

    return {
        "whisper_model": WHISPER_MODEL_SIZE,
        "whisper_loaded": _whisper_model is not None,
        "ollama_url": OLLAMA_URL,
        "ollama_model": OLLAMA_MODEL,
        "ollama_reachable": ollama_reachable,
    }
