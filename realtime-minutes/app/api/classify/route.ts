import { NextRequest, NextResponse } from "next/server";
import { getClassifier } from "@/lib/classify";
import { isRateLimited } from "@/lib/rateLimit";
import { Mode } from "@/lib/types";

const VALID_MODES: Mode[] = ["meeting", "karte"];
const MAX_TEXT_LENGTH = 2000;
const MAX_CONTEXT_ITEMS = 20;

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export async function POST(req: NextRequest) {
  if (isRateLimited(getClientIp(req))) {
    return NextResponse.json(
      { error: "リクエストが多すぎます。しばらく待ってから再度お試しください。" },
      { status: 429 }
    );
  }

  let body: { text?: unknown; context?: unknown; mode?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  // 1回の発言としてありえない長さは断る(AI料金の水増し攻撃を防ぐ)
  if (text.length > MAX_TEXT_LENGTH) {
    return NextResponse.json({ error: "text is too long" }, { status: 413 });
  }
  const context = (Array.isArray(body.context) ? body.context : [])
    .filter((c): c is string => typeof c === "string")
    .slice(-MAX_CONTEXT_ITEMS)
    .map((c) => c.slice(0, MAX_TEXT_LENGTH));

  const mode: Mode = VALID_MODES.includes(body.mode as Mode) ? (body.mode as Mode) : "meeting";

  try {
    const classifier = getClassifier();
    const result = await classifier.classify(text, context, mode);
    return NextResponse.json(result);
  } catch (err) {
    // 内部のエラー文(APIキーの状態・外部APIの応答など)は画面に返さず、サーバーのログにだけ残す
    console.error("[classify]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "classification failed" }, { status: 500 });
  }
}
