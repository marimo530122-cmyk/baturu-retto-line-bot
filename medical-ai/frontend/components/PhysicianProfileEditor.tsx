"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export default function PhysicianProfileEditor() {
  const [open, setOpen] = useState(false);
  const [styleNotes, setStyleNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.getPhysicianProfile().then((p) => {
      setStyleNotes(p.style_notes);
      setLoaded(true);
    });
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      await api.updatePhysicianProfile(styleNotes);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between text-sm font-semibold"
      >
        <span>医師プロファイル（文体・重視ポイント）{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="mt-3">
          <p className="text-xs text-gray-400 mb-2">
            ここに記載した内容と、この医師が過去に確定させたカルテの実例が、アンビエントスクライブの
            ライブプレビュー生成時に文体の参考として自動的に使われます（内容自体は今回の会話のみに基づきます）。
          </p>
          <textarea
            value={styleNotes}
            onChange={(e) => setStyleNotes(e.target.value)}
            disabled={!loaded}
            rows={3}
            placeholder="例: 断定的な言い切り口調。専門用語は使うが、患者にも分かるよう一言補足を添える。"
            className="w-full border border-gray-300 rounded-md text-sm p-2"
          />
          <button
            onClick={handleSave}
            disabled={saving || !loaded}
            className="mt-2 bg-clinic-primary text-white text-sm font-medium px-3 py-1.5 rounded-md disabled:opacity-50"
          >
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      )}
    </div>
  );
}
