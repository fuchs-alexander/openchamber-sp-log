import { connectHost, isGuestSessionItem, type GuestItem } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { createApi } from "./api.ts";
import { createFlow, type FlowState } from "./flow.ts";
import { createStore } from "./store.ts";

const host = connectHost();
const flow = createFlow({ api: createApi(host), store: createStore(host), host, now: () => new Date() });

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  status: $<HTMLParagraphElement>("status"),
  message: $<HTMLParagraphElement>("message"),
  projectField: $<HTMLLabelElement>("project-field"),
  project: $<HTMLSelectElement>("project"),
  editor: $<HTMLDivElement>("editor"),
  target: $<HTMLSelectElement>("target"),
  title: $<HTMLInputElement>("title"),
  summary: $<HTMLTextAreaElement>("summary"),
  hours: $<HTMLInputElement>("hours"),
  save: $<HTMLButtonElement>("save"),
  cancel: $<HTMLButtonElement>("cancel"),
};

const STATUS: Record<FlowState["phase"], string> = {
  disconnected: "Unter Einstellungen → Integrationen „Super Productivity“ verbinden.",
  "pick-project": "Welchem Super-Productivity-Projekt gehört dieses Verzeichnis?",
  drafting: "Entwurf wird erstellt …",
  ready: "",
  saving: "Wird gespeichert …",
  done: "Geloggt ✓",
  error: "",
};

function setOptions(select: HTMLSelectElement, options: { value: string; label: string }[], value: string): void {
  const key = JSON.stringify(options);
  if (select.dataset.key !== key) {
    select.replaceChildren(...options.map((o) => new Option(o.label, o.value)));
    select.dataset.key = key;
  }
  if (select.value !== value) select.value = value;
}

/** Writes a value unless the user is typing in that control. */
function setValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  if (document.activeElement !== input && input.value !== value) input.value = value;
}

function render(s: FlowState): void {
  el.status.textContent = STATUS[s.phase];
  el.status.className = s.phase === "done" ? "notice ok" : s.phase === "disconnected" ? "notice warn" : "muted";
  el.status.hidden = !STATUS[s.phase];
  el.message.textContent = s.message ?? "";
  el.message.hidden = !s.message;

  const editing = s.phase === "ready" || s.phase === "saving";
  const projectOptions = s.projects.map((p) => ({ value: p.id, label: p.title }));
  if (s.phase === "pick-project") projectOptions.unshift({ value: "", label: "Projekt wählen …" });
  el.projectField.hidden = !(s.phase === "pick-project" || editing);
  setOptions(el.project, projectOptions, s.projectId ?? "");
  el.project.disabled = s.phase === "saving";

  el.editor.hidden = !editing;
  setOptions(
    el.target,
    [{ value: "new", label: "Neue Aufgabe" }, ...s.tasks.map((t) => ({ value: t.id, label: t.title }))],
    s.target,
  );
  setValue(el.title, s.draft.title);
  setValue(el.summary, s.draft.summary);
  setValue(el.hours, s.draft.hours === null ? "" : String(s.draft.hours));
  for (const c of [el.target, el.title, el.summary, el.hours]) c.disabled = s.phase === "saving";

  el.save.hidden = !editing;
  el.save.disabled = s.phase !== "ready";
  el.save.textContent = s.phase === "saving" ? "Wird gespeichert …" : "Speichern";
  el.cancel.textContent = s.phase === "done" ? "Schließen" : "Abbrechen";
}

function showNoItem(): void {
  el.status.textContent = "Starte das Loggen über das Session-Menü: „Nach Super Productivity loggen“.";
  el.status.className = "muted";
  el.status.hidden = false;
}

flow.subscribe(render);

el.project.addEventListener("change", () => {
  if (el.project.value) void flow.chooseProject(el.project.value);
});
el.target.addEventListener("change", () => flow.setTarget(el.target.value));
el.title.addEventListener("input", () => flow.edit({ title: el.title.value }));
el.summary.addEventListener("input", () => flow.edit({ summary: el.summary.value }));
el.hours.addEventListener("input", () => {
  const raw = el.hours.value.trim();
  const n = raw === "" ? null : Number(raw);
  flow.edit({ hours: n === null || Number.isFinite(n) ? n : null });
});
el.save.addEventListener("click", () => void flow.save());
el.cancel.addEventListener("click", () => void host.close().catch(() => {}));

let started: string | null = null;
function handleItem(item: GuestItem | null): void {
  if (!isGuestSessionItem(item)) {
    if (started === null) showNoItem();
    return;
  }
  const messages = item.messages ?? [];
  // onItem replays the same snapshot; restart only for a new session or new messages.
  const key = `${item.sessionId}:${messages.length}:${messages[messages.length - 1]?.id ?? ""}`;
  if (key === started) return;
  started = key;
  void flow.start({ sessionId: item.sessionId, sessionTitle: item.sessionTitle, directory: item.directory, messages });
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  handleItem(ctx.item);
});
host.onItem(handleItem);
