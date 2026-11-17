import { draftFromJson, WORK_RULES, type Draft } from "./draft.ts";

/** The message sent into the logged session, asking its own agent for the draft. */
export function buildSessionDraftPrompt(logId: string): string {
  return [
    `[SP-Log-Anfrage ${logId}]`,
    "Erstelle einen Arbeitslog-Eintrag für die Arbeit in dieser Session. Berücksichtige nur Arbeit seit der letzten [SP-Log-Anfrage …] in dieser Session (gibt es keine, die ganze Session).",
    "Verwende keine Tools.",
    "",
    WORK_RULES,
    "",
    "Antworte ausschließlich mit diesem JSON, ohne weiteren Text:",
    `{"logId":${JSON.stringify(logId)},"title":"…","summary":"…","hours":0}`,
  ].join("\n");
}

/** All top-level `{...}` spans in the text, respecting JSON strings. */
function objectSpans(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"' && depth > 0) inString = true;
    else if (c === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "}" && depth > 0) {
      depth--;
      if (depth === 0) spans.push(text.slice(start, i + 1));
    }
  }
  return spans;
}

/** The draft from the JSON object carrying `logId`; null when no such object is in the text. */
export function parseSessionDraft(text: string, logId: string): Draft | null {
  let match: Record<string, unknown> | null = null;
  for (const span of objectSpans(text)) {
    try {
      const value: unknown = JSON.parse(span);
      if (value !== null && typeof value === "object" && !Array.isArray(value)) {
        const data = value as Record<string, unknown>;
        if (data.logId === logId) match = data; // the last one wins
      }
    } catch {
      // not JSON, skip
    }
  }
  return match ? draftFromJson(match) : null;
}
