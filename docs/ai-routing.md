# マルチAI・ルーティング司令塔 (Jev + Claude + Gemini)

重いAI(Claude)を毎回フルに呼ぶのをやめ、「まず激安・高速な Jev に判定だけさせて、
必要なときだけ重いAIを呼ぶ」ための仕組み。実装は `scripts/ai_router.py`。

## 役割分担

| 層 | 担当 | やること | やらないこと |
| --- | --- | --- | --- |
| 判定・ルーティング | **Jev** (TypeSafe, `jev-latest`) | 選択肢から1つ選ぶ・はい/いいえの確率・段階評価 | 文章を書く |
| 実装・本気の整形 | **Claude** (`claude-opus-5`) | 魚屋エピソード・AI自動化メモの構造化 | 単純な分類 |
| 壁打ち・分析 | **Gemini** (`GEMINI_MODEL`, 既定 `gemini-flash-latest`) | 生煮えアイデアの整理と論点出し | — |
| 開発 | **Claude Code** | `route: tech` のログを読んで実装する | 定期実行の中での判定 |

## メモ取り込みでの流れ

```
メモ ──▶ Jev「このメモは何?」(choice: story / tech / idea / noise)
          │
          ├─ story (日常・愚痴・修羅場) ──▶ Claude で3セクション整形
          ├─ tech  (AI・自動化の試行錯誤) ─▶ Claude で整形 + route: tech を記録
          ├─ idea  (生煮えアイデア・相談) ─▶ Gemini で整形 + 壁打ちメモ
          └─ noise (テスト送信など)       ─▶ AIを呼ばず元メモだけ保存
```

安全側に倒すルール(`scripts/ai_router.py` の先頭で調整できる):

- `TYPESAFE_API_KEY` が無い・Jev が失敗した → 全部 Claude(従来どおり)
- Jev の確信度が `ROUTE_MIN_CONFIDENCE`(既定 0.6)未満 → Claude
- noise で AI を完全に飛ばすのは確信度 `ROUTE_SKIP_MIN_CONFIDENCE`(既定 0.85)以上のときだけ
- `GEMINI_API_KEY` が無い・Gemini が失敗した → Claude

どのルートでも元メモは加工せずに残るので、判定ミスがあっても後から直せる。
各ログのヘッダに `- route: idea → gemini` のように振り分け結果が残る。

## 導入手順

1. GitHub の Settings → Secrets and variables → Actions に登録する(どちらも任意)
   - `TYPESAFE_API_KEY` — TypeSafe のダッシュボードで発行
   - `GEMINI_API_KEY` — Google AI Studio で発行
2. 何もしなくても動く。キーが無いものは自動で Claude にフォールバックする。
3. Actions のログに `Route: story → claude (confidence 0.92) - Jev判定どおり` のように
   判定理由が出るので、最初の数日は振り分けが妥当か確認し、必要ならしきい値や
   `MEMO_KIND_QUESTION` の説明文を調整する。

追加の Python パッケージは不要(Jev と Gemini は標準ライブラリの `urllib` で呼ぶ)。

## 他の処理に広げるときの型

新しい判定を足すときは `jev_ask(state, questions)` を使う。質問は3種類:

- `{"type": "choice", "instructions": ..., "criteria": {"ラベル": "説明", ...}}` → `choice` と `confidence`
- `{"type": "noul", "instructions": ...}` → `noul`(はいの確率 0〜1)
- `{"type": "score", "instructions": ..., "criteria": ["0の説明", "1の説明", ...]}` → `score` と `confidence`

同じ入力への独立した質問は1回のリクエストにまとめる(並列で答えが返る)。

## X自動投稿の安全チェック (`x_broadcast.js`)

Claude が書いた本文を、投稿前に Jev へ `noul` 3問まとめて1回で確認する。

| 質問名 | 見ること |
| --- | --- |
| `drinking` | イッキ飲み・飲酒の強要・未成年飲酒を連想させるか |
| `real_names` | 実在の人物・企業・店名を出していないか(自社ツール名はOK) |
| `invented_facts` | テーマ・参考投稿にない数字や効果を作っていないか |

- どれかの確率が `JEV_VIOLATION_THRESHOLD`(既定 0.5)以上 → 固定文面で投稿
- Jev が失敗した → 固定文面で投稿(チェックできない文面は出さない)
- `TYPESAFE_API_KEY` が無い → 従来どおり正規表現チェック(URL・ハッシュタグ・【PR】)だけ
- 正規表現チェックと文字数チェックはそのまま残している(機械的に判定できるものはコードで)

## トレンド追従との相性(検証結果)

### 結論

今の仕組みは「トレンドを追う」目的には**半分しか合っていない**。

- **合っている部分 = ふるい分けと安全確認。** 大量の候補を安く速く「使える/使えない」に分けるのは
  Jev の得意分野そのもの。トレンド20件を判定しても入力数千トークン(1日1円未満)。
