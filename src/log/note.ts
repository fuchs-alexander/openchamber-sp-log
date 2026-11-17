function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** One decimal, German decimal comma, without a trailing ",0". */
function formatHours(hours: number): string {
  const rounded = Math.round(hours * 10) / 10;
  return (Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)).replace(".", ",");
}

export function formatNoteBlock(d: {
  date: Date;
  title: string;
  hours: number;
  summary: string;
  sessionTitle: string;
}): string {
  return (
    `### ${formatLocalDate(d.date)} · ${d.title} · ≈ ${formatHours(d.hours)} h\n` +
    `${d.summary}\n\n<sub>OpenChamber: ${d.sessionTitle}</sub>`
  );
}
