@echo off
chcp 65001 >nul
setlocal
set PYTHONUTF8=1
cd /d "%~dp0"

echo ==================================================
echo  医療AI ローカル完結アプリ を起動します
echo ==================================================

where python >nul 2>nul
if errorlevel 1 (
  echo エラー: python が見つかりません。
  echo https://www.python.org/downloads/ からインストールしてください。
  echo インストール画面で「Add python.exe to PATH」に必ずチェックを入れてください。
  pause
  exit /b 1
)

if not exist ".venv" (
  echo [1/4] Python仮想環境を作成しています...
  python -m venv .venv
)

call .venv\Scripts\activate.bat

echo [2/4] 依存パッケージをインストールしています（初回のみネット接続が必要です）...
pip install -q -r requirements.txt
if errorlevel 1 (
  echo パッケージのインストールに失敗しました。上のエラー内容を確認してください。
  pause
  exit /b 1
)

echo [3/4] スマホ接続用のネットワーク設定（証明書・QRコード）を準備しています...
python network_setup.py

echo [4/4] サーバーを起動しています...
echo.
echo  ・音声文字起こし用のWhisperモデルは、初めてマイクで発話した時に自動でダウンロードされます。
echo  ・カルテの自動生成には、別途 Ollama の起動が必要です（README.md参照）。
echo    未起動の場合は [MOCK] 付きのダミー内容が表示されます。
echo  ・「Windows セキュリティの重要な警告」が出た場合は「プライベートネットワーク」に
echo    チェックを入れて「アクセスを許可する」を選んでください。
echo.
echo  終了するには、この黒い画面を閉じるか Ctrl+C を押してください。
echo ==================================================

uvicorn main:app --host 0.0.0.0 --port 8443 --ssl-keyfile=certs\key.pem --ssl-certfile=certs\cert.pem

pause
