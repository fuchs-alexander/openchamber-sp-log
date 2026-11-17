import { describe, expect, test } from "bun:test";
import type { GenerateRequest } from "@openchamber/sdk";
import type { Msg } from "../src/log/draft.ts";
import type { MatchCandidate } from "../src/log/match.ts";
import { GatewayError, type Api, type HostLike, type SpProject } from "../src/panel/api.ts";
import type { Binding, Store } from "../src/panel/store.ts";
import { createFlow } from "../src/panel/flow.ts";

const DRAFT_JSON = JSON.stringify({ title: "Login gefixt", summary: "Token-Refresh repariert.", hours: 2.5 });

const MESSAGES: Msg[] = [
  { id: "m1", role: "user", text: "ALTE-ARBEIT", createdAt: 1 },
  { id: "m2", role: "assistant", text: "alte Antwort", createdAt: 2 },
  { id: "m3", role: "user", text: "NEUE-ARBEIT", createdAt: 3 },
  { id: "m4", role: "assistant", text: "neue Antwort", createdAt: 4 },
];

type Gen = string | Error;

function setup(opts: {
  project?: string | null;
  binding?: Binding | null;
  tasks?: MatchCandidate[];
  projects?: SpProject[] | Error;
  generate?: Gen[];
  append?: (taskId: string) => string | Error;
  create?: () => string | Error;
} = {}) {
  const calls = {
    create: [] as { projectId: string; title: string; notes: string }[],
    append: [] as { taskId: string; text: string }[],
    tasks: [] as string[],
    generate: [] as GenerateRequest[],
    setProject: [] as { dir: string; id: string }[],
    setBinding: [] as { sessionId: string; b: Binding }[],
    clearBinding: [] as string[],
    toast: [] as { kind: string; message: string }[],
    close: 0,
  };
  const tasks = opts.tasks ?? [
    { id: "t1", title: "Login-Bug", notesExcerpt: "" },
    { id: "t2", title: "Doku", notesExcerpt: "" },
  ];
  const gens = [...(opts.generate ?? [DRAFT_JSON, JSON.stringify({ taskId: null, reason: "" })])];
  const projects: Map<string, string> = new Map();
  if (opts.project !== null) projects.set("/repo", opts.project ?? "p1");
  let binding: Binding | null = opts.binding ?? null;

  const api: Api = {
    projects: async () => {
      if (opts.projects instanceof Error) throw opts.projects;
      return opts.projects ?? [{ id: "p1", title: "Projekt 1" }];
    },
    tasks: async (projectId) => {
      calls.tasks.push(projectId);
      return tasks;
    },
    create: async (projectId, title, notes) => {
      calls.create.push({ projectId, title, notes });
      const r = opts.create?.() ?? "new1";
      if (r instanceof Error) throw r;
      return r;
    },
    append: async (taskId, text) => {
      calls.append.push({ taskId, text });
      const r = opts.append?.(taskId) ?? taskId;
      if (r instanceof Error) throw r;
      return r;
    },
  };
  const store: Store = {
    getProject: async (dir) => projects.get(dir) ?? null,
    setProject: async (dir, id) => {
      calls.setProject.push({ dir, id });
      projects.set(dir, id);
    },
    getBinding: async () => binding,
    setBinding: async (sessionId, b) => {
      calls.setBinding.push({ sessionId, b });
      binding = b;
    },
    clearBinding: async (sessionId) => {
      calls.clearBinding.push(sessionId);
      binding = null;
    },
  };
  const host: HostLike = {
    request: async () => ({ status: 200, body: "{}" }) as never,
    storage: { get: async () => undefined, set: async () => {}, delete: async () => {} },
    generate: async (req) => {
      calls.generate.push(req);
      const next = gens.shift() ?? "";
      if (next instanceof Error) throw next;
      return { text: next };
    },
    toast: async (t) => {
      calls.toast.push({ kind: t.kind, message: t.message });
    },
    close: async () => {
      calls.close++;
    },
  };
  const flow = createFlow({ api, store, host, now: () => new Date(2026, 10, 17, 12) });
  const item = { sessionId: "s1", sessionTitle: "Session A", directory: "/repo" as string | null, messages: MESSAGES };
  return { flow, calls, item };
}

