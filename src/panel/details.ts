import type { Api, TaskDetails } from "./api.ts";
import type { Store } from "./store.ts";

/**
 * The rail panel's read-only view of the current session's SP task: what it
 * shows (pure), the controller that reads binding and task, and the DOM.
 * Task titles and notes come from SP: they are only ever set as text nodes.
 */

// ── Formatting ────────────────────────────────────────────────────────────

/** "≈ 2,5 h" from milliseconds: at most two decimals, German comma. */
export function formatHoursMs(ms: number): string {
  const hours = Math.round((ms / 3_600_000) * 100) / 100;
  return `≈ ${String(hours).replace(".", ",")} h`;
}

export type DetailsSummary = {
  title: string;
  project: string | null;
  badge: "offen" | "erledigt";
  total: string;
  subtasks: { title: string; hours: string; isDone: boolean }[];
};

export function describeDetails(d: TaskDetails): DetailsSummary {
  return {
    title: d.title.trim() || "Ohne Titel",
    project: d.projectTitle,
    badge: d.isDone ? "erledigt" : "offen",
    total: formatHoursMs(d.timeSpentMs),
    subtasks: d.subtasks.map((s) => ({ title: s.title, hours: formatHoursMs(s.timeSpentMs), isDone: s.isDone })),
  };
}

// ── Notes: a tiny markdown subset ─────────────────────────────────────────

export type Inline = { text: string; bold?: true; small?: true };
export type NoteBlock =
  | { type: "heading"; inlines: Inline[] }
  | { type: "para"; lines: Inline[][] }
  | { type: "list"; items: Inline[][] };

type Token = { at: number; end: number; kind: "bold" | "subOpen" | "subClose" };

/** Markers that close later in the line; a lone marker stays literal text. */
function markers(line: string): Token[] {
  const all: Token[] = [];
  const re = /\*\*|<sub>|<\/sub>/gi;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    const raw = m[0].toLowerCase();
    all.push({ at: m.index, end: m.index + m[0].length, kind: raw === "**" ? "bold" : raw === "<sub>" ? "subOpen" : "subClose" });
  }
  const keep = new Set<Token>();
  const bolds = all.filter((t) => t.kind === "bold");
  for (let i = 0; i + 1 < bolds.length; i += 2) keep.add(bolds[i]!).add(bolds[i + 1]!);
  let open: Token | null = null;
  for (const t of all) {
    if (t.kind === "subOpen" && !open) open = t;
    else if (t.kind === "subClose" && open) {
      keep.add(open).add(t);
      open = null;
    }
  }
  return all.filter((t) => keep.has(t));
}

/** **bold** and <sub>small</sub> (nestable) in one line. */
export function parseInline(line: string): Inline[] {
  const out: Inline[] = [];
  let bold = false;
  let small = false;
  let pos = 0;
  const push = (text: string): void => {
    if (!text) return;
    const last = out.at(-1);
    if (last && !!last.bold === bold && !!last.small === small) {
      last.text += text;
      return;
    }
    const part: Inline = { text };
    if (small) part.small = true;
    if (bold) part.bold = true;
    out.push(part);
  };
  for (const t of markers(line)) {
    push(line.slice(pos, t.at));
    pos = t.end;
    if (t.kind === "bold") bold = !bold;
    else small = t.kind === "subOpen";
  }
  push(line.slice(pos));
  return out;
}

/** `#`–`######` headings, `- ` bullets, paragraphs split by blank lines, line breaks kept. */
export function parseNotes(text: string): NoteBlock[] {
  const blocks: NoteBlock[] = [];
  let para: Inline[][] | null = null;
  let list: Inline[][] | null = null;
  const close = (): void => {
    para = null;
    list = null;
  };
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (line.trim() === "") {
      close();
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      close();
      blocks.push({ type: "heading", inlines: parseInline(heading[1]!.trim()) });
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      para = null;
      if (!list) {
        list = [];
        blocks.push({ type: "list", items: list });
      }
      list.push(parseInline(bullet[1]!));
      continue;
    }
    list = null;
    if (!para) {
      para = [];
      blocks.push({ type: "para", lines: para });
    }
    para.push(parseInline(line.trim()));
  }
  return blocks;
}

