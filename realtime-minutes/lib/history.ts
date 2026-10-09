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


// ---------------------------------------------------------------------------
// 録音中の内容の自動保存(下書き)
// 以前は「リセット→OK」を押したときだけ保存していたため、その前にページを閉じたり、
// スマホがバックグラウンドのブラウザを勝手に閉じたりすると、記録が丸ごと消えていた。
// 発言が増えるたびに下書きとして保存し、次に開いたときに続きから戻す。
// ---------------------------------------------------------------------------

const DRAFT_KEY = "realtime-minutes:draft";

export interface DraftEntry {
  mode: Mode;
  updatedAt: number;
  utterances: ClassifiedUtterance[];
}

export function saveDraft(mode: Mode, utterances: ClassifiedUtterance[]): void {
  try {
    if (utterances.length === 0) {
      localStorage.removeItem(DRAFT_KEY);
      return;
    }
    const draft: DraftEntry = { mode, updatedAt: Date.now(), utterances };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 容量オーバー等で保存できなくても録音自体は続けられるので無視
  }
}

export function loadDraft(): DraftEntry | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.utterances) || parsed.utterances.length === 0) return null;
    if (parsed.mode !== "meeting" && parsed.mode !== "karte") return null;
    return parsed as DraftEntry;
  } catch {
    return null;
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // 無視
  }
}
