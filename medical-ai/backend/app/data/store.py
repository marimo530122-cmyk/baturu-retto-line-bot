"""患者・診察セッション・連携記録・医師プロファイルの保存先。

SQLite(1つのファイルに保存する、追加費用なしのデータベース)に書き込むので、
アプリを再起動してもデータが消えない。

設計メモ:
- 読み込みは起動時に1回だけファイルから行い、以降はメモリ上の同じオブジェクトを返す。
  書き込み(save_*/create_*/add_*)はその場でファイルにも反映する(write-through)。
  録音中のWebSocketとライブドラフト更新が同じセッションを同時に触っても、以前のインメモリ版と
  同じく1つのオブジェクトを共有するので、古いコピーで上書きし合うことがない。
- そのため「1プロセスで動かす」前提。複数台・複数プロセスで動かす段階(本番)では、
  PostgreSQL等のサーバー型DBに置き換えること。外から見える関数(list_patients 等)は
  変えずに中身だけ差し替えられるよう、ここに保存処理を閉じ込めてある。
- 各データはPydanticモデルをJSONにして1行ずつ保存する(項目追加でスキーマ変更が要らない)。
"""
from __future__ import annotations

import os
import sqlite3
import threading
from datetime import datetime
from pathlib import Path

from fastapi import HTTPException

