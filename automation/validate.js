const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Layer 1: structural validation. Pure JS, no network, always enforced.
 * Returns { ok, errors } — never throws.
 */
export function validateStructure(data) {
  const errors = [];

  if (typeof data?.summary !== "string" || data.summary.trim().length === 0) {
    errors.push("summary is missing or empty");
  }
  if (!Array.isArray(data?.decisions)) {
    errors.push("decisions is not an array");
  } else if (data.decisions.some((d) => typeof d !== "string")) {
    errors.push("decisions contains a non-string entry");
  }
  if (!Array.isArray(data?.todos)) {
    errors.push("todos is not an array");
  } else {
    data.todos.forEach((todo, i) => {
      if (typeof todo?.task !== "string" || todo.task.trim().length === 0) {
        errors.push(`todos[${i}].task is missing or empty`);
      }
      if (typeof todo?.owner !== "string") {
        errors.push(`todos[${i}].owner is not a string`);
      }
      if (typeof todo?.due !== "string" || (todo.due !== "" && !DATE_RE.test(todo.due))) {
        errors.push(`todos[${i}].due is not empty and not YYYY-MM-DD`);
      }
    });
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Layer 2: semantic check via TypeSafe's Jev model (Noul primitive: probability
 * that the extraction faithfully represents the source text).
 *
 * UNVERIFIED: docs.typesafe.ai was unreachable while building this pipeline
 * (network egress to typesafe.ai was blocked in the build sandbox), so the
 * endpoint path and request/response shape below are a best-effort guess from
 * the typesafe-ai Claude Code skill's description of the Noul primitive
 * (instructions + criteria + state -> probability), NOT a confirmed API
 * contract. Confirm against https://docs.typesafe.ai/api.md and
 * https://docs.typesafe.ai/primitives/noul.md before depending on this in
 * production, and adjust the fetch below to match.
 *
 * Fails closed by default (JEV_FAIL_OPEN=false): any network/API/shape error
 * is treated as a failed check, so a broken safety brake blocks the pipeline
 * instead of silently letting bad data through.
 */
export async function validateWithJev(rawText, extracted) {
  const apiKey = process.env.TYPESAFE_API_KEY;
  const baseUrl = process.env.TYPESAFE_API_BASE_URL || "https://api.typesafe.ai";
  const failOpen = process.env.JEV_FAIL_OPEN === "true";

  if (!apiKey) {
    return { ok: failOpen, skipped: true, reason: "TYPESAFE_API_KEY not set" };
  }

  try {
    const res = await fetch(`${baseUrl}/v1/noul`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        instructions:
          "Does the extracted summary/decisions/todos faithfully and completely " +
          "represent the source meeting text, with no fabricated facts?",
        state: {
          source_text: rawText,
          extracted,
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Jev API returned ${res.status}: ${body.slice(0, 300)}`);
    }

    const data = await res.json();
    // Guessed response shape: a probability in [0, 1]. Adjust once confirmed.
    const probability = typeof data?.probability === "number" ? data.probability : null;
    if (probability === null) {
      throw new Error(`Unexpected Jev response shape: ${JSON.stringify(data).slice(0, 300)}`);
    }

    const threshold = Number(process.env.JEV_CONFIDENCE_THRESHOLD || 0.6);
    return { ok: probability >= threshold, probability, skipped: false };
  } catch (err) {
    return { ok: failOpen, skipped: false, error: err.message };
  }
}

/** Run both validation layers; throws on failure so callers can hard-stop the run. */
export async function validate(rawText, extracted) {
  const structural = validateStructure(extracted);
  if (!structural.ok) {
    const err = new Error(`Structural validation failed: ${structural.errors.join("; ")}`);
    err.stage = "structural";
    err.details = structural;
    throw err;
  }

  const semantic = await validateWithJev(rawText, extracted);
  if (!semantic.ok) {
    const err = new Error(
      semantic.skipped
        ? `Jev check skipped and fail-open disabled (${semantic.reason})`
        : `Jev semantic check failed: ${semantic.error || `probability ${semantic.probability} below threshold`}`
    );
    err.stage = "jev";
    err.details = semantic;
    throw err;
  }

  return { structural, semantic };
}
