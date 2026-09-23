#!/usr/bin/env bash
# 受託案件ワークフローの依存を一括インストール(新しい環境・クラウドセッション開始時に1回)
set -e
cd "$(dirname "$0")"
pip install -q -r requirements.txt
if command -v apt-get >/dev/null 2>&1; then
  SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
  $SUDO apt-get install -y -q libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk >/dev/null 2>&1 \
    || { $SUDO apt-get update -q >/dev/null && $SUDO apt-get install -y -q libreoffice-writer libreoffice-calc libreoffice-impress fonts-noto-cjk >/dev/null; }
fi
python3 fl.py doctor