from app.config import get_settings
from app.models import (
    AuthSession,
    ConsultationSession,
    HandoffRecord,
    Patient,
    PatientStatus,
    PhysicianProfile,
    Role,
    SessionStatus,
    User,
)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS handoffs (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS physician_profile (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    login_id TEXT NOT NULL UNIQUE,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    data TEXT NOT NULL
);
"""


def _demo_patients() -> list[Patient]:
    """データベースが空のときだけ入れる、架空のデモ患者。"""
    return [
        Patient(
            id="p001",
            name="山田 太郎",
            name_kana="ヤマダ タロウ",
            birth_date="1968-04-12",
            sex="男性",
            department="内科",
            scheduled_time="09:00",
            chief_complaint="咳・微熱が3日間続いている",
        ),
        Patient(
            id="p002",
            name="佐藤 花子",
            name_kana="サトウ ハナコ",
            birth_date="1985-11-02",
            sex="女性",
            department="内科",
            scheduled_time="09:20",
            chief_complaint="不眠が続いており、いつもの薬を1ヶ月分希望",
        ),
        Patient(
            id="p003",
            name="鈴木 一郎",
            name_kana="スズキ イチロウ",
            birth_date="1952-01-30",
            sex="男性",
            department="循環器内科",
            scheduled_time="09:40",
            chief_complaint="動悸・息切れ、専門医紹介の可能性",
        ),
    ]


# 試し用の架空アカウント(SEED_DEMO_USERS=true のときだけ作る。本番では絶対に有効にしない)
DEMO_USERS = [
    ("demo-doctor", "デモ医師", Role.DOCTOR, "demodoctor2026"),
    ("demo-nurse", "デモ看護師", Role.NURSE, "demonurse2026"),
    ("demo-admin", "デモ管理者", Role.ADMIN, "demoadmin2026"),
]


class SqliteStore:
    def __init__(self, database_path: str, seed_demo_users: bool = False) -> None:
        self._lock = threading.RLock()
        is_memory = database_path == ":memory:"
        if not is_memory:
            path = Path(database_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            is_new = not path.exists()
        self._conn = sqlite3.connect(database_path, check_same_thread=False)
        if not is_memory:
            if is_new:
                # 患者情報が入るファイルなので、持ち主(アプリを動かすユーザー)以外は読めないようにする
                os.chmod(database_path, 0o600)
            # 書き込み途中で落ちてもファイルが壊れにくいモード
            self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

        self._patients: dict[str, Patient] = {}
        self._sessions: dict[str, ConsultationSession] = {}
        self._handoffs: list[HandoffRecord] = []
        self._physician_profile = PhysicianProfile()
        self._users: dict[str, User] = {}
        self._auth_sessions: dict[str, AuthSession] = {}
        self._load()
        if not self._patients:
            for patient in _demo_patients():
                self._save_patient(patient)
        if seed_demo_users and not self._users:
            from app.services.auth import hash_password

            for login_id, display_name, role, password in DEMO_USERS:
                self.save_user(
                    User(
                        login_id=login_id,
                        display_name=display_name,
                        role=role,
                        password_hash=hash_password(password),
                        must_change_password=False,
                    )
                )

    def _load(self) -> None:
        for (data,) in self._conn.execute("SELECT data FROM patients ORDER BY rowid"):
            patient = Patient.model_validate_json(data)
            self._patients[patient.id] = patient
        for (data,) in self._conn.execute("SELECT data FROM sessions ORDER BY rowid"):
            session = ConsultationSession.model_validate_json(data)
            self._sessions[session.id] = session
        for (data,) in self._conn.execute("SELECT data FROM handoffs ORDER BY seq"):
            self._handoffs.append(HandoffRecord.model_validate_json(data))
        row = self._conn.execute("SELECT data FROM physician_profile WHERE id = 1").fetchone()
        if row:
            self._physician_profile = PhysicianProfile.model_validate_json(row[0])
        for (data,) in self._conn.execute("SELECT data FROM users ORDER BY rowid"):
            user = User.model_validate_json(data)
            self._users[user.id] = user
        for (data,) in self._conn.execute("SELECT data FROM auth_sessions"):
            auth_session = AuthSession.model_validate_json(data)
            self._auth_sessions[auth_session.token_hash] = auth_session

    def _write(self, sql: str, params: tuple) -> None:
        with self._lock:
            self._conn.execute(sql, params)
            self._conn.commit()

    def _save_patient(self, patient: Patient) -> None:
        self._patients[patient.id] = patient
        self._write(
            "INSERT INTO patients (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (patient.id, patient.model_dump_json()),
        )

    def close(self) -> None:
        with self._lock:
            self._conn.close()

    # --- 患者 ---

    def list_patients(self) -> list[Patient]:
        return list(self._patients.values())

    def get_patient(self, patient_id: str) -> Patient:
        patient = self._patients.get(patient_id)
        if not patient:
            raise HTTPException(status_code=404, detail="患者が見つかりません")
        return patient

    # --- 診察セッション ---

    def create_session(self, patient_id: str) -> ConsultationSession:
        patient = self.get_patient(patient_id)
        session = ConsultationSession(patient_id=patient_id)
        self.save_session(session)
        patient.status = PatientStatus.IN_SESSION
        self._save_patient(patient)
        return session

    def get_session(self, session_id: str) -> ConsultationSession:
        session = self._sessions.get(session_id)
        if not session:
            raise HTTPException(status_code=404, detail="診察セッションが見つかりません")
        return session

    def save_session(self, session: ConsultationSession) -> None:
        self._sessions[session.id] = session
        self._write(
            "INSERT INTO sessions (id, data, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
            (session.id, session.model_dump_json(), datetime.utcnow().isoformat()),
        )

    def list_sessions_for_patient(self, patient_id: str) -> list[ConsultationSession]:
        """その患者の診察記録を新しい順に返す(看護師が最新のカルテを開くため)。"""
        sessions = [s for s in self._sessions.values() if s.patient_id == patient_id]
        sessions.sort(key=lambda s: s.started_at, reverse=True)
        return sessions

    def list_recent_finalized_sessions(self, limit: int = 2) -> list[ConsultationSession]:
        """医師の文体を模倣するための少数例として、直近に確定したカルテを新しい順に返す。"""
        finalized = [
            s
            for s in self._sessions.values()
            if s.status in (SessionStatus.REVIEW, SessionStatus.SENT) and s.soap.generated_at
        ]
        finalized.sort(key=lambda s: s.soap.generated_at, reverse=True)
        return finalized[:limit]

    # --- 看護師/調剤への連携 ---

    def add_handoff(self, record: HandoffRecord) -> None:
        self._handoffs.append(record)
        self._write("INSERT INTO handoffs (id, data) VALUES (?, ?)", (record.id, record.model_dump_json()))

    def list_handoff_outbox(self) -> list[HandoffRecord]:
        return list(reversed(self._handoffs))

    # --- 医師プロファイル ---

    def get_physician_profile(self) -> PhysicianProfile:
        return self._physician_profile

    def set_physician_profile(self, style_notes: str) -> PhysicianProfile:
        self._physician_profile = PhysicianProfile(style_notes=style_notes, updated_at=datetime.utcnow())
        self._write(
            "INSERT INTO physician_profile (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
            (self._physician_profile.model_dump_json(),),
        )
        return self._physician_profile


    # --- 職員アカウント ---

    def list_users(self) -> list[User]:
        return list(self._users.values())

    def get_user(self, user_id: str) -> User | None:
        return self._users.get(user_id)

    def find_user_by_login_id(self, login_id: str) -> User | None:
        return next((u for u in self._users.values() if u.login_id == login_id), None)

    def save_user(self, user: User) -> None:
        self._users[user.id] = user
        self._write(
            "INSERT INTO users (id, login_id, data) VALUES (?, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET login_id = excluded.login_id, data = excluded.data",
            (user.id, user.login_id, user.model_dump_json()),
        )

    # --- ログイン状態 ---

    def get_auth_session(self, token_hash: str) -> AuthSession | None:
        return self._auth_sessions.get(token_hash)

    def save_auth_session(self, auth_session: AuthSession) -> None:
        self._auth_sessions[auth_session.token_hash] = auth_session
        self._write(
            "INSERT INTO auth_sessions (token_hash, user_id, data) VALUES (?, ?, ?) "
            "ON CONFLICT(token_hash) DO UPDATE SET data = excluded.data",
            (auth_session.token_hash, auth_session.user_id, auth_session.model_dump_json()),
        )

    def delete_auth_session(self, token_hash: str) -> None:
        self._auth_sessions.pop(token_hash, None)
        self._write("DELETE FROM auth_sessions WHERE token_hash = ?", (token_hash,))

    def delete_auth_sessions_for_user(self, user_id: str) -> None:
        """パスワード変更・アカウント停止のときに、その人のログインを全部切る。"""
        for key in [k for k, v in self._auth_sessions.items() if v.user_id == user_id]:
            self._auth_sessions.pop(key, None)
        self._write("DELETE FROM auth_sessions WHERE user_id = ?", (user_id,))

_settings = get_settings()
_store = SqliteStore(_settings.database_path, seed_demo_users=_settings.seed_demo_users)

# 既存のルーターは `store.get_session(...)` のように関数として呼んでいるので、その形のまま公開する
list_patients = _store.list_patients
get_patient = _store.get_patient
create_session = _store.create_session
get_session = _store.get_session
save_session = _store.save_session
list_recent_finalized_sessions = _store.list_recent_finalized_sessions
add_handoff = _store.add_handoff
list_handoff_outbox = _store.list_handoff_outbox
get_physician_profile = _store.get_physician_profile
set_physician_profile = _store.set_physician_profile
list_sessions_for_patient = _store.list_sessions_for_patient
list_users = _store.list_users
get_user = _store.get_user
find_user_by_login_id = _store.find_user_by_login_id
save_user = _store.save_user
get_auth_session = _store.get_auth_session
save_auth_session = _store.save_auth_session
delete_auth_session = _store.delete_auth_session
delete_auth_sessions_for_user = _store.delete_auth_sessions_for_user
