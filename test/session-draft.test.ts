import { describe, expect, test } from "bun:test";
import { SESSION_WORK_RULES, WORK_RULES } from "../src/log/draft.ts";
import { buildSessionDraftPrompt, formatSinceTime, parseSessionDraft } from "../src/log/session-draft.ts";

describe("buildSessionDraftPrompt", () => {
  const prompt = buildSessionDraftPrompt("L1", null);

  test("starts with the request marker and asks for the SpLogDraft block with the logId", () => {
    expect(prompt.startsWith("[SP-Log-Anfrage L1]")).toBe(true);
    expect(prompt).toContain("```openui-lang\nroot = Stack([d])\nd = SpLogDraft(\"L1\", \"<Titel>\", \"<Zusammenfassung>\", \"<Stunden>\")\n```");
    expect(prompt).not.toContain("Verwende keine Tools");
    expect(prompt).toContain(SESSION_WORK_RULES);
  });

  test("allows only read-only git commands in the project directory", () => {
    expect(prompt).toContain("ausschließlich lesende Git-Befehle im Projektverzeichnis");
    for (const cmd of ["git status", "git diff --stat", "git diff --shortstat", "git log --stat / --oneline (auch mit --since/--author)", "git show --stat"]) {
      expect(prompt).toContain(cmd);
    }
    expect(prompt).toContain("Keine anderen Tools, keine schreibenden oder netzwerkbezogenen Git-Befehle (kein commit, checkout, switch, reset, stash, pull, fetch, push, merge, rebase).");
  });

  test("scopes git to changes made in this session, not commits pulled from others", () => {
    expect(prompt).toMatch(/Commits und nicht committeten Änderungen/);
    expect(prompt).toContain("Subagenten");
    expect(prompt).toMatch(/von anderen .*zählen nicht/);
  });

  test("gives the size guide and the generated-files rule", () => {
    expect(prompt).toContain("Richtwerte nach Umfang: minimal (1 Datei, wenige Zeilen) 0.5–1h, klein (1–3 Dateien) 1–3h, mittel (4–8 Dateien) 4–8h, umfangreich (8–15 Dateien) 8–16h, groß (15+ Dateien) 16–32h");
    expect(prompt).toContain("generierte Dateien (dist/, Lockfiles, Bundles) nicht mitzählen");
    expect(prompt).toContain("Tests und Doku zählen als Aufwand");
  });

  test("keeps file lists and hashes out of the card and falls back without git", () => {
    expect(prompt).toMatch(/keine Dateilisten oder Commit-Hashes/);
    expect(prompt).toMatch(/kein Git-Repository/);
  });

  test("tool calls may come first, but the answer is only the block", () => {
    expect(prompt).toMatch(/Werkzeugaufrufe davor sind erlaubt/);
    expect(prompt).toContain("Antworte ausschließlich mit genau diesem Block");
  });

  test("explains quoting: double quotes, escaped quotes and newlines, decimal dot", () => {
    expect(prompt).toContain("doppelten Anführungszeichen");
    expect(prompt).toContain('\\"');
    expect(prompt).toContain("\\n");
    expect(prompt).toMatch(/Dezimalzahl mit Punkt/);
  });

  // The block's arg names (title/summary/hours) live in the manifest; the prompt must
  // only not offer a JSON object template, which OpenChamber would show as raw JSON
  // (or, with a "title" key, as a pull request card).
  test("offers no JSON object template", () => {
    expect(prompt).not.toMatch(/\{\s*"[A-Za-z]+"\s*:/);
    expect(prompt).not.toContain('"title"');
    expect(prompt).not.toContain('"summary"');
    expect(prompt).not.toContain('"hours"');
    expect(prompt).not.toContain("JSON");
  });

  test("session rules keep the meaning of WORK_RULES with the German block fields", () => {
    expect(SESSION_WORK_RULES).toBe(WORK_RULES.replaceAll("summary", "Zusammenfassung").replaceAll("hours", "Stunden"));
  });

  test("without a saved log the whole session counts", () => {
    expect(prompt).toContain("die ganze Session");
    expect(prompt).not.toContain("seit der letzten");
    expect(prompt).not.toContain("Berücksichtige nur Arbeit nach");
  });

  test("after a saved session draft only work after that request counts", () => {
    const p = buildSessionDraftPrompt("L2", "L1");
    expect(p).toContain("Berücksichtige nur Arbeit nach der Anfrage [SP-Log-Anfrage L1]");
    expect(p).not.toContain("die ganze Session");
  });

  test("after a log without a request only work after the logged message counts", () => {
    const long = "Fix den Login\n" + "x".repeat(300);
    const p = buildSessionDraftPrompt("L2", null, long);
    const expected = ("Fix den Login " + "x".repeat(300)).slice(0, 200);
    expect(p).toContain(`Berücksichtige nur Arbeit nach dieser Nachricht: "${expected}"`);
    expect(p).not.toContain("x".repeat(201));
    expect(p).not.toContain("die ganze Session");
  });
});

describe("parseSessionDraft: SpLogDraft block", () => {
  test("happy path inside an openui-lang fence", () => {
    const text = '```openui-lang\nroot = Stack([d])\nd = SpLogDraft("L1", "Login repariert", "Fix für den Login.", "1.5")\n```';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: "Login repariert", summary: "Fix für den Login.", hours: 1.5 });
  });

  test("outside a fence, whitespace and newlines between args", () => {
    const text = 'd = SpLogDraft(\n  "L1" ,\n  "Export",\n\t"CSV gebaut." ,  "3"\n)';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: "Export", summary: "CSV gebaut.", hours: 3 });
  });

  test("escaped quotes, newlines and unicode escapes", () => {
    const text = 'd = SpLogDraft("L1", "Der \\"Fix\\"", "Zeile 1\\n- Punkt \\u00e4\\\\", "2")';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: 'Der "Fix"', summary: "Zeile 1\n- Punkt ä\\", hours: 2 });
  });

  test("German comma hours", () => {
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S", "1,5")', "L1")).toEqual({ title: "T", summary: "S", hours: 1.5 });
  });

  test("invalid hours keep the draft with hours null", () => {
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S", "viel")', "L1")).toEqual({ title: "T", summary: "S", hours: null });
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S", "101")', "L1")).toEqual({ title: "T", summary: "S", hours: null });
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S", "36")', "L1")).toEqual({ title: "T", summary: "S", hours: 36 });
  });

  test("single quotes are accepted", () => {
    expect(parseSessionDraft("SpLogDraft('L1', 'T', 'It\\'s', '0.5')", "L1")).toEqual({ title: "T", summary: "It's", hours: 0.5 });
  });

  test("wrong logId gives null", () => {
    expect(parseSessionDraft('SpLogDraft("L2", "T", "S", "1")', "L1")).toBeNull();
  });

  test("the call with the matching logId wins among several", () => {
    const text = 'SpLogDraft("L0", "Alt", "S", "1")\nSpLogDraft("L1", "Neu", "S", "2")';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: "Neu", summary: "S", hours: 2 });
  });

  test("malformed block gives null", () => {
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S")', "L1")).toBeNull();
    expect(parseSessionDraft('SpLogDraft("L1", "T", "unterminated, "1")', "L1")).toBeNull();
    expect(parseSessionDraft('SpLogDraft("L1", T, "S", "1")', "L1")).toBeNull();
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S", "1", "x")', "L1")).toBeNull();
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S", "1"', "L1")).toBeNull();
    expect(parseSessionDraft('SpLogDraft("L1", "T\\q", "S", "1")', "L1")).toBeNull();
  });

  test("without a block the JSON fallback still works", () => {
    expect(parseSessionDraft('{"logId":"L1","titel":"X","zusammenfassung":"S","stunden":1}', "L1")).toEqual({ title: "X", summary: "S", hours: 1 });
  });
});

