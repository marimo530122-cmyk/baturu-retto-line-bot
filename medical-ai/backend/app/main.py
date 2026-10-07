import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.routers import documents, handoff, patients, physician, sessions

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

settings = get_settings()

# SENTRY_DSN が設定されている場合のみ有効化する(OPENAI_API_KEY同様、未設定でもアプリ自体は動く)。
if settings.sentry_dsn:
    import sentry_sdk

    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        environment=settings.sentry_environment,
        # このアプリは個人情報を扱うため、送信ペイロード等の詳細は既定でオフのままにする
        send_default_pii=False,
    )
    logger.info("Sentry 初期化完了 (environment=%s)", settings.sentry_environment)
else:
    logger.info("SENTRY_DSN 未設定のため、エラー監視は無効です(ログ出力のみ)")

app = FastAPI(title="医療AI 診察支援API", version="0.1.0")


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    """HTTPExceptionとして明示的に送出されたもの以外の、予期しないエラーを一元的に処理する。
    原因特定のためサーバーログに記録しつつ、ユーザーには生のトレースバックを見せない。"""
    logger.exception("未処理の例外が発生しました: %s %s", request.method, request.url.path)
    if settings.sentry_dsn:
        import sentry_sdk

        sentry_sdk.capture_exception(exc)
    return JSONResponse(
        status_code=500,
        content={"error": "サーバー内部でエラーが発生しました。しばらくしてから再度お試しください。"},
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list,
    # 本アプリは認証Cookieを使わないため allow_credentials=False とし、
    # ALLOWED_ORIGINS="*"（デフォルト）でのデプロイを可能にしている。
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(patients.router)
app.include_router(sessions.router)
app.include_router(documents.router)
app.include_router(handoff.router)
app.include_router(physician.router)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "mock_mode": settings.mock_mode}


@app.get("/api/features")
def features() -> dict:
    """画面側が、設定で「切」になっている機能のボタン等を出さないようにするための一覧。"""
    return {"drug_suggestions": get_settings().enable_drug_suggestions}