- **合っていなかった部分 = トレンドの入口がゼロ。** X投稿は `x_episodes.json` の固定テーマを
  日替わりで回しているだけで、メモ取り込みも本人のメモが入口。どこからも世の中の流れが入ってこない。
  Jev は渡された文章を判定するだけで、ネットを見に行ったり今の話題を知っていたりはしない。
  → 「集める」部分を新しく足した(`x_trends.js`)。
- **リアルタイムではない。** 投稿は1日1回(17:30 JST)。飲み会ツールの宣伝なので、1日1回その日の
  空気に乗れれば十分と判断し、頻度は変えていない。分単位で追うなら、X の有料APIか常駐サーバーが
  必要になり、今の「GitHub Actions だけで無料で回す」方針から外れる。

### 役割の置き方

| 工程 | 担当 | 理由 |
| --- | --- | --- |
| 集める | Google Trends の日本向けRSS(無料・キー不要) | Jev にも Claude にも最新の話題を知る手段がない |
| ふるい分け | **Jev**(1件ごとに3問、全件並列) | 大量・単純・安さ重視 = Jev の本領 |
| 書く | Claude | 文章生成は Jev にはできない |
| 投稿前チェック | 正規表現 + **Jev** | 既存の安全チェックにトレンドも state として渡す |

### ルール上の落とし穴と対処

トレンドの多くは「芸能人の名前」「企業の新商品」「事件・災害」。一方、投稿ルールは
「実在の人物・企業を出さない」「イッキ飲み等を連想させない」。そのまま便乗すると
ルール違反か炎上になるので、Jev で次を**除外**してから相性の一番高いものを1つだけ使う。

| 質問 | 種類 | 除外条件 |
| --- | --- | --- |
| `sensitive` 災害・事故・訃報・事件・政治など、軽いノリで触れると不謹慎か | noul | 0.3 以上(厳しめ) |
| `named_party` 特定の人物・企業・商品が主役で、名前を出さずに触れられないか | noul | 0.5 以上 |
| `fit` 飲み会・罰ゲーム・割り勘の投稿にどれだけ自然に絡められるか | score 0〜3 | 2 未満 |

実際に残るのは「忘年会」「花火大会」「連休」「猛暑」のような季節・行事系が中心になる想定。
それで十分に「今日っぽさ」は出せる。残らない日は普段どおりの投稿になる。

### 有効にする方法

リポジトリ変数(Actions → Variables)に `USE_TRENDS` = `1` を追加する。
`ANTHROPIC_API_KEY` と `TYPESAFE_API_KEY` の両方があるときだけ動く。最初は「Daily X Post」を
`dry_run=1` で手動実行し、ログの `トレンド判定: 20件中3件が使用可 → 「花火大会」(相性2.4)` と
本文を見てから本番にするのがおすすめ。

未確認の点: この開発環境からは Google Trends にも Jev にもつながらなかったため、RSS の形式と
Jev の判定精度は実環境で未検証。RSS 取得・解析・Jev のどれかが失敗しても、トレンドなしの
普段の投稿に戻る。

## ターミナルから使う (`scripts/jev_local_router.py`)

「これは Claude に聞くほどでもない」軽い判定を、ターミナルから Jev だけで済ませるためのツール。
結果は1行のJSONで返る。

```
export TYPESAFE_API_KEY=...   # 未設定なら常に {"engine": "claude", "fallback": true}

python scripts/jev_local_router.py noul "飲酒を強要しているか" "イッキ!イッキ!"
python scripts/jev_local_router.py choice "メモの種類は?" "仕入れ値がまた上がった" --options 愚痴 アイデア 報告
python scripts/jev_local_router.py score "急ぎ度は?" "明日の朝までに発注" --levels 急がない 今週中 今日中
python scripts/jev_local_router.py route "このツイートがネガティブか判定して"   # jev で済むか claude か
cat memo.txt | python scripts/jev_local_router.py noul "愚痴か"                  # 標準入力も可
```

- キー未設定・通信エラー・確信度不足のときは `"engine": "claude"` を返す(終了コードは 0)。
  「Jev では判定できなかったので普通に Claude に頼めばいい」という合図。
- Claude Code の手前に自動で割り込む仕組みではない。Claude Code は指示を必ず自分で読んでから動くので、
  開発中の Claude のトークンはこのツールでは減らない。減らせるのは「判定だけのために Claude を呼ぶ」回数。
- Claude Code on the web(スマホ)で使うには、環境設定で `TYPESAFE_API_KEY` を環境変数に入れ、
  ネットワークポリシーで `api.typesafe.ai` への通信を許可する必要がある(既定では遮断される)。

## テスト

実際のAPIを呼ばずに振り分けと安全チェックの全パターンを確認する(`.github/workflows/test.yml` で自動実行)。

```
python -m unittest discover tests
node --test tests/x_broadcast_jev.test.js tests/x_trends.test.js
```

## 次の候補

- **動画化候補の選定** (`generate_short_video.py`): 蓄積したログを `score`(フックの強さ 0〜3)で
  採点し、上位だけを動画生成に回す。
