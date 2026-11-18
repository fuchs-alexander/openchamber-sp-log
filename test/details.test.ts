import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Binding } from "../src/panel/store.ts";
import type { TaskDetails } from "../src/panel/api.ts";
import { parseTaskDetails } from "../src/panel/api.ts";
import {
  createDetailsController,
  describeDetails,
  formatHoursMs,
  parseInline,
  parseNotes,
  renderNotes,
  type DetailsView,
} from "../src/panel/details.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));

const DETAILS: TaskDetails = {
  id: "T",
  title: "Login-Bug",
  isDone: false,
  projectId: "P1",
  projectTitle: "Kunde A",
  timeSpentMs: 9_000_000,
  notes: "",
  subtasks: [
    { id: "S1", title: "17.11. · Login", isDone: true, timeSpentMs: 3_600_000, timeSpentOnDay: {} },
    { id: "S2", title: "18.11. · Mehr", isDone: true, timeSpentMs: 5_400_000, timeSpentOnDay: {} },
  ],
};

const BOUND: Binding = {
  taskId: "T",
  lastMessageId: null,
  lastCreatedAt: null,
  lastLogId: null,
  taskTitle: "Login-Bug",
  projectTitle: null,
  logs: null,
};

describe("formatting", () => {
  test("hours from ms with a German comma, at most two decimals", () => {
    expect(formatHoursMs(9_000_000)).toBe("≈ 2,5 h");
    expect(formatHoursMs(3_600_000)).toBe("≈ 1 h");
    expect(formatHoursMs(1_000_000)).toBe("≈ 0,28 h");
    expect(formatHoursMs(0)).toBe("≈ 0 h");
  });

  test("describeDetails: header, badge, total and subtasks", () => {
    expect(describeDetails(DETAILS)).toEqual({
      title: "Login-Bug",
      project: "Kunde A",
      badge: "offen",
      total: "≈ 2,5 h",
      subtasks: [
        { title: "17.11. · Login", hours: "≈ 1 h", isDone: true },
        { title: "18.11. · Mehr", hours: "≈ 1,5 h", isDone: true },
      ],
    });
    const done = describeDetails({ ...DETAILS, isDone: true, title: "", projectTitle: null });
    expect(done).toMatchObject({ title: "Ohne Titel", project: null, badge: "erledigt" });
  });

  test("parseTaskDetails accepts the gateway's shape and refuses junk", () => {
    expect(parseTaskDetails(JSON.parse(JSON.stringify(DETAILS)))).toEqual(DETAILS);
    expect(parseTaskDetails({ id: 1 })).toBeNull();
    expect(parseTaskDetails(null)).toBeNull();
    const loose = parseTaskDetails({ id: "T", subtasks: [{ id: "S", title: 3 }, "x"] });
    expect(loose).toEqual({
      id: "T",
      title: "",
      isDone: false,
      projectId: null,
      projectTitle: null,
      timeSpentMs: 0,
      notes: "",
      subtasks: [{ id: "S", title: "", isDone: false, timeSpentMs: 0, timeSpentOnDay: {} }],
    });
  });
});

