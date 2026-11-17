import { describe, expect, test } from "bun:test";
import { HostRequestError, type GenerateRequest, type GuestRequest, type GuestRequestResult } from "@openchamber/sdk";
import type { Msg } from "../src/log/draft.ts";
import type { MatchCandidate } from "../src/log/match.ts";
import { GatewayError, type Api, type BoundTask, type HostLike, type SaveResult, type SpProject } from "../src/panel/api.ts";
import type { Binding, PendingStore, SavedLog, Store } from "../src/panel/store.ts";
import { createFlow } from "../src/panel/flow.ts";
import { formatSinceTime } from "../src/log/session-draft.ts";

const DRAFT_JSON = JSON.stringify({ title: "Login gefixt", summary: "Token-Refresh repariert.", hours: 2.5 });

const MESSAGES: Msg[] = [
  { id: "m1", role: "user", text: "ALTE-ARBEIT", createdAt: 1 },
  { id: "m2", role: "assistant", text: "alte Antwort", createdAt: 2 },
  { id: "m3", role: "user", text: "NEUE-ARBEIT", createdAt: 3 },
  { id: "m4", role: "assistant", text: "neue Antwort", createdAt: 4 },
];

const FALLBACK = "Session-Entwurf nicht verfügbar – Entwurf vom Small Model.";
const WAITING_FALLBACK = "Session wartet auf deine Eingabe – Entwurf vom Small Model.";
const WORKING = "Session arbeitet – Entwurf folgt, sobald sie fertig ist …";
const LOG_POINT_LOST =
  "Hinweis: Letzter Log-Stand nicht gefunden – Schätzung umfasst möglicherweise bereits geloggte Arbeit. Bitte Stunden prüfen.";

/** A service whose session answers every request at once with a draft for its logId. */
const answeringService = (req: GuestRequest): GuestRequestResult =>
  req.method === "POST"
    ? ok({ started: true })
    : ok({ state: "done", text: sessionReply(req.query!.logId!), sessionStatus: "idle" });

const promptOf = (req: GuestRequest): string => JSON.parse(req.body!).prompt;

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

/** The fields a binding from before 0.3.0 lacks. */
const LEGACY = { taskTitle: null, projectTitle: null, logs: null };

type Gen = string | Error;

