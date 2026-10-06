/**
 * 撮った写真の画像データ本体をブラウザ内(IndexedDB)に保存する。
 * localStorageは文字列のみ・容量も小さいため、画像のような大きいバイナリは
 * IndexedDBに保存する(lib/photoHistory.ts は日時・プレビュー文字列などの
 * メタデータのみを扱い、画像本体はこちらが担当する)。
 */

const DB_NAME = "realtime-minutes";
const STORE_NAME = "photo-blobs";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function savePhotoBlob(id: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(blob, id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 保存に失敗しても撮影・文字起こし自体は成立させる(履歴の写真が無いだけ)
  }
}

export async function getPhotoBlob(id: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const result = await new Promise<Blob | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve((req.result as Blob) ?? null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

export async function deletePhotoBlob(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 削除に失敗しても致命的ではないので無視
  }
}

/** 現在の履歴一覧(idのリスト)に無いBlobを掃除し、際限なく容量が増えないようにする。 */
export async function pruneOrphanedPhotoBlobs(keepIds: string[]): Promise<void> {
  try {
    const db = await openDb();
    const keepSet = new Set(keepIds);
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAllKeys();
      req.onsuccess = () => {
        for (const key of req.result) {
          if (!keepSet.has(String(key))) store.delete(key);
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // 掃除に失敗しても致命的ではないので無視
  }
}
