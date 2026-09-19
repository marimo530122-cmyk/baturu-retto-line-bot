"use client";

import { useEffect, useRef } from "react";
import { Transformer } from "markmap-lib";
import { Markmap } from "markmap-view";

const transformer = new Transformer();

export function MindMapView({ markdown }: { markdown: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const markmapRef = useRef<Markmap | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    markmapRef.current = Markmap.create(svgRef.current);
    return () => {
      markmapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!markmapRef.current) return;
    const { root } = transformer.transform(markdown);
    markmapRef.current.setData(root);
    markmapRef.current.fit();
  }, [markdown]);

  return (
    <div className="h-full w-full">
      <svg ref={svgRef} className="h-full w-full" />
    </div>
  );
}
