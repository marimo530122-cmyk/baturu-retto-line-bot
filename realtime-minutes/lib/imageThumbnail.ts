/**
 * スマホの写真は1枚数MBになることがあり、そのまま何十枚も保存すると容量を圧迫するため、
 * 履歴表示用に縮小したサムネイルを作ってから保存する(文字起こし自体は元画像の解像度のまま
 * 行うので、OCR精度には影響しない)。
 */
export async function createThumbnailBlob(file: File, maxDim = 800, quality = 0.7): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context を取得できませんでした");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("サムネイル生成に失敗しました"))),
      "image/jpeg",
      quality
    );
  });
}