function setup(opts: {
  project?: string | null;
  binding?: Binding | null;
  tasks?: MatchCandidate[];
  projects?: SpProject[] | Error;
  generate?: Gen[];
  append?: (taskId: string) => string | Error | SaveResult;
  create?: () => string | Error | SaveResult;
  /** GET /tasks/:id; default: the open tasks, anything else is gone (null). */
  task?: (id: string) => BoundTask | null | Error;
  setBindingError?: Error;
  setProject?: () => Promise<void>;
  /** The extension's service; by default there is none (`NO_SERVICE`). */
  service?: (req: GuestRequest) => GuestRequestResult | Error;
  now?: () => Date;
  ids?: string[];
  closeOnDone?: () => boolean;
  /** `saved:<logId>` markers already in storage. */
  saved?: Record<string, SavedLog>;
  pending?: Pick<PendingStore, "set" | "clear">;
} = {}) {
  const calls = {
    create: [] as { projectId: string; title: string; notes: string; hours: number; logTitle: string }[],
    append: [] as { taskId: string; text: string; hours: number; logTitle: string }[],
    tasks: [] as string[],
    task: [] as string[],
    generate: [] as GenerateRequest[],
    setProject: [] as { dir: string; id: string }[],
    setBinding: [] as { sessionId: string; b: Binding }[],
    clearBinding: [] as string[],
    toast: [] as { kind: string; message: string }[],
    close: 0,
    service: [] as GuestRequest[],
    setSaved: [] as { logId: string; s: SavedLog }[],
    markSeen: [] as { logId: string; at: number }[],
  };
  const saved = new Map<string, SavedLog>(Object.entries(opts.saved ?? {}));
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
    task: async (id) => {
      calls.task.push(id);
      const r = opts.task ? opts.task(id) : (() => {
        const open = tasks.find((t) => t.id === id);
        return open ? { id, title: open.title, isDone: false } : null;
      })();
      if (r instanceof Error) throw r;
      return r;
    },
    create: async (projectId, title, notes, hours, logTitle) => {
      calls.create.push({ projectId, title, notes, hours, logTitle });
      const r = opts.create?.() ?? "new1";
      if (r instanceof Error) throw r;
      return typeof r === "string" ? { id: r, timeBooked: true, timeError: null, completed: true } : r;
    },
    append: async (taskId, text, hours, logTitle) => {
      calls.append.push({ taskId, text, hours, logTitle });
      const r = opts.append?.(taskId) ?? taskId;
      if (r instanceof Error) throw r;
      return typeof r === "string" ? { id: r, timeBooked: true, timeError: null, completed: true } : r;
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
    getSaved: async (logId) => saved.get(logId) ?? null,
    setSaved: async (logId, s) => {
      calls.setSaved.push({ logId, s });
      saved.set(logId, s);
    },
    getSeen: async () => null,
    markSeen: async (logId, at) => {
      calls.markSeen.push({ logId, at });
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
    closeOnDone: opts.closeOnDone,
    pending: opts.pending,
  });
  const item = { sessionId: "s1", sessionTitle: "Session A", directory: "/repo" as string | null, messages: MESSAGES };
  return { flow, calls, item, saved };
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
    expect(messages).toContain(WORKING);
    expect(messages).not.toContain("Wartet, bis die Session frei ist …");
    expect(messages).not.toContain("Session erstellt Entwurf …");
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

  test("flow: waiting session falls back without sending", async () => {
    const { flow, calls, item } = setup({
      service: (req) => (req.method === "POST" ? { status: 409, body: '{"error":"session-waiting"}' } : ok({ state: "pending", sessionStatus: "idle" })),
    });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft.title).toBe("Login gefixt");
    expect(flow.state.message).toContain(WAITING_FALLBACK);
    expect(flow.state.message).not.toContain(FALLBACK);
    expect(calls.service.filter((r) => r.method === "GET")).toHaveLength(0);
  });

  test("flow: poll host timeout keeps polling", async () => {
    let gets = 0;
    const { flow, item } = setup({
      service: (req) => {
        if (req.method === "POST") return ok({ started: true });
        gets++;
        if (gets <= 2) return { status: 504, body: '{"error":"host-timeout"}' };
        return ok({ state: "done", text: sessionReply("log-1"), sessionStatus: "idle" });
      },
    });
    await flow.start(item);
    expect(gets).toBe(3);
    expect(flow.state.draft.title).toBe("Aus der Session");
    expect(flow.state.message).toBeNull();
  });

  test("flow: start host timeout falls back", async () => {
    const { flow, item } = setup({ service: () => ({ status: 504, body: '{"error":"host-timeout"}' }) });
    await flow.start(item);
    expect(flow.state.draft.title).toBe("Login gefixt");
    expect(flow.state.message).toContain(FALLBACK);
  });

  test("flow: unbound session drafts the whole session", async () => {
    const { flow, calls, item } = setup({ service: answeringService });
    await flow.start(item);
    expect(promptOf(calls.service[0]!)).toContain("die ganze Session");
  });

  test("flow: binding from 0.1.0 limits the draft to work after the logged message", async () => {
    const { flow, calls, item } = setup({
      service: answeringService,
      binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY },
    });
    await flow.start(item);
    const prompt = promptOf(calls.service[0]!);
    expect(prompt).toContain('Berücksichtige nur Arbeit nach dieser Nachricht: "alte Antwort"');
    expect(prompt).not.toContain("die ganze Session");
    expect(flow.state.draft.title).toBe("Aus der Session");
    expect(flow.state.message).toBeNull();
  });

  test("flow: binding from 0.1.0 with a lost message warns to check the hours", async () => {
    const { flow, calls, item } = setup({
      service: answeringService,
      binding: { taskId: "t1", lastMessageId: "gone", lastCreatedAt: null, lastLogId: null, ...LEGACY },
    });
    await flow.start(item);
    const prompt = promptOf(calls.service[0]!);
    expect(prompt).not.toContain("Berücksichtige nur Arbeit nach");
    expect(flow.state.draft.title).toBe("Aus der Session");
    expect(flow.state.message).toBe(LOG_POINT_LOST);
  });

  test("flow: three saved logs in one session, a cancelled draft does not move the boundary", async () => {
    const more = (n: number): Msg[] =>
      Array.from({ length: n }, (_, i) => ({ id: `m${i + 1}`, role: i % 2 ? "assistant" : "user", text: `Nachricht ${i + 1}`, createdAt: i + 1 }) as Msg);
    const { flow, calls, item } = setup({
      service: answeringService,
      tasks: [{ id: "new1", title: "Aus der Session", notesExcerpt: "" }],
      generate: [JSON.stringify({ taskId: null, reason: "" })],
      ids: ["log-1", "log-2", "log-3", "log-4"],
    });
    const posts = () => calls.service.filter((r) => r.method === "POST" && r.path === "/draft");

    // log 1: no binding, whole session
    await flow.start({ ...item, messages: more(4) });
    expect(promptOf(posts()[0]!)).toContain("die ganze Session");
    flow.setTarget("new");
    await flow.save();
    expect(calls.create).toHaveLength(1);
    expect(calls.setBinding.at(-1)!.b).toMatchObject({ taskId: "new1", lastMessageId: "m4", lastCreatedAt: 4, lastLogId: "log-1" });

    // log 2: after log-1, appended to the bound task
    await flow.start({ ...item, messages: more(6) });
    const p2 = promptOf(posts()[1]!);
    expect(p2).toContain("Berücksichtige nur Arbeit nach der Anfrage [SP-Log-Anfrage log-1]");
    expect(flow.state.target).toBe("new1");
    await flow.save();
    expect(calls.append.map((a) => a.taskId)).toEqual(["new1"]);
    expect(calls.setBinding.at(-1)!.b).toMatchObject({ taskId: "new1", lastMessageId: "m6", lastCreatedAt: 6, lastLogId: "log-2" });

    // cancelled: drafted (log-3) but never saved
    await flow.start({ ...item, messages: more(8) });
    expect(flow.state.phase).toBe("ready");
    flow.cancel();
    expect(calls.setBinding).toHaveLength(2);

    // log 3: still after log-2
    await flow.start({ ...item, messages: more(10) });
    const p3 = promptOf(posts()[3]!);
    expect(p3).toContain("Berücksichtige nur Arbeit nach der Anfrage [SP-Log-Anfrage log-2]");
    expect(p3).not.toContain("log-1");
    expect(p3).not.toContain("log-3");
    await flow.save();
    expect(calls.append.map((a) => a.taskId)).toEqual(["new1", "new1"]);
    expect(calls.setBinding.at(-1)!.b).toMatchObject({ taskId: "new1", lastMessageId: "m10", lastCreatedAt: 10, lastLogId: "log-4" });
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
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY } });
    await flow.start(item);
    expect(calls.generate).toHaveLength(1);
    expect(flow.state.target).toBe("t1");
    const prompt = calls.generate[0]!.prompt;
    expect(prompt).toContain("NEUE-ARBEIT");
    expect(prompt).not.toContain("ALTE-ARBEIT");
  });

  test("flow: missing lastMessageId falls back to createdAt", async () => {
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "gone", lastCreatedAt: 2, lastLogId: null, ...LEGACY } });
    await flow.start(item);
    const prompt = calls.generate[0]!.prompt;
    expect(prompt).toContain("NEUE-ARBEIT");
    expect(prompt).not.toContain("ALTE-ARBEIT");
    expect(flow.state.message).toBe(FALLBACK);
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: lost log point estimates all and warns", async () => {
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "gone", lastCreatedAt: null, lastLogId: null, ...LEGACY } });
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
      binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY },
      tasks: [{ id: "t2", title: "Doku", notesExcerpt: "" }],
    });
    await flow.start(item);
    expect(calls.clearBinding).toEqual(["s1"]);
    expect(flow.state.target).toBe("new");
    expect(flow.state.message).toBeTruthy();
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: a done bound task stays the target and is offered as (erledigt)", async () => {
    const { flow, calls, item } = setup({
      binding: { taskId: "t9", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY },
      task: (id) => (id === "t9" ? { id: "t9", title: "Alt", isDone: true } : null),
    });
    await flow.start(item);
    expect(calls.task).toEqual(["t9"]);
    expect(calls.clearBinding).toHaveLength(0);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.target).toBe("t9");
    expect(flow.state.message).toBe(FALLBACK);
    // only the draft: no matching for a bound session
    expect(calls.generate).toHaveLength(1);
    expect(flow.state.tasks.map((t) => t.id)).toEqual(["t9", "t1", "t2"]);
    expect(flow.state.tasks[0]).toMatchObject({ id: "t9", title: "Alt", isDone: true });
    flow.setTarget("t1");
    flow.setTarget("t9");
    expect(flow.state.target).toBe("t9");
    await flow.save();
    expect(calls.append.map((a) => a.taskId)).toEqual(["t9"]);
    expect(calls.create).toHaveLength(0);
    expect(calls.setBinding[0]!.b).toMatchObject({ taskId: "t9", taskTitle: "Alt" });
  });

  test("flow: an open bound task in the list needs no lookup", async () => {
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY } });
    await flow.start(item);
    expect(flow.state.target).toBe("t1");
    expect(calls.task).toEqual([]);
    expect(flow.state.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
  });

  test("flow: bound task gone (404) → binding cleared, new task, message", async () => {
    const { flow, calls, item } = setup({
      binding: { taskId: "t9", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY },
      task: () => null,
    });
    await flow.start(item);
    expect(calls.task).toEqual(["t9"]);
    expect(calls.clearBinding).toEqual(["s1"]);
    expect(flow.state.target).toBe("new");
    expect(flow.state.message).toContain("Es wird eine neue Aufgabe angelegt.");
    expect(flow.state.tasks.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(flow.state.phase).toBe("ready");
  });

  test("flow: bound task lookup fails → load error, binding kept", async () => {
    const { flow, calls, item } = setup({
      binding: { taskId: "t9", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY },
      task: () => new GatewayError(503, "sp-unreachable"),
    });
    await flow.start(item);
    expect(flow.state.phase).toBe("error");
    expect(calls.clearBinding).toHaveLength(0);
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
    expect(calls.setBinding).toMatchObject([{ sessionId: "s1", b: { taskId: "new1", lastMessageId: "m4", lastCreatedAt: 4, lastLogId: null } }]);
    expect(calls.toast).toEqual([{ kind: "success", message: "In Super Productivity geloggt" }]);
    expect(calls.close).toBe(1);
    expect(flow.state.phase).toBe("done");
  });

  test("flow: passes the hours to create and append", async () => {
    const a = setup();
    await a.flow.start(a.item);
    await a.flow.save();
    expect(a.calls.create[0]!.hours).toBe(2.5);
    const b = setup();
    await b.flow.start(b.item);
    b.flow.setTarget("t2");
    b.flow.edit({ hours: 0.75 });
    await b.flow.save();
    expect(b.calls.append[0]!.hours).toBe(0.75);
  });

  test("flow: passes the draft title as logTitle to create and append", async () => {
    const a = setup();
    await a.flow.start(a.item);
    a.flow.edit({ title: "  Neuer Titel  " });
    await a.flow.save();
    expect(a.calls.create[0]!.logTitle).toBe("Neuer Titel");
    const b = setup();
    await b.flow.start(b.item);
    b.flow.setTarget("t2");
    await b.flow.save();
    expect(b.calls.append[0]!.logTitle).toBe("Login gefixt");
  });

  test("flow: time not booked → error toast, still binds and finishes", async () => {
    const { flow, calls, item } = setup({ create: () => ({ id: "new1", timeBooked: false, timeError: "sp-time-rejected", completed: true }) });
    await flow.start(item);
    await flow.save();
    expect(calls.toast).toEqual([
      { kind: "error", message: "Geloggt, aber Zeit konnte in Super Productivity nicht erfasst werden – bitte dort nachtragen." },
    ]);
    expect(calls.setBinding).toMatchObject([{ sessionId: "s1", b: { taskId: "new1" } }]);
    expect(calls.service.filter((r) => r.path === "/logged")).toHaveLength(1);
    expect(calls.close).toBe(1);
    expect(flow.state.phase).toBe("done");
  });

  test("flow: no time booking reported (hours 0 / old gateway) → success toast", async () => {
    const { flow, calls, item } = setup({ create: () => ({ id: "new1", timeBooked: null, timeError: null, completed: true }) });
    await flow.start(item);
    flow.edit({ hours: 0 });
    await flow.save();
    expect(calls.create[0]!.hours).toBe(0);
    expect(calls.toast).toEqual([{ kind: "success", message: "In Super Productivity geloggt" }]);
  });

  test("flow: reports a saved log to the service", async () => {
    const { flow, calls, item } = setup();
    await flow.start(item);
    await flow.save();
    const logged = calls.service.filter((r) => r.path === "/logged");
    expect(logged).toHaveLength(1);
    expect(logged[0]!.method).toBe("POST");
    expect(JSON.parse(logged[0]!.body!)).toEqual({ sessionId: "s1", at: new Date(2026, 10, 17, 12).getTime(), hours: 2.5 });
    // NO_SERVICE is not fatal
    expect(calls.toast).toEqual([{ kind: "success", message: "In Super Productivity geloggt" }]);
    expect(flow.state.phase).toBe("done");
  });

  test("flow: no service report when the save fails", async () => {
    const { flow, calls, item } = setup({ create: () => new Error("boom") });
    await flow.start(item);
    await flow.save();
    expect(calls.service.filter((r) => r.path === "/logged")).toHaveLength(0);
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
    expect(calls.setBinding[0]!.b).toMatchObject({ taskId: "t2", lastMessageId: "m4", lastCreatedAt: 4, lastLogId: null });
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

describe("flow: binding details", () => {
  const AT = new Date(2026, 10, 17, 12).getTime();

  test("save of a new task records titles and the first log", async () => {
    const { flow, calls, item } = setup();
    await flow.start(item);
    await flow.save();
    expect(calls.setBinding[0]!.b).toEqual({
      taskId: "new1",
      lastMessageId: "m4",
      lastCreatedAt: 4,
      lastLogId: null,
      taskTitle: "Login gefixt",
      projectTitle: "Projekt 1",
      logs: [{ at: AT, hours: 2.5 }],
      directory: "/repo",
    });
  });

  test("save accepts more than 24h up to 100h, refuses above", async () => {
    const big = setup();
    await big.flow.start(big.item);
    big.flow.edit({ hours: 30 });
    await big.flow.save();
    expect(big.calls.setBinding[0]!.b).toMatchObject({ logs: [{ at: AT, hours: 30 }] });

    const over = setup();
    await over.flow.start(over.item);
    over.flow.edit({ hours: 100.5 });
    await over.flow.save();
    expect(over.calls.setBinding).toHaveLength(0);
    expect(over.flow.state.message).toBe("Bitte die Stunden (0 bis 100) eingeben.");
  });

  test("save to an existing task appends to the logs of the binding", async () => {
    const { flow, calls, item } = setup({
      binding: {
        taskId: "t1",
        lastMessageId: "m2",
        lastCreatedAt: 2,
        lastLogId: null,
        taskTitle: "Login-Bug",
        projectTitle: "Projekt 1",
        logs: [{ at: 1000, hours: 1 }],
      },
    });
    await flow.start(item);
    flow.edit({ hours: 0.75 });
    await flow.save();
    expect(calls.setBinding[0]!.b).toMatchObject({
      taskId: "t1",
      taskTitle: "Login-Bug",
      projectTitle: "Projekt 1",
      logs: [{ at: 1000, hours: 1 }, { at: AT, hours: 0.75 }],
    });
  });

  test("a binding from before 0.3.0 starts its log list with this save", async () => {
    const { flow, calls, item } = setup({ binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY } });
    await flow.start(item);
    flow.setTarget("t2");
    await flow.save();
    expect(calls.setBinding[0]!.b).toMatchObject({ taskId: "t2", taskTitle: "Doku", projectTitle: "Projekt 1", logs: [{ at: AT, hours: 2.5 }] });
  });
});

describe("flow: without messages (Work Status)", () => {
  const NO_DRAFT = "Session-Entwurf nicht möglich – bitte über … → Export → Nach Super Productivity loggen.";

  test("no messages and no session draft: error, Small Model is not asked", async () => {
    const { flow, calls, item } = setup();
    await flow.start({ ...item, messages: [] });
    expect(flow.state.phase).toBe("error");
    expect(flow.state.message).toBe(NO_DRAFT);
    expect(calls.generate).toHaveLength(0);
  });

  test("no messages and a waiting session: error, Small Model is not asked", async () => {
    const { flow, calls, item } = setup({
      service: (req) => (req.method === "POST" ? { status: 409, body: '{"error":"session-waiting"}' } : ok({ state: "pending", sessionStatus: "idle" })),
    });
    await flow.start({ ...item, messages: [] });
    expect(flow.state.phase).toBe("error");
    expect(flow.state.message).toBe(NO_DRAFT);
    expect(calls.generate).toHaveLength(0);
  });

  test("allowFallback false forbids the Small Model even with messages", async () => {
    const { flow, calls, item } = setup();
    await flow.start({ ...item, allowFallback: false });
    expect(flow.state.phase).toBe("error");
    expect(flow.state.message).toBe(NO_DRAFT);
    expect(calls.generate).toHaveLength(0);
  });

  test("no messages: the session draft works and saving keeps the bound message", async () => {
    const { flow, calls, item } = setup({
      service: answeringService,
      binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: "old-log", ...LEGACY },
    });
    await flow.start({ ...item, messages: [] });
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft.title).toBe("Aus der Session");
    await flow.save();
    expect(calls.setBinding[0]!.b).toMatchObject({ taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: "log-1" });
    expect(flow.state.phase).toBe("done");
  });
});

