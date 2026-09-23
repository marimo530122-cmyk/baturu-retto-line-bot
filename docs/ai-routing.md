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

次の候補:

- **X自動投稿のチェック** (`x_broadcast.js`): Claude が書いた本文に「イッキ飲み・飲酒の強要を
  連想させるか」「実在の店名や人名を出していないか」を `noul` で確認し、引っかかったら固定文面に
  戻す。今の正規表現チェック(URL・ハッシュタグ)では拾えない意味的なルール違反を安く検出できる。
- **動画化候補の選定** (`generate_short_video.py`): 蓄積したログを `score`(フックの強さ 0〜3)で
  採点し、上位だけを動画生成に回す。
