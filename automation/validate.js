const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const BASIC_INFO_FIELDS = ["visit_date", "department", "doctor", "companion"];
const REQUIRED_STRING_FIELDS = ["chief_complaint", "diagnosis"];
const OPTIONAL_STRING_FIELDS = ["readings_trend", "treatment_change_reason", "side_effects_and_allergies", "notes"];
const STRING_ARRAY_FIELDS = ["treatment", "restrictions", "red_flags"];

function validateTaskList(data, field, errors) {
  if (!Array.isArray(data?.[field])) {
    errors.push(`${field} is not an array`);
    return;
  }
  data[field].forEach((item, i) => {
    if (typeof item?.task !== "string" || item.task.trim().length === 0) {
      errors.push(`${field}[${i}].task is missing or empty`);
    }
    if (typeof item?.owner !== "string") {
      errors.push(`${field}[${i}].owner is not a string`);
    }
    if (typeof item?.due !== "string" || (item.due !== "" && !DATE_RE.test(item.due))) {
      errors.push(`${field}[${i}].due is not empty and not YYYY-MM-DD`);
    }
  });
}

/**
 * Layer 1: structural validation. Pure JS, no network, always enforced.
 * Returns { ok, errors } — never throws.
 */
export function validateStructure(data) {
  const errors = [];

  if (typeof data?.basic_info !== "object" || data.basic_info === null || Array.isArray(data.basic_info)) {
    errors.push("basic_info is not an object");
  } else {
    BASIC_INFO_FIELDS.forEach((field) => {
      if (typeof data.basic_info[field] !== "string") errors.push(`basic_info.${field} is not a string`);
    });
    if (data.basic_info.visit_date && !DATE_RE.test(data.basic_info.visit_date)) {
      errors.push("basic_info.visit_date is not empty and not YYYY-MM-DD");
    }
  }

  REQUIRED_STRING_FIELDS.forEach((field) => {
    if (typeof data?.[field] !== "string" || data[field].trim().length === 0) {
      errors.push(`${field} is missing or empty`);
    }
  });
  OPTIONAL_STRING_FIELDS.forEach((field) => {
    if (typeof data?.[field] !== "string") errors.push(`${field} is not a string`);
  });
  STRING_ARRAY_FIELDS.forEach((field) => {
    if (!Array.isArray(data?.[field])) {
      errors.push(`${field} is not an array`);
    } else if (data[field].some((v) => typeof v !== "string")) {
      errors.push(`${field} contains a non-string entry`);
    }
  });

  if (!Array.isArray(data?.qa_log)) {
    errors.push("qa_log is not an array");
  } else {
    data.qa_log.forEach((qa, i) => {
      if (typeof qa?.question !== "string") errors.push(`qa_log[${i}].question is not a string`);
      if (typeof qa?.answer !== "string") errors.push(`qa_log[${i}].answer is not a string`);
    });
  }

  validateTaskList(data, "homework", errors);

  if (typeof data?.next_visit !== "object" || data.next_visit === null || Array.isArray(data.next_visit)) {
    errors.push("next_visit is not an object");
  } else {
    ["date", "preparation", "cost_estimate"].forEach((field) => {
      if (typeof data.next_visit[field] !== "string") errors.push(`next_visit.${field} is not a string`);
    });
    if (data.next_visit.date && !DATE_RE.test(data.next_visit.date)) {
      errors.push("next_visit.date is not empty and not YYYY-MM-DD");
    }
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
          "Does this extracted hospital-visit karte (chief complaint/diagnosis/treatment/" +
          "red flags/homework/etc.) faithfully and completely represent the source memo, " +
          "with no fabricated facts, and no invented red-flag warnings not present in the memo?",
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
