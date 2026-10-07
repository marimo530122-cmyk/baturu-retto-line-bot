"""ログイン・役割ごとの権限・自動ログアウト・アカウント管理。"""
import uuid
from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.data import store
from app.deps import PASSWORD_CHANGE_REQUIRED
from app.main import app
from app.services.auth import token_hash
from auth_helpers import login_headers

client = TestClient(app)


def _login(login_id: str, password: str):
    return client.post("/api/auth/login", json={"login_id": login_id, "password": password})


def _create_staff(role: str = "nurse", password: str = "temppass2026") -> tuple[str, str, str]:
    """管理者として職員を作り、(user_id, login_id, 仮パスワード) を返す。"""
    login_id = f"staff-{uuid.uuid4().hex[:8]}"
    res = client.post(
        "/api/admin/users",
        headers=login_headers("admin"),
        json={"login_id": login_id, "display_name": "テスト職員", "role": role, "temporary_password": password},
    )
    assert res.status_code == 200, res.text
    return res.json()["id"], login_id, password


def _activate(login_id: str, temp_password: str, new_password: str = "newpass2026x") -> dict:
    """仮パスワードでログインし、本人がパスワードを変えた状態のヘッダーを返す。"""
    token = _login(login_id, temp_password).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    res = client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": temp_password, "new_password": new_password},
    )
    assert res.status_code == 200, res.text
    return headers


def _new_session_id() -> str:
    res = client.post("/api/patients/p001/sessions", headers=login_headers("doctor"))
    assert res.status_code == 200
    return res.json()["id"]


# --- ログイン ---


def test_api_requires_login():
    assert client.get("/api/patients").status_code == 401
    assert client.get("/api/patients", headers={"Authorization": "Bearer wrong"}).status_code == 401


def test_wrong_password_and_unknown_id_give_the_same_message():
    wrong = _login("demo-doctor", "wrongpass2026")
    unknown = _login("no-such-user", "wrongpass2026")
    assert wrong.status_code == unknown.status_code == 401
    assert wrong.json()["detail"] == unknown.json()["detail"]


def test_account_locks_after_five_wrong_passwords():
    _, login_id, password = _create_staff()
    for _ in range(5):
        assert _login(login_id, "wrongpass2026").status_code == 401
    # 正しいパスワードでも、ロック中は入れない
    assert _login(login_id, password).status_code == 429


def test_password_is_not_stored_in_plain_text():
    _, login_id, password = _create_staff()
    user = store.find_user_by_login_id(login_id)
    assert password not in user.model_dump_json()
    assert user.password_hash.startswith("scrypt$")


def test_logout_invalidates_token():
    headers = login_headers("doctor")
    assert client.get("/api/patients", headers=headers).status_code == 200
    client.post("/api/auth/logout", headers=headers)
    assert client.get("/api/patients", headers=headers).status_code == 401


# --- 自動ログアウト ---


def _age_session(headers: dict, minutes: int) -> None:
    token = headers["Authorization"].split(" ", 1)[1]
    session = store.get_auth_session(token_hash(token))
    session.last_activity_at = datetime.utcnow() - timedelta(minutes=minutes)


def test_idle_for_30_minutes_logs_out():
    headers = login_headers("doctor")
    _age_session(headers, 31)
    res = client.get("/api/patients", headers=headers)
    assert res.status_code == 401
    assert "一定時間操作がなかった" in res.json()["detail"]


def test_activity_extends_the_login():
    headers = login_headers("doctor")
    _age_session(headers, 29)
    assert client.get("/api/patients", headers=headers).status_code == 200
    # 操作した時点から数え直しになっている(=あと30分使える)
    token = headers["Authorization"].split(" ", 1)[1]
    last = store.get_auth_session(token_hash(token)).last_activity_at
    assert datetime.utcnow() - last < timedelta(seconds=5)


# --- 役割ごとの権限 ---


def test_nurse_can_read_but_not_edit():
    session_id = _new_session_id()
    nurse = login_headers("nurse")
    assert client.get(f"/api/sessions/{session_id}", headers=nurse).status_code == 200
    assert client.get("/api/patients/p001/sessions", headers=nurse).status_code == 200
    assert client.get("/api/handoff/outbox", headers=nurse).status_code == 200
    assert (
        client.post(
            f"/api/sessions/{session_id}/transcript/manual", headers=nurse, json={"speaker": "patient", "text": "咳"}
        ).status_code
        == 200
    )
    assert client.patch(f"/api/sessions/{session_id}/soap", headers=nurse, json={"subjective": "x"}).status_code == 403
    assert client.patch(f"/api/sessions/{session_id}/prescription", headers=nurse, json={}).status_code == 403
    assert client.post(f"/api/sessions/{session_id}/finalize", headers=nurse).status_code == 403
    assert client.post("/api/patients/p001/sessions", headers=nurse).status_code == 403
    assert client.post(f"/api/sessions/{session_id}/handoff", headers=nurse, json={"targets": ["nurse"]}).status_code == 403


