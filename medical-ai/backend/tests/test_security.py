"""不正アクセスの見張り番(app/security.py)と、入力の長さ制限のテスト。"""
from fastapi.testclient import TestClient

from app import security
from app.config import get_settings
from app.main import app

client = TestClient(app)


def test_ログイン失敗が続いたIPは締め出され_正しいパスワードでも通らない(monkeypatch):
    monkeypatch.setattr(get_settings(), "security_auth_fail_limit", 3)
    for i in range(3):
        res = client.post("/api/auth/login", json={"login_id": f"nobody-{i}", "password": "wrongpass123"})
        assert res.status_code == 401
    res = client.post("/api/auth/login", json={"login_id": "demo-doctor", "password": "demodoctor2026"})
    assert res.status_code == 429
    assert res.headers["retry-after"] == "900"
    # 死活確認は止めない
    assert client.get("/api/health").status_code == 200


def test_連打は429で止まる(monkeypatch):
    monkeypatch.setattr(get_settings(), "security_rate_per_min", 5)
    statuses = [client.get("/api/features").status_code for _ in range(7)]
    assert statuses == [200] * 5 + [429] * 2


def test_応答に守りのヘッダーが付く():
    res = client.get("/api/features")
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"
    assert res.headers["cache-control"] == "no-store"


def test_警報は同じ種類を連発しない(caplog):
    security.alert("test", "1回目", now=1000.0)
    security.alert("test", "2回目", now=1001.0)
    security.alert("test", "3回目", now=1000.0 + security.ALERT_COOLDOWN_SEC)
    messages = [r.getMessage() for r in caplog.records if "[security]" in r.getMessage()]
    assert len(messages) == 2


def test_長すぎる入力は422で断る():
    res = client.post("/api/auth/login", json={"login_id": "x" * 65, "password": "p"})
    assert res.status_code == 422
    res = client.post("/api/auth/login", json={"login_id": "demo-doctor", "password": "p" * 257})
    assert res.status_code == 422
