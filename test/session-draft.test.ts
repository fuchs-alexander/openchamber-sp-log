import { describe, expect, test } from "bun:test";
import { WORK_RULES } from "../src/log/draft.ts";
import { buildSessionDraftPrompt, parseSessionDraft } from "../src/log/session-draft.ts";

describe("buildSessionDraftPrompt", () => {
  const prompt = buildSessionDraftPrompt("L1");

  test("starts with the request marker and asks for the JSON with the logId", () => {
    expect(prompt.startsWith("[SP-Log-Anfrage L1]")).toBe(true);
    expect(prompt).toContain('"logId":"L1"');
    expect(prompt).toContain("Verwende keine Tools.");
  });

  test("limits the work to the time since the last request and includes the rules", () => {
    expect(prompt).toContain("seit der letzten [SP-Log-Anfrage");
    expect(prompt).toContain(WORK_RULES);
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
