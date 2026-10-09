"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const transformer = new Transformer();

export const MindMapView = forwardRef<SVGSVGElement | null, { markdown: string }>(function MindMapView({ markdown }, ref) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // 画像に保存するとき、外から図(SVG)を受け取れるようにする
  useImperativeHandle<SVGSVGElement | null, SVGSVGElement | null>(ref, () => svgRef.current, []);
  const markmapRef = useRef<Markmap | null>(null);
  const rootRef = useRef<ReturnType<typeof transformer.transform>["root"] | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    markmapRef.current = Markmap.create(svgRef.current);
    // 非表示(スマホの「インサイト」を開く前など)のときに描くと、文字の大きさが0として測られて
    // 図が極端に拡大・画面外にずれる。表示されて大きさが変わるたびに、測り直してから合わせ直す。
    const observer = new ResizeObserver(() => {
      const svg = svgRef.current;
      const mm = markmapRef.current;
      if (!svg || !mm || svg.clientWidth === 0 || svg.clientHeight === 0) return;
      if (rootRef.current) void mm.setData(rootRef.current).then(() => mm.fit());
      else void mm.fit();
    });
    observer.observe(svgRef.current);
    return () => {
      observer.disconnect();
      markmapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markmapRef.current) return;
    const { root } = transformer.transform(markdown);
    rootRef.current = root;
    const svg = svgRef.current;
    if (!svg || svg.clientWidth === 0 || svg.clientHeight === 0) return; // 表示されたときに上の監視で描く
    const mm = markmapRef.current;
    void mm.setData(root).then(() => mm.fit());
  }, [markdown]);

  return (
    <div className="h-full w-full">
      <svg ref={svgRef} className="h-full w-full" />
    </div>
  );
});
