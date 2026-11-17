import { parseHoursText, type Draft } from "../log/draft.ts";
import type { Binding, SavedLog } from "../panel/store.ts";

export type DraftCard = { title: string; badge: string; summary: string; footer: string };

const MAX_TITLE_CHARS = 200;
const MAX_SUMMARY_CHARS = 4000;
export const CARD_FOOTER = "SP-Log-Entwurf · wird über Dialog oder Work Status gespeichert";

/** What the SpLogDraft card shows for the (model-written, untrusted) block arguments. */
export function describeDraftCard(args: Partial<Record<string, string>>): DraftCard {
  const title = (typeof args.title === "string" ? args.title.trim() : "").slice(0, MAX_TITLE_CHARS);
  const summary = (typeof args.summary === "string" ? args.summary.trim() : "").slice(0, MAX_SUMMARY_CHARS);
  const hours = typeof args.hours === "string" ? parseHoursText(args.hours) : null;
  const badge = hours === null ? "Aufwand unklar" : `≈ ${formatHours(hours)} h`;
  return { title: title || "Ohne Titel", badge, summary, footer: CARD_FOOTER };
}

/** The card's logId names storage keys: only ids like the flow makes (UUIDs, `log-1`). */
export function isCardLogId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(value);
}

/** The editable draft from the (untrusted) block arguments. */
export function draftFromArgs(args: Partial<Record<string, string>>): Draft {
  const title = (typeof args.title === "string" ? args.title.trim() : "").slice(0, MAX_TITLE_CHARS);
  const summary = (typeof args.summary === "string" ? args.summary.trim() : "").slice(0, MAX_SUMMARY_CHARS);
  const hours = typeof args.hours === "string" ? parseHoursText(args.hours) : null;
  return { title, summary, hours };
}

export type CardState = { kind: "saved"; taskTitle: string; hours: number | null } | { kind: "stale" } | { kind: "open" };

/**
 * What the card shows instead of (or as) the form:
 * 1. `saved:<logId>` exists → saved (task and hours from the marker).
 * 2. The binding's lastLogId is this card (a save from before 0.7.0) → saved (from the binding).
 * 3. The binding's last log was saved after the card was created → stale („Veraltet“).
 *    Created = when the session-draft request was sent (`seen:<logId>`, written by the flow),
 *    or else when a card frame first showed it. Unknown creation or no log time → open.
 * 4. Otherwise → open (the form).
 */
export function decideCardState(input: {
  logId: string;
  saved: SavedLog | null;
  binding: Binding | null;
  createdAt: number | null;
}): CardState {
  const { logId, saved, binding, createdAt } = input;
  if (saved) return { kind: "saved", taskTitle: saved.taskTitle, hours: saved.hours };
  if (!binding) return { kind: "open" };
  const last = binding.logs?.at(-1) ?? null;
  if (binding.lastLogId === logId) return { kind: "saved", taskTitle: binding.taskTitle ?? "", hours: last?.hours ?? null };
  if (last && createdAt !== null && last.at > createdAt) return { kind: "stale" };
  return { kind: "open" };
}

export function formatHours(hours: number): string {
  return String(Math.round(hours * 100) / 100).replace(".", ",");
}

/** „Gespeichert ✓ · <Aufgabe> · ≈ X h“ */
export function savedLine(state: { taskTitle: string; hours: number | null }): string {
  const parts = ["Gespeichert ✓"];
  if (state.taskTitle) parts.push(state.taskTitle);
  if (state.hours !== null) parts.push(`≈ ${formatHours(state.hours)} h`);
  return parts.join(" · ");
}

export const STALE_LINE = "Veraltet – neuerer Log vorhanden";
