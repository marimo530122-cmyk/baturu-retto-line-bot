#!/data/data/com.termux/files/usr/bin/bash
# Termux初回セットアップ: 画像生成パイプラインの実行環境を整える。
# 実行: bash setup.sh
set -e

echo "[1/4] パッケージ更新..."
pkg update -y

echo "[2/4] Python と Termux:API をインストール..."
pkg install -y python termux-api

echo "[3/4] スマホ共有ストレージ(~/storage)を連携..."
echo "      -> 権限ダイアログが出たら「許可」を選んでください"
termux-setup-storage
sleep 2

echo "[4/4] 作業ディレクトリを作成..."
mkdir -p "$HOME/note_project/images"

echo ""
echo "セットアップ完了。以下のコマンドで画像を生成できます:"
echo "  cd ~/note_project"
echo "  python generate.py \"生成したい画像の説明\""
