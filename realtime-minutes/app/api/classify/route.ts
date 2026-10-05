import { NextRequest, NextResponse } from "next/server";
import { getClassifier } from "@/lib/classify";
import { isRateLimited } from "@/lib/rateLimit";
import { Mode } from "@/lib/types";

const VALID_MODES: Mode[] = ["meeting", "karte"];

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

  let body: { text?: string; context?: string[]; mode?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  const mode: Mode = VALID_MODES.includes(body.mode as Mode) ? (body.mode as Mode) : "meeting";

  try {
    const classifier = getClassifier();
    const result = await classifier.classify(text, body.context ?? [], mode);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "classification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
