from fastapi import APIRouter

from app.data import store
from app.models import PhysicianProfile, PhysicianProfileUpdate

router = APIRouter(prefix="/api/physician-profile", tags=["physician"])


@router.get("", response_model=PhysicianProfile)
def get_profile() -> PhysicianProfile:
    """医師の文体・重視ポイントのプロファイル（ライブドラフト生成の文体模倣に使用）。"""
    return store.get_physician_profile()


@router.put("", response_model=PhysicianProfile)
def update_profile(body: PhysicianProfileUpdate) -> PhysicianProfile:
    return store.set_physician_profile(body.style_notes)