describe("parseSessionDraft: JSON fallback", () => {
  test("German keys", () => {
    const text = '{"logId":"L1","titel":"Login repariert","zusammenfassung":"Fix.","stunden":2}';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: "Login repariert", summary: "Fix.", hours: 2 });
  });

  test("German keys: invalid stunden and wrong logId", () => {
    expect(parseSessionDraft('{"logId":"L1","titel":"X","zusammenfassung":"S","stunden":101}', "L1")).toEqual({
      title: "X",
      summary: "S",
      hours: null,
    });
    expect(parseSessionDraft('{"logId":"L2","titel":"X","zusammenfassung":"S","stunden":1}', "L1")).toBeNull();
  });

  test("plain", () => {
    const text = '{"logId":"L1","title":"Login repariert","summary":"Fix.","hours":2}';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: "Login repariert", summary: "Fix.", hours: 2 });
  });

  test("fenced", () => {
    const text = 'Hier ist der Eintrag:\n```json\n{"logId":"L1","title":"Export","summary":"CSV-Export gebaut.","hours":3.5}\n```';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: "Export", summary: "CSV-Export gebaut.", hours: 3.5 });
  });

  test("picks the object with the matching logId among other JSON", () => {
    const text =
      'Vorher: {"foo":1} und eine alte Antwort {"logId":"L0","title":"Alt","summary":"","hours":1}\n' +
      '{"logId":"L1","title":"Neu {mit Klammer}","summary":"a \\"}\\" b","hours":1}';
    expect(parseSessionDraft(text, "L1")).toEqual({ title: "Neu {mit Klammer}", summary: 'a "}" b', hours: 1 });
  });

  test("wrong logId", () => {
    expect(parseSessionDraft('{"logId":"L2","title":"X","summary":"","hours":1}', "L1")).toBeNull();
    expect(parseSessionDraft("kein JSON", "L1")).toBeNull();
  });

  test("invalid hours", () => {
    expect(parseSessionDraft('{"logId":"L1","title":"X","summary":"S","hours":101}', "L1")).toEqual({
      title: "X",
      summary: "S",
      hours: null,
    });
  });
});