function inlineNodes(doc: Document, inlines: Inline[]): Node[] {
  return inlines.map((part) => {
    let node: Node = doc.createTextNode(part.text);
    if (part.bold) {
      const strong = doc.createElement("strong");
      strong.append(node);
      node = strong;
    }
    if (part.small) {
      const small = doc.createElement("small");
      small.append(node);
      node = small;
    }
    return node;
  });
}

/** The notes as DOM: text nodes only, never parsed HTML. */
export function renderNotes(doc: Document, blocks: NoteBlock[]): HTMLDivElement {
  const root = doc.createElement("div");
  root.className = "notes";
  for (const block of blocks) {
    if (block.type === "heading") {
      const h = doc.createElement("h3");
      h.append(...inlineNodes(doc, block.inlines));
      root.append(h);
    } else if (block.type === "para") {
      const p = doc.createElement("p");
      block.lines.forEach((line, i) => {
        if (i > 0) p.append(doc.createElement("br"));
        p.append(...inlineNodes(doc, line));
      });
      root.append(p);
    } else {
      const ul = doc.createElement("ul");
      for (const item of block.items) {
        const li = doc.createElement("li");
        li.append(...inlineNodes(doc, item));
        ul.append(li);
      }
      root.append(ul);
    }
  }
  return root;
}

// ── Controller ────────────────────────────────────────────────────────────

const LOAD_FAILED = "Super Productivity ist gerade nicht erreichbar.";

export type DetailsView =
  | { kind: "no-session" }
  | { kind: "loading" }
  | { kind: "not-logged" }
  | { kind: "gone" }
  | { kind: "error"; message: string }
  | { kind: "details"; details: TaskDetails };

export function createDetailsController(deps: {
  store: Pick<Store, "getBinding">;
  api: Pick<Api, "details">;
  onChange: (view: DetailsView) => void;
}) {
  let session: string | null = null;
  let started = false;
  let view: DetailsView = { kind: "no-session" };
  /** Bumped on every read so a late answer for an older session is dropped. */
  let generation = 0;

  function show(next: DetailsView): void {
    view = next;
    deps.onChange(view);
  }

  async function refresh(): Promise<void> {
    const run = ++generation;
    const id = session;
    if (!id) return show({ kind: "no-session" });
    const binding = await deps.store.getBinding(id).catch(() => null);
    if (run !== generation) return;
    if (!binding) return show({ kind: "not-logged" });
    // Keep the shown task while it is read again; only a first read shows „lädt“.
    if (view.kind !== "details") show({ kind: "loading" });
    try {
      const details = await deps.api.details(binding.taskId);
      if (run !== generation) return;
      show(details ? { kind: "details", details } : { kind: "gone" });
    } catch {
      if (run === generation) show({ kind: "error", message: LOAD_FAILED });
    }
  }

  return {
    get view(): DetailsView {
      return view;
    },
    setSession(next: string | null): void {
      if (started && next === session) return;
      started = true;
      session = next;
      view = { kind: "no-session" };
      void refresh();
    },
    refresh,
  };
}

// ── View ──────────────────────────────────────────────────────────────────

export const TEXT = {
  noSession: "Keine Session geöffnet.",
  loading: "Aufgabe wird geladen …",
  notLogged: "Noch nicht geloggt",
  logNow: "Jetzt loggen",
  gone: "Die verknüpfte Aufgabe gibt es in Super Productivity nicht mehr (gelöscht oder archiviert). Beim nächsten Log wird eine neue angelegt.",
  refresh: "Aktualisieren",
  subtasks: "Logs",
  noSubtasks: "Keine Logs als Unteraufgaben.",
  notes: "Notizen",
  noNotes: "Keine Notizen.",
};

