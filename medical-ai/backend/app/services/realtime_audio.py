"""リアルタイム音声文字起こしの抽象化。

- OPENAI_API_KEY が設定されている場合: OpenAI Realtime API (wss) にブラウザから届いた
  PCM16 音声チャンクを中継し、文字起こしイベントをテキストデルタとして返す。
- 未設定の場合: SimulatedTranscriber を使用し、フロントから送られる手動テキスト入力
  （開発用の「マイクなしモード」）をそのまま議事録セグメントとして扱う。

どちらの実装も同じインターフェース (RealtimeTranscriber) を満たすため、
ルーター側は音声認識バックエンドの違いを意識しない。
"""
from __future__ import annotations

import base64
import json
import logging
from abc import ABC, abstractmethod
from typing import AsyncIterator

from app.config import Settings

logger = logging.getLogger(__name__)

OPENAI_REALTIME_WS_URL = "wss://api.openai.com/v1/realtime"


class TranscriptDelta:
    def __init__(self, text: str, is_final: bool):
        self.text = text
        self.is_final = is_final


class RealtimeTranscriber(ABC):
    """1診察セッションにつき1インスタンス。"""

    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def feed_audio_chunk(self, audio_b64: str) -> None:
        """フロントから届いた base64 PCM16(16kHz mono) チャンクを送る。"""

    @abstractmethod
    async def feed_manual_text(self, text: str) -> AsyncIterator[TranscriptDelta]:
        """マイクを使わない開発/デモ用: テキストをそのまま確定セグメントとして返す。"""

    @abstractmethod
    async def poll_deltas(self) -> list[TranscriptDelta]:
        """音声認識サービスから届いた新規デルタを取り出す（ノンブロッキング）。"""

    @abstractmethod
    async def close(self) -> None: ...


class SimulatedTranscriber(RealtimeTranscriber):
    """OPENAI_API_KEY 未設定時、またはテスト用のフォールバック実装。

    実際の音声波形は解析せず、フロントエンドの「テキスト入力（マイクなしモード）」
    からのテキストのみを議事録に反映する。音声チャンクは受け取っても無視する。
    """

    def __init__(self) -> None:
        self._pending: list[TranscriptDelta] = []

    async def start(self) -> None:
        logger.info("SimulatedTranscriber started (OPENAI_API_KEY 未設定のためモックモード)")

    async def feed_audio_chunk(self, audio_b64: str) -> None:
        # モックモードでは音声波形の解析は行わない。
        return None

    async def feed_manual_text(self, text: str) -> AsyncIterator[TranscriptDelta]:
        delta = TranscriptDelta(text=text, is_final=True)
        yield delta

    async def poll_deltas(self) -> list[TranscriptDelta]:
        pending, self._pending = self._pending, []
        return pending

    async def close(self) -> None:
        return None


class OpenAIRealtimeTranscriber(RealtimeTranscriber):
    """OpenAI Realtime API (wss) を用いたリアルタイム文字起こし。

    プロトコル概要 (Realtime API):
      1. wss://api.openai.com/v1/realtime?model=... へ Authorization ヘッダ付きで接続
      2. session.update で入力音声フォーマット/文字起こしモデルを設定
      3. input_audio_buffer.append で base64 PCM16 チャンクを送信
      4. conversation.item.input_audio_transcription.completed イベントで確定テキストを受信

    このクラスは接続とイベントの中継のみを担当し、SOAP/紹介状/処方の生成には関与しない
    （それは llm_pipeline.py が transcript 全文に対して行う）。
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._ws = None
        self._deltas: list[TranscriptDelta] = []
        self._recv_task = None

    async def start(self) -> None:
        try:
            import websockets
        except ImportError as e:  # pragma: no cover
            raise RuntimeError("websockets パッケージが必要です") from e

        import asyncio

        url = f"{OPENAI_REALTIME_WS_URL}?model={self._settings.realtime_model}"
        headers = {
            "Authorization": f"Bearer {self._settings.openai_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }
        self._ws = await websockets.connect(url, extra_headers=headers, max_size=None)
        await self._ws.send(
            json.dumps(
                {
                    "type": "session.update",
                    "session": {
                        "input_audio_format": "pcm16",
                        "input_audio_transcription": {"model": "whisper-1"},
                        "turn_detection": {"type": "server_vad"},
                    },
                }
            )
        )
        self._recv_task = asyncio.create_task(self._recv_loop())

    async def _recv_loop(self) -> None:
        assert self._ws is not None
        try:
            async for raw in self._ws:
                event = json.loads(raw)
                etype = event.get("type", "")
                if etype == "conversation.item.input_audio_transcription.completed":
                    text = event.get("transcript", "")
                    if text:
                        self._deltas.append(TranscriptDelta(text=text, is_final=True))
                elif etype == "conversation.item.input_audio_transcription.delta":
                    text = event.get("delta", "")
                    if text:
                        self._deltas.append(TranscriptDelta(text=text, is_final=False))
        except Exception:  # noqa: BLE001
            logger.exception("Realtime API 受信ループでエラーが発生しました")

    async def feed_audio_chunk(self, audio_b64: str) -> None:
        if not self._ws:
            return
        await self._ws.send(
            json.dumps({"type": "input_audio_buffer.append", "audio": audio_b64})
        )

    async def feed_manual_text(self, text: str) -> AsyncIterator[TranscriptDelta]:
        # OpenAI Realtime 接続時も、開発用の手動テキスト入力はローカルで即時反映する。
        yield TranscriptDelta(text=text, is_final=True)

    async def poll_deltas(self) -> list[TranscriptDelta]:
        pending, self._deltas = self._deltas, []
        return pending

    async def close(self) -> None:
        if self._recv_task:
            self._recv_task.cancel()
        if self._ws:
            await self._ws.close()


def create_transcriber(settings: Settings) -> RealtimeTranscriber:
    if settings.mock_mode:
        return SimulatedTranscriber()
    return OpenAIRealtimeTranscriber(settings)


def decode_audio_chunk(audio_b64: str) -> bytes:
    return base64.b64decode(audio_b64)
