import { buildDraftRequest, messagesSince, parseDraft, type Draft, type Msg } from "../log/draft.ts";
import { buildMatchRequest, parseMatch, type MatchCandidate } from "../log/match.ts";
import { formatNoteBlock } from "../log/note.ts";
import { buildSessionDraftPrompt, parseSessionDraft } from "../log/session-draft.ts";
import { GatewayError, type Api, type HostLike, type SpProject } from "./api.ts";
import { createDraftsClient, DraftServiceError } from "./drafts-client.ts";
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
  /**
   * Whether the Small Model may draft when the session cannot. Default: only
   * with messages (the Work Status has none, so it shows an error instead).
   */
  allowFallback?: boolean;
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
  sessionWorking: "Session arbeitet – Entwurf folgt, sobald sie fertig ist …",
  sessionWaiting: "Session wartet auf deine Eingabe – bitte dort antworten.",
  sessionFallback: "Session-Entwurf nicht verfügbar – Entwurf vom Small Model.",
  sessionWaitingFallback: "Session wartet auf deine Eingabe – Entwurf vom Small Model.",
  noSessionDraft: "Session-Entwurf nicht möglich – bitte über … → Export → Nach Super Productivity loggen.",
};

/** How often and how long the panel asks the service for the session's draft. */
export const DRAFT_POLL_MS = 2_000;
export const DRAFT_WAIT_MS = 10 * 60 * 1000;

/**
 * `fallback`: why the Small Model drafted instead of the session (null: the session drafted).
 * `logId`: the session-draft request the draft came from; null for the Small Model.
 */
type Drafted = {
  draft: Draft;
  failed: boolean;
  logPointLost: boolean;
  fallback: string | null;
  logId: string | null;
  /** No session draft and the Small Model may not draft: the flow ends in an error. */
  none?: boolean;
};

/** What the session-draft attempt gave: a draft, or why there is none. */
type SessionDrafted = { draft: Draft; logId: string } | "unavailable" | "waiting" | "aborted";

const sleepMs = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function waitMessage(sessionStatus: string): string {
  return sessionStatus === "waiting" ? TEXT.sessionWaiting : TEXT.sessionWorking;
}

const hasReason = (err: unknown, reason: string): boolean => err instanceof DraftServiceError && err.reason === reason;

const isDisconnected = (err: unknown): boolean => err instanceof GatewayError && err.code === "disconnected";

function initialState(): FlowState {
  return { phase: "drafting", projects: [], projectId: null, tasks: [], target: "new", draft: EMPTY_DRAFT, message: null };
}

