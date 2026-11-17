import { describe, expect, test } from "bun:test";
import type { GuestRequest, GuestRequestResult, JsonValue } from "@openchamber/sdk";
import type { Api, HostLike } from "../src/panel/api.ts";
import { createFlow } from "../src/panel/flow.ts";
import { createPendingStore, createStore } from "../src/panel/store.ts";
import type { FlowItem, FlowState } from "../src/panel/flow.ts";
import type { Binding } from "../src/panel/store.ts";
import { createStatusController, LOGGED_MS, type StatusView } from "../src/status/controller.ts";

const HINT = "Loggen: … → Export → Nach Super Productivity loggen";
const BOUND: Binding = {
  taskId: "t1",
  lastMessageId: null,
  lastCreatedAt: null,
  lastLogId: "l1",
  taskTitle: "Login-Bug",
  projectTitle: null,
  logs: [{ at: new Date(2026, 10, 17, 9).getTime(), hours: 1 }],
};

const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(bindings: Record<string, Binding | null> = {}) {
  const calls = { start: [] as FlowItem[], cancel: 0, getBinding: [] as string[] };
  const listeners = new Set<(s: FlowState) => void>();
  let state = { phase: "drafting" } as FlowState;
  const flow = {
    get state() {
      return state;
    },
    subscribe(fn: (s: FlowState) => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    start: async (item: FlowItem) => {
      calls.start.push(item);
    },
    cancel: () => {
      calls.cancel++;
    },
  };
  const emit = (phase: FlowState["phase"], message: string | null = null) => {
    state = { ...state, phase, message };
    for (const fn of listeners) fn(state);
  };
  const timers: { ms: number; fn: () => void; cancelled: boolean }[] = [];
  const views: StatusView[] = [];
  const ctrl = createStatusController({
    flow,
    store: {
      getBinding: async (id) => {
        calls.getBinding.push(id);
        return bindings[id] ?? null;
      },
      getSaved: async () => null,
    },
    now: () => new Date(2026, 10, 17, 15),
    delay: (ms, fn) => {
      const t = { ms, fn, cancelled: false };
      timers.push(t);
      return () => {
        t.cancelled = true;
      };
    },
    onChange: (v) => views.push(v),
  });
  const view = () => ctrl.view;
  return { ctrl, flow, calls, emit, timers, views, view, bindings };
}

describe("status controller", () => {
  test("no session: a note, no button", async () => {
    const { ctrl, view } = setup();
    ctrl.setSession(null);
    await tick();
    expect(view()).toEqual({ mode: "summary", lines: ["Keine Session geöffnet."], button: null });
  });

  test("unlogged session: summary with Jetzt loggen and the hint", async () => {
    const { ctrl, view } = setup();
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    expect(view()).toEqual({ mode: "summary", lines: ["Noch nicht geloggt", HINT], button: "Jetzt loggen" });
  });

  test("logged session: Nachloggen", async () => {
    const { ctrl, view } = setup({ s1: BOUND });
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    const v = view();
    expect(v.mode === "summary" && v.button).toBe("Nachloggen");
    expect(v.mode === "summary" && v.lines.at(-1)).toBe(HINT);
  });

  test("startLogging runs the flow inline for the current session without messages", async () => {
    const { ctrl, calls, view } = setup();
    ctrl.setDirectory("/repo");
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    expect(view()).toEqual({ mode: "flow" });
    expect(calls.start).toEqual([{ sessionId: "s1", sessionTitle: "Session A", directory: "/repo", messages: [] }]);
  });

  test("startLogging without a session does nothing", async () => {
    const { ctrl, calls, view } = setup();
    ctrl.setSession(null);
    await tick();
    ctrl.startLogging();
    expect(calls.start).toHaveLength(0);
    expect(view().mode).toBe("summary");
  });

  test("after save: Geloggt, then the summary with the new binding", async () => {
    const { ctrl, emit, timers, view, bindings } = setup();
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    emit("saving");
    expect(view().mode).toBe("flow");
    bindings.s1 = BOUND;
    emit("done");
    expect(view()).toEqual({ mode: "logged" });
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(LOGGED_MS);
    timers[0]!.fn();
    await tick();
    const v = view();
    expect(v.mode).toBe("summary");
    expect(v.mode === "summary" && v.button).toBe("Nachloggen");
  });

  test("cancelLogging stops the flow and returns to the summary", async () => {
    const { ctrl, calls, view } = setup();
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    ctrl.cancelLogging();
    await tick();
    expect(calls.cancel).toBe(1);
    expect(view()).toEqual({ mode: "summary", lines: ["Noch nicht geloggt", HINT], button: "Jetzt loggen" });
  });

  test("a session change cancels the running flow and shows the new session", async () => {
    const { ctrl, calls, view } = setup({ s2: BOUND });
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    ctrl.setSession({ id: "s2", title: "Session B" });
    await tick();
    expect(calls.cancel).toBe(1);
    const v = view();
    expect(v.mode).toBe("summary");
    expect(v.mode === "summary" && v.button).toBe("Nachloggen");
  });

  test("the same session again (e.g. busy changed) keeps the flow running", async () => {
    const { ctrl, calls, view } = setup();
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    ctrl.setSession({ id: "s1", title: "Session A neu" });
    await ctrl.refresh();
    expect(calls.cancel).toBe(0);
    expect(view()).toEqual({ mode: "flow" });
  });

  test("a session change while Geloggt is shown drops the pending timer", async () => {
    const { ctrl, emit, timers, view } = setup();
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    emit("done");
    ctrl.setSession({ id: "s2", title: "Session B" });
    await tick();
    expect(timers[0]!.cancelled).toBe(true);
    expect(view().mode).toBe("summary");
  });

  test("flow phases after leaving the flow are ignored", async () => {
    const { ctrl, emit, view } = setup();
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    ctrl.cancelLogging();
    await tick();
    emit("done");
    expect(view().mode).toBe("summary");
  });
});

describe("status controller: project directory", () => {
  test("Nachloggen uses the directory saved in the binding", async () => {
    const { ctrl, calls } = setup({ s1: { ...BOUND, directory: "/session/repo" } });
    ctrl.setDirectory("/work-status");
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    expect(calls.start[0]!.directory).toBe("/session/repo");
  });

  test("an old binding without directory falls back to the Work Status directory", async () => {
    const { ctrl, calls } = setup({ s1: BOUND });
    ctrl.setDirectory("/work-status");
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    expect(calls.start[0]!.directory).toBe("/work-status");
  });
});

/**
 * The real flow behind the controller, against fakes of SP, the host storage
 * and the extension's service. `frame()` builds a fresh frame (flow +
 * controller) on the same storage and service, as when OpenChamber unmounts
 * the Work Status section and mounts it again.
 */
function world() {
  const storage = new Map<string, JsonValue>();
  const posts: string[] = [];
  /** The session's answer per logId; missing: still working. */
  const replies = new Map<string, string>();
  let sessionStatus = "busy";
  let polls = 0;
  /** SP tasks by id; a log completes its task, so none of them is open. */
  const spTasks = new Map<string, { id: string; title: string; isDone: boolean }>();
  const appends: string[] = [];
  const api: Api = {
    projects: async () => [{ id: "p1", title: "Projekt 1" }],
    tasks: async () => [...spTasks.values()].filter((t) => !t.isDone).map((t) => ({ id: t.id, title: t.title, notesExcerpt: "" })),
    task: async (id) => spTasks.get(id) ?? null,
    create: async (_projectId, title) => {
      spTasks.set("new1", { id: "new1", title, isDone: true });
      return { id: "new1", timeBooked: true, timeError: null, completed: true };
    },
    append: async (taskId) => {
      appends.push(taskId);
      return { id: taskId, timeBooked: true, timeError: null, completed: true };
    },
  };
  const host: HostLike = {
    request: async () => ({ status: 200, body: "{}" }) as never,
    serviceRequest: async (req: GuestRequest): Promise<GuestRequestResult> => {
      if (req.path === "/logged") return { status: 200, body: "{}" };
      if (req.method === "POST") {
        posts.push(JSON.parse(req.body!).logId);
        return { status: 200, body: JSON.stringify({ started: true }) };
      }
      polls++;
      const logId = req.query!.logId!;
      const text = replies.get(logId);
      const body = text ? { state: "done", text, sessionStatus: "idle" } : { state: "pending", sessionStatus };
      return { status: 200, body: JSON.stringify(body) };
    },
    storage: {
      get: async (key) => storage.get(key),
      set: async (key, value) => {
        storage.set(key, value);
      },
      delete: async (key) => {
        storage.delete(key);
      },
    },
    generate: async () => ({ text: JSON.stringify({ taskId: null, reason: "" }) }),
    toast: async () => {},
    close: async () => {},
  };
  let ids = 0;
  function frame(opts: { remember?: boolean; now?: () => Date } = {}) {
    const store = createStore(host);
    const pending = createPendingStore(host);
    const flow = createFlow({
      api,
      store,
      host,
      pending,
      rememberPending: opts.remember ?? true,
      now: () => new Date(2026, 10, 17, 15),
      newId: () => `log-${++ids}`,
      sleep: () => new Promise((r) => setTimeout(r, 0)),
      closeOnDone: () => false,
    });
    const ctrl = createStatusController({
      flow,
      store,
      pending,
      now: opts.now ?? (() => new Date(2026, 10, 17, 15)),
      delay: () => () => {},
      onChange: () => {},
    });
    return { flow, ctrl };
  }
  return {
    frame,
    posts,
    storage,
    reply: (logId: string, text: string) => replies.set(logId, text),
    setStatus: (s: string) => {
      sessionStatus = s;
    },
    polls: () => polls,
    appends,
  };
}

const reply = (logId: string) =>
  JSON.stringify({ logId, titel: "Login gefixt", zusammenfassung: "Token-Refresh repariert.", stunden: 6 });

async function until(cond: () => boolean, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await tick();
  }
  throw new Error(`timed out waiting for ${what}`);
}

