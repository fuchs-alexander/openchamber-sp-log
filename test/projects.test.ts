import { describe, expect, test } from "bun:test";
import { groupProjects } from "../src/panel/projects.ts";

const p = (id: string, title: string, folder: string | null) => ({ id, title, folder });

describe("groupProjects", () => {
  test("sorts folders and projects by German collation, ungrouped first", () => {
    const result = groupProjects([
      p("1", "zeta", null),
      p("2", "Äpfel", "Privat"),
      p("3", "apfelbaum", "Privat"),
      p("4", "Übersicht", null),
      p("5", "beta", "kunden / Österreich"),
      p("6", "Alpha", "Kunden"),
      p("7", "ober", null),
      p("8", "Zoo", "Privat"),
    ]);
    expect(result.ungrouped.map((x) => x.title)).toEqual(["ober", "Übersicht", "zeta"]);
    expect(result.groups.map((g) => g.folder)).toEqual(["Kunden", "kunden / Österreich", "Privat"]);
    expect(result.groups[2]!.projects.map((x) => x.title)).toEqual(["Äpfel", "apfelbaum", "Zoo"]);
  });

  test("projects without folder field are ungrouped", () => {
    const result = groupProjects([{ id: "1", title: "B" }, { id: "2", title: "a" }]);
    expect(result.ungrouped.map((x) => x.id)).toEqual(["2", "1"]);
    expect(result.groups).toEqual([]);
  });
});
