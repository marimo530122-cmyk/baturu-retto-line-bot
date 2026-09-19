import { NextRequest, NextResponse } from "next/server";
import { getClassifier } from "@/lib/classify";

export async function POST(req: NextRequest) {
  let body: { text?: string; context?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }

  try {
    const classifier = getClassifier();
    const result = await classifier.classify(text, body.context ?? []);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "classification failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
