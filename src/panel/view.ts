import type { Flow, FlowState } from "./flow.ts";
import { groupProjects } from "./projects.ts";

/** The log flow's DOM, shared by the dialog and the SP Log work status. */

const STATUS: Record<FlowState["phase"], string> = {
  disconnected: "Unter Einstellungen → Integrationen „Super Productivity“ verbinden.",
  "pick-project": "Welchem Super-Productivity-Projekt gehört dieses Verzeichnis?",
  drafting: "Entwurf wird erstellt …",
  ready: "",
  saving: "Wird gespeichert …",
  done: "Geloggt ✓",
  error: "",
};

const CSS = `
.splog-flow { display: flex; flex-direction: column; gap: 12px; }
.splog-flow [hidden] { display: none !important; }
.splog-flow p { margin: 0; overflow-wrap: anywhere; }
.splog-flow .muted { color: var(--oc-muted); }
.splog-flow .field { display: flex; flex-direction: column; gap: 4px; }
.splog-flow .field > span { font-weight: 600; font-size: 0.9em; }
.splog-flow .editor { display: flex; flex-direction: column; gap: 12px; }
.splog-flow input, .splog-flow select, .splog-flow textarea {
  width: 100%; min-height: 44px; padding: 8px 10px; font: inherit;
  color: var(--oc-fg); background: var(--oc-elevated, var(--oc-bg));
  border: 1px solid var(--oc-border); border-radius: var(--oc-radius, 6px);
}
.splog-flow textarea { min-height: 120px; resize: vertical; }
.splog-flow.compact { gap: 8px; }
.splog-flow.compact .editor { gap: 8px; }
.splog-flow.compact textarea { min-height: 88px; }
.splog-flow input:focus, .splog-flow select:focus, .splog-flow textarea:focus { outline: 2px solid var(--oc-focus, var(--oc-primary)); outline-offset: 1px; }
.splog-flow .actions { display: flex; gap: 8px; flex-wrap: wrap; }
.splog-btn {
  min-height: 44px; min-width: 44px; padding: 0 16px; font: inherit; font-weight: 600; cursor: pointer;
  border-radius: var(--oc-radius, 6px); border: 1px solid var(--oc-border);
  background: transparent; color: var(--oc-fg);
}
.splog-btn.primary { background: var(--oc-primary); color: var(--oc-primary-fg); border-color: var(--oc-primary); flex: 1; }
.splog-btn:disabled { opacity: 0.6; cursor: default; }
.splog-btn:focus-visible { outline: 2px solid var(--oc-focus, var(--oc-primary)); outline-offset: 1px; }
.splog-notice { padding: 10px 12px; border-radius: var(--oc-radius, 6px); background: var(--oc-muted-surface, transparent); border: 1px solid var(--oc-border); }
.splog-notice.warn { color: var(--oc-warning-text, var(--oc-fg)); border-color: var(--oc-warning, var(--oc-border)); }
.splog-notice.ok { color: var(--oc-success-text, var(--oc-fg)); border-color: var(--oc-success, var(--oc-border)); }
`;

/** Adds the shared styles once per document (buttons and notices are used outside the flow too). */
export function ensureStyles(): void {
  if (document.getElementById("splog-styles")) return;
  const style = document.createElement("style");
  style.id = "splog-styles";
  style.textContent = CSS;
  document.head.append(style);
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, ...children: Node[]): HTMLElementTagNameMap[K] {
  const node: HTMLElementTagNameMap[K] = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function field(label: string, control: HTMLElement): HTMLLabelElement {
  return h("label", { className: "field" }, h("span", { textContent: label }), control);
}

function setOptions(select: HTMLSelectElement, options: { value: string; label: string }[], value: string): void {
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    select.replaceChildren(...options.map((o) => new Option(o.label, o.value)));
    select.dataset.key = key;
  }
  if (select.value !== value) select.value = value;
}

/** The project select: projects without folder first, then one <optgroup> per SP folder. */
function setProjectOptions(select: HTMLSelectElement, s: FlowState): void {
  const { ungrouped, groups } = groupProjects(s.projects);
  const placeholder = s.phase === "pick-project";
  const key = JSON.stringify({ placeholder, ungrouped, groups });
  if (select.dataset.key !== key) {
    const option = (p: { id: string; title: string }) => new Option(p.title, p.id);
    const children: HTMLElement[] = placeholder ? [new Option("Projekt wählen …", "")] : [];
    children.push(...ungrouped.map(option));
    for (const g of groups) {
      const group = document.createElement("optgroup");
      group.label = g.folder;
      group.append(...g.projects.map(option));
      children.push(group);
    }
    select.replaceChildren(...children);
    select.dataset.key = key;
  }
  const value = s.projectId ?? "";
  if (select.value !== value) select.value = value;
}

