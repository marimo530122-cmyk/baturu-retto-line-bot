import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.data import store
from app.models import (
    ConsultationSession,
    ManualTranscriptIn,
    SessionStatus,
    TranscriptSegment,
)
from app.services import llm_pipeline
from app.services.realtime_audio import create_transcriber

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


@router.get("/{session_id}", response_model=ConsultationSession)
def get_session(session_id: str) -> ConsultationSession:
    return store.get_session(session_id)


@router.post("/{session_id}/transcript/manual", response_model=ConsultationSession)
def add_manual_transcript(session_id: str, body: ManualTranscriptIn) -> ConsultationSession:
    """マイクを使わない開発/デモ用: 手動でテキストを議事録に追加する。"""
    session = store.get_session(session_id)
    session.transcript.append(TranscriptSegment(speaker=body.speaker, text=body.text))
    store.save_session(session)
    return session


@router.post("/{session_id}/prescription/refresh", response_model=ConsultationSession)
async def refresh_prescription(session_id: str) -> ConsultationSession:
    """診察中の会話（議事録）から処方オーダをその都度再抽出し、対話の進行に合わせて
    処方箋が自動的に育っていく「ライブ処方ドラフト」を実現するエンドポイント。

    finalize とは異なりセッションのステータスは変更しない。また、医師が既に
    処方内容を手動編集済み（prescription.edited）の場合は、その編集内容を
    AIの再抽出で上書きしないよう、自動更新をスキップする。
    """
    session = store.get_session(session_id)
    if session.prescription.edited:
        return session

    settings = get_settings()
    session.prescription = await llm_pipeline.extract_prescription(settings, session)
    store.save_session(session)
    return session


@router.post("/{session_id}/live-draft/refresh", response_model=ConsultationSession)
async def refresh_live_draft(session_id: str) -> ConsultationSession:
    """アンビエントスクライブのライブプレビュー（主訴・治療方針・処方・紹介状の4項目）を、
    ここまでの会話全文から手動入力なしで再生成する。医師プロファイルと、直近にこの医師が
    確定させたカルテを文体参考として利用する。finalize とは異なりセッションの
    ステータスは変更しない。"""
    session = store.get_session(session_id)
    settings = get_settings()
    physician_profile = store.get_physician_profile()
    style_examples = store.list_recent_finalized_sessions(limit=2)

    session.live_draft = await llm_pipeline.generate_live_draft(
        settings, session, physician_profile, style_examples
    )
    store.save_session(session)
    return session


@router.post("/{session_id}/finalize", response_model=ConsultationSession)
async def finalize_session(session_id: str) -> ConsultationSession:
    session = store.get_session(session_id)
    session.status = SessionStatus.GENERATING
    store.save_session(session)

    settings = get_settings()
    await llm_pipeline.run_full_pipeline(settings, session)

    session.status = SessionStatus.REVIEW
    store.save_session(session)
    return session


@router.websocket("/{session_id}/audio")
async def audio_ws(websocket: WebSocket, session_id: str) -> None:
    """フロントからのリアルタイム音声(base64 PCM16)/手動テキストを受け取り、
    文字起こしデルタを返しつつ、確定した発話をセッションの議事録に蓄積する。

    受信メッセージ (JSON):
      {"type": "audio_chunk", "audio": "<base64>"}
      {"type": "manual_text", "speaker": "doctor"|"patient"|"staff", "text": "..."}
    送信メッセージ (JSON):
      {"type": "transcript_delta", "text": "...", "is_final": true|false}
      {"type": "error", "message": "..."}
    """
    await websocket.accept()
    try:
        session = store.get_session(session_id)
    except Exception:  # noqa: BLE001
        await websocket.send_json({"type": "error", "message": "セッションが見つかりません"})
        await websocket.close()
        return

    settings = get_settings()
    transcriber = create_transcriber(settings)
    await transcriber.start()

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            if msg_type == "audio_chunk":
                await transcriber.feed_audio_chunk(message.get("audio", ""))
                for delta in await transcriber.poll_deltas():
                    if delta.is_final:
                        session.transcript.append(TranscriptSegment(text=delta.text, is_final=True))
                        store.save_session(session)
                    await websocket.send_json(
                        {"type": "transcript_delta", "text": delta.text, "is_final": delta.is_final}
                    )

            elif msg_type == "manual_text":
                speaker = message.get("speaker", "unknown")
                text = message.get("text", "")
                if not text.strip():
                    continue
                async for delta in transcriber.feed_manual_text(text):
                    session.transcript.append(
                        TranscriptSegment(speaker=speaker, text=delta.text, is_final=delta.is_final)
                    )
                    store.save_session(session)
                    await websocket.send_json(
                        {"type": "transcript_delta", "text": delta.text, "is_final": delta.is_final, "speaker": speaker}
                    )
            else:
                await websocket.send_json({"type": "error", "message": f"不明なメッセージタイプ: {msg_type}"})

    except WebSocketDisconnect:
        logger.info("audio_ws disconnected: session=%s", session_id)
    finally:
        await transcriber.close()
