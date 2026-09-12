import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import documents, handoff, patients, sessions

logging.basicConfig(level=logging.INFO)

settings = get_settings()

app = FastAPI(title="医療AI 診察支援API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patients.router)
app.include_router(sessions.router)
app.include_router(documents.router)
app.include_router(handoff.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "mock_mode": settings.mock_mode}
