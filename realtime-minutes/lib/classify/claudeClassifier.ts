import { ClassifyResult } from "@/lib/types";
import { ClassifierBackend, CLASSIFY_SYSTEM_PROMPT, buildUserPrompt, parseClassifyJson } from "./types";

export class ClaudeClassifier implements ClassifierBackend {
  constructor(
    private apiKey: string,
    private model: string = "claude-haiku-4-5-20251001"
  ) {}

  async classify(text: string, recentContext: string[]): Promise<ClassifyResult> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 200,
        system: CLASSIFY_SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserPrompt(text, recentContext) }],
      }),
    });

    if (!res.ok) {
      throw new Error(`Claude API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const raw: string = data?.content?.[0]?.text ?? "{}";
    return parseClassifyJson(raw);
  }
}
