/**
 * 画面の図(SVG)を画像(PNG)にして、スマホなら共有メニュー(写真に保存・LINE等)、
 * パソコンならダウンロードで渡す。すべてブラウザ内で行い、図をどこにも送らない。
 */
// 画像にすると画面のCSSが効かなくなるので、見た目に関わるものだけ各要素に直接書き込む
const STYLE_PROPS = [
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-dasharray",
  "opacity", "visibility", "display", "color", "background-color",
  "font-family", "font-size", "font-weight", "font-style", "line-height", "white-space", "text-align",
  "padding-top", "padding-right", "padding-bottom", "padding-left", "border-radius",
];

function inlineComputedStyles(original: Element, clone: Element): void {
  const computed = getComputedStyle(original);
  const style = STYLE_PROPS.map((p) => `${p}:${computed.getPropertyValue(p)}`).join(";");
  clone.setAttribute("style", `${clone.getAttribute("style") ?? ""};${style}`);
  const originalChildren = original.children;
  const cloneChildren = clone.children;
  for (let i = 0; i < originalChildren.length && i < cloneChildren.length; i++) {
    inlineComputedStyles(originalChildren[i], cloneChildren[i]);
  }
}

export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
  // 画面に見えている範囲ではなく、中身が実際にある範囲(はみ出し・ずれた分も含む)で切り出す
  const PAD = 16;
  const box = svg.getBBox();
  const width = Math.ceil(box.width + PAD * 2);
  const height = Math.ceil(box.height + PAD * 2);

  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineComputedStyles(svg, clone);
  // 図の中の文章(foreignObject内のHTML)も画像に描けるよう、名前空間を明示する
  clone.querySelectorAll("foreignObject > *").forEach((el) => el.setAttribute("xmlns", "http://www.w3.org/1999/xhtml"));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("viewBox", `${box.x - PAD} ${box.y - PAD} ${width} ${height}`);

  const source = new XMLSerializer().serializeToString(clone);
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("図を画像に変換できませんでした"));
    image.src = url;
  });

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("この端末では画像を作れませんでした");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(image, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("画像を作れませんでした"))), "image/png");
  });
}

/** 共有メニューが使えれば共有、使えなければダウンロード。どちらで渡したかを返す */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], title });
    return "shared";
  }
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
  return "downloaded";
}
