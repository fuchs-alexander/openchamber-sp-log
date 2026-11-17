import { describe, expect, test } from "bun:test";
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
  const emit = (phase: FlowState["phase"]) => {
    state = { ...state, phase };
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
