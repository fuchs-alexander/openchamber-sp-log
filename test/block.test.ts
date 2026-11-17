import { describe, expect, test } from "bun:test";
import pkg from "../package.json";
import { decideCardState, describeDraftCard, draftFromArgs, isCardLogId } from "../src/block/card.ts";
import type { Binding } from "../src/panel/store.ts";
import { parseHoursText } from "../src/log/draft.ts";

describe("manifest", () => {
  test("declares the SpLogDraft block", () => {
    const blocks = (pkg.openchamber.contributes as Record<string, unknown>).blocks as Array<Record<string, unknown>>;
    expect(blocks).toHaveLength(1);
    const b = blocks[0]!;
    expect(b.name).toBe("SpLogDraft");
    expect(b.args).toEqual(["logId", "title", "summary", "hours"]);
    expect(b.entry).toBe("dist/block/index.html");
    expect((b.description as string).length).toBeLessThanOrEqual(120);
    expect(pkg.version).toBe("0.7.1");
  });
});

describe("parseHoursText", () => {
  test("dot, comma, whitespace", () => {
    expect(parseHoursText("1.5")).toBe(1.5);
    expect(parseHoursText(" 1,5 ")).toBe(1.5);
    expect(parseHoursText("0")).toBe(0);
    expect(parseHoursText("2h")).toBeNull();
    expect(parseHoursText("")).toBeNull();
    expect(parseHoursText("-1")).toBeNull();
    expect(parseHoursText("25")).toBe(25);
    expect(parseHoursText("100")).toBe(100);
    expect(parseHoursText("100.5")).toBeNull();
    expect(parseHoursText("1e1")).toBeNull();
  });
});

describe("describeDraftCard", () => {
  test("formats hours with a German comma", () => {
    expect(describeDraftCard({ logId: "L1", title: " Login ", summary: "a\nb", hours: "1.5" })).toEqual({
      title: "Login",
      badge: "≈ 1,5 h",
      summary: "a\nb",
      footer: "SP-Log-Entwurf · wird über Dialog oder Work Status gespeichert",
    });
    expect(describeDraftCard({ title: "T", summary: "", hours: "2" }).badge).toBe("≈ 2 h");
  });

  test("invalid or missing args", () => {
    expect(describeDraftCard({ title: "T", summary: "S", hours: "viel" }).badge).toBe("Aufwand unklar");
    expect(describeDraftCard({}).badge).toBe("Aufwand unklar");
    expect(describeDraftCard({}).title).toBe("Ohne Titel");
    expect(describeDraftCard({ title: "x".repeat(500) }).title.length).toBeLessThanOrEqual(200);
  });
});

const B = (lastLogId: string | null, lastAt: number | null): Binding => ({
  taskId: "t1",
  lastMessageId: null,
  lastCreatedAt: null,
  lastLogId,
  taskTitle: "Login-Bug",
  projectTitle: null,
  logs: lastAt === null ? null : [{ at: lastAt - 10, hours: 0.5 }, { at: lastAt, hours: 2 }],
});

describe("decideCardState", () => {
  test("a saved marker wins: saved with its task and hours", () => {
    expect(decideCardState({ logId: "L1", saved: { taskTitle: "Doku", hours: 1.5, at: 9 }, binding: B("L2", 500), createdAt: 1 })).toEqual({
      kind: "saved",
      taskTitle: "Doku",
      hours: 1.5,
    });
  });

  test("binding's lastLogId is this card (saved before 0.7.0): saved from the binding", () => {
    expect(decideCardState({ logId: "L1", saved: null, binding: B("L1", 500), createdAt: 100 })).toEqual({ kind: "saved", taskTitle: "Login-Bug", hours: 2 });
  });

  test("another log was saved after the card was created: stale", () => {
    expect(decideCardState({ logId: "L1", saved: null, binding: B("L2", 500), createdAt: 100 })).toEqual({ kind: "stale" });
    // a Small Model log (lastLogId null) saved later also makes it stale
    expect(decideCardState({ logId: "L1", saved: null, binding: B(null, 500), createdAt: 100 })).toEqual({ kind: "stale" });
  });

  test("the last log is older than the card: open", () => {
    expect(decideCardState({ logId: "L1", saved: null, binding: B("L0", 50), createdAt: 100 })).toEqual({ kind: "open" });
  });

  test("no binding, no log times or unknown creation: open", () => {
    expect(decideCardState({ logId: "L1", saved: null, binding: null, createdAt: 100 })).toEqual({ kind: "open" });
    expect(decideCardState({ logId: "L1", saved: null, binding: B("L0", null), createdAt: 100 })).toEqual({ kind: "open" });
    expect(decideCardState({ logId: "L1", saved: null, binding: B("L0", 500), createdAt: null })).toEqual({ kind: "open" });
  });
});

describe("card args", () => {
  test("isCardLogId accepts ids the flow makes and refuses anything else", () => {
    expect(isCardLogId("3f2a9c1e-0b7d-4e6a-9c1f-2d3e4f5a6b7c")).toBe(true);
    expect(isCardLogId("log-1")).toBe(true);
    expect(isCardLogId("")).toBe(false);
    expect(isCardLogId(undefined)).toBe(false);
    expect(isCardLogId("a b")).toBe(false);
    expect(isCardLogId("../x")).toBe(false);
    expect(isCardLogId("x".repeat(81))).toBe(false);
  });

  test("draftFromArgs trims, clamps and parses the hours", () => {
    expect(draftFromArgs({ title: " T ", summary: " S ", hours: "1,5" })).toEqual({ title: "T", summary: "S", hours: 1.5 });
    expect(draftFromArgs({ title: "x".repeat(300), hours: "zwei" })).toEqual({ title: "x".repeat(200), summary: "", hours: null });
  });
});
