import { describe, expect, test } from "bun:test";
import { HostRequestError, type GenerateRequest, type GuestRequest, type GuestRequestResult } from "@openchamber/sdk";
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

const FALLBACK = "Session-Entwurf nicht verfügbar – Entwurf vom Small Model.";

const ok = (body: unknown): GuestRequestResult => ({ status: 200, body: JSON.stringify(body) });

/** A fake service: POST starts, GET answers with the polls in order (the last one repeats). */
function fakeService(polls: { state: string; text?: string; sessionStatus: string }[]) {
  const queue = [...polls];
  return (req: GuestRequest): GuestRequestResult => {
    if (req.method === "POST") return ok({ started: true });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return ok(next);
  };
}

const sessionReply = (logId: string) =>
  `Hier der Eintrag:\n${JSON.stringify({ logId, title: "Aus der Session", summary: "Session-Zusammenfassung.", hours: 1.5 })}`;

type Gen = string | Error;

function setup(opts: {
  project?: string | null;
  binding?: Binding | null;
  tasks?: MatchCandidate[];
  projects?: SpProject[] | Error;
  generate?: Gen[];
  append?: (taskId: string) => string | Error;
  create?: () => string | Error;
  setBindingError?: Error;
  setProject?: () => Promise<void>;
  /** The extension's service; by default there is none (`NO_SERVICE`). */
  service?: (req: GuestRequest) => GuestRequestResult | Error;
  now?: () => Date;
  ids?: string[];
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
    service: [] as GuestRequest[],
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
      await opts.setProject?.();
    },
    getBinding: async () => binding,
    setBinding: async (sessionId, b) => {
      calls.setBinding.push({ sessionId, b });
      if (opts.setBindingError) throw opts.setBindingError;
      binding = b;
    },
    clearBinding: async (sessionId) => {
      calls.clearBinding.push(sessionId);
      binding = null;
    },
  };
  const host: HostLike = {
    request: async () => ({ status: 200, body: "{}" }) as never,
    serviceRequest: async (req) => {
      calls.service.push(req);
      const r = opts.service?.(req) ?? new HostRequestError("NO_SERVICE", "no service");
      if (r instanceof Error) throw r;
      return r;
    },
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
  const ids = [...(opts.ids ?? ["log-1", "log-2", "log-3"])];
  const flow = createFlow({
    api,
    store,
    host,
    now: opts.now ?? (() => new Date(2026, 10, 17, 12)),
    newId: () => ids.shift() ?? "log-x",
    sleep: () => new Promise((r) => setTimeout(r, 0)),
  });
  const item = { sessionId: "s1", sessionTitle: "Session A", directory: "/repo" as string | null, messages: MESSAGES };
  return { flow, calls, item };
}