describe("flow: review fixes", () => {
  test("save stores the session's directory in the binding", async () => {
    const { flow, calls, item } = setup();
    await flow.start(item);
    await flow.save();
    expect(calls.setBinding[0]!.b.directory).toBe("/repo");
  });

  test("save without directory stores null", async () => {
    const { flow, calls, item } = setup({ project: null });
    await flow.start({ ...item, directory: null });
    await flow.chooseProject("p1");
    await flow.save();
    expect(calls.setBinding[0]!.b.directory).toBeNull();
  });

  test("allowFallback true keeps the Small Model draft without messages (dialog)", async () => {
    const { flow, calls, item } = setup();
    await flow.start({ ...item, messages: [], allowFallback: true });
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft.title).toBe("Login gefixt");
    expect(calls.generate.length).toBeGreaterThan(0);
  });

  test("closeOnDone false: no host.close after save (Work Status)", async () => {
    const { flow, calls, item } = setup({ closeOnDone: () => false });
    await flow.start(item);
    await flow.save();
    expect(flow.state.phase).toBe("done");
    expect(calls.close).toBe(0);
  });
});

describe("flow: sinceTime for the multi-commit estimate", () => {
  const boundary = (p: string) => p.match(/Zeitpunkt der Grenze: (\S+) \(für git log --since\)\./)?.[1] ?? null;

  test("bound session: the time of the last saved log", async () => {
    const { flow, calls, item } = setup({
      service: answeringService,
      binding: {
        taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: "old-log", taskTitle: null, projectTitle: null,
        logs: [{ at: 1000, hours: 1 }, { at: 5_000_000, hours: 2 }],
      },
    });
    await flow.start(item);
    expect(boundary(promptOf(calls.service[0]!))).toBe(formatSinceTime(5_000_000));
  });

  test("bound session without logs: lastCreatedAt", async () => {
    const { flow, calls, item } = setup({
      service: answeringService,
      binding: { taskId: "t1", lastMessageId: "m2", lastCreatedAt: 2, lastLogId: null, ...LEGACY },
    });
    await flow.start(item);
    expect(boundary(promptOf(calls.service[0]!))).toBe(formatSinceTime(2));
  });

  test("unbound session: createdAt of the first message", async () => {
    const { flow, calls, item } = setup({ service: answeringService });
    await flow.start({ ...item, messages: [{ ...MESSAGES[0]!, createdAt: 7_000 }, ...MESSAGES.slice(1)] });
    expect(boundary(promptOf(calls.service[0]!))).toBe(formatSinceTime(7_000));
  });

  test("status surface without binding and messages: no boundary time", async () => {
    const { flow, calls, item } = setup({ service: answeringService });
    await flow.start({ ...item, messages: [] });
    expect(promptOf(calls.service[0]!)).not.toContain("Zeitpunkt der Grenze");
  });
});