describe("flow", () => {
  test("flow: first run asks project", async () => {
    const { flow, calls, item } = setup({ project: null });
    await flow.start(item);
    expect(flow.state.phase).toBe("pick-project");
    expect(flow.state.projects).toEqual([{ id: "p1", title: "Projekt 1" }]);
    await flow.chooseProject("p1");
    expect(calls.setProject).toEqual([{ dir: "/repo", id: "p1" }]);
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: missing directory uses global", async () => {
    const { flow, calls, item } = setup({ project: null });
    await flow.start({ ...item, directory: null });
    await flow.chooseProject("p1");
    expect(calls.setProject).toEqual([{ dir: "global", id: "p1" }]);
  });

  test("flow: suggests match", async () => {
    const { flow, calls, item } = setup({ generate: [DRAFT_JSON, JSON.stringify({ taskId: "t1", reason: "gleich" })] });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.target).toBe("t1");
    expect(flow.state.draft).toEqual({ title: "Login gefixt", summary: "Token-Refresh repariert.", hours: 2.5 });
    expect(calls.generate).toHaveLength(2);
    expect(calls.tasks).toEqual(["p1"]);
  });

  test("flow: bound session skips match", async () => {
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "m2" } });
    await flow.start(item);
    expect(calls.generate).toHaveLength(1);
    expect(flow.state.target).toBe("t1");
    const prompt = calls.generate[0]!.prompt;
    expect(prompt).toContain("NEUE-ARBEIT");
    expect(prompt).not.toContain("ALTE-ARBEIT");
  });

  test("flow: stale binding", async () => {
    const { flow, calls, item } = setup({
      binding: { taskId: "t1", lastMessageId: "m2" },
      tasks: [{ id: "t2", title: "Doku", notesExcerpt: "" }],
    });
    await flow.start(item);
    expect(calls.clearBinding).toEqual(["s1"]);
    expect(flow.state.target).toBe("new");
    expect(flow.state.message).toBeTruthy();
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: empty task list skips match", async () => {
    const { flow, calls, item } = setup({ tasks: [] });
    await flow.start(item);
    expect(calls.generate).toHaveLength(1);
    expect(flow.state.target).toBe("new");
  });

  test("flow: match failure falls back to new", async () => {
    const { flow, item } = setup({ generate: [DRAFT_JSON, new Error("NO_MODEL")] });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.target).toBe("new");
  });

  test("flow: model failure", async () => {
    const { flow, calls, item } = setup({ generate: [new Error("NO_MODEL"), new Error("NO_MODEL")] });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft).toEqual({ title: "", summary: "", hours: null });
    expect(flow.state.target).toBe("new");
    await flow.save();
    expect(calls.create).toHaveLength(0);
    expect(calls.append).toHaveLength(0);
    expect(flow.state.message).toBeTruthy();
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: save new binds session", async () => {
    const { flow, calls, item } = setup();
    await flow.start(item);
    expect(flow.state.target).toBe("new");
    await flow.save();
    expect(calls.create).toHaveLength(1);
    expect(calls.create[0]!.projectId).toBe("p1");
    expect(calls.create[0]!.title).toBe("Login gefixt");
    expect(calls.create[0]!.notes).toBe(
      "### 2026-11-17 · Login gefixt · ≈ 2,5 h\nToken-Refresh repariert.\n\n<sub>OpenChamber: Session A</sub>",
    );
    expect(calls.setBinding).toEqual([{ sessionId: "s1", b: { taskId: "new1", lastMessageId: "m4" } }]);
    expect(calls.toast).toEqual([{ kind: "success", message: "In Super Productivity geloggt" }]);
    expect(calls.close).toBe(1);
    expect(flow.state.phase).toBe("done");
  });

  test("flow: append uses edited draft", async () => {
    const { flow, calls, item } = setup();
    await flow.start(item);
    flow.setTarget("t2");
    flow.edit({ title: "Anders", hours: 1 });
    await flow.save();
    expect(calls.append).toHaveLength(1);
    expect(calls.append[0]!.taskId).toBe("t2");
    expect(calls.append[0]!.text).toStartWith("### 2026-11-17 · Anders · ≈ 1 h\n");
    expect(calls.setBinding[0]!.b).toEqual({ taskId: "t2", lastMessageId: "m4" });
  });

  test("flow: append task-gone", async () => {
    const { flow, calls, item } = setup({
      generate: [DRAFT_JSON, JSON.stringify({ taskId: "t1", reason: "" })],
      append: () => new GatewayError(404, "task-gone"),
    });
    await flow.start(item);
    expect(flow.state.target).toBe("t1");
    await flow.save();
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.target).toBe("new");
    expect(flow.state.message).toBeTruthy();
    expect(calls.setBinding).toHaveLength(0);
    expect(calls.close).toBe(0);
  });

  test("flow: double save", async () => {
    const { flow, calls, item } = setup();
    await flow.start(item);
    await Promise.all([flow.save(), flow.save()]);
    expect(calls.create).toHaveLength(1);
  });

  test("flow: disconnected", async () => {
    const { flow, item } = setup({ projects: new GatewayError(0, "disconnected") });
    await flow.start(item);
    expect(flow.state.phase).toBe("disconnected");
  });

  test("flow: save error keeps draft", async () => {
    const { flow, calls, item } = setup({ create: () => new GatewayError(503, "sp-unavailable") });
    await flow.start(item);
    await flow.save();
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.message).toBeTruthy();
    expect(flow.state.draft.title).toBe("Login gefixt");
    expect(calls.setBinding).toHaveLength(0);
  });
});