describe("notes markdown subset", () => {
  test("inline: bold and <sub> small text; unmatched markers stay literal", () => {
    expect(parseInline("a **b** c")).toEqual([{ text: "a " }, { text: "b", bold: true }, { text: " c" }]);
    expect(parseInline("x <sub>klein **fett**</sub>")).toEqual([
      { text: "x " },
      { text: "klein ", small: true },
      { text: "fett", small: true, bold: true },
    ]);
    expect(parseInline("2 ** 3 <sub>offen")).toEqual([{ text: "2 ** 3 <sub>offen" }]);
    expect(parseInline("<script>alert(1)</script>")).toEqual([{ text: "<script>alert(1)</script>" }]);
  });

  test("blocks: headings, paragraphs with line breaks, bullet lists", () => {
    const notes = "### 17.11.2026 · Login\n**Zeit:** 1 h\nZweite Zeile\n\n- eins\n- **zwei**\nDanach\n\n\n#### Klein";
    expect(parseNotes(notes)).toEqual([
      { type: "heading", inlines: [{ text: "17.11.2026 · Login" }] },
      { type: "para", lines: [[{ text: "Zeit:", bold: true }, { text: " 1 h" }], [{ text: "Zweite Zeile" }]] },
      { type: "list", items: [[{ text: "eins" }], [{ text: "zwei", bold: true }]] },
      { type: "para", lines: [[{ text: "Danach" }]] },
      { type: "heading", inlines: [{ text: "Klein" }] },
    ]);
    expect(parseNotes("  \n\n")).toEqual([]);
    expect(parseNotes("a\r\nb")).toEqual([{ type: "para", lines: [[{ text: "a" }], [{ text: "b" }]] }]);
  });

  test("renders with DOM nodes and text only", () => {
    const doc = fakeDocument();
    const root = renderNotes(doc as unknown as Document, parseNotes("### H\n<b>x</b> **y**\nz\n\n- <img src=x onerror=1>"));
    expect(serialize(root as unknown as FakeNode)).toBe(
      '<div class="notes"><h3>H</h3><p>"<b>x</b> "<strong>y</strong><br>z</p><ul><li>"<img src=x onerror=1>"</li></ul></div>',
    );
  });

  test("details.ts never assigns HTML", () => {
    const source = readFileSync(new URL("../src/panel/details.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe("details controller", () => {
  function setup(opts: { bindings?: Record<string, Binding | null>; details?: (id: string) => Promise<TaskDetails | null> } = {}) {
    const views: DetailsView[] = [];
    const calls: string[] = [];
    const ctrl = createDetailsController({
      store: { getBinding: async (id) => opts.bindings?.[id] ?? null },
      api: {
        details: async (id) => {
          calls.push(id);
          return opts.details ? opts.details(id) : DETAILS;
        },
      },
      onChange: (v) => views.push(v),
    });
    return { ctrl, views, calls };
  }

  test("no session", async () => {
    const { ctrl } = setup();
    ctrl.setSession(null);
    await tick();
    expect(ctrl.view).toEqual({ kind: "no-session" });
  });

  test("without binding: not logged, no SP call", async () => {
    const { ctrl, calls } = setup();
    ctrl.setSession("s1");
    await tick();
    expect(ctrl.view).toEqual({ kind: "not-logged" });
    expect(calls).toEqual([]);
  });

  test("with binding: loading, then the task's details live from SP", async () => {
    const { ctrl, views, calls } = setup({ bindings: { s1: BOUND } });
    ctrl.setSession("s1");
    await tick();
    await tick();
    expect(views[0]).toEqual({ kind: "loading" });
    expect(ctrl.view).toEqual({ kind: "details", details: DETAILS });
    expect(calls).toEqual(["T"]);
  });

  test("task gone: a hint", async () => {
    const { ctrl } = setup({ bindings: { s1: BOUND }, details: async () => null });
    ctrl.setSession("s1");
    await tick();
    await tick();
    expect(ctrl.view).toEqual({ kind: "gone" });
  });

  test("SP not reachable: an error view", async () => {
    const { ctrl } = setup({ bindings: { s1: BOUND }, details: async () => Promise.reject(new Error("x")) });
    ctrl.setSession("s1");
    await tick();
    await tick();
    expect(ctrl.view).toEqual({ kind: "error", message: "Super Productivity ist gerade nicht erreichbar." });
  });

  test("a late answer for the previous session is dropped", async () => {
    let release: (d: TaskDetails) => void = () => {};
    const slow = new Promise<TaskDetails>((r) => (release = r));
    const { ctrl } = setup({
      bindings: { s1: BOUND, s2: null },
      details: () => slow,
    });
    ctrl.setSession("s1");
    await tick();
    ctrl.setSession("s2");
    await tick();
    release(DETAILS);
    await tick();
    expect(ctrl.view).toEqual({ kind: "not-logged" });
  });

  test("refresh reads again; the same session again does not", async () => {
    const { ctrl, calls } = setup({ bindings: { s1: BOUND } });
    ctrl.setSession("s1");
    await tick();
    await tick();
    ctrl.setSession("s1");
    await tick();
    expect(calls).toHaveLength(1);
    await ctrl.refresh();
    expect(calls).toHaveLength(2);
  });
});

/** Just enough DOM for renderNotes: elements, text nodes, class names. */
type FakeNode = { tag: string | null; text: string; className: string; children: FakeNode[] };
function fakeDocument() {
  const element = (tag: string | null) => {
    const node = {
      tag,
      text: "",
      className: "",
      children: [] as FakeNode[],
      append(...items: (FakeNode | string)[]) {
        for (const item of items) node.children.push(typeof item === "string" ? text(item) : item);
      },
      set textContent(value: string) {
        node.children = [text(value)];
      },
    };
    return node;
  };
  const text = (value: string): FakeNode => ({ tag: null, text: value, className: "", children: [] });
  return { createElement: element, createTextNode: text };
}
function serialize(node: FakeNode): string {
  if (node.tag === null) return node.text.includes("<") || node.text.endsWith(" ") ? `"${node.text}"` : node.text;
  const cls = node.className ? ` class="${node.className}"` : "";
  if (node.tag === "br") return "<br>";
  return `<${node.tag}${cls}>${node.children.map(serialize).join("")}</${node.tag}>`;
}
