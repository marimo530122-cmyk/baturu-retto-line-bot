import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect

from app.config import get_settings
from app.data import store
from app.deps import authenticate_token, CLINICAL_STAFF, DOCTOR_ONLY, require_roles
from app.errors import LlmGenerationError
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


@router.get("/{session_id}", response_model=ConsultationSession, dependencies=[Depends(require_roles(*CLINICAL_STAFF))])
def get_session(session_id: str) -> ConsultationSession:
    return store.get_session(session_id)


@router.post("/{session_id}/transcript/manual", response_model=ConsultationSession, dependencies=[Depends(require_roles(*CLINICAL_STAFF))])
def add_manual_transcript(session_id: str, body: ManualTranscriptIn) -> ConsultationSession:
    """マイクを使わない開発/デモ用: 手動でテキストを議事録に追加する。"""
    session = store.get_session(session_id)
    session.transcript.append(TranscriptSegment(speaker=body.speaker, text=body.text))
    store.save_session(session)
    return session


@router.post("/{session_id}/prescription/refresh", response_model=ConsultationSession, dependencies=[Depends(require_roles(*DOCTOR_ONLY))])
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
    try:
        session.prescription = await llm_pipeline.extract_prescription(settings, session)
    except LlmGenerationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    store.save_session(session)
    return session


@router.post("/{session_id}/live-draft/refresh", response_model=ConsultationSession, dependencies=[Depends(require_roles(*DOCTOR_ONLY))])
async def refresh_live_draft(session_id: str) -> ConsultationSession:
    """アンビエントスクライブのライブプレビュー（主訴・治療方針・処方・紹介状の4項目）を、
    ここまでの会話全文から手動入力なしで再生成する。医師プロファイルと、直近にこの医師が
    確定させたカルテを文体参考として利用する。finalize とは異なりセッションの
    ステータスは変更しない。"""
    session = store.get_session(session_id)
    settings = get_settings()
    physician_profile = store.get_physician_profile()
    style_examples = store.list_recent_finalized_sessions(limit=2)

    try:
        session.live_draft = await llm_pipeline.generate_live_draft(
            settings, session, physician_profile, style_examples
        )
    except LlmGenerationError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    store.save_session(session)
    return session


@router.post("/{session_id}/finalize", response_model=ConsultationSession, dependencies=[Depends(require_roles(*DOCTOR_ONLY))])
async def finalize_session(session_id: str) -> ConsultationSession:
    session = store.get_session(session_id)
    session.status = SessionStatus.GENERATING
    store.save_session(session)

    settings = get_settings()
    try:
        await llm_pipeline.run_full_pipeline(settings, session)
    except LlmGenerationError as exc:
        # 生成中状態のまま固まらないよう、医師が再試行できる状態に戻してから保存する
        session.status = SessionStatus.IN_PROGRESS
        store.save_session(session)
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    session.status = SessionStatus.REVIEW
    store.save_session(session)
    return session


@router.websocket("/{session_id}/audio")
async def audio_ws(websocket: WebSocket, session_id: str) -> None:
    """フロントからのリアルタイム音声(base64 PCM16)/手動テキストを受け取り、
    文字起こしデルタを返しつつ、確定した発話をセッションの議事録に蓄積する。

    受信メッセージ (JSON):
      {"type": "auth", "token": "<ログイントークン>"}  ← 接続直後に必ず最初に送る
      {"type": "audio_chunk", "audio": "<base64>"}
      {"type": "manual_text", "speaker": "doctor"|"patient"|"staff", "text": "..."}
    送信メッセージ (JSON):
      {"type": "transcript_delta", "text": "...", "is_final": true|false}
      {"type": "error", "message": "..."}
    """
    await websocket.accept()

    # ブラウザのWebSocketはログイン用のヘッダーを付けられないため、最初のメッセージでトークンを受け取る
    # (URLに入れるとサーバーのアクセスログに残ってしまうので使わない)
    async def _reject(message: str) -> None:
        await websocket.send_json({"type": "error", "fatal": True, "auth": True, "message": message})
        await websocket.close(code=4401)

    try:
        first = await asyncio.wait_for(websocket.receive_json(), timeout=10)
    except (asyncio.TimeoutError, WebSocketDisconnect, ValueError):
        await _reject("ログインしてください。")
        return
    token = first.get("token") if isinstance(first, dict) and first.get("type") == "auth" else None
    try:
        user = authenticate_token(token)
    except HTTPException as exc:
        await _reject(str(exc.detail))
        return
    if user.role not in CLINICAL_STAFF:
        await _reject("この操作を行う権限がありません。")
        return
    await websocket.send_json({"type": "auth_ok"})

    try:
        session = store.get_session(session_id)
    except Exception:  # noqa: BLE001
        await websocket.send_json({"type": "error", "message": "セッションが見つかりません", "fatal": True})
        await websocket.close()
        return

    settings = get_settings()
    transcriber = create_transcriber(settings)
    try:
        await transcriber.start()
    except Exception:  # noqa: BLE001
        logger.exception("音声認識の初期化に失敗しました: session=%s", session_id)
        await websocket.send_json(
            {
                "type": "error",
                "fatal": True,
                "message": "音声認識サービスに接続できませんでした。少し待ってから「マイク開始」を押し直してください。",
            }
        )
        await websocket.close()
        return

    try:
        while True:
            message = await websocket.receive_json()
            msg_type = message.get("type")

            # 録音中もメッセージのたびにログインを確認する(=録音中は自動ログアウトまでの時間が延びる)。
            # アカウント停止・パスワード再発行でログインが無効になったら、その場で接続を切る。
            try:
                authenticate_token(token)
            except HTTPException as exc:
                await _reject(str(exc.detail))
                break

            try:
                if msg_type == "audio_chunk":
                    await transcriber.feed_audio_chunk(message.get("audio", ""))
                    for delta in await transcriber.poll_deltas():
                        if delta.is_final:
                            session.transcript.append(TranscriptSegment(text=delta.text, is_final=True))
                            store.save_session(session)
                        await websocket.send_json(
                            {"type": "transcript_delta", "text": delta.text, "is_final": delta.is_final}
                        )

                    # 上流の音声認識接続が裏で切れていた場合、黙って文字起こしが止まるのを
                    # 防ぐため、ブラウザ側に再接続が必要であることを明示的に伝える。
                    if transcriber.has_fatal_error():
                        await websocket.send_json(
                            {
                                "type": "error",
                                "fatal": True,
                                "message": "音声認識との接続が切れました。「マイク開始」を押し直してください。",
                            }
                        )
                        break

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
                            {
                                "type": "transcript_delta",
                                "text": delta.text,
                                "is_final": delta.is_final,
                                "speaker": speaker,
                            }
                        )
                else:
                    await websocket.send_json(
                        {"type": "error", "fatal": False, "message": f"不明なメッセージタイプ: {msg_type}"}
                    )
            except WebSocketDisconnect:
                raise
            except Exception:  # noqa: BLE001
                # 1メッセージの処理に失敗しても接続自体は切らず、エラーを通知して継続する
                # (例: 音声チャンク1件の中継失敗で録音全体を止めない)。
                logger.exception("audio_ws メッセージ処理中にエラー: session=%s", session_id)
                try:
                    import sentry_sdk

                    sentry_sdk.capture_exception()
                except ImportError:
                    pass
                await websocket.send_json(
                    {"type": "error", "fatal": False, "message": "音声処理中に一時的なエラーが発生しました。"}
                )

    except WebSocketDisconnect:
        logger.info("audio_ws disconnected: session=%s", session_id)
    finally:
        await transcriber.close()
