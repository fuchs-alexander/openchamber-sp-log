import { describe, expect, test } from "bun:test";
import { WORK_RULES } from "../src/log/draft.ts";
import { buildSessionDraftPrompt, parseSessionDraft } from "../src/log/session-draft.ts";

describe("buildSessionDraftPrompt", () => {
  const prompt = buildSessionDraftPrompt("L1", null);

  test("starts with the request marker and asks for the JSON with the logId", () => {
    expect(prompt.startsWith("[SP-Log-Anfrage L1]")).toBe(true);
    expect(prompt).toContain('"logId":"L1"');
    expect(prompt).toContain("Verwende keine Tools.");
    expect(prompt).toContain(WORK_RULES);
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

describe("parseSessionDraft", () => {
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
