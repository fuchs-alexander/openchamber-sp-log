import { describe, expect, test } from "bun:test";
import pkg from "../package.json";
import { describeDraftCard } from "../src/block/card.ts";
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
    expect(pkg.version).toBe("0.4.0");
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
    expect(parseHoursText("25")).toBeNull();
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
