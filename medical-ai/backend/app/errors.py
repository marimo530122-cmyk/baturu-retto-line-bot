"""外部LLM呼び出しの再試行と、ユーザー向けエラーメッセージの統一。

音声認識中・SOAP/処方生成中にOpenAI側のタイムアウトやレートリミットが発生しても
アプリ全体を落とさず、呼び出し元（ルーター）が「再試行してください」という
分かりやすいメッセージをフロントエンドに返せるようにする。
"""
from __future__ import annotations

import asyncio
import logging
from typing import Awaitable, Callable, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

# 短時間に何度もリトライしてAPI利用料が無駄に増えないよう、試行回数・待ち時間を抑えめにする
MAX_ATTEMPTS = 3
BASE_BACKOFF_SECONDS = 1.5


class LlmGenerationError(Exception):
    """OpenAI呼び出しがリトライしても成功しなかった場合に送出する。

    メッセージはそのままユーザーに見せても問題ない日本語にしてある。
    """


def _is_transient_openai_error(exc: Exception) -> bool:
    """リトライして回復が見込めるエラーかどうか判定する(タイムアウト・レートリミット・
    一時的な接続断・5xx)。認証エラーや不正なリクエスト(4xx)はリトライしても無駄なので
    対象外とする。"""
    try:
        import openai
    except ImportError:  # pragma: no cover
        return False

    if isinstance(exc, (openai.APITimeoutError, openai.RateLimitError, openai.APIConnectionError)):
        return True
    if isinstance(exc, openai.InternalServerError):
        return True
    return False


async def call_with_retry(
    func: Callable[[], Awaitable[T]],
    *,
    stage: str,
) -> T:
    """OpenAI呼び出しを行う非同期関数を、一時的なエラーに限りリトライして実行する。

    stage: ログ・エラーメッセージに出す処理名(例: "SOAP生成")。
    """
    last_exc: Exception | None = None
    for attempt in range(1, MAX_ATTEMPTS + 1):
        try:
            return await func()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            transient = _is_transient_openai_error(exc)
            logger.warning(
                "%s でエラー発生 (試行 %d/%d, リトライ可能=%s): %s",
                stage,
                attempt,
                MAX_ATTEMPTS,
                transient,
                exc,
            )
            if not transient or attempt == MAX_ATTEMPTS:
                break
            await asyncio.sleep(BASE_BACKOFF_SECONDS * attempt)

    logger.exception("%s が最終的に失敗しました", stage, exc_info=last_exc)
    try:
        import sentry_sdk

        sentry_sdk.capture_exception(last_exc)
    except ImportError:  # pragma: no cover
        pass

    raise LlmGenerationError(
        f"{stage}に失敗しました。AIサービスが混雑しているか接続が不安定な可能性があります。"
        "しばらくしてからもう一度お試しください。"
    ) from last_exc