const ALREADY = "Bereits über die Karte gespeichert.";
const CARD = {
  sessionId: "s1",
  sessionTitle: "Session A",
  directory: "/repo" as string | null,
  logId: "card-1",
  draft: { title: "Von der Karte", summary: "Karten-Zusammenfassung.", hours: 1.25 },
};

describe("flow: startWithDraft (chat card)", () => {
  test("skips the session draft and goes straight to the match suggestion", async () => {
    const { flow, calls } = setup({ service: answeringService, generate: [JSON.stringify({ taskId: "t2", reason: "passt" })] });
    await flow.startWithDraft(CARD);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft).toEqual(CARD.draft);
    expect(flow.state.target).toBe("t2");
    expect(flow.state.message).toBeNull();
    expect(calls.service.filter((r) => r.path === "/draft")).toHaveLength(0);
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0]!.prompt).toContain("Von der Karte");
  });

  test("a bound session targets the bound task, also when it is done", async () => {
    const { flow, calls } = setup({
      binding: { taskId: "t9", lastMessageId: null, lastCreatedAt: null, lastLogId: "old", ...LEGACY },
      task: (id) => (id === "t9" ? { id: "t9", title: "Erledigt", isDone: true } : null),
    });
    await flow.startWithDraft(CARD);
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.target).toBe("t9");
    expect(flow.state.tasks[0]).toMatchObject({ id: "t9", isDone: true });
    expect(calls.generate).toHaveLength(0);
  });

  test("no project mapping: pick-project, then ready with the card's draft", async () => {
    const { flow } = setup({ project: null });
    await flow.startWithDraft(CARD);
    expect(flow.state.phase).toBe("pick-project");
    await flow.chooseProject("p1");
    expect(flow.state.phase).toBe("ready");
    expect(flow.state.draft).toEqual(CARD.draft);
  });

  test("saving does what save does, with the card's logId and without closing", async () => {
    const { flow, calls, saved } = setup({ closeOnDone: () => false, generate: [JSON.stringify({ taskId: null, reason: "" })] });
    await flow.startWithDraft(CARD);
    flow.edit({ hours: 2 });
    await flow.save();
    expect(flow.state.phase).toBe("done");
    expect(calls.create).toMatchObject([{ projectId: "p1", title: "Von der Karte", hours: 2, logTitle: "Von der Karte" }]);
    expect(calls.setBinding.at(-1)!.b).toMatchObject({ taskId: "new1", lastLogId: "card-1", taskTitle: "Von der Karte", projectTitle: "Projekt 1", directory: "/repo" });
    expect(calls.service.filter((r) => r.path === "/logged")).toHaveLength(1);
    expect(calls.toast).toEqual([{ kind: "success", message: "In Super Productivity geloggt" }]);
    expect(calls.close).toBe(0);
    expect(saved.get("card-1")).toEqual({ taskTitle: "Von der Karte", hours: 2, at: new Date(2026, 10, 17, 12).getTime() });
  });

  test("an already saved card log ends at once without the gateway", async () => {
    const { flow, calls } = setup({ saved: { "card-1": { taskTitle: "X", hours: 1, at: 1 } } });
    await flow.startWithDraft(CARD);
    expect(flow.state.phase).toBe("done");
    expect(flow.state.message).toBe(ALREADY);
    expect(calls.create).toHaveLength(0);
    expect(calls.tasks).toHaveLength(0);
  });
});

