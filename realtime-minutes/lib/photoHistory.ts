import { deletePhotoBlob, pruneOrphanedPhotoBlobs } from "./photoStore";

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
 * (端末・ブラウザをまたいでは共有されない)。写真本体は容量が大きいため
 * lib/photoStore.ts(IndexedDB)が別途担当し、ここではメタデータのみを扱う。
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

/**
 * id は呼び出し側で発行する(写真本体をphotoStore.tsへ保存するときと同じidを
 * 使い、あとから紐付けられるようにするため)。
 */
export function savePhotoHistoryEntry(id: string, status: PhotoHistoryEntry["status"], text: string): void {
  try {
    const entry: PhotoHistoryEntry = {
      id,
      capturedAt: Date.now(),
      status,
      preview: text.slice(0, PREVIEW_LENGTH),
    };
    const existing = loadPhotoHistory();
    const next = [entry, ...existing].slice(0, MAX_ENTRIES);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    // 上限を超えて一覧から落ちた古い写真のBlobも一緒に消し、容量が際限なく増えないようにする
    void pruneOrphanedPhotoBlobs(next.map((e) => e.id));
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
  void deletePhotoBlob(id);
}