describe("multi-commit estimate", () => {
  const prompt = buildSessionDraftPrompt("L1", null);

  test("asks to consider all commits since the boundary plus uncommitted changes", () => {
    expect(prompt).toContain("Eine Aufgabe besteht oft aus mehreren Commits");
    expect(prompt).toContain("betrachte alle Commits dieser Session seit der Grenze (nicht nur den letzten) plus nicht committete Änderungen");
    expect(prompt).toContain("git log --since=<Zeitpunkt> --stat");
    expect(prompt).toContain("git diff --stat <ältester Commit>^..HEAD");
    expect(prompt).toContain("eine mehrfach geänderte Datei zählt nur einmal");
    expect(prompt).toContain("Schätze den Gesamtumfang, nicht pro Commit");
    expect(prompt).toContain("das Ergebnis der Aufgabe als Ganzes, nicht Commit für Commit");
  });

  test("keeps the allowed/forbidden command lists and the no-hashes rule", () => {
    expect(prompt).toContain("git log --stat / --oneline (auch mit --since/--author)");
    expect(prompt).toContain("(kein commit, checkout, switch, reset, stash, pull, fetch, push, merge, rebase)");
    expect(prompt).toMatch(/keine Dateilisten oder Commit-Hashes/);
  });

  test("without sinceTime there is no boundary time", () => {
    expect(prompt).not.toContain("Zeitpunkt der Grenze");
  });

  test("with sinceTime the scope line names the boundary in ISO 8601 with local offset", () => {
    const at = Date.UTC(2026, 10, 17, 18, 43);
    const p = buildSessionDraftPrompt("L2", "L1", null, at, 60);
    const scopeLine = p.split("\n")[1]!;
    expect(scopeLine).toContain("Berücksichtige nur Arbeit nach der Anfrage [SP-Log-Anfrage L1]");
    expect(scopeLine).toContain("Zeitpunkt der Grenze: 2026-11-17T19:43:00+01:00 (für git log --since).");
  });
});

describe("formatSinceTime", () => {
  const at = Date.UTC(2026, 10, 17, 18, 43, 5);
  test("positive offset", () => expect(formatSinceTime(at, 60)).toBe("2026-11-17T19:43:05+01:00"));
  test("negative half-hour offset crossing the day", () => expect(formatSinceTime(Date.UTC(2026, 0, 1, 2, 0), -210)).toBe("2025-12-31T22:30:00-03:30"));
  test("zero offset", () => expect(formatSinceTime(at, 0)).toBe("2026-11-17T18:43:05+00:00"));
  test("defaults to the local offset", () => {
    const off = -new Date(at).getTimezoneOffset();
    expect(formatSinceTime(at)).toBe(formatSinceTime(at, off));
  });
});
