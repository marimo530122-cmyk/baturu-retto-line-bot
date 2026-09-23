# 受託案件・自動処理ワークフロー

クラウドワークス等の受託案件(Excel・Word・PowerPoint・PDF・データ整理・リサーチ)を、
Claude Code を司令塔にして「要件整理 → 作成 → 品質チェック → 納品」まで自動で進めるための道具箱。

## セットアップ

```bash
bash freelance/setup.sh        # Python依存 + LibreOffice(PDF化用) + 日本語フォント → 最後に doctor
```

## 10の手足

| # | 役割 | コマンド |
|---|---|---|
| ① | 司令塔コア | `.claude/skills/freelance-commander/SKILL.md`(Claude Code が自動で使う) |
| ② | xlsx自動構築エンジン | `python3 freelance/fl.py xlsx --spec 仕様.json -o out.xlsx` |
| ③ | docx自動生成 | `python3 freelance/fl.py docx --md 本文.md --cover --toc -o out.docx` |
| ④ | pptx自動生成 | `python3 freelance/fl.py pptx --md 構成.md -o out.pptx` |
| ⑤ | PDF変換・処理 | `python3 freelance/fl.py pdf convert out.xlsx` / `merge` / `split` / `text` |
| ⑥ | Webデータ収集 | `python3 freelance/fl.py scrape URL --item .card --field "名前=h2"` |
| ⑦ | CSV/データパーサー | `python3 freelance/fl.py clean in.csv --dedupe --date-cols 日付` |
| ⑧ | 品質チェッカー | `python3 freelance/fl.py check 成果物フォルダ` |
| ⑨ | ビジネス文章 | `python3 freelance/fl.py write proposal --set client=山田` |
| ⑩ | ファイルマネージャー | `python3 freelance/fl.py project new/list/package` |

各仕様の見本: `templates/specs/`(Excel=`sample_xlsx.json`、Word=`sample_docx.json`+`sample_docx_body.md`、
PowerPoint=`sample_pptx.md`、汚いCSVの例=`sample_messy.csv`)。文面テンプレート: `templates/messages/`。

## 案件フォルダ

`freelance/projects/<日付>_<クライアント>_<案件名>/` に `01_brief`〜`05_delivery` が作られる。
クライアントの資料を含むので **Git 管理外**(`.gitignore` 済み)。