def test_admin_cannot_see_medical_records():
    session_id = _new_session_id()
    admin = login_headers("admin")
    assert client.get("/api/patients", headers=admin).status_code == 403
    assert client.get(f"/api/sessions/{session_id}", headers=admin).status_code == 403
    assert client.get(f"/api/sessions/{session_id}/soap", headers=admin).status_code == 403


def test_only_admin_can_manage_staff():
    for role in ("doctor", "nurse"):
        assert client.get("/api/admin/users", headers=login_headers(role)).status_code == 403
    assert client.get("/api/admin/users", headers=login_headers("admin")).status_code == 200


# --- 職員の作成・パスワード変更・停止 ---


def test_new_staff_must_change_password_first():
    _, login_id, password = _create_staff(role="doctor")
    token = _login(login_id, password).json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    res = client.get("/api/patients", headers=headers)
    assert res.status_code == 403
    assert res.json()["detail"] == PASSWORD_CHANGE_REQUIRED
    assert client.get("/api/auth/me", headers=headers).json()["must_change_password"] is True

    res = client.post(
        "/api/auth/change-password",
        headers=headers,
        json={"current_password": password, "new_password": "mynewpass2026"},
    )
    assert res.status_code == 200
    assert client.get("/api/patients", headers=headers).status_code == 200
    assert _login(login_id, "mynewpass2026").status_code == 200


@pytest.mark.parametrize("weak", ["short1", "onlyletterspassword", "1234567890123"])
def test_weak_passwords_are_rejected(weak):
    res = client.post(
        "/api/admin/users",
        headers=login_headers("admin"),
        json={"login_id": f"weak-{uuid.uuid4().hex[:6]}", "display_name": "x", "role": "nurse", "temporary_password": weak},
    )
    assert res.status_code == 400


def test_duplicate_login_id_is_rejected():
    _, login_id, _ = _create_staff()
    res = client.post(
        "/api/admin/users",
        headers=login_headers("admin"),
        json={"login_id": login_id, "display_name": "x", "role": "nurse", "temporary_password": "temppass2026"},
    )
    assert res.status_code == 409


def test_deactivated_staff_is_logged_out_immediately():
    user_id, login_id, password = _create_staff()
    headers = _activate(login_id, password)
    assert client.get("/api/patients", headers=headers).status_code == 200

    res = client.patch(f"/api/admin/users/{user_id}", headers=login_headers("admin"), json={"is_active": False})
    assert res.status_code == 200
    assert client.get("/api/patients", headers=headers).status_code == 401
    assert _login(login_id, "newpass2026x").status_code == 401


def test_password_reset_requires_change_again():
    user_id, login_id, password = _create_staff()
    headers = _activate(login_id, password)
    res = client.post(
        f"/api/admin/users/{user_id}/reset-password",
        headers=login_headers("admin"),
        json={"temporary_password": "resetpass2026"},
    )
    assert res.status_code == 200
    assert client.get("/api/patients", headers=headers).status_code == 401  # 古いログインは切れる
    token = _login(login_id, "resetpass2026").json()["token"]
    assert client.get("/api/patients", headers={"Authorization": f"Bearer {token}"}).status_code == 403


def test_admin_cannot_deactivate_self():
    admin = login_headers("admin")
    me = client.get("/api/auth/me", headers=admin).json()
    res = client.patch(f"/api/admin/users/{me['id']}", headers=admin, json={"is_active": False})
    assert res.status_code == 400


# --- 録音(WebSocket) ---


def test_audio_websocket_requires_login():
    session_id = _new_session_id()
    with client.websocket_connect(f"/api/sessions/{session_id}/audio") as ws:
        ws.send_json({"type": "manual_text", "speaker": "patient", "text": "ログインなし"})
        msg = ws.receive_json()
        assert msg["type"] == "error" and msg["auth"] is True


def test_audio_websocket_accepts_login_token():
    session_id = _new_session_id()
    token = login_headers("doctor")["Authorization"].split(" ", 1)[1]
    with client.websocket_connect(f"/api/sessions/{session_id}/audio") as ws:
        ws.send_json({"type": "auth", "token": token})
        assert ws.receive_json()["type"] == "auth_ok"
        ws.send_json({"type": "manual_text", "speaker": "patient", "text": "咳が出ます"})
        assert ws.receive_json()["type"] == "transcript_delta"


def test_audio_websocket_rejects_admin():
    session_id = _new_session_id()
    token = login_headers("admin")["Authorization"].split(" ", 1)[1]
    with client.websocket_connect(f"/api/sessions/{session_id}/audio") as ws:
        ws.send_json({"type": "auth", "token": token})
        msg = ws.receive_json()
        assert msg["type"] == "error" and msg["auth"] is True


# --- 最初の管理者を作るコマンド ---


def test_cli_create_admin_can_log_in():
    from app.cli import create_admin

    login_id = f"first-admin-{uuid.uuid4().hex[:6]}"
    create_admin(login_id, "事務長", "adminpass2026")
    res = _login(login_id, "adminpass2026")
    assert res.status_code == 200
    assert res.json()["user"]["role"] == "admin"
    with pytest.raises(ValueError):
        create_admin(f"{login_id}-2", "弱い", "short")
