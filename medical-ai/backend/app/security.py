"""不正アクセスの見張り番(追加パッケージなし・メモリだけで動く)。

- 同じ相手(IP)からの連打を止める(1分あたりの上限を超えたら 429)
- ログイン失敗・権限なし(401/403)が続いた相手を、しばらく締め出す(総当たり対策。
  アカウントごとのロックは app/services/auth.py にあり、こちらは「IDを変えながらの総当たり」用)
- 401/403・サーバーエラー(5xx)・アクセス全体が急に増えたら、開発者の Discord / Slack に知らせる

知らせ先は SECURITY_ALERT_WEBHOOK_URL(Discord か Slack の Incoming Webhook のURL)。
空ならサーバーのログ([security])に出すだけで、止める働きはそのまま動く。
再起動すると数え直しになる(1台構成ならこれで足りる。複数台にするなら Redis などに移す)。
"""
from __future__ import annotations

import asyncio
import logging
import re
import time
from dataclasses import dataclass, field

import httpx
from fastapi import Request
from fastapi.responses import JSONResponse

from app.config import get_settings

logger = logging.getLogger("security")

WINDOW_SEC = 5 * 60
ALERT_COOLDOWN_SEC = 10 * 60
_EXEMPT_PATHS = {"/api/health"}


@dataclass
class _IpState:
    minute_start: float = 0.0
    minute_count: int = 0
    fail_start: float = 0.0
    fail_count: int = 0
    locked_until: float = 0.0


@dataclass
class _Guard:
    per_ip: dict[str, _IpState] = field(default_factory=dict)
    window_start: float = 0.0
    total: int = 0
    auth_fail: int = 0
    server_error: int = 0
    last_alert: dict[str, float] = field(default_factory=dict)
    tasks: set[asyncio.Task] = field(default_factory=set)


_guard = _Guard()


def reset() -> None:
    """テスト用: 数え直す。"""
    global _guard
    _guard = _Guard()


def client_ip(request: Request) -> str:
    # Render などの中継サーバーの後ろでは、本当の相手のIPは X-Forwarded-For の先頭に入る
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    host = request.client.host if request.client else "unknown"
    return (forwarded or host)[:64]


def _state(ip: str, now: float) -> _IpState:
    state = _guard.per_ip.get(ip)
    if state is None:
        state = _IpState(minute_start=now, fail_start=now)
        _guard.per_ip[ip] = state
    return state


def _sweep(now: float) -> None:
    if now - _guard.window_start >= WINDOW_SEC:
        _guard.window_start = now
        _guard.total = _guard.auth_fail = _guard.server_error = 0
    if len(_guard.per_ip) < 5000:
        return
    for ip, s in list(_guard.per_ip.items()):
        if s.locked_until < now and now - s.minute_start > WINDOW_SEC and now - s.fail_start > WINDOW_SEC:
            del _guard.per_ip[ip]


def check(ip: str, now: float | None = None) -> str | None:
    """処理の前に呼ぶ。止めるべきなら理由("locked" / "rate")を返す。"""
    settings = get_settings()
    now = time.time() if now is None else now
    _sweep(now)
    _guard.total += 1
    if _guard.total == settings.security_alert_total:
        alert("flood", f"5分間のアクセスが {settings.security_alert_total} 回に達しました(DDoS の可能性)")
    state = _state(ip, now)
    if state.locked_until > now:
        return "locked"
    if now - state.minute_start >= 60:
        state.minute_start, state.minute_count = now, 0
    state.minute_count += 1
    if state.minute_count > settings.security_rate_per_min:
        if state.minute_count == settings.security_rate_per_min + 1:
            alert(f"rate:{ip}", f"{ip} から1分間に {settings.security_rate_per_min} 回を超えるアクセス(連打・攻撃の可能性)。429 で止めています")
        return "rate"
    return None


def record(ip: str, status: int, path: str, now: float | None = None) -> None:
    """応答を返した後に呼ぶ。結果を数えて、締め出し・知らせを決める。"""
    settings = get_settings()
    now = time.time() if now is None else now
    if status in (401, 403):
        _guard.auth_fail += 1
        if _guard.auth_fail == settings.security_alert_auth_fail:
            alert("authfail", f"5分間で 401/403 が {settings.security_alert_auth_fail} 回(総当たり攻撃の可能性)。最後: {ip} {path}")
        state = _state(ip, now)
        if now - state.fail_start > WINDOW_SEC * 2:
            state.fail_start, state.fail_count = now, 0
        state.fail_count += 1
        if state.fail_count >= settings.security_auth_fail_limit and state.locked_until <= now:
            state.locked_until = now + settings.security_lock_minutes * 60
            alert(f"lock:{ip}", f"{ip} が 401/403 を {state.fail_count} 回出したので {settings.security_lock_minutes} 分締め出しました")
    elif status >= 500:
        _guard.server_error += 1
        if _guard.server_error == settings.security_alert_5xx:
            alert("5xx", f"5分間でサーバーエラー(5xx)が {settings.security_alert_5xx} 回。最後: {path}")


def alert(kind: str, message: str, now: float | None = None) -> None:
    now = time.time() if now is None else now
    if now - _guard.last_alert.get(kind, 0) < ALERT_COOLDOWN_SEC:
        return
    _guard.last_alert[kind] = now
    text = f"【医療AI 警報】{message}"
    logger.warning("[security] %s", text)
    url = get_settings().security_alert_webhook_url
    if not url:
        return
    # Discord は content、Slack は text で受け取る
    payload = {"content": text} if re.search(r"discord(app)?\.com/api/webhooks/", url) else {"text": text}
    try:
        task = asyncio.get_running_loop().create_task(_post(url, payload))
    except RuntimeError:  # イベントループの外(テスト等)では送らない
        return
    _guard.tasks.add(task)
    task.add_done_callback(_guard.tasks.discard)


async def _post(url: str, payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            await client.post(url, json=payload)
    except httpx.HTTPError as exc:
        logger.error("[security] 通知に失敗: %s", exc)


_SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "Cache-Control": "no-store",
}


async def security_middleware(request: Request, call_next):
    path = request.url.path
    if path in _EXEMPT_PATHS:
        return await call_next(request)
    ip = client_ip(request)
    blocked = check(ip)
    if blocked:
        return JSONResponse(
            status_code=429,
            content={"detail": "アクセスが多すぎます。しばらく待ってからお試しください。"},
            headers={"Retry-After": "900" if blocked == "locked" else "60", **_SECURITY_HEADERS},
        )
    try:
        response = await call_next(request)
    except Exception:
        record(ip, 500, path)
        raise
    record(ip, response.status_code, path)
    for key, value in _SECURITY_HEADERS.items():
        response.headers.setdefault(key, value)
    return response
