"use client";

import { forwardRef } from "react";
import type { FishboneData } from "@/lib/fishbone";

// 画像に書き出しても同じ見た目になるよう、色や文字はCSSクラスではなく属性で直接指定する
const FONT = "'Hiragino Sans', 'Noto Sans JP', 'Yu Gothic', sans-serif";
const COLORS = ["#e11d48", "#7c3aed", "#d97706", "#0284c7", "#059669", "#4f46e5"];
const BONE_SPACING = 300;
const ITEM_HEIGHT = 24;
const HEAD_WIDTH = 170;
const MARGIN = 24;
const TOP = 36; // タイトルの下から骨を始める

function wrap(text: string, perLine: number, maxLines: number): string[] {
  const lines: string[] = [];
  for (let i = 0; i < text.length && lines.length < maxLines; i += perLine) lines.push(text.slice(i, i + perLine));
  if (text.length > perLine * maxLines) lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, perLine - 1)}…`;
  return lines;
}

export const FishboneView = forwardRef<SVGSVGElement, { data: FishboneData }>(function FishboneView({ data }, ref) {
  const bones = data.bones;
  const columns = Math.max(1, Math.ceil(bones.length / 2));
  const maxItems = Math.max(1, ...bones.map((b) => b.items.length));
  const sideHeight = 56 + maxItems * ITEM_HEIGHT;
  const height = TOP + sideHeight * 2 + 40;
  const spineY = TOP + sideHeight + 20;
  const headX = MARGIN + columns * BONE_SPACING;
  const width = headX + HEAD_WIDTH + MARGIN;
  const headLines = wrap(data.head, 9, 3);

  return (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} fontFamily={FONT}>
      <rect x={0} y={0} width={width} height={height} fill="#ffffff" />
      <text x={MARGIN} y={18} fontSize={12} fill="#6b7280">{data.title}</text>

      {/* 背骨 */}
      <line x1={MARGIN} y1={spineY} x2={headX} y2={spineY} stroke="#111827" strokeWidth={4} strokeLinecap="round" />
      <polygon points={`${headX - 4},${spineY - 9} ${headX + 8},${spineY} ${headX - 4},${spineY + 9}`} fill="#111827" />

      {/* 頭(結論) */}
      <rect x={headX + 8} y={spineY - 36} width={HEAD_WIDTH - 8} height={72} rx={12} fill="#111827" />
      {headLines.map((line, i) => (
        <text
          key={i}
          x={headX + 8 + (HEAD_WIDTH - 8) / 2}
          y={spineY - (headLines.length - 1) * 9 + i * 18 + 5}
          fontSize={14}
          fontWeight={700}
          fill="#ffffff"
          textAnchor="middle"
        >
          {line}
        </text>
      ))}

      {bones.length === 0 && (
        <text x={MARGIN} y={spineY - 14} fontSize={13} fill="#9ca3af">まだ図にできる内容がありません</text>
      )}

      {/* 骨(要因) */}
      {bones.map((bone, i) => {
        const top = i % 2 === 0;
        const column = Math.floor(i / 2);
        const color = COLORS[i % COLORS.length];
        const x0 = MARGIN + (column + 1) * BONE_SPACING - 16; // 背骨との接点
        const x1 = x0 - 80; // 骨の先
        const y1 = top ? TOP + 44 : height - 44;
        const xAt = (y: number) => x1 + ((x0 - x1) * (y - y1)) / (spineY - y1);
        return (
          <g key={bone.label}>
            <line x1={x1} y1={y1} x2={x0} y2={spineY} stroke={color} strokeWidth={3} strokeLinecap="round" />
            <rect x={x1 - 70} y={top ? y1 - 30 : y1 + 6} width={140} height={24} rx={12} fill={color} />
            <text x={x1} y={top ? y1 - 13 : y1 + 23} fontSize={13} fontWeight={700} fill="#ffffff" textAnchor="middle">
              {bone.label}
            </text>
            {bone.items.map((item, k) => {
              const y = top ? y1 + 22 + k * ITEM_HEIGHT : y1 - 22 - k * ITEM_HEIGHT;
              const x = xAt(y);
              return (
                <g key={k}>
                  <line x1={x - 14} y1={y} x2={x} y2={y} stroke={color} strokeWidth={1.5} />
                  <text x={x - 18} y={y + 4} fontSize={12} fill="#111827" textAnchor="end">
                    {item}
                  </text>
                </g>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
});
