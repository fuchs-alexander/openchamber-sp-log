import { buildDraftRequest, messagesSince, parseDraft, type Draft, type Msg } from "../log/draft.ts";
import { buildMatchRequest, parseMatch, type MatchCandidate } from "../log/match.ts";
import { formatNoteBlock } from "../log/note.ts";
import { GatewayError, type Api, type HostLike, type SpProject } from "./api.ts";
import type { Binding, Store } from "./store.ts";

export type Phase = "disconnected" | "pick-project" | "drafting" | "ready" | "saving" | "done" | "error";
export type Target = string; // a task id, or "new"

export type FlowState = {
  phase: Phase;
  projects: SpProject[];
  projectId: string | null;
  tasks: MatchCandidate[];
  target: Target;
  draft: Draft;
  message: string | null;
};

export type FlowItem = {
  sessionId: string;
  sessionTitle: string;
  directory: string | null;
  messages: Msg[];
};

const EMPTY_DRAFT: Draft = { title: "", summary: "", hours: null };

const TEXT = {
  draftFailed: "Kein Entwurf vom Modell – bitte Titel, Zusammenfassung und Stunden selbst ausfüllen.",
  staleBinding: "Die zuletzt verknüpfte Aufgabe ist nicht mehr offen. Es wird eine neue Aufgabe angelegt.",
  taskGone: "Die Aufgabe existiert nicht mehr oder ist erledigt. Bitte „Neue Aufgabe“ wählen oder eine andere.",
  needTitle: "Bitte einen Titel (höchstens 200 Zeichen) eingeben.",
  needHours: "Bitte die Stunden (0 bis 24) eingeben.",
  saveFailed: "Speichern fehlgeschlagen. Der Entwurf bleibt erhalten – bitte erneut versuchen.",
  loadFailed: "Super Productivity ist gerade nicht erreichbar.",
  logged: "In Super Productivity geloggt",
  logPointLost:
    "Hinweis: Letzter Log-Stand nicht gefunden – Schätzung umfasst möglicherweise bereits geloggte Arbeit. Bitte Stunden prüfen.",
  bindingFailed: "Geloggt, aber Session-Bindung konnte nicht gespeichert werden – beim nächsten Log Stunden prüfen.",
};

const isDisconnected = (err: unknown): boolean => err instanceof GatewayError && err.code === "disconnected";

function initialState(): FlowState {
  return { phase: "drafting", projects: [], projectId: null, tasks: [], target: "new", draft: EMPTY_DRAFT, message: null };
}

