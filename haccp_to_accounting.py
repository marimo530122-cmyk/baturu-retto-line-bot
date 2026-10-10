import os
import json
import glob
import cv2
import pandas as pd
from datetime import datetime

PROMPT_TEMPLATE = """
あなたは飲食業・食品製造業の衛生管理者および経理担当者です。
画像（納品書、食材現物、賞味期限印字、レシート）から情報を正確に読み取り、
以下のJSONフォーマット【のみ】で出力してください。

{
  "haccp": {
    "receive_date": "受領日(YYYY-MM-DD)",
    "item_name": "品名・原材料名",
    "vendor": "仕入先・納品業者名",
    "lot_number": "ロット番号、製造番号または産地",
    "expiry_date": "賞味期限または消費期限(YYYY-MM-DD)",
    "storage_temp": "保管区分（常温 / 冷蔵 / 冷凍）",
    "packaging_condition": "包装・外観状態（良好 / 破損・汚れあり）",
    "status": "判定（受領合格 / 不合格・返品）",
    "note": "特記事項"
  },
  "accounting": {
    "transaction_date": "取引日(YYYY-MM-DD)",
    "vendor": "取引先名",
    "account_item": "勘定科目（仕入高 / 消耗品費 / 雑費）",
    "tax_rate": "税率（8% / 10%）",
    "total_amount": 0,
    "tax_amount": 0,
    "tax_category": "税区分（仕入8%(軽) / 仕入10%）",
    "payment_status": "決済（未決済・買掛金 / 完了・現金）",
    "description": "摘要（品名、ロット、賞味期限、HACCP確認済）"
  }
}
"""

def extract_best_frame(video_path, output_image_path="temp_frame.jpg"):
    cap = cv2.VideoCapture(video_path)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames > 0:
        cap.set(cv2.CAP_PROP_POS_FRAMES, total_frames // 2)
        ret, frame = cap.read()
        if ret:
            cv2.imwrite(output_image_path, frame)
            cap.release()
            return output_image_path
    cap.release()
    return None

def call_gemini_api(image_path):
    gemini_key = os.environ.get("GEMINI_API_KEY")
    if not gemini_key:
        print("[Notice] GEMINI_API_KEY 未設定のためテストデータで動作します。")
        return {
            "haccp": {
                "receive_date": datetime.now().strftime("%Y-%m-%d"),
                "item_name": "銘柄豚バラ肉",
                "vendor": "駿河食肉卸売センター",
                "lot_number": "LOT-20261011-B",
                "expiry_date": "2026-10-18",
                "storage_temp": "冷蔵",
                "packaging_condition": "良好",
                "status": "受領合格",
                "note": "品温4℃確認、外観良好"
            },
            "accounting": {
                "transaction_date": datetime.now().strftime("%Y-%m-%d"),
                "vendor": "駿河食肉卸売センター",
                "account_item": "仕入高",
                "tax_rate": "8%",
                "total_amount": 24800,
                "tax_amount": 1837,
                "tax_category": "仕入8%(軽)",
                "payment_status": "未決済・買掛金",
                "description": "銘柄豚バラ肉 LOT-20261011-B 賞味:2026-10-18 HACCP受領点検済"
            }
        }
    try:
        from google import genai
        from google.genai import types
        client = genai.Client(api_key=gemini_key)
        with open(image_path, "rb") as f:
            image_bytes = f.read()
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"), PROMPT_TEMPLATE],
            config=types.GenerateContentConfig(response_mime_type="application/json")
        )
        text = response.text.strip().replace("```json", "").replace("```", "")
        return json.loads(text)
    except Exception as e:
        print(f"[Error] {e}")
        return None

def export_to_csvs(data, source_filename=""):
    haccp_data = data.get("haccp", {})
    acc_data = data.get("accounting", {})
    haccp_data["source_file"] = os.path.basename(source_filename)
    haccp_data["processed_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    pd.DataFrame([haccp_data]).to_csv("haccp_ledger.csv", mode="a", index=False, header=not os.path.exists("haccp_ledger.csv"), encoding="utf_8_sig")
    acc_data["source_file"] = os.path.basename(source_filename)
    pd.DataFrame([acc_data]).to_csv("accounting_ledger.csv", mode="a", index=False, header=not os.path.exists("accounting_ledger.csv"), encoding="utf_8_sig")

    freee_row = {
        "収支区分": "支出",
        "管理番号": f"HACCP-{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "発生日": acc_data.get("transaction_date", ""),
        "決済期日": acc_data.get("transaction_date", ""),
        "取引先": acc_data.get("vendor", ""),
        "勘定科目": acc_data.get("account_item", "仕入高"),
        "税区分": acc_data.get("tax_category", "仕入8%(軽)"),
        "金額": acc_data.get("total_amount", 0),
        "税額": acc_data.get("tax_amount", 0),
        "備考": acc_data.get("description", ""),
        "品目": haccp_data.get("item_name", ""),
        "部門": "飲食・製造",
        "メモタグ": f"HACCP:{haccp_data.get('status', '受領済')}"
    }
    pd.DataFrame([freee_row]).to_csv("freee_import_journal.csv", mode="a", index=False, header=not os.path.exists("freee_import_journal.csv"), encoding="utf_8_sig")

def main():
    input_dir = "inputs"
    os.makedirs(input_dir, exist_ok=True)
    files = glob.glob(f"{input_dir}/*.*")
    if not files:
        print("inputs/ フォルダに画像を入れてください。")
        return
    for f in files:
        data = call_gemini_api(f)
        if data:
            export_to_csvs(data, f)
            print(f"✓ 完了: {f}")
    print("全処理が完了しました（haccp_ledger.csv / freee_import_journal.csv 出力済）。")

if __name__ == "__main__":
    main()
