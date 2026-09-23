import { GoogleGenerativeAI } from "@google/generative-ai";

// 通院カルテ&処方箋の13項目スキーマ(医師・患者安全の視点)。事実を捏造・誇張しないこと。
const SYSTEM_PROMPT = `あなたは、家族の通院に付き添った人が残したメモから、あとで見返せる
「カルテ(今の状態の記録)」と「処方箋(次のアクション・注意点)」を整理する編集アシスタントです。

入力されるメモは、病院での医師とのやり取りや、本人の様子についての口語的な記録です。
事実を捏造・誇張せず、メモに書かれていないことは空文字/空配列にしてください。
特に「11. レッドフラッグ」は安全に関わる項目です。メモに医師の警告として
書かれていないことを推測で作り出さないこと(不明なら空配列のままにする)。
出力はJSONオブジェクト1つのみとし、前後に説明文やMarkdownのコードフェンスを付けないこと。

{
  "basic_info": {
    "visit_date": "受診日(メモから分かれば YYYY-MM-DD、不明なら空文字)",
    "department": "診療科(分かれば)",
    "doctor": "担当医(分かれば)",
    "companion": "同行者(分かれば。自分が付き添ったなら「自分」等)"
  },
  "chief_complaint": "主訴。今日一番気になって受診した理由(自由記述)",
  "readings_trend": "自宅での数値・体調の推移(血圧・体重・痛みの度合いなど、日々のモニタリング結果。自由記述)",
  "diagnosis": "医師からの診察・診断内容(所見、病状の変化。自由記述)",
  "qa_log": [
    { "question": "診察室で交わされた質問", "answer": "それに対する医師の回答" }
  ],
  "treatment": ["今回処方された薬・行われた処置の詳細(箇条書き、なければ空配列)"],
  "treatment_change_reason": "処方・治療の変更点とその理由(前回から何がどう変わったか。自由記述、なければ空文字)",
  "side_effects_and_allergies": "副作用・アレルギーの確認(前回からの体調変化や不具合の有無。自由記述)",
  "restrictions": ["生活制限・NG事項(食事・運動・入浴などの医師からの禁止/制限事項。箇条書き、なければ空配列)"],
  "homework": [
    {
      "task": "次回までに自宅でやること(自己測定・モニタリング等)",
      "owner": "担当者(不明な場合は空文字。家族なら「自分」等)",
      "due": "期限。ISO 8601形式(YYYY-MM-DD)。不明な場合は空文字"
    }
  ],
  "red_flags": ["レッドフラッグ。「こうなったらすぐ連絡/受診」と医師が示した要注意サイン(箇条書き、なければ空配列。推測で作らない)"],
  "next_visit": {
    "date": "次回受診予定日(YYYY-MM-DD、不明なら空文字)",
    "preparation": "それまでに必要な準備(検査予定等、自由記述)",
    "cost_estimate": "費用の見積もり・想定(自由記述)"
  },
  "notes": "全体を通した振り返り・フリーメモ(家族/介助者としての所感、自由記述)"
}`;

/** Ask Gemini to extract the 13-field, clinically-oriented karte/prescription schema. */
export async function extractStructuredData(rawText) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set.");

  const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: SYSTEM_PROMPT,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
    },
  });

  const result = await model.generateContent(rawText);
  const raw = result.response.text();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Gemini returned non-JSON output: ${err.message}\nRaw: ${raw.slice(0, 500)}`);
  }

  const str = (v) => (typeof v === "string" ? v : "");
  const strArray = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  const obj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

  const basicInfo = obj(parsed.basic_info);
  const nextVisit = obj(parsed.next_visit);

  return {
    basic_info: {
      visit_date: str(basicInfo.visit_date),
      department: str(basicInfo.department),
      doctor: str(basicInfo.doctor),
      companion: str(basicInfo.companion),
    },
    chief_complaint: str(parsed.chief_complaint),
    readings_trend: str(parsed.readings_trend),
    diagnosis: str(parsed.diagnosis),
    qa_log: Array.isArray(parsed.qa_log)
      ? parsed.qa_log.map((qa) => ({ question: str(qa?.question), answer: str(qa?.answer) }))
      : [],
    treatment: strArray(parsed.treatment),
    treatment_change_reason: str(parsed.treatment_change_reason),
    side_effects_and_allergies: str(parsed.side_effects_and_allergies),
    restrictions: strArray(parsed.restrictions),
    homework: Array.isArray(parsed.homework) ? parsed.homework : [],
    red_flags: strArray(parsed.red_flags),
    next_visit: {
      date: str(nextVisit.date),
      preparation: str(nextVisit.preparation),
      cost_estimate: str(nextVisit.cost_estimate),
    },
    notes: str(parsed.notes),
  };
}
