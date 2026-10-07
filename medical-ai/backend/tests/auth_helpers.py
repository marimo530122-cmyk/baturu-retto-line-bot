"""テスト用: デモアカウントでログインして、APIに付けるヘッダーを返す。"""
from fastapi.testclient import TestClient

from app.main import app

DEMO_PASSWORDS = {
    "doctor": ("demo-doctor", "demodoctor2026"),
    "nurse": ("demo-nurse", "demonurse2026"),
    "admin": ("demo-admin", "demoadmin2026"),
}


def login_headers(role: str) -> dict[str, str]:
    login_id, password = DEMO_PASSWORDS[role]
    res = TestClient(app).post("/api/auth/login", json={"login_id": login_id, "password": password})
    assert res.status_code == 200, res.text
    return {"Authorization": f"Bearer {res.json()['token']}"}