export const DETAILS_CSS = `
.splog-details { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.splog-details p, .splog-details li, .splog-details h2, .splog-details h3 { margin: 0; overflow-wrap: anywhere; }
.splog-details h2 { font-size: 1.1em; }
.splog-details h3 { font-size: 0.95em; }
.splog-details .meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; color: var(--oc-muted); }
.splog-details .badge { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--oc-border); font-size: 0.85em; color: var(--oc-fg); }
.splog-details .badge.done { color: var(--oc-success-text, var(--oc-fg)); border-color: var(--oc-success, var(--oc-border)); }
.splog-details .subtasks { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
.splog-details .subtasks li { display: flex; gap: 8px; justify-content: space-between; }
.splog-details .subtasks .hours { white-space: nowrap; color: var(--oc-muted); font-variant-numeric: tabular-nums; }
.splog-details .notes { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--oc-border); border-radius: var(--oc-radius, 6px); }
.splog-details .notes ul { margin: 0; padding-left: 1.2em; }
.splog-details .notes small { color: var(--oc-muted); }
.splog-details .muted { color: var(--oc-muted); }
.splog-details .actions { display: flex; gap: 8px; flex-wrap: wrap; }
`;

function node<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function button(doc: Document, label: string, primary: boolean, onClick: () => void): HTMLButtonElement {
  const b = node(doc, "button", primary ? "splog-btn primary" : "splog-btn", label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** The panel's content for a details view; `onLog` starts the inline log flow. */
export function renderDetailsView(doc: Document, view: DetailsView, handlers: { onRefresh: () => void; onLog: () => void }): HTMLElement {
  const root = node(doc, "section", "splog-details");
  root.setAttribute("aria-live", "polite");
  const refresh = () => button(doc, TEXT.refresh, false, handlers.onRefresh);
  const actions = (...buttons: HTMLButtonElement[]) => {
    const row = node(doc, "div", "actions");
    row.append(...buttons);
    return row;
  };
  switch (view.kind) {
    case "no-session":
      root.append(node(doc, "p", "muted", TEXT.noSession));
      break;
    case "loading":
      root.append(node(doc, "p", "muted", TEXT.loading));
      break;
    case "not-logged":
      root.append(node(doc, "p", "", TEXT.notLogged), actions(button(doc, TEXT.logNow, true, handlers.onLog)));
      break;
    case "gone":
      root.append(node(doc, "p", "splog-notice warn", TEXT.gone), actions(refresh()));
      break;
    case "error":
      root.append(node(doc, "p", "splog-notice warn", view.message), actions(refresh()));
      break;
    case "details": {
      const d = describeDetails(view.details);
      const meta = node(doc, "div", "meta");
      if (d.project) meta.append(node(doc, "span", "", d.project));
      meta.append(node(doc, "span", d.badge === "erledigt" ? "badge done" : "badge", d.badge), node(doc, "span", "", d.total));
      root.append(node(doc, "h2", "", d.title), meta);

      root.append(node(doc, "h3", "", TEXT.subtasks));
      if (d.subtasks.length === 0) root.append(node(doc, "p", "muted", TEXT.noSubtasks));
      else {
        const list = node(doc, "ul", "subtasks");
        for (const s of d.subtasks) {
          const li = node(doc, "li", "");
          li.append(node(doc, "span", "", s.title || "Ohne Titel"), node(doc, "span", "hours", s.hours));
          list.append(li);
        }
        root.append(list);
      }

      root.append(node(doc, "h3", "", TEXT.notes));
      const blocks = parseNotes(view.details.notes);
      root.append(blocks.length > 0 ? renderNotes(doc, blocks) : node(doc, "p", "muted", TEXT.noNotes));
      root.append(actions(refresh()));
      break;
    }
  }
  return root;
}
