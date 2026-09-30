# メモ自動蓄積パイプライン

## 目的

現役魚屋（48歳）が日々スマホから吐き出す「愚痴・修羅場・AI自動化の試行錯誤」の生メモを、
Claude API で自動的に構造化し、このリポジトリの `docs/daily-logs/` に Markdown として
蓄積する。将来のショート動画・SNS投稿・ブログ記事のネタ帳として使う一次データベース。

## 全体フロー

1. スマホの Gemini / メモアプリ等に吐き出したテキストを、GitHub Actions の
   `repository_dispatch`（iOS ショートカット等からの自動POST）または
   `workflow_dispatch`（GitHub モバイルアプリからの手動実行）でこのリポジトリに送る。
2. `.github/workflows/process-memo.yml` が起動し、`scripts/process_memo.py` を実行する。
3. スクリプトは Claude API（Anthropic API, `claude-opus-5`）にメモを渡し、
   以下の3項目に自動分類・整形させる。
4. 整形結果を Markdown ファイルとして `docs/daily-logs/` にコミット・プッシュする。
5. (任意) 蓄積したログの中から動画化したいものを選び、`.github/workflows/generate-short-video.yml`
   を起動すると、`scripts/generate_short_video.py` がナレーション音声・字幕付きの縦型
   ショート動画(MP4)を生成し、GitHub Releaseに添付してダウンロードURLを発行する。
6. (任意) 実際に撮影した素材(自撮りトーク等)は `.github/workflows/auto-edit-video.yml` に
   GoogleドライブのURLを渡すと、`scripts/auto_edit_video.py` が自動編集(無音カット・フィラー除去・
   Claudeによる言い直しカット・色補正・音声ノイズ処理・単語タイミング字幕・9:16化・書き出しチェック)
   して、完成MP4と編集レポートをGitHub Releaseに添付する。

## データフォーマットのルール

各ログファイルは `docs/daily-logs/YYYY-MM-DD-HHMMSS-<slug>.md` という名前で保存する。
ファイルの中身は必ず以下の3セクション構成に従う。

```markdown
# <フック用タイトル(最有力案)>

- date: YYYY-MM-DD HH:MM
- tags: <カンマ区切りのタグ>

## ① ショート動画・フック用タイトル
<3案程度の候補タイトル(箇条書き)>

## ② 一次情報ドキュメント(事実と感情)
<何が起きたか(事実)と、そのとき何を感じたか(感情)を分けて記述した一次データ>

## ③ GitHub/ストック用Markdownデータ
<検索・再利用しやすい形に整理した要約(箇条書き、キーワード込み)>

---
### 元メモ(生データ)
<ユーザーが投げた元のテキストをそのまま保存>
```

- 元メモは絶対に加工せず、`### 元メモ(生データ)` セクションに原文のまま残す
  (後から人間やAIが読み返して事実確認できるようにするため)。
- タイトルや分類はあくまでClaudeによる一次整形であり、人間が後から
  Markdownファイルを直接編集して修正してよい。
- ファイル名の日時は取り込み時刻(UTC)を使う。

## 動画生成エンジンの選定方針

「既存のショート動画自動生成OSSアプリを丸ごと取り込む」のではなく、そうしたOSSアプリの
内部で実際に使われているのと同じ枯れたビルディングブロックを直接組み合わせる方式を採用した。

- **TTS(音声合成)**: [`edge-tts`](https://github.com/rany2/edge-tts)(MIT、APIキー不要、
  無料)。Microsoft Edgeの高品質ニューラル音声を日本語含め利用でき、単語ごとの発話タイミング
  (WordBoundary)も取得できるため、字幕の自動タイミング合わせに使える。
- **動画合成・字幕焼き込み**: `ffmpeg` + `libass`(GitHub Actionsの `ubuntu-latest` に
  標準搭載)。`.ass` 字幕ファイルを生成し、`ass` フィルタで縦型(9:16, 1080x1920)動画に
  焼き込む。日本語フォント(`fonts-noto-cjk`)のインストールが別途必要(ワークフローに含む)。
