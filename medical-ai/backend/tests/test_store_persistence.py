"""SQLite保存: アプリを再起動(=ストアを開き直し)してもデータが残ること。"""
import os
import stat

from app.data.store import SqliteStore
from app.models import HandoffRecord, HandoffTarget, PatientStatus, SessionStatus


def test_data_survives_restart(tmp_path):
    db = str(tmp_path / "medical_ai.sqlite3")

    store = SqliteStore(db)
    patient_id = store.list_patients()[0].id
    session = store.create_session(patient_id)
    session.soap.subjective = "咳が続く"
    session.status = SessionStatus.REVIEW
    store.save_session(session)
    store.add_handoff(HandoffRecord(session_id=session.id, patient_name="山田 太郎", targets=[HandoffTarget.NURSE]))
    store.set_physician_profile("結論を先に書く")
    store.close()

    reopened = SqliteStore(db)
    restored = reopened.get_session(session.id)
    assert restored.soap.subjective == "咳が続く"
    assert restored.status == SessionStatus.REVIEW
    assert reopened.get_patient(patient_id).status == PatientStatus.IN_SESSION
    assert [h.session_id for h in reopened.list_handoff_outbox()] == [session.id]
    assert reopened.get_physician_profile().style_notes == "結論を先に書く"
    reopened.close()


def test_demo_patients_are_seeded_only_once(tmp_path):
    db = str(tmp_path / "medical_ai.sqlite3")
    SqliteStore(db).close()
    reopened = SqliteStore(db)
    assert len(reopened.list_patients()) == 3  # 再起動のたびに増えない
    reopened.close()


def test_database_file_is_private_to_owner(tmp_path):
    db = str(tmp_path / "medical_ai.sqlite3")
    SqliteStore(db).close()
    mode = stat.S_IMODE(os.stat(db).st_mode)
    assert mode & (stat.S_IRWXG | stat.S_IRWXO) == 0  # 他のユーザーからは読めない


def test_get_session_returns_shared_object(tmp_path):
    """録音中のWebSocketと他のAPIが同じセッションを触っても、古いコピーで上書きし合わないこと。"""
    store = SqliteStore(str(tmp_path / "medical_ai.sqlite3"))
    session = store.create_session(store.list_patients()[0].id)
    assert store.get_session(session.id) is store.get_session(session.id)
    store.close()
