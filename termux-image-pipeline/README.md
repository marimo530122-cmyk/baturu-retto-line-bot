# Termux 自律型画像生成パイプライン

Android上のTermuxから、コマンド1発でプロンプト→16:9画像を生成・保存するミニマルツール。

## 選定理由(現場判断)

| 検討軸 | 採用: Pollinations.ai (GET API) | 不採用: ローカルモデル(Stable Diffusionなど) |
|---|---|---|
| RAM/ストレージ | ゼロ(APIコールのみ) | 数GB級、Termuxのメモリ制限で実用に耐えない |
| 認証 | 不要(APIキーなし) | ライブラリ導入だけでも重い |
| 依存 | Python標準ライブラリ(`urllib`)のみ | torch等の巨大依存 |
| 安定性 | 多くの既存OSSラッパーが裏で使う枯れたエンドポイント | 端末ごとに動作差・クラッシュリスク |
| 16:9対応 | `width`/`height`パラメータで厳密指定可 | モデルにより解像度対応がまちまち |

「OSSアプリを丸ごと移植」ではなく、それらが内部で使っている軽量なビルディングブロック(GETリクエスト1本の画像生成API)を直接叩く方式を採用。

## セットアップ(実機Termuxで1回だけ)

```bash
cd ~
git clone <このリポジトリ> repo-tmp  # もしくは termux-image-pipeline/ 以下だけ取得
cd repo-tmp/termux-image-pipeline
bash setup.sh
```

`setup.sh` が行うこと:
- `python`, `termux-api` パッケージのインストール
- `termux-setup-storage` によるスマホ共有ストレージ連携(権限ダイアログで許可すること)
- `~/note_project/images/` の作成

## 使い方

```bash
cd ~/note_project
python generate.py "スマホ画面でターミナルが光るサイバーパンクなイラスト"
```

- 内部保存: `~/note_project/images/<timestamp>-<slug>.jpg`
- スマホ共有(ギャラリーから確認可): `~/storage/shared/Download/note_images/`
  - `~/storage` が未連携の場合は自動でスキップし、その旨をメッセージ表示する
- 再現性が欲しい場合: `--seed <整数>` を追加

## 動作確認について(重要な注記)

このツールはクラウド版Claude Codeのサンドボックス環境で開発された。開発コンテナの組織egressポリシーが `image.pollinations.ai` への接続を許可していないため(403 Forbidden)、実際の画像生成APIコールはこのコンテナ内では検証できていない。

検証済み:
- 引数パース、URL組み立て、slugify、ファイル保存、`~/storage` 有無による共有フォルダ分岐ロジック(すべてユニットテスト済み・正常動作)

未検証(実機での確認が必要):
- Pollinations.ai への実際のHTTPS接続と画像取得

実機のTermux(egress制限なし)では `pip`/追加ライブラリ不要でそのまま動作するはず。初回実行時にAPI側のコールドスタートで数秒〜十数秒かかることがある。