describe("status controller: logging while the session works", () => {
  test("first run: pick project, same-session snapshots while polling, then the parsed draft", async () => {
    const w = world();
    const { flow, ctrl } = w.frame();
    ctrl.setDirectory("/repo");
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    await until(() => flow.state.phase === "pick-project", "pick-project");
    void flow.chooseProject("p1");
    await until(() => w.posts.length === 1 && w.polls() > 0, "polling");
    // The host re-sends the same session while it works on the request.
    for (const busy of [true, false, true]) {
      ctrl.setSession({ id: "s1", title: busy ? "Session A" : "Session A (neu)" });
      await tick();
    }
    expect(flow.state.phase).toBe("drafting");
    w.reply(w.posts[0]!, reply(w.posts[0]!));
    await until(() => flow.state.phase === "ready", "ready");
    expect(ctrl.view).toEqual({ mode: "flow" });
    expect(flow.state.draft).toEqual({ title: "Login gefixt", summary: "Token-Refresh repariert.", hours: 6 });
    expect(w.posts).toHaveLength(1);
  });

  test("another session still cancels the flow", async () => {
    const w = world();
    const { flow, ctrl } = w.frame();
    ctrl.setDirectory("/repo");
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    await until(() => flow.state.phase === "pick-project", "pick-project");
    void flow.chooseProject("p1");
    await until(() => w.polls() > 0, "polling");
    ctrl.setSession({ id: "s2", title: "Session B" });
    await tick();
    w.reply(w.posts[0]!, reply(w.posts[0]!));
    for (let i = 0; i < 20; i++) await tick();
    expect(ctrl.view.mode).toBe("summary");
    expect(flow.state.phase).toBe("drafting");
  });

  test("a remounted frame resumes the running request instead of showing the summary", async () => {
    const w = world();
    const first = w.frame();
    first.ctrl.setDirectory("/repo");
    first.ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    first.ctrl.startLogging();
    await until(() => first.flow.state.phase === "pick-project", "pick-project");
    void first.flow.chooseProject("p1");
    await until(() => w.polls() > 0, "polling");
    // OpenChamber hides the Work Status (overlay closed): the frame is gone.
    first.flow.cancel();

    const second = w.frame();
    second.ctrl.setDirectory("/repo");
    second.ctrl.setSession({ id: "s1", title: "Session A" });
    await until(() => second.ctrl.view.mode === "flow", "resumed flow");
    w.reply(w.posts[0]!, reply(w.posts[0]!));
    await until(() => second.flow.state.phase === "ready", "ready");
    expect(second.flow.state.draft.hours).toBe(6);
    // No second request into the session.
    expect(w.posts).toHaveLength(1);
  });

  test("Abbrechen forgets the request: a remounted frame shows the summary", async () => {
    const w = world();
    const first = w.frame();
    first.ctrl.setDirectory("/repo");
    first.ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    first.ctrl.startLogging();
    await until(() => first.flow.state.phase === "pick-project", "pick-project");
    void first.flow.chooseProject("p1");
    await until(() => w.polls() > 0, "polling");
    first.ctrl.cancelLogging();
    await until(() => first.ctrl.view.mode === "summary" && (first.ctrl.view as { lines: string[] }).lines.length > 0, "summary");

    const second = w.frame();
    second.ctrl.setSession({ id: "s1", title: "Session A" });
    for (let i = 0; i < 20; i++) await tick();
    expect(second.ctrl.view).toEqual({ mode: "summary", lines: ["Noch nicht geloggt", HINT], button: "Jetzt loggen" });
  });

  test("after a save a remounted frame shows the logged summary, not the old request", async () => {
    const w = world();
    const first = w.frame();
    first.ctrl.setDirectory("/repo");
    first.ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    first.ctrl.startLogging();
    await until(() => first.flow.state.phase === "pick-project", "pick-project");
    void first.flow.chooseProject("p1");
    await until(() => w.posts.length === 1, "request");
    w.reply(w.posts[0]!, reply(w.posts[0]!));
    await until(() => first.flow.state.phase === "ready", "ready");
    await first.flow.save();
    expect(first.flow.state.phase).toBe("done");

    const second = w.frame();
    second.ctrl.setSession({ id: "s1", title: "Session A" });
    for (let i = 0; i < 20; i++) await tick();
    const v = second.ctrl.view;
    expect(v.mode === "summary" && v.button).toBe("Nachloggen");
  });

  test("Nachloggen appends to the bound task although the first log completed it", async () => {
    const w = world();
    const first = w.frame();
    first.ctrl.setDirectory("/repo");
    first.ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    first.ctrl.startLogging();
    await until(() => first.flow.state.phase === "pick-project", "pick-project");
    void first.flow.chooseProject("p1");
    await until(() => w.posts.length === 1, "request");
    w.reply(w.posts[0]!, reply(w.posts[0]!));
    await until(() => first.flow.state.phase === "ready", "ready");
    await first.flow.save();
    expect(first.flow.state.phase).toBe("done");

    const second = w.frame();
    second.ctrl.setDirectory("/repo");
    second.ctrl.setSession({ id: "s1", title: "Session A" });
    await until(() => second.ctrl.view.mode === "summary" && (second.ctrl.view as { button: string | null }).button === "Nachloggen", "Nachloggen");
    second.ctrl.startLogging();
    await until(() => w.posts.length === 2, "second request");
    w.reply(w.posts[1]!, reply(w.posts[1]!));
    await until(() => second.flow.state.phase === "ready", "second ready");
    expect(second.flow.state.target).toBe("new1");
    expect(second.flow.state.message).toBeNull();
    await second.flow.save();
    expect(w.appends).toEqual(["new1"]);
    expect(second.flow.state.phase).toBe("done");
  });

  test("the dialog keeps no request, and its save ends the one the Work Status waits for", async () => {
    const w = world();
    const status = w.frame();
    status.ctrl.setDirectory("/repo");
    status.ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    status.ctrl.startLogging();
    await until(() => status.flow.state.phase === "pick-project", "pick-project");
    void status.flow.chooseProject("p1");
    await until(() => w.posts.length === 1, "request");
    expect([...w.storage.keys()]).toContain("pending:s1");
    status.flow.cancel();

    const dialog = w.frame({ remember: false });
    void dialog.flow.start({ sessionId: "s1", sessionTitle: "Session A", directory: "/repo", messages: [], allowFallback: true });
    await until(() => w.posts.length === 2, "dialog request");
    // The dialog's own request is not kept: its window stays until the user closes it.
    expect((w.storage.get("pending:s1") as { logId: string }).logId).toBe(w.posts[0]!);
    w.reply(w.posts[1]!, reply(w.posts[1]!));
    await until(() => dialog.flow.state.phase === "ready", "dialog ready");
    await dialog.flow.save();
    expect(w.storage.has("pending:s1")).toBe(false);
  });

  test("a request older than the flow's wait is dropped, not continued", async () => {
    const w = world();
    w.storage.set("pending:s1", { logId: "old", startedAt: new Date(2026, 10, 17, 14).getTime(), directory: "/repo" });
    const { ctrl } = w.frame();
    ctrl.setSession({ id: "s1", title: "Session A" });
    for (let i = 0; i < 20; i++) await tick();
    expect(ctrl.view.mode).toBe("summary");
    expect(w.storage.has("pending:s1")).toBe(false);
    expect(w.posts).toHaveLength(0);
  });
});

