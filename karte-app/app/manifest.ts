import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "通院カルテ",
    short_name: "通院カルテ",
    description: "通院の会話を音声で自動記録し、症状・診断・処方のカルテに整理するツール",
    start_url: "/",
    display: "standalone",
    background_color: "#fff1f2",
    theme_color: "#be123c",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
