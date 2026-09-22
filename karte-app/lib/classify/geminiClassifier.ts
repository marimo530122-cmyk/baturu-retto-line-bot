import { ClassifyResult, Mode } from "@/lib/types";
import { ClassifierBackend, SYSTEM_PROMPTS, buildUserPrompt, parseClassifyJson } from "./types";

export class GeminiClassifier implements ClassifierBackend {
  constructor(
    private apiKey: string,
    private model: string = "gemini-2.5-flash"
  ) {}

  async classify(text: string, recentContext: string[], mode: Mode): Promise<ClassifyResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPTS[mode] }] },
        contents: [{ role: "user", parts: [{ text: buildUserPrompt(text, recentContext) }] }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.2,
          maxOutputTokens: 200,
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`Gemini API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const raw: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    return parseClassifyJson(raw, mode);
  }
}
