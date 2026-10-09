"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Copy, Image as ImageIcon } from "lucide-react";
import { ClassifiedUtterance, Mode } from "@/lib/types";
import { utterancesToMarkdown } from "@/lib/markmapTransform";
import { analyzeKarte, candidatesEnabled } from "@/lib/karteInsights";
import { buildKarteFishbone, buildMeetingFishbone, emptyFishbone, fishboneToText } from "@/lib/fishbone";
import { shareOrDownload, svgToPngBlob } from "@/lib/svgExport";
import { MindMapView } from "./MindMapView";
import { FishboneView } from "./FishboneView";

type MapStyle = "mindmap" | "fishbone";

/** 「全体図」タブ: マインドマップとフィッシュボーンを切り替え、画像で保存・文字でコピーできる */
export function MapPanel({ utterances, mode }: { utterances: ClassifiedUtterance[]; mode: Mode }) {
  const [style, setStyle] = useState<MapStyle>("mindmap");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const mindmapRef = useRef<SVGSVGElement | null>(null);
  const fishboneRef = useRef<SVGSVGElement | null>(null);

  const markdown = useMemo(() => utterancesToMarkdown(utterances, mode), [utterances, mode]);
  const fishbone = useMemo(() => {
    if (utterances.length === 0) return emptyFishbone(mode);
    return mode === "karte"
      ? buildKarteFishbone(analyzeKarte(utterances, { includeCandidates: candidatesEnabled() }))
      : buildMeetingFishbone(utterances);
  }, [utterances, mode]);

  const baseName = `${mode === "karte" ? "通院カルテ" : "議事録"}_${style === "fishbone" ? "フィッシュボーン" : "マインドマップ"}`;

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(null), 3000);
  }

  async function handleSaveImage() {
    const svg = style === "fishbone" ? fishboneRef.current : mindmapRef.current;
    if (!svg) return;
    setSaving(true);
    try {
      const blob = await svgToPngBlob(svg);
      const stamp = new Date().toISOString().slice(0, 10);
      const how = await shareOrDownload(blob, `${baseName}_${stamp}.png`, baseName);
      flash(how === "shared" ? "画像を共有メニューに渡しました" : "画像を保存しました");
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return; // 共有をキャンセルした
      flash(
        style === "mindmap"
          ? "この端末ではマインドマップを画像にできませんでした。フィッシュボーンに切り替えるか、文字でコピーをお使いください"
          : "画像にできませんでした。文字でコピーをお使いください"
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCopyText() {
    const text = style === "fishbone" ? fishboneToText(fishbone) : markdown;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      flash("コピーできませんでした(ブラウザの設定でクリップボードが許可されていない可能性があります)");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-white px-3 py-2">
        <div className="flex gap-1 rounded-md bg-gray-100 p-0.5">
          {(["mindmap", "fishbone"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStyle(s)}
              className={`rounded px-2.5 py-1 text-xs font-medium ${
                style === s ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
              }`}
            >
              {s === "mindmap" ? "マインドマップ" : "フィッシュボーン"}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <button
            onClick={handleSaveImage}
            disabled={saving}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            <ImageIcon className="h-3.5 w-3.5" />
            {saving ? "作成中..." : "画像で保存"}
          </button>
          <button
            onClick={handleCopyText}
            className="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "コピーしました" : "文字でコピー"}
          </button>
        </div>
      </div>
      {message && <p className="shrink-0 bg-amber-50 px-3 py-1.5 text-xs text-amber-900">{message}</p>}
      <div className="min-h-0 flex-1">
        {style === "mindmap" ? (
          <MindMapView ref={mindmapRef} markdown={markdown} />
        ) : (
          <div className="h-full overflow-auto bg-white p-2">
            <p className="mb-1 text-[11px] text-gray-400">横にスクロールすると全体が見られます(画像で保存すると1枚にまとまります)</p>
            <FishboneView ref={fishboneRef} data={fishbone} />
          </div>
        )}
      </div>
    </div>
  );
}
