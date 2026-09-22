import { GoogleGenerativeAI } from "@google/generative-ai";

const SYSTEM_PROMPT = `あなたは会議・作業メモから要点を抽出する編集アシスタントです。
入力されたテキストから、事実を捏造・誇張せずに以下のJSONスキーマで出力してください。
出力はJSONオブジェクト1つのみとし、前後に説明文やMarkdownのコードフェンスを付けないこと。

{
  "summary": "全体の要約(200文字程度)",
  "decisions": ["決定事項を短い箇条書きで(なければ空配列)"],
  "todos": [
    {
      "task": "やるべきこと",
      "owner": "担当者(不明な場合は空文字)",
      "due": "期限。ISO 8601形式(YYYY-MM-DD)。不明な場合は空文字"
    }
  ]
}`;

/** Ask Gemini to extract summary / decisions / due-dated todos from raw memo text. */
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

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    decisions: Array.isArray(parsed.decisions) ? parsed.decisions : [],
    todos: Array.isArray(parsed.todos) ? parsed.todos : [],
  };
}
