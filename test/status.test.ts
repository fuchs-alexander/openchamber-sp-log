import { describe, expect, test } from "bun:test";
import { describeBinding, logButtonLabel } from "../src/status/describe.ts";

const NOW = new Date(2026, 10, 17, 15);
const HINT = "Loggen: … → Export → Nach Super Productivity loggen";
const base = { taskId: "t1", lastMessageId: "m1", lastCreatedAt: 1, lastLogId: null };

describe("describeBinding", () => {
  test("no binding: not logged yet", () => {
    expect(describeBinding(null, NOW).lines).toEqual(["Noch nicht geloggt", HINT]);
  });

  test("binding with logs: task, project, count, last log and sum", () => {
    const lines = describeBinding(
      {
        ...base,
        taskTitle: "Login-Bug",
        projectTitle: "Kunde A",
        logs: [
          { at: new Date(2026, 10, 3, 9).getTime(), hours: 1.25 },
          { at: new Date(2026, 10, 17, 11).getTime(), hours: 0.5 },
        ],
      },
      NOW,
    ).lines;
    expect(lines).toEqual([
      "Geloggt in „Login-Bug“ (Kunde A)",
      "2 Logs · Summe ≈ 1,75 h",
      "Letzter Log: 17.11.2026 · ≈ 0,5 h",
      HINT,
    ]);
  });

  test("one log, whole hours, no project title", () => {
    const lines = describeBinding(
      { ...base, taskTitle: "Doku", projectTitle: null, logs: [{ at: new Date(2026, 0, 5).getTime(), hours: 2 }] },
      NOW,
    ).lines;
    expect(lines).toEqual(["Geloggt in „Doku“", "1 Log · Summe ≈ 2 h", "Letzter Log: 05.01.2026 · ≈ 2 h", HINT]);
  });

  test("sum avoids floating point noise", () => {
    const logs = [0.1, 0.2].map((hours, i) => ({ at: i, hours }));
    const lines = describeBinding({ ...base, taskTitle: "X", projectTitle: null, logs }, NOW).lines;
    expect(lines[1]).toBe("2 Logs · Summe ≈ 0,3 h");
  });

  test("old binding without logs and titles", () => {
    expect(describeBinding({ ...base, taskTitle: null, projectTitle: null, logs: null }, NOW).lines).toEqual([
      "Gebunden an SP-Aufgabe",
      "Logs: unbekannt (vor 0.3.0)",
      HINT,
    ]);
  });
});

describe("logButtonLabel", () => {
  test("no binding: Jetzt loggen; binding: Nachloggen", () => {
    expect(logButtonLabel(null)).toBe("Jetzt loggen");
    expect(logButtonLabel({ ...base, taskTitle: null, projectTitle: null, logs: null })).toBe("Nachloggen");
  });
});
