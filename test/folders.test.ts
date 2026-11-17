import { describe, expect, test } from "bun:test";
import { folderIndex } from "../gateway/folders.ts";

describe("folderIndex", () => {
  test("flat folder", () => {
    const tree = [{ k: "f", id: "F1", name: "Posylka", isExpanded: true, children: [{ k: "p", id: "A" }, { k: "p", id: "B" }] }];
    expect(folderIndex(tree)).toEqual(new Map([["A", "Posylka"], ["B", "Posylka"]]));
  });

  test("nested folders are joined with ' / '", () => {
    const tree = [
      {
        k: "f",
        id: "F1",
        name: "Kunden",
        children: [{ k: "f", id: "F2", name: "Möbel", children: [{ k: "p", id: "A" }] }, { k: "p", id: "B" }],
      },
    ];
    expect(folderIndex(tree)).toEqual(new Map([["A", "Kunden / Möbel"], ["B", "Kunden"]]));
  });

  test("projects without folder are not in the map", () => {
    const tree = [{ k: "p", id: "Root" }, { k: "f", id: "F", name: "Nomobo", children: [{ k: "p", id: "N" }] }];
    const map = folderIndex(tree);
    expect(map.has("Root")).toBe(false);
    expect(map.get("N")).toBe("Nomobo");
  });

  test("garbage yields an empty map", () => {
    for (const bad of [null, undefined, 42, "x", {}, { projectTree: [] }, [null, 1, "a"], [{ k: "f", name: 3, children: [{ k: "p", id: "A" }] }], [{ k: "f", name: "X", children: "nope" }], [{ k: "p", id: 5 }]]) {
      expect(folderIndex(bad).size).toBe(0);
    }
  });
});