describe("flow: saved marker and double-save guard", () => {
  test("a session-draft save writes saved:<logId>; a Small Model save does not", async () => {
    const a = setup({ service: answeringService });
    await a.flow.start(a.item);
    await a.flow.save();
    expect(a.calls.setSaved).toEqual([{ logId: "log-1", s: { taskTitle: "Aus der Session", hours: 1.5, at: new Date(2026, 10, 17, 12).getTime() } }]);

    const b = setup();
    await b.flow.start(b.item);
    await b.flow.save();
    expect(b.flow.state.phase).toBe("done");
    expect(b.calls.setSaved).toHaveLength(0);
  });

  test("the request time is kept as seen:<logId>", async () => {
    const { flow, calls, item } = setup({ service: answeringService });
    await flow.start(item);
    expect(calls.markSeen).toEqual([{ logId: "log-1", at: new Date(2026, 10, 17, 12).getTime() }]);
  });

  test("status/dialog save of a log already saved by the card: done, no gateway, pending cleared", async () => {
    const cleared: { sessionId: string; logId?: string }[] = [];
    const pending = { set: async () => {}, clear: async (sessionId: string, logId?: string) => void cleared.push({ sessionId, logId }) };
    const { flow, calls, item, saved } = setup({ service: answeringService, pending });
    await flow.start(item);
    expect(flow.state.phase).toBe("ready");
    saved.set("log-1", { taskTitle: "Login-Bug", hours: 1.5, at: 5 });
    await flow.save();
    expect(flow.state.phase).toBe("done");
    expect(flow.state.message).toBe(ALREADY);
    expect(calls.create).toHaveLength(0);
    expect(calls.append).toHaveLength(0);
    expect(calls.setBinding).toHaveLength(0);
    expect(calls.service.filter((r) => r.path === "/logged")).toHaveLength(0);
    expect(cleared).toContainEqual({ sessionId: "s1", logId: undefined });
  });

  test("resuming a request whose log is already saved ends at once", async () => {
    const { flow, calls, item } = setup({ service: answeringService, saved: { "log-7": { taskTitle: "X", hours: 1, at: 1 } } });
    await flow.start({ ...item, messages: [], resume: { logId: "log-7", startedAt: new Date(2026, 10, 17, 11).getTime() } });
    expect(flow.state.phase).toBe("done");
    expect(flow.state.message).toBe(ALREADY);
    expect(calls.service.filter((r) => r.path === "/draft")).toHaveLength(0);
  });
});
