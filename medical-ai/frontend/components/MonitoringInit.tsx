"use client";

import { useEffect } from "react";
import { initMonitoring } from "@/lib/monitoring";

/** レイアウトから1度だけ呼ばれる、エラー監視の初期化トリガー。画面には何も表示しない。 */
export default function MonitoringInit() {
  useEffect(() => {
    initMonitoring();
  }, []);
  return null;
}
