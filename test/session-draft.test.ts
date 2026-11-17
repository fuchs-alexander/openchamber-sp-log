import { describe, expect, test } from "bun:test";
import { SESSION_WORK_RULES, WORK_RULES } from "../src/log/draft.ts";
import { buildSessionDraftPrompt, parseSessionDraft } from "../src/log/session-draft.ts";

describe("buildSessionDraftPrompt", () => {
  const prompt = buildSessionDraftPrompt("L1", null);

  test("starts with the request marker and asks for the SpLogDraft block with the logId", () => {
    expect(prompt.startsWith("[SP-Log-Anfrage L1]")).toBe(true);
    expect(prompt).toContain("```openui-lang\nroot = Stack([d])\nd = SpLogDraft(\"L1\", \"<Titel>\", \"<Zusammenfassung>\", \"<Stunden>\")\n```");
    expect(prompt).toContain("Verwende keine Tools.");
    expect(prompt).toContain(SESSION_WORK_RULES);
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
    expect(parseSessionDraft('SpLogDraft("L1", "T", "S", "99")', "L1")).toEqual({ title: "T", summary: "S", hours: null });
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
    expect(parseSessionDraft('{"logId":"L1","titel":"X","zusammenfassung":"S","stunden":99}', "L1")).toEqual({
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
    expect(parseSessionDraft('{"logId":"L1","title":"X","summary":"S","hours":99}', "L1")).toEqual({
      title: "X",
      summary: "S",
      hours: null,
    });
  });
});