export function createFlow(deps: { api: Api; store: Store; host: HostLike; now: () => Date }) {
  const { api, store, host, now } = deps;
  let state = initialState();
  const listeners = new Set<(s: FlowState) => void>();

  // Per-run context; a new start() bumps runId so late results of an old run are dropped.
  let runId = 0;
  let item: FlowItem | null = null;
  let directory = "global";
  let binding: Binding | null = null;
  let draftPromise: Promise<{ draft: Draft; failed: boolean; logPointLost: boolean }> | null = null;
  let draftApplied = false;

  function set(patch: Partial<FlowState>): void {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function fail(err: unknown): void {
    if (isDisconnected(err)) set({ phase: "disconnected", message: null });
    else set({ phase: "error", message: TEXT.loadFailed });
  }

  function ensureDraft(): Promise<{ draft: Draft; failed: boolean; logPointLost: boolean }> {
    if (!draftPromise) {
      const current = item!;
      const lastId = binding?.lastMessageId ?? null;
      const lastCreatedAt = binding?.lastCreatedAt ?? null;
      const since = messagesSince(current.messages, lastId, lastCreatedAt);
      // A logged point existed but neither its id nor its timestamp can locate it any more.
      const logPointLost =
        lastId !== null && lastCreatedAt === null && !current.messages.some((m) => m.id === lastId);
      draftPromise = host
        .generate(buildDraftRequest(since, current.sessionTitle))
        .then((res) => ({ draft: parseDraft(res.text), failed: false, logPointLost }))
        .catch(() => ({ draft: EMPTY_DRAFT, failed: true, logPointLost }));
    }
    return draftPromise;
  }

  async function suggestTarget(draft: Draft, tasks: MatchCandidate[]): Promise<Target> {
    if (tasks.length === 0 || !draft.title) return "new";
    try {
      const res = await host.generate(buildMatchRequest(draft, tasks));
      return parseMatch(res.text, tasks.map((t) => t.id)) ?? "new";
    } catch {
      return "new";
    }
  }

  /** Loads open tasks and the draft for a project, then picks the target. */
  async function loadProject(run: number, projectId: string, initial: boolean): Promise<void> {
    set({ phase: "drafting", projectId, message: null });
    let tasks: MatchCandidate[];
    let drafted: { draft: Draft; failed: boolean; logPointLost: boolean };
    try {
      [tasks, drafted] = await Promise.all([api.tasks(projectId), ensureDraft()]);
    } catch (err) {
      if (run === runId) fail(err);
      return;
    }
    if (run !== runId) return;

    const notes: string[] = [];
    if (!draftApplied) {
      draftApplied = true;
      set({ draft: drafted.draft });
      if (drafted.logPointLost) notes.push(TEXT.logPointLost);
      if (drafted.failed) notes.push(TEXT.draftFailed);
    }

    let target: Target;
    if (binding) {
      if (tasks.some((t) => t.id === binding!.taskId)) {
        target = binding.taskId;
      } else {
        target = "new";
        if (initial) {
          const sessionId = item!.sessionId;
          binding = null;
          await store.clearBinding(sessionId).catch(() => {});
          if (run !== runId) return;
          notes.push(TEXT.staleBinding);
        }
      }
    } else {
      target = await suggestTarget(state.draft, tasks);
      if (run !== runId) return;
    }
    set({ phase: "ready", tasks, target, message: notes.length > 0 ? notes.join(" ") : null });
  }

  async function start(next: FlowItem): Promise<void> {
    const run = ++runId;
    item = next;
    directory = next.directory || "global";
    binding = null;
    draftPromise = null;
    draftApplied = false;
    state = initialState();
    set({});

    let projects: SpProject[];
    let projectId: string | null;
    try {
      [projects, projectId, binding] = await Promise.all([
        api.projects(),
        store.getProject(directory),
        store.getBinding(next.sessionId),
      ]);
    } catch (err) {
      if (run === runId) fail(err);
      return;
    }
    if (run !== runId) return;
    set({ projects });
    if (!projectId || !projects.some((p) => p.id === projectId)) {
      set({ phase: "pick-project", projectId: null });
      return;
    }
    await loadProject(run, projectId, true);
  }

  async function chooseProject(id: string): Promise<void> {
    if (!item || !state.projects.some((p) => p.id === id)) return;
    if (state.phase !== "pick-project" && state.phase !== "ready") return;
    const run = runId;
    const initial = state.phase === "pick-project";
    // Leave pick-project/ready before awaiting storage so a second choice is ignored.
    set({ phase: "drafting", projectId: id, message: null });
    await store.setProject(directory, id).catch(() => {});
    if (run !== runId) return;
    await loadProject(run, id, initial);
  }

  function setTarget(target: Target): void {
    if (target === "new" || state.tasks.some((t) => t.id === target)) set({ target });
  }

  function edit(patch: Partial<Draft>): void {
    set({ draft: { ...state.draft, ...patch } });
  }

  async function save(): Promise<void> {
    if (state.phase !== "ready" || !item || !state.projectId) return;
    const { draft, target, projectId } = state;
    const title = draft.title.trim();
    if (!title || title.length > 200) return set({ message: TEXT.needTitle });
    const hours = draft.hours;
    if (hours === null || !Number.isFinite(hours) || hours < 0 || hours > 24) return set({ message: TEXT.needHours });

    const run = runId;
    const current = item;
    set({ phase: "saving", message: null });
    const block = formatNoteBlock({ date: now(), title, hours, summary: draft.summary.trim(), sessionTitle: current.sessionTitle });

    let taskId: string;
    try {
      taskId = target === "new" ? await api.create(projectId, title, block) : await api.append(target, block);
    } catch (err) {
      if (run !== runId) return;
      if (err instanceof GatewayError && err.code === "task-gone") {
        if (binding?.taskId === target) {
          binding = null;
          await store.clearBinding(current.sessionId).catch(() => {});
        }
        set({ phase: "ready", target: "new", tasks: state.tasks.filter((t) => t.id !== target), message: TEXT.taskGone });
      } else {
        set({ phase: "ready", message: TEXT.saveFailed });
      }
      return;
    }

    const last = current.messages[current.messages.length - 1];
    const lastMessageId = last?.id ?? binding?.lastMessageId ?? null;
    const lastCreatedAt = last?.createdAt ?? binding?.lastCreatedAt ?? null;
    binding = { taskId, lastMessageId, lastCreatedAt };
    const bound = await store.setBinding(current.sessionId, binding).then(
      () => true,
      () => false,
    );
    const toast = bound
      ? ({ kind: "success", message: TEXT.logged } as const)
      : ({ kind: "error", message: TEXT.bindingFailed } as const);
    await host.toast(toast).catch(() => {});
    if (run === runId) set({ phase: "done", message: null });
    await host.close().catch(() => {});
  }

  return {
    get state(): FlowState {
      return state;
    },
    subscribe(fn: (s: FlowState) => void): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start,
    chooseProject,
    setTarget,
    edit,
    save,
  };
}

export type Flow = ReturnType<typeof createFlow>;
