import { ClassifyResult } from "@/lib/types";
import { ClassifierBackend, CLASSIFY_SYSTEM_PROMPT, buildUserPrompt, parseClassifyJson } from "./types";

export class OllamaClassifier implements ClassifierBackend {
  constructor(
    private baseUrl: string = "http://localhost:11434",
    private model: string = "llama3.1"
  ) {}

  async classify(text: string, recentContext: string[]): Promise<ClassifyResult> {
    const res = await fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.model,
        system: CLASSIFY_SYSTEM_PROMPT,
        prompt: buildUserPrompt(text, recentContext),
        format: "json",
        stream: false,
        options: { temperature: 0.2 },
      }),
    });

    if (!res.ok) {
      throw new Error(`Ollama API error: ${res.status} ${await res.text()}`);
    }

    const data = await res.json();
    const raw: string = data?.response ?? "{}";
    return parseClassifyJson(raw);
  }
}
