#!/usr/bin/env bash
# 医療AI ローカル完結アプリ 起動スクリプト（同じWi-Fi内のスマホからもアクセス可能）
#
# すべての処理（音声認識・カルテ生成）はこのPC内で完結します。
# 外部クラウドAPIへのデータ送信は一切ありません。
#
# 使い方:
#   cd medical-ai-local
#   ./start.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

command -v python3 >/dev/null 2>&1 || { echo "エラー: python3 が見つかりません。先にPythonをインストールしてください。"; exit 1; }

echo "=================================================="
echo " 医療AI ローカル完結アプリ を起動します"
echo "=================================================="

if [ ! -d ".venv" ]; then
  echo "[1/4] Python仮想環境を作成しています..."
  python3 -m venv .venv
fi
source .venv/bin/activate

echo "[2/4] 依存パッケージをインストールしています（初回のみネット接続が必要です）..."
pip install -q -r requirements.txt

echo "[3/4] スマホ接続用のネットワーク設定（自己署名証明書・QRコード）を準備しています..."
python3 network_setup.py

echo "[4/4] サーバーを起動しています..."
echo ""
echo " ・音声文字起こし用のWhisperモデルは、初めてマイクで発話した時に"
echo "   自動でダウンロードされます（初回のみネット接続が必要、以後は不要）。"
echo " ・カルテの自動生成には、別途 Ollama の起動が必要です"
echo "   （未起動の場合は [MOCK] 付きのダミー内容が表示されます）。"
echo "   詳しい手順は README.md を参照してください。"
echo ""
echo " 終了するには Ctrl+C を押してください。"
echo "=================================================="

# 0.0.0.0 にバインドし、同じWi-Fi（LAN）内の他端末からもアクセス可能にする。
# ネットワーク越しにマイクAPIを使えるようにするため、自己署名証明書でHTTPS化している。
uvicorn main:app --host 0.0.0.0 --port 8443 \
  --ssl-keyfile=certs/key.pem --ssl-certfile=certs/cert.pem