/** Writes a value unless the user is typing in that control. */
function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

export type FlowViewOptions = {
  /** „Abbrechen“ / „Schließen“ was clicked. */
  onCancel: () => void;
  /** After every render, e.g. to report the height. */
  onRender?: () => void;
  /** Tighter spacing for the Work Status. */
  compact?: boolean;
};

/**
 * Draws the flow into `root` and keeps it up to date until `dispose()`.
 * The controls call the flow directly; only cancelling is left to the caller.
 */
export function renderFlow(root: HTMLElement, flow: Flow, opts: FlowViewOptions): { dispose: () => void } {
  ensureStyles();
  const status = h("p", { className: "muted" });
  status.setAttribute("role", "status");
  const message = h("p", { className: "splog-notice warn", hidden: true });
  message.setAttribute("role", "alert");
  const project = h("select");
  const projectField = field("SP-Projekt", project);
  const target = h("select");
  const title = h("input", { type: "text", maxLength: 200, autocomplete: "off" });
  const summary = h("textarea", { rows: opts.compact ? 4 : 6, maxLength: 4000 });
  const hours = h("input", { type: "number", step: "0.25", min: "0", max: "24", inputMode: "decimal" });
  const editor = h(
    "div",
    { className: "editor" },
    field("Ziel", target),
    field("Titel", title),
    field("Zusammenfassung", summary),
    field("Stunden (geschätzter Aufwand)", hours),
  );
  const save = h("button", { type: "button", className: "splog-btn primary", textContent: "Speichern" });
  const cancel = h("button", { type: "button", className: "splog-btn", textContent: "Abbrechen" });
  const container = h(
    "div",
    { className: opts.compact ? "splog-flow compact" : "splog-flow" },
    status,
    message,
    projectField,
    editor,
    h("div", { className: "actions" }, save, cancel),
  );
  root.replaceChildren(container);

  function render(s: FlowState): void {
    status.textContent = STATUS[s.phase];
    status.className = s.phase === "done" ? "splog-notice ok" : s.phase === "disconnected" ? "splog-notice warn" : "muted";
    status.hidden = !STATUS[s.phase];
    message.textContent = s.message ?? "";
    message.hidden = !s.message;

    const editing = s.phase === "ready" || s.phase === "saving";
    projectField.hidden = !(s.phase === "pick-project" || editing);
    setProjectOptions(project, s);
    project.disabled = s.phase === "saving";

    editor.hidden = !editing;
    setOptions(target, [{ value: "new", label: "Neue Aufgabe" }, ...s.tasks.map((t) => ({ value: t.id, label: t.isDone ? `${t.title} (erledigt)` : t.title }))], s.target);
    setValue(title, s.draft.title);
    setValue(summary, s.draft.summary);
    setValue(hours, s.draft.hours === null ? "" : String(s.draft.hours));
    for (const c of [target, title, summary, hours]) c.disabled = s.phase === "saving";

    save.hidden = !editing;
    save.disabled = s.phase !== "ready";
    save.textContent = s.phase === "saving" ? "Wird gespeichert …" : "Speichern";
    cancel.textContent = s.phase === "done" ? "Schließen" : "Abbrechen";
    opts.onRender?.();
  }

  project.addEventListener("change", () => {
    if (project.value) void flow.chooseProject(project.value);
  });
  target.addEventListener("change", () => flow.setTarget(target.value));
  title.addEventListener("input", () => flow.edit({ title: title.value }));
  summary.addEventListener("input", () => flow.edit({ summary: summary.value }));
  hours.addEventListener("input", () => {
    const raw = hours.value.trim();
    const n = raw === "" ? null : Number(raw);
    flow.edit({ hours: n === null || Number.isFinite(n) ? n : null });
  });
  save.addEventListener("click", () => void flow.save());
  cancel.addEventListener("click", () => opts.onCancel());

  const unsubscribe = flow.subscribe(render);
  render(flow.state);
  return {
    dispose(): void {
      unsubscribe();
      container.remove();
    },
  };
}