describe("flow: session draft", () => {
  test("flow: uses session draft", async () => {
    const { flow, calls, item } = setup({
      service: fakeService([
        { state: "pending", sessionStatus: "busy" },
        { state: "done", text: sessionReply("log-1"), sessionStatus: "idle" },
      ]),
      generate: [JSON.stringify({ taskId: "t1", reason: "gleich" })],
    });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft).toEqual({ title: "Aus der Session", summary: "Session-Zusammenfassung.", hours: 1.5 });
    expect(flow.state.target).toBe("t1");
    expect(flow.state.message).toBeNull();
    // generate only matched against the SP tasks
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0]!.prompt).toContain("Login-Bug");
    const post = calls.service[0]!;
    expect(post.method).toBe("POST");
    expect(post.path).toBe("/draft");
    const body = JSON.parse(post.body!);
    expect(body.sessionId).toBe("s1");
    expect(body.logId).toBe("log-1");
    expect(body.prompt).toContain("[SP-Log-Anfrage log-1]");
    expect(calls.service[1]).toMatchObject({ method: "GET", path: "/draft", query: { sessionId: "s1", logId: "log-1" } });
  });

  test("flow: falls back without service", async () => {
    const { flow, calls, item } = setup();
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft).toEqual({ title: "Login gefixt", summary: "Token-Refresh repariert.", hours: 2.5 });
    expect(calls.generate).toHaveLength(2);
    expect(flow.state.message).toContain(FALLBACK);
  });

  test("flow: falls back on http error", async () => {
    const { flow, calls, item } = setup({ service: () => ({ status: 502, body: '{"error":"NO_SESSION"}' }) });
    await flow.start(item);
    expect(flow.state.draft.title).toBe("Login gefixt");
    expect(calls.generate).toHaveLength(2);
    expect(flow.state.message).toContain(FALLBACK);
  });

  test("flow: falls back on failed and invalid draft", async () => {
    for (const poll of [
      { state: "failed", sessionStatus: "unknown" },
      { state: "done", text: sessionReply("other-log"), sessionStatus: "idle" },
    ]) {
      const { flow, item } = setup({ service: fakeService([poll]) });
      await flow.start(item);
      expect(flow.state.draft.title).toBe("Login gefixt");
      expect(flow.state.message).toContain(FALLBACK);
    }
  });

  test("flow: falls back on timeout", async () => {
    let t = new Date(2026, 10, 17, 12).getTime();
    const now = () => {
      t += 60_000; // every look at the clock is a minute later
      return new Date(t);
    };
    const { flow, calls, item } = setup({ now, service: fakeService([{ state: "pending", sessionStatus: "busy" }]) });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft.title).toBe("Login gefixt");
    expect(flow.state.message).toContain(FALLBACK);
    const gets = calls.service.filter((r) => r.method === "GET").length;
    expect(gets).toBeGreaterThan(3);
    expect(gets).toBeLessThanOrEqual(10);
  });

  test("flow: busy message", async () => {
    const { flow, item } = setup({
      service: fakeService([
        { state: "pending", sessionStatus: "busy" },
        { state: "done", text: sessionReply("log-1"), sessionStatus: "idle" },
      ]),
    });
    const messages: (string | null)[] = [];
    flow.subscribe((s) => messages.push(s.message));
    await flow.start(item);
    expect(messages).toContain("Session erstellt Entwurf …");
    expect(messages).toContain("Wartet, bis die Session frei ist …");
  });

  test("flow: waiting message", async () => {
    const { flow, item } = setup({
      service: fakeService([
        { state: "pending", sessionStatus: "waiting" },
        { state: "done", text: sessionReply("log-1"), sessionStatus: "idle" },
      ]),
    });
    const messages: (string | null)[] = [];
    flow.subscribe((s) => messages.push(s.message));
    await flow.start(item);
    expect(messages).toContain("Session wartet auf deine Eingabe – bitte dort antworten.");
    expect(flow.state.draft.title).toBe("Aus der Session");
  });

  test("flow: restart cancels polling", async () => {
    const { flow, calls, item } = setup({
      service: (req) => {
        if (req.method === "POST") return ok({ started: true });
        if (req.query?.logId === "log-2") return ok({ state: "done", text: sessionReply("log-2"), sessionStatus: "idle" });
        return ok({ state: "pending", sessionStatus: "busy" });
      },
    });
    const first = flow.start(item);
    while (!calls.service.some((r) => r.method === "GET")) await new Promise((r) => setTimeout(r, 0));
    await flow.start({ ...item, sessionId: "s2" });
    await first;
    const firstGets = () => calls.service.filter((r) => r.query?.logId === "log-1").length;
    const before = firstGets();
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(firstGets()).toBe(before);
    expect(flow.state.draft.title).toBe("Aus der Session");
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: cancel stops polling", async () => {
    const { flow, calls, item } = setup({ service: fakeService([{ state: "pending", sessionStatus: "busy" }]) });
    const run = flow.start(item);
    while (!calls.service.some((r) => r.method === "GET")) await new Promise((r) => setTimeout(r, 0));
    flow.cancel();
    await run;
    const before = calls.service.length;
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    expect(calls.service.length).toBe(before);
    expect(calls.generate).toHaveLength(0);
  });
});

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
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2 } });
    await flow.start(item);
    expect(calls.generate).toHaveLength(1);
    expect(flow.state.target).toBe("t1");
    const prompt = calls.generate[0]!.prompt;
    expect(prompt).toContain("NEUE-ARBEIT");
    expect(prompt).not.toContain("ALTE-ARBEIT");
  });

  test("flow: missing lastMessageId falls back to createdAt", async () => {
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "gone", lastCreatedAt: 2 } });
    await flow.start(item);
    const prompt = calls.generate[0]!.prompt;
    expect(prompt).toContain("NEUE-ARBEIT");
    expect(prompt).not.toContain("ALTE-ARBEIT");
    expect(flow.state.message).toBe(FALLBACK);
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: lost log point estimates all and warns", async () => {
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "gone", lastCreatedAt: null } });
    await flow.start(item);
    const prompt = calls.generate[0]!.prompt;
    expect(prompt).toContain("ALTE-ARBEIT");
    expect(prompt).toContain("NEUE-ARBEIT");
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.message).toBe(
      FALLBACK +
        " Hinweis: Letzter Log-Stand nicht gefunden – Schätzung umfasst möglicherweise bereits geloggte Arbeit. Bitte Stunden prüfen.",
    );
  });

  test("flow: binding save failure warns but finishes", async () => {
    const { flow, calls, item } = setup({ setBindingError: new Error("STORAGE") });
    await flow.start(item);
    await flow.save();
    expect(calls.create).toHaveLength(1);
    expect(calls.toast).toEqual([
      {
        kind: "error",
        message: "Geloggt, aber Session-Bindung konnte nicht gespeichert werden – beim nächsten Log Stunden prüfen.",
      },
    ]);
    expect(flow.state.phase).toBe("done");
    expect(calls.close).toBe(1);
  });

  test("flow: chooseProject enters drafting before storage resolves", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { flow, item } = setup({ setProject: () => gate });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    const pending = flow.chooseProject("p1");
    expect(flow.state.phase).toBe("drafting");
    void flow.chooseProject("p1"); // ignored: not in pick-project/ready
    release();
    await pending;
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: stale binding", async () => {
    const { flow, calls, item } = setup({
      binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2 },
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
    expect(calls.setBinding).toEqual([{ sessionId: "s1", b: { taskId: "new1", lastMessageId: "m4", lastCreatedAt: 4 } }]);
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
    expect(calls.setBinding[0]!.b).toEqual({ taskId: "t2", lastMessageId: "m4", lastCreatedAt: 4 });
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
