import { draftFromJson, SESSION_WORK_RULES, type Draft } from "./draft.ts";

/** How much of a logged message the prompt quotes to mark where the last log ended. */
export const SINCE_HINT_MAX = 200;

function scope(sinceLogId: string | null, sinceMessageHint: string | null): string {
  if (sinceLogId) return `Berücksichtige nur Arbeit nach der Anfrage [SP-Log-Anfrage ${sinceLogId}] in dieser Session.`;
  const hint = sinceMessageHint?.replace(/\s+/g, " ").trim().slice(0, SINCE_HINT_MAX);
  if (hint) return `Berücksichtige nur Arbeit nach dieser Nachricht: "${hint}"`;
  return "Berücksichtige die ganze Session.";
}

/**
 * The message sent into the logged session, asking its own agent for the draft.
 * `sinceLogId` is the request whose draft was last saved; without it,
 * `sinceMessageHint` quotes the last logged message (a log from before session drafts).
 */
export function buildSessionDraftPrompt(logId: string, sinceLogId: string | null, sinceMessageHint: string | null = null): string {
  return [
    `[SP-Log-Anfrage ${logId}]`,
    `Erstelle einen Arbeitslog-Eintrag für die Arbeit in dieser Session. ${scope(sinceLogId, sinceMessageHint)}`,
    "Verwende keine Tools.",
    "",
    SESSION_WORK_RULES,
    "",
    "Antworte ausschließlich mit diesem JSON, ohne weiteren Text:",
    `{"logId":${JSON.stringify(logId)},"titel":"…","zusammenfassung":"…","stunden":0}`,
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
  if (!match) return null;
  // German keys as requested by the prompt; the English ones from before stay accepted.
  return draftFromJson({
    title: match.titel ?? match.title,
    summary: match.zusammenfassung ?? match.summary,
    hours: match.stunden ?? match.hours,
  });
}
