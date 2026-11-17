import type { Binding } from "../panel/store.ts";

const HINT = "Loggen: … → Export → Nach Super Productivity loggen";

const pad = (n: number): string => String(n).padStart(2, "0");

/** TT.MM.JJJJ in local time. */
function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** "≈ 1,5 h": at most two decimals, German decimal comma. */
function formatHours(hours: number): string {
  return `≈ ${String(Math.round(hours * 100) / 100).replace(".", ",")} h`;
}

/**
 * The lines the SP Log work status shows for a session's binding.
 * `now` is the moment the section is drawn (kept for date-relative wording).
 */
export function describeBinding(binding: Binding | null, now: Date): { lines: string[] } {
  void now;
  if (!binding) return { lines: ["Noch nicht geloggt", HINT] };
  const lines: string[] = [];
  if (binding.taskTitle) {
    lines.push(`Geloggt in „${binding.taskTitle}“${binding.projectTitle ? ` (${binding.projectTitle})` : ""}`);
  } else {
    lines.push("Gebunden an SP-Aufgabe");
  }
  const logs = binding.logs;
  if (!logs) {
    lines.push("Logs: unbekannt (vor 0.3.0)");
  } else {
    const sum = logs.reduce((s, l) => s + l.hours, 0);
    lines.push(`${logs.length} ${logs.length === 1 ? "Log" : "Logs"} · Summe ${formatHours(sum)}`);
    const last = logs[logs.length - 1];
    if (last) lines.push(`Letzter Log: ${formatDate(last.at)} · ${formatHours(last.hours)}`);
  }
  lines.push(HINT);
  return { lines };
}

/** The status button that starts logging the current session. */
export function logButtonLabel(binding: Binding | null): string {
  return binding ? "Nachloggen" : "Jetzt loggen";
}
