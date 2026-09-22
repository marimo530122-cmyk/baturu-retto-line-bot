import { ClassifiedUtterance, Mode } from "@/lib/types";

export interface HistoryEntry {
  id: string;
  mode: Mode;
  savedAt: number;
  utterances: ClassifiedUtterance[];
}

const STORAGE_KEY = "realtime-minutes:history";
const MAX_ENTRIES = 50;

/**
 * このアプリには永続化DBが無いため、ブラウザのlocalStorageだけを使う。
 * 端末・ブラウザをまたいでは共有されない(このスマホ・このブラウザだけの記録)。
 */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveHistoryEntry(mode: Mode, utterances: ClassifiedUtterance[]): HistoryEntry | null {
  if (utterances.length === 0) return null;
  try {
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      mode,
      savedAt: Date.now(),
      utterances,
    };
    const existing = loadHistory();
    const next = [entry, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    return entry;
  } catch {
    return null;
  }
}

export function deleteHistoryEntry(id: string): void {
  try {
    const next = loadHistory().filter((e) => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存に失敗しても致命的ではないので無視
  }
}
