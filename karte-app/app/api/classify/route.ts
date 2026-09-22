import { NextRequest, NextResponse } from "next/server";
import { getClassifier } from "@/lib/classify";
import { Mode } from "@/lib/types";

const VALID_MODES: Mode[] = ["meeting", "karte"];

export async function POST(req: NextRequest) {
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
