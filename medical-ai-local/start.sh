#!/usr/bin/env bash
# 医療AI ローカル完結アプリ 起動スクリプト
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
  echo "[1/3] Python仮想環境を作成しています..."
  python3 -m venv .venv
fi
source .venv/bin/activate

echo "[2/3] 依存パッケージをインストールしています（初回のみネット接続が必要です）..."
pip install -q -r requirements.txt

echo "[3/3] サーバーを起動しています..."
echo ""
echo " ブラウザで下記を開いてください:"
echo ""
echo "   http://127.0.0.1:8000"
echo ""
echo " ・音声文字起こし用のWhisperモデルは、初めてマイクで発話した時に"
echo "   自動でダウンロードされます（初回のみネット接続が必要、以後は不要）。"
echo " ・カルテの自動生成には、別途 Ollama の起動が必要です"
echo "   （未起動の場合は [MOCK] 付きのダミー内容が表示されます）。"
echo "   詳しい手順は README.md を参照してください。"
echo ""
echo " 終了するには Ctrl+C を押してください。"
echo "=================================================="

# 127.0.0.1（このPCの中だけ）にバインドし、外部ネットワークに公開しない。
uvicorn main:app --host 127.0.0.1 --port 8000
