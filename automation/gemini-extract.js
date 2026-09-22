import { GoogleGenerativeAI } from "@google/generative-ai";

// 通院カルテ&処方箋の13項目スキーマ。事実を捏造・誇張しないこと。
const SYSTEM_PROMPT = `あなたは、家族の通院に付き添った人が残したメモから、あとで見返せる
「カルテ(現状の記録)」と「処方箋(次のアクション)」を整理する編集アシスタントです。

入力されるメモは、病院での医師とのやり取りや、本人の様子についての口語的な記録です。
事実を捏造・誇張せず、メモに書かれていないことは空文字/空配列にしてください。
出力はJSONオブジェクト1つのみとし、前後に説明文やMarkdownのコードフェンスを付けないこと。

{
  "visit_date": "受診日(メモから分かれば YYYY-MM-DD、不明なら空文字)",
  "hospital_and_department": "病院名・診療科(分かれば)",
  "overview": "今回の受診の概要(何のために行ったか、200文字程度)",
  "symptoms": "現状の症状・体調の様子(自由記述)",
  "decisions": ["診断・治療方針など、その場で決まったこと(箇条書き、なければ空配列)"],
  "concerns": ["まだ解決していない懸念・不安(箇条書き、なければ空配列)"],
  "todos": [
    {
      "task": "次にやるべきこと(薬をもらう、検査を受ける等)",
      "owner": "担当者(不明な場合は空文字。家族なら「自分」等)",
      "due": "期限。ISO 8601形式(YYYY-MM-DD)。不明な場合は空文字"
    }
  ],
  "priority": "対応の優先度・緊急度(例: 緊急/通常/経過観察。不明なら空文字)",
  "advice": ["医師からのアドバイス・生活上の注意点(箇条書き、なければ空配列)"],
  "resources": ["参考にすべき資料・紹介先・専門医など(箇条書き、なければ空配列)"],
  "follow_up_points": ["次回受診時に確認・報告すべきこと(箇条書き、なければ空配列)"],
  "background": "これまでの経緯・背景(既往歴や前回までの流れ、自由記述)",
  "cost_and_time": "想定される費用・かかる時間・通院頻度など(自由記述)",
  "ng_items": ["やってはいけないこと・注意事項(薬の飲み合わせ等、箇条書き、なければ空配列)"]
}`;

/** Ask Gemini to extract the 13-field hospital-visit karte/prescription schema. */
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

  return {
    visit_date: str(parsed.visit_date),
    hospital_and_department: str(parsed.hospital_and_department),
    overview: str(parsed.overview),
    symptoms: str(parsed.symptoms),
    decisions: strArray(parsed.decisions),
    concerns: strArray(parsed.concerns),
    todos: Array.isArray(parsed.todos) ? parsed.todos : [],
    priority: str(parsed.priority),
    advice: strArray(parsed.advice),
    resources: strArray(parsed.resources),
    follow_up_points: strArray(parsed.follow_up_points),
    background: str(parsed.background),
    cost_and_time: str(parsed.cost_and_time),
    ng_items: strArray(parsed.ng_items),
  };
}
