export interface PhotoHistoryEntry {
  id: string;
  capturedAt: number;
  status: "success" | "empty" | "error";
  /** 読み取れたテキストの先頭部分、またはエラー内容(一覧でどの写真か分かる程度のプレビュー) */
  preview: string;
}

const STORAGE_KEY = "realtime-minutes:photo-history";
const MAX_ENTRIES = 50;
const PREVIEW_LENGTH = 40;

/**
 * 「いつ写真を撮って読み取ったか」の記録。このアプリには永続化DBが無いため、
 * lib/history.ts の会議記録と同じく、ブラウザのlocalStorageだけを使う
 * (端末・ブラウザをまたいでは共有されない)。写真そのものは保存せず、
 * 読み取り結果のプレビュー文字列だけを残す(ストレージ圧迫と、写真という
 * 個人情報を増やさないため)。
 */
export function loadPhotoHistory(): PhotoHistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function savePhotoHistoryEntry(status: PhotoHistoryEntry["status"], text: string): void {
  try {
    const entry: PhotoHistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      capturedAt: Date.now(),
      status,
      preview: text.slice(0, PREVIEW_LENGTH),
    };
    const existing = loadPhotoHistory();
    const next = [entry, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存に失敗しても撮影自体は成功しているので無視
  }
}

export function deletePhotoHistoryEntry(id: string): void {
  try {
    const next = loadPhotoHistory().filter((e) => e.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存に失敗しても致命的ではないので無視
  }
}