describe("status controller: log saved through the chat card", () => {
  test("a pending request whose log the card saved is cleared, not continued", async () => {
    const w = world();
    const first = w.frame();
    first.ctrl.setDirectory("/repo");
    first.ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    first.ctrl.startLogging();
    await until(() => first.flow.state.phase === "pick-project", "pick-project");
    void first.flow.chooseProject("p1");
    await until(() => w.posts.length === 1, "request");
    const logId = w.posts[0]!;
    first.flow.cancel();
    expect(w.storage.get("pending:s1")).toMatchObject({ logId });

    // The card saved this log meanwhile.
    w.storage.set(`saved:${logId}`, { taskTitle: "Login gefixt", hours: 6, at: 1 });
    const second = w.frame();
    second.ctrl.setSession({ id: "s1", title: "Session A" });
    for (let i = 0; i < 20; i++) await tick();
    expect(second.ctrl.view.mode).toBe("summary");
    expect(w.storage.has("pending:s1")).toBe(false);
  });

  test("done with a message: the logged view shows it", async () => {
    const { ctrl, emit, view } = setup();
    ctrl.setSession({ id: "s1", title: "Session A" });
    await tick();
    ctrl.startLogging();
    emit("done", "Bereits über die Karte gespeichert.");
    expect(view()).toEqual({ mode: "logged", note: "Bereits über die Karte gespeichert." });
  });
});