export function createFlow(deps: {
  api: Api;
  store: Store;
  host: HostLike;
  now: () => Date;
  /** A fresh id for every session-draft request. */
  newId?: () => string;
  sleep?: (ms: number) => Promise<void>;
}) {
  const { api, store, host, now } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const sleep = deps.sleep ?? sleepMs;
  const drafts = createDraftsClient(host);
  let state = initialState();
  const listeners = new Set<(s: FlowState) => void>();

  // Per-run context; a new start() bumps runId so late results of an old run are dropped.
  let runId = 0;
  let item: FlowItem | null = null;
  let directory = "global";
  let binding: Binding | null = null;
  let draftPromise: Promise<Drafted> | null = null;
  let draftApplied = false;
  /** The session-draft request whose draft is in the dialog; null for a Small Model draft. */
  let draftLogId: string | null = null;

  function set(patch: Partial<FlowState>): void {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  }

  function fail(err: unknown): void {
    if (isDisconnected(err)) set({ phase: "disconnected", message: null });
    else set({ phase: "error", message: TEXT.loadFailed });
  }

  /**
   * Asks the logged session itself (through the service) for the draft, limited
   * to the work after the last saved log. "unavailable" or "waiting": the Small
   * Model drafts instead. "aborted": the run was replaced or cancelled meanwhile.
   */
  async function sessionDraft(run: number, current: FlowItem, since: { logId: string | null; hint: string | null }): Promise<SessionDrafted> {
    const sessionId = current.sessionId;
    const logId = newId();
    const deadline = now().getTime() + DRAFT_WAIT_MS;
    try {
      await drafts.start(sessionId, logId, buildSessionDraftPrompt(logId, since.logId, since.hint));
    } catch (err) {
      if (run !== runId) return "aborted";
      return hasReason(err, "session-waiting") ? "waiting" : "unavailable";
    }
    try {
      while (true) {
        if (run !== runId) return "aborted";
        if (now().getTime() >= deadline) return "unavailable";
        await sleep(DRAFT_POLL_MS);
        if (run !== runId) return "aborted";
        let poll;
        try {
          poll = await drafts.poll(sessionId, logId);
        } catch (err) {
          // The host was slow this time; the session may still be drafting.
          if (hasReason(err, "host-timeout")) continue;
          throw err;
        }
        if (run !== runId) return "aborted";
        if (poll.state === "done") {
          const draft = parseSessionDraft(poll.text ?? "", logId);
          return draft ? { draft, logId } : "unavailable";
        }
        if (poll.state === "failed") return "unavailable";
        if (state.phase === "drafting") set({ message: waitMessage(poll.sessionStatus) });
      }
    } catch {
      return run === runId ? "unavailable" : "aborted";
    }
  }

  /**
   * Where the session draft starts: after the last saved session-draft request;
   * for a binding from before 0.2.0, after the bound message (quoted). `lost`:
   * a binding exists but its message is gone, so the whole session is drafted.
   */
  function sessionDraftSince(current: FlowItem): { logId: string | null; hint: string | null; lost: boolean } {
    if (!binding) return { logId: null, hint: null, lost: false };
    if (binding.lastLogId) return { logId: binding.lastLogId, hint: null, lost: false };
    const lastId = binding.lastMessageId;
    const text = current.messages.find((m) => m.id === lastId)?.text.trim();
    return text ? { logId: null, hint: text, lost: false } : { logId: null, hint: null, lost: true };
  }

  /** The Small Model's draft from the messages since the last logged point. */
  function smallModelDraft(current: FlowItem, fallback: string): Promise<Drafted> {
    const lastId = binding?.lastMessageId ?? null;
    const lastCreatedAt = binding?.lastCreatedAt ?? null;
    const since = messagesSince(current.messages, lastId, lastCreatedAt);
    // A logged point existed but neither its id nor its timestamp can locate it any more.
    const logPointLost = lastId !== null && lastCreatedAt === null && !current.messages.some((m) => m.id === lastId);
    return host
      .generate(buildDraftRequest(since, current.sessionTitle))
      .then((res) => ({ draft: parseDraft(res.text), failed: false, logPointLost, fallback, logId: null }))
      .catch(() => ({ draft: EMPTY_DRAFT, failed: true, logPointLost, fallback, logId: null }));
  }

  function ensureDraft(run: number): Promise<Drafted> {
    if (!draftPromise) {
      const current = item!;
      const since = sessionDraftSince(current);
      set({ message: TEXT.sessionWorking });
      draftPromise = sessionDraft(run, current, since).then((result) => {
        if (result === "aborted") return { draft: EMPTY_DRAFT, failed: false, logPointLost: false, fallback: null, logId: null };
        if (result === "waiting" || result === "unavailable") {
          const allowFallback = current.allowFallback ?? current.messages.length > 0;
          if (!allowFallback) return { draft: EMPTY_DRAFT, failed: true, logPointLost: false, fallback: null, logId: null, none: true };
          return smallModelDraft(current, result === "waiting" ? TEXT.sessionWaitingFallback : TEXT.sessionFallback);
        }
        return { draft: result.draft, failed: false, logPointLost: since.lost, fallback: null, logId: result.logId };
      });
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
    let drafted: Drafted;
    try {
      [tasks, drafted] = await Promise.all([api.tasks(projectId), ensureDraft(run)]);
    } catch (err) {
      if (run === runId) fail(err);
      return;
    }
    if (run !== runId) return;
    if (drafted.none) {
      set({ phase: "error", message: TEXT.noSessionDraft });
      return;
    }

    const notes: string[] = [];
    if (!draftApplied) {
      draftApplied = true;
      draftLogId = drafted.logId;
      set({ draft: drafted.draft });
      if (drafted.fallback) notes.push(drafted.fallback);
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
    draftLogId = null;
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

  /** Stops the current run: pending session-draft polls end and late results are dropped. */
  function cancel(): void {
    runId++;
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
    const date = now();
    const block = formatNoteBlock({ date, title, hours, summary: draft.summary.trim(), sessionTitle: current.sessionTitle });

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
    const taskTitle = target === "new" ? title : (state.tasks.find((t) => t.id === target)?.title ?? title);
    const projectTitle = state.projects.find((p) => p.id === projectId)?.title ?? null;
    // Bindings from before 0.3.0 have no log list; it starts with this save.
    const logs = [...(binding?.logs ?? []), { at: date.getTime(), hours }];
    binding = { taskId, lastMessageId, lastCreatedAt, lastLogId: draftLogId, taskTitle, projectTitle, logs };
    const bound = await store.setBinding(current.sessionId, binding).then(
      () => true,
      () => false,
    );
    // Lets the service mark the session as logged; without a service there is no mark.
    await host
      .serviceRequest({
        method: "POST",
        path: "/logged",
        body: JSON.stringify({ sessionId: current.sessionId, at: date.getTime(), hours }),
      })
      .catch(() => {});
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
    cancel,
    setTarget,
    edit,
    save,
  };
}

export type Flow = ReturnType<typeof createFlow>;
