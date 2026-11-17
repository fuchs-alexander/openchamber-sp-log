import { draftFromJson, parseHoursText, SESSION_WORK_RULES, type Draft } from "./draft.ts";

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
    "Antworte ausschließlich mit genau diesem Block, ohne weiteren Text, und ersetze die Platzhalter <Titel>, <Zusammenfassung> und <Stunden>:",
    "```openui-lang",
    "root = Stack([d])",
    `d = SpLogDraft(${JSON.stringify(logId)}, "<Titel>", "<Zusammenfassung>", "<Stunden>")`,
    "```",
    "Alle Werte stehen in doppelten Anführungszeichen. Schreibe \" im Text als \\\" und Zeilenumbrüche als \\n.",
    "Stunden als Dezimalzahl mit Punkt, z. B. \"1.5\".",
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

const BLOCK_CALL = /\bSpLogDraft\s*\(/g;
const SIMPLE_ESCAPES: Record<string, string> = { '"': '"', "'": "'", "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

/**
 * The positional string arguments of a call whose `(` ends before `start`, up to its `)`.
 * Strings in double (or single) quotes with JSON escapes; null when anything else appears.
 */
function callArgs(text: string, start: number): string[] | null {
  const args: string[] = [];
  let i = start;
  const skipSpace = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  skipSpace();
  if (text[i] === ")") return args;
  for (;;) {
    skipSpace();
    const quote = text[i];
    if (quote !== '"' && quote !== "'") return null;
    i++;
    let value = "";
    for (;;) {
      if (i >= text.length) return null;
      const c = text[i]!;
      if (c === quote) {
        i++;
        break;
      }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === undefined) return null;
        if (e === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) return null;
          value += String.fromCharCode(parseInt(hex, 16));
          i += 6;
          continue;
        }
        const mapped = SIMPLE_ESCAPES[e];
        if (mapped === undefined) return null;
        value += mapped;
        i += 2;
        continue;
      }
      value += c; // a raw newline is tolerated
      i++;
    }
    args.push(value);
    skipSpace();
    if (text[i] === ",") {
      i++;
      continue;
    }
    if (text[i] === ")") return args;
    return null;
  }
}

/** The draft from the last well-formed `SpLogDraft(logId, title, summary, hours)` call for `logId`. */
function blockDraft(text: string, logId: string): Draft | null {
  let match: string[] | null = null;
  for (const m of text.matchAll(BLOCK_CALL)) {
    const args = callArgs(text, m.index + m[0].length);
    if (args && args.length === 4 && args[0] === logId) match = args;
  }
  if (!match) return null;
  return draftFromJson({ title: match[1], summary: match[2], hours: parseHoursText(match[3]!) });
}

/**
 * The draft the session answered for `logId`: its `SpLogDraft` block, else (an older
 * prompt) the JSON object carrying `logId`; null when neither is in the text.
 */
export function parseSessionDraft(text: string, logId: string): Draft | null {
  const fromBlock = blockDraft(text, logId);
  if (fromBlock) return fromBlock;
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
