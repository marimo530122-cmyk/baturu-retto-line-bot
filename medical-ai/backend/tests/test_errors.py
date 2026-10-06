"""call_with_retry: 一時的なAPIエラーはリトライし、それ以外は即座に失敗することを確認する。"""
import openai
import pytest

from app.errors import LlmGenerationError, call_with_retry


@pytest.fixture(autouse=True)
def no_real_sleep(monkeypatch):
    """テストを高速化するため、リトライ待機の実スリープを無効化する。"""
    import asyncio

    async def _no_sleep(_seconds: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)


async def test_succeeds_without_retry_when_no_error():
    calls = {"count": 0}

    async def func():
        calls["count"] += 1
        return "ok"

    result = await call_with_retry(func, stage="テスト処理")
    assert result == "ok"
    assert calls["count"] == 1


async def test_retries_on_transient_error_then_succeeds():
    calls = {"count": 0}

    async def func():
        calls["count"] += 1
        if calls["count"] < 2:
            raise openai.APITimeoutError(request=_fake_request())
        return "recovered"

    result = await call_with_retry(func, stage="テスト処理")
    assert result == "recovered"
    assert calls["count"] == 2


async def test_gives_up_after_max_attempts_on_persistent_transient_error():
    calls = {"count": 0}

    async def func():
        calls["count"] += 1
        raise openai.RateLimitError(message="rate limited", response=_fake_response(), body=None)

    with pytest.raises(LlmGenerationError):
        await call_with_retry(func, stage="テスト処理")
    assert calls["count"] == 3  # MAX_ATTEMPTS


async def test_non_transient_error_fails_immediately_without_retry():
    calls = {"count": 0}

    async def func():
        calls["count"] += 1
        raise ValueError("これはリトライしても直らない種類のエラー")

    with pytest.raises(LlmGenerationError):
        await call_with_retry(func, stage="テスト処理")
    assert calls["count"] == 1


def _fake_request():
    import httpx

    return httpx.Request("POST", "https://example.com")


def _fake_response():
    import httpx

    return httpx.Response(status_code=429, request=_fake_request())
