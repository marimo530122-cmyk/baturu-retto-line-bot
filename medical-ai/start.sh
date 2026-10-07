#!/usr/bin/env bash
# 医療AI 診察支援アプリ ワンコマンド起動スクリプト
#
# 登録・APIキーの設定は一切不要です。このスクリプトを実行するだけで
# バックエンド(FastAPI)とフロントエンド(Next.js)が両方起動し、
# ブラウザで http://localhost:3000 を開けばすぐに試せます
# （生成される議事録/カルテ/紹介状/処方は [MOCK] 付きのダミー内容になります）。
#
# 使い方:
#   cd medical-ai
#   ./start.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/backend"
FRONTEND_DIR="$SCRIPT_DIR/frontend"

echo "=================================================="
echo " 医療AI 診察支援アプリ を起動します（登録・APIキー不要）"
echo "=================================================="

command -v python3 >/dev/null 2>&1 || { echo "エラー: python3 が見つかりません。先にPythonをインストールしてください。"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "エラー: node が見つかりません。先にNode.jsをインストールしてください。"; exit 1; }

# --- バックエンド ---
echo "[1/4] バックエンドの準備をしています..."
cd "$BACKEND_DIR"
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
fi
source .venv/bin/activate
pip install -q -r requirements.txt

echo "[2/4] バックエンドを起動しています (http://localhost:8000)..."
uvicorn app.main:app --port 8000 > /tmp/medical-ai-backend.log 2>&1 &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "終了します..."
  kill "$BACKEND_PID" 2>/dev/null || true
  kill "$FRONTEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# --- フロントエンド ---
echo "[3/4] フロントエンドの準備をしています..."
cd "$FRONTEND_DIR"
if [ ! -d "node_modules" ]; then
  npm install --no-audit --no-fund
fi
if [ ! -f ".env.local" ]; then
  echo "NEXT_PUBLIC_API_BASE=http://localhost:8000" > .env.local
fi

echo "[4/4] フロントエンドを起動しています (http://localhost:3000)..."
npx next dev -p 3000 > /tmp/medical-ai-frontend.log 2>&1 &
FRONTEND_PID=$!

sleep 3
echo ""
echo "=================================================="
echo " 準備ができました！ブラウザで下記を開いてください"
echo ""
echo "   http://localhost:3000"
echo ""
echo " （APIキー未設定のため、生成物には [MOCK] と表示されます。"
echo "   本物のAI生成を試したい場合のみ、backend/.env に"
echo "   OPENAI_API_KEY を設定してください。任意です。）"
echo ""
echo " 終了するには Ctrl+C を押してください。"
echo "=================================================="

wait
