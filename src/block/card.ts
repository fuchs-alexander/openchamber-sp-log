import { parseHoursText } from "../log/draft.ts";

export type DraftCard = { title: string; badge: string; summary: string; footer: string };

const MAX_TITLE_CHARS = 200;
const MAX_SUMMARY_CHARS = 4000;
export const CARD_FOOTER = "SP-Log-Entwurf · wird über Dialog oder Work Status gespeichert";

/** What the SpLogDraft card shows for the (model-written, untrusted) block arguments. */
export function describeDraftCard(args: Partial<Record<string, string>>): DraftCard {
  const title = (typeof args.title === "string" ? args.title.trim() : "").slice(0, MAX_TITLE_CHARS);
  const summary = (typeof args.summary === "string" ? args.summary.trim() : "").slice(0, MAX_SUMMARY_CHARS);
  const hours = typeof args.hours === "string" ? parseHoursText(args.hours) : null;
  const badge = hours === null ? "Aufwand unklar" : `≈ ${String(Math.round(hours * 100) / 100).replace(".", ",")} h`;
  return { title: title || "Ohne Titel", badge, summary, footer: CARD_FOOTER };
}