- **撮影素材の自動編集**: 「先に文字起こしし、テキスト上でカット位置を決め、映像は最後に1回だけ
  ffmpegで処理する」方式(video-use等のAI動画編集と同じ考え方)。文字起こしは
  [`faster-whisper`](https://github.com/SYSTRAN/faster-whisper)(MIT、無料、CPUで動作)。
  映像をAIに見せないので、Claudeに渡すのは文字起こしテキストだけ(`--ai` 時のみ)。
  Whisperはフィラーを勝手に省く癖があるため、`initial_prompt` にフィラーを入れて書き起こさせている。
- 出所不明な大型OSSリポジトリを丸ごと依存に加えないことで、ライセンス・保守性・CI実行環境
  との相性リスクを避けつつ、車輪の再発明もしていない(TTSエンジンもレンダラも既存OSS)。

## ディレクトリ構成

- `CLAUDE.md` — このファイル。プロジェクトの目的とルール。
- `scripts/process_memo.py` — メモを受け取り、Claude API で分類・整形し、
  Markdownとして保存する。`--commit` を付けるとその場で `git add/commit/push` まで行う。
- `scripts/generate_short_video.py` — `docs/daily-logs/` のログ(または直接指定した
  ナレーション文)から、TTS音声・字幕焼き込み済みの縦型ショート動画(MP4)を `output/` に
  生成する。`output/` は `.gitignore` 対象(リポジトリを肥大化させないため)。
- `scripts/auto_edit_video.py` — 撮影素材(パス/URL/Googleドライブ共有リンク)を自動編集して
  `output/` に縦型MP4・編集レポート(`.report.md`)・プレビュー画像・文字起こしJSONを書き出す。
  文字起こしJSONを手直しして `--transcript` で渡せば、文字起こしをやり直さずに再編集できる。
- `scripts/requirements.txt` — 依存パッケージ(`anthropic`, `edge-tts`)。
- `scripts/requirements-video-edit.txt` — 自動編集用の追加依存(`faster-whisper`, `gdown`)。
- `package.json` — X自動投稿のAI生成用(`@anthropic-ai/sdk`)。
- `docs/daily-logs/` — 生成されたメモの蓄積先。
- `freelance/` — クラウドワークス案件自動ハンター(`python3 freelance/fl.py scrape-cw`)。
  詳細は `freelance/README.md`。取得結果の `freelance/projects/` は、最新版(`cw_latest_projects.csv/.html`)以外 Git に入れない。
- `sengoku-shield/` — 鮮刻シールド(せんこくシールド、詐欺電話対策ツール。「戦国」ではなく「鮮刻」。フォルダ名やURLの sengoku はそのまま)。Twilio着信にAIが応対して時間を稼ぎ、
  正規表現+Jev(TypeSafe、任意)で詐欺パターンを検知する。声紋照合・公的機関の名乗り・SNS自動投稿は意図的に入れていない。
  検知ルールはAI提案→機械チェック→人間承認で育てる(`evolve.js`、自動反映はしない)。
  普通の電話87件で誤検知ゼロを確認するベンチマーク(`evidence/` に結果を保存)と、
  ハッシュでつないだ監査ログ(`audit/audit-log.jsonl`、追記のみ・手で編集しない)があり、
  `.github/workflows/sengoku-shield-ci.yml` で毎回検証する。
  ベンチマークの holdout 例文に合わせてルールを調整しないこと(数字が実力以上に良く見えるため)。
  スマホ連動の見守り画面(`/app`)と判定API(`/api/judge`)もある。警告とボタンを出すまでで、
  電話を切る・AIに代わるのは必ず本人の操作にする(自動切り替えは入れない)。
  画面の言葉はお年寄りを怖がらせないやさしい文面にし、「警察に中継している」など事実でない安心材料は書かない
  (警察への自動送信・実況中継は、受け付ける公式の窓口が無いので入れていない)。
  AIは相手の名前・口座・金額・日時・場所を聞き返して言わせてよいが、振り込む・渡す・行く・待つ等の約束や
  架空の口座番号は言わない(受け取り役が本当に家に来る危険と、実在の口座と一致する危険があるため)。
  会う日時・場所が出たら110番を案内し、だまされたふり作戦は警察の指示に任せる。
  AIに代わった後は、まだ聞けていない手がかり(銀行・口座・名前・金額・日時場所)を1つずつ聞き出し、
  相手が怪しんだら(Jev/言葉で判断)なだめてつなぎ止める(`lib/elicit.js`)。
  「守秘義務だから誰にも言うな」と口止めされたら「分かりました、誰にも言いませんから」と話を合わせ(相手に言うだけで、
  家族への知らせは止めない)、警察を名乗る相手には名前と所属を聞き返す。地元(藤枝署)の手口は `docs/fujieda_scam_context.md`。
  全国の警察の防犯動画の要約は `docs/police-videos/` に1本1ファイルでためる(書き起こしの丸ごと貼り付け・個人名は不可。
  新しい言い回しは dev と holdout に半分ずつ入れる。決まりは `docs/police-videos/README.md`)。
  知らせる家族は、見守り画面の6桁の招待番号をLINEで送った人だけ(`lib/family.js`、名簿は data/ に保存)。
  相手が振込先の口座を言ったら、その場で家族のLINEに送り、家族から警察・銀行に伝えてもらう(疑いなしの電話では送らない)。
  口座・会う日時と場所・家に来る話が出たら、登録した家族に自動音声の電話もかける(1通話1回)。AIが自分で110番はしない。
  本人や家族の声を真似る機能(声のクローン)は入れない。それ自体がオレオレ詐欺の道具になり、
  声の見本を集めて保存すること自体も漏洩時の被害が大きいため。AIの声は、性別を合わせた汎用の合成音声のみ。
  Twilio は無くても起動する(電話の受け口 `/voice/*` だけ閉じる)。スマホだけで置くときはリポジトリ直下の
  `render.yaml`(Render Blueprint、家族の名簿を残すためディスク付き)を使う。鍵は Render の画面に直接入れ、チャットや Git に書かない。
  詳細は `sengoku-shield/README.md`。
- `.github/workflows/process-memo.yml` — メモ取り込みの自動化トリガー
  (`repository_dispatch` / `workflow_dispatch`)。
- `.github/workflows/generate-short-video.yml` — 動画生成の自動化トリガー。
  生成したMP4はGitHub Releaseに添付され、スマホからダウンロードURLとして取得できる。
- `.github/workflows/auto-edit-video.yml` — 撮影素材の自動編集トリガー(`video_url` にGoogleドライブの
  共有リンクを渡す)。結果は `edit-YYYYMMDD-HHMMSS` のReleaseに添付され、本文に編集レポートが載る。

## SNS自動投稿(X)とマネタイズ導線

- `x_broadcast.js` + `x_episodes.json` — 毎日17:30 JSTに `.github/workflows/daily-x-post.yml`
  がテンプレートを日替わりローテーションでXに投稿する(LINEの `broadcast.js` と同じ方式)。
- リンク先はリポジトリ変数(Actions → Variables)で設定する: `GAME_URL`(バツルーレット)、
  `MIKUCHIWARI_URL`(三口割り)、`AFFILIATE_URL`(Amazonアソシエイト等)。
  未設定のURLを使うテンプレートは自動でスキップ。有料版(480円)の課金はバツルーレット本体
  (baturu-retto リポジトリの `billing.js`)にあるので、有料版の宣伝は `GAME_URL` に誘導する。
- `ANTHROPIC_API_KEY` があれば、その日のテンプレートの `topic` をもとに Claude(`claude-opus-5`)が
  本文だけを毎日書き直す。URL・ハッシュタグ・【PR】はプログラム側で付け、AIには書かせない。
  AIが失敗・拒否・ルール違反(URLやハッシュタグを含む等)・文字数オーバーのときは固定文面で投稿する。
- 広告・アフィリエイトを含むテンプレートは `"ad": true` にすると先頭に `【PR】` が自動で付く
  (ステマ規制=景品表示法への対応。外さないこと)。
- 文字数はXの数え方(日本語2・URL23)で280以内かを投稿前にチェックする。
- 手動実行時に `dry_run=1` を指定すると投稿せず文面だけ確認できる。

## 必要なSecrets

- `ANTHROPIC_API_KEY` — Claude API キー。GitHub リポジトリの
  Settings → Secrets and variables → Actions に登録しておく。
- `X_API_KEY` / `X_API_SECRET` / `X_ACCESS_TOKEN` / `X_ACCESS_TOKEN_SECRET` — X自動投稿用
  (X Developer Portalで「Read and write」権限のアプリを作り、OAuth 1.0aのキーを発行する)。
- 動画生成ワークフローは追加のSecret不要(標準の `GITHUB_TOKEN` でReleaseを作成)。
  将来Googleドライブ等に連携する場合は、サービスアカウントJSON等を別途Secretsに追加する。
