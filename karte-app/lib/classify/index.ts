import { ClassifierBackend } from "./types";
import { MockClassifier } from "./mockClassifier";
import { GeminiClassifier } from "./geminiClassifier";
import { ClaudeClassifier } from "./claudeClassifier";
import { OllamaClassifier } from "./ollamaClassifier";
import { JevClassifier } from "./jevClassifier";

export type { ClassifierBackend } from "./types";

/**
 * CLASSIFIER_PROVIDER 環境変数でバックエンドを差し替える(mock/gemini/claude/ollama/jev)。
 * 抽象化されているので、将来Whisper.cppなど別STT・別LLMへの切り替えも
 * この関数だけの変更で済む。
 */
export function getClassifier(): ClassifierBackend {
  const provider = (process.env.CLASSIFIER_PROVIDER || "mock").toLowerCase();

  switch (provider) {
    case "gemini": {
      const key = process.env.GEMINI_API_KEY;
      if (!key) throw new Error("GEMINI_API_KEY が .env.local に設定されていません");
      return new GeminiClassifier(key, process.env.GEMINI_MODEL);
    }
    case "claude": {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error("ANTHROPIC_API_KEY が .env.local に設定されていません");
      return new ClaudeClassifier(key, process.env.ANTHROPIC_MODEL);
    }
    case "ollama":
      return new OllamaClassifier(process.env.OLLAMA_BASE_URL, process.env.OLLAMA_MODEL);
    case "jev": {
      const key = process.env.TYPESAFE_API_KEY;
      if (!key) throw new Error("TYPESAFE_API_KEY が .env.local に設定されていません");
      return new JevClassifier(key, process.env.TYPESAFE_API_BASE_URL);
    }
    case "mock":
    default:
      return new MockClassifier();
  }
}
