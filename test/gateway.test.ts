import { describe, expect, test } from "bun:test";
import { createGateway } from "../gateway/gateway.ts";

const GW_TOKEN = "g".repeat(64);
const SP_TOKEN = "sp-secret-token-123";
const SP_URL = "http://sp.local:3876";

type Call = { method: string; path: string; auth: string | null; body: unknown };
type Route = (call: Call) => Response | Promise<Response>;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function spFake(routes: Record<string, Route>) {
  const calls: Call[] = [];
  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const raw = init?.body;
    const call: Call = {
      method,
      path: url.pathname + url.search,
      auth: headers.get("authorization"),
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
    };
    calls.push(call);
    const route = routes[`${method} ${call.path}`];
    if (!route) return json({ ok: false, error: "not found" }, 404);
    return route(call);
  }) as typeof fetch;
  return { calls, fetch: fetchStub };
}

function gw(routes: Record<string, Route> = {}) {
  const sp = spFake(routes);
  const handle = createGateway({
    spUrl: SP_URL,
    spToken: () => SP_TOKEN,
    gatewayToken: GW_TOKEN,
    fetch: sp.fetch,
  });
  return { sp, handle };
}

function req(method: string, path: string, body?: unknown, token: string | null = GW_TOKEN): Request {
  const headers: Record<string, string> = {};
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new Request(`http://gw.local${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("gateway", () => {
  test("gateway: rejects missing/wrong token", async () => {
    const { sp, handle } = gw({ "GET /projects": () => json({ ok: true, data: [] }) });
    const cases: Array<[string, string, unknown]> = [
      ["GET", "/me", undefined],
      ["GET", "/projects", undefined],
      ["GET", "/projects/A/tasks", undefined],
      ["POST", "/tasks", { projectId: "A", title: "t", notes: "" }],
      ["POST", "/tasks/T/append", { text: "x" }],
      ["GET", "/nope", undefined],
    ];
    for (const [m, p, b] of cases) {
      expect((await handle(req(m, p, b, null))).status).toBe(401);
      expect((await handle(req(m, p, b, "wrong"))).status).toBe(401);
      expect((await handle(req(m, p, b, GW_TOKEN.slice(0, -1) + "x"))).status).toBe(401);
    }
    const basic = new Request("http://gw.local/me", { headers: { authorization: `Basic ${GW_TOKEN}` } });
    expect((await handle(basic)).status).toBe(401);
    expect(sp.calls).toHaveLength(0);

    const ok = await handle(req("GET", "/me"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: "Super Productivity" });
  });

  test("gateway: projects filters archived and hidden", async () => {
    const { sp, handle } = gw({
      "GET /projects": () =>
        json({
          ok: true,
          data: [
            { id: "A", title: "A", isArchived: false, isHiddenFromMenu: false, extra: 1 },
            { id: "B", isArchived: true },
            { id: "C", isHiddenFromMenu: true },
          ],
        }),
    });
    const res = await handle(req("GET", "/projects"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual([{ id: "A", title: "A", folder: null }]);
    expect(sp.calls).toHaveLength(1);
    expect(sp.calls[0]!.auth).toBe(`Bearer ${SP_TOKEN}`);
  });

  test("gateway: tasks excerpt", async () => {
    const long = "x".repeat(1000);
    const { sp, handle } = gw({
      "GET /tasks?projectId=A": () =>
        json({
          ok: true,
          data: [
            { id: "T1", title: "One", notes: long, isDone: false },
            { id: "T2", title: "Two", isDone: false },
          ],
        }),
    });
    const res = await handle(req("GET", "/projects/A/tasks"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; title: string; notesExcerpt: string }>;
    expect(body).toHaveLength(2);
    expect(body[0]!.id).toBe("T1");
    expect(body[0]!.title).toBe("One");
    expect(body[0]!.notesExcerpt.length).toBeLessThanOrEqual(300);
    expect(body[0]!.notesExcerpt.startsWith("xxx")).toBe(true);
    expect(body[1]).toEqual({ id: "T2", title: "Two", notesExcerpt: "" });
    expect(sp.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /tasks?projectId=A"]);
  });

  test("gateway: create, then complete the task", async () => {
    const { sp, handle } = gw({
      "POST /tasks": () => json({ ok: true, data: { id: "NEW1", title: "t" } }),
      "PATCH /tasks/NEW1": () => json({ ok: true, data: { id: "NEW1" } }),
    });
    const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "body", extra: "no" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "NEW1", completed: true });
    expect(sp.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["POST /tasks", "PATCH /tasks/NEW1"]);
    expect(sp.calls[0]!.body).toEqual({ title: "Log", notes: "body", projectId: "A" });
    expect(sp.calls[1]!.body).toEqual({ isDone: true });

    expect((await handle(req("POST", "/tasks", { projectId: "A", notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", { projectId: "A", title: "", notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", { projectId: "A", title: "t".repeat(201), notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", { projectId: "../x", title: "t", notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", "not json"))).status).toBe(400);
    expect(sp.calls).toHaveLength(2);
  });

  test("gateway: failed completion → 200 with completed false", async () => {
    const { handle } = gw({
      "POST /tasks": () => json({ ok: true, data: { id: "NEW1", title: "t" } }),
      "PATCH /tasks/NEW1": () => json({ ok: false }, 500),
    });
    const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "body" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "NEW1", completed: false });
  });

  test("gateway: append", async () => {
    const run = async (oldNotes: string | undefined, expected: string) => {
      const { sp, handle } = gw({
        "GET /tasks/T": () =>
          json({ ok: true, data: { id: "T", title: "t", isDone: false, ...(oldNotes === undefined ? {} : { notes: oldNotes }) } }),
        "PATCH /tasks/T": () => json({ ok: true, data: { id: "T" } }),
      });
      const res = await handle(req("POST", "/tasks/T/append", { text: "neu" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "T", completed: true });
      expect(sp.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /tasks/T", "PATCH /tasks/T", "PATCH /tasks/T"]);
      expect(sp.calls[1]!.body).toEqual({ notes: expected });
      expect(sp.calls[2]!.body).toEqual({ isDone: true });
    };
    await run("alt", "alt\n\nneu");
    await run("", "neu");
    await run(undefined, "neu");
  });

  test("gateway: append to a done task appends and completes it again", async () => {
    const { sp, handle } = gw({
      "GET /tasks/T": () => json({ ok: true, data: { id: "T", title: "t", notes: "alt", isDone: true } }),
      "PATCH /tasks/T": () => json({ ok: true, data: { id: "T" } }),
    });
    const res = await handle(req("POST", "/tasks/T/append", { text: "neu" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "T", completed: true });
    expect(sp.calls.map((c) => c.body)).toEqual([undefined, { notes: "alt\n\nneu" }, { isDone: true }]);
  });

  test("gateway: append to archived/missing task", async () => {
    for (const getRoute of [
      () => json({ ok: false, error: "not found" }, 404),
      () => json({ ok: true, data: { id: "T", title: "t", notes: "alt", isDone: true, isArchived: true } }),
    ]) {
      const { sp, handle } = gw({
        "GET /tasks/T": getRoute,
        "PATCH /tasks/T": () => json({ ok: true, data: { id: "T" } }),
      });
      const res = await handle(req("POST", "/tasks/T/append", { text: "neu" }));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "task-gone" });
      expect(sp.calls.some((c) => c.method === "PATCH")).toBe(false);
    }
  });

  test("gateway: GET /tasks/:id gives id, title and isDone", async () => {
    const { sp, handle } = gw({
      "GET /tasks/T": () => json({ ok: true, data: { id: "T", title: "Login", notes: "geheim", isDone: true, timeSpent: 5 } }),
      "GET /tasks/O": () => json({ ok: true, data: { id: "O", title: "Offen", isDone: false } }),
    });
    const done = await handle(req("GET", "/tasks/T"));
    expect(done.status).toBe(200);
    expect(await done.json()).toEqual({ id: "T", title: "Login", isDone: true });
    expect(await (await handle(req("GET", "/tasks/O"))).json()).toEqual({ id: "O", title: "Offen", isDone: false });
    expect(sp.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /tasks/T", "GET /tasks/O"]);
  });

  test("gateway: GET /tasks/:id missing or archived → 404 task-gone", async () => {
    const { handle } = gw({
      "GET /tasks/A": () => json({ ok: true, data: { id: "A", title: "a", isDone: true, isArchived: true } }),
    });
    for (const id of ["A", "MISSING"]) {
      const res = await handle(req("GET", `/tasks/${id}`));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "task-gone" });
    }
    expect((await handle(req("GET", "/tasks/T", undefined, null))).status).toBe(401);
  });

  test("gateway: invalid id", async () => {
    const { sp, handle } = gw();
    const bad = ["a.b", "a%2Fb", "x".repeat(65), "%20"];
    for (const id of bad) {
      expect((await handle(req("GET", `/projects/${id}/tasks`))).status).toBe(400);
      expect((await handle(req("POST", `/tasks/${id}/append`, { text: "x" }))).status).toBe(400);
      expect((await handle(req("GET", `/tasks/${id}`))).status).toBe(400);
    }
    expect(sp.calls).toHaveLength(0);
  });

  test("gateway: sp down", async () => {
    const handle = createGateway({
      spUrl: SP_URL,
      spToken: () => SP_TOKEN,
      gatewayToken: GW_TOKEN,
      fetch: (async () => {
        throw new Error(`connect ECONNREFUSED with Bearer ${SP_TOKEN}`);
      }) as unknown as typeof fetch,
    });
    const res = await handle(req("GET", "/projects"));
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "sp-unreachable" });
    expect(text).not.toContain(SP_TOKEN);
    expect(text).not.toContain(GW_TOKEN);
  });

  test("gateway: body limit", async () => {
    const { sp, handle } = gw({ "POST /tasks": () => json({ ok: true, data: { id: "N" } }) });
    const big = JSON.stringify({ projectId: "A", title: "t", notes: "x".repeat(65537) });
    const res = await handle(req("POST", "/tasks", big));
    expect(res.status).toBe(413);
    expect(sp.calls).toHaveLength(0);
  });

  test("gateway: unknown route", async () => {
    const { sp, handle } = gw();
    expect((await handle(req("GET", "/unknown"))).status).toBe(404);
    expect((await handle(req("DELETE", "/projects"))).status).toBe(404);
    expect((await handle(req("GET", "/tasks"))).status).toBe(404);
    expect(sp.calls).toHaveLength(0);
  });

  test("gateway: reads sp token per request", async () => {
    let token = "first";
    const sp = spFake({ "GET /projects": () => json({ ok: true, data: [] }) });
    const handle = createGateway({ spUrl: SP_URL, spToken: () => token, gatewayToken: GW_TOKEN, fetch: sp.fetch });
    await handle(req("GET", "/projects"));
    token = "second";
    await handle(req("GET", "/projects"));
    expect(sp.calls.map((c) => c.auth)).toEqual(["Bearer first", "Bearer second"]);
  });
  test("gateway: projects carry folder from folders()", async () => {
    const sp = spFake({
      "GET /projects": () => json({ ok: true, data: [{ id: "A", title: "A" }, { id: "B", title: "B" }] }),
    });
    const handle = createGateway({
      spUrl: SP_URL,
      spToken: () => SP_TOKEN,
      gatewayToken: GW_TOKEN,
      fetch: sp.fetch,
      folders: async () => new Map([["A", "Posylka / Intern"]]),
    });
    const res = await handle(req("GET", "/projects"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: "A", title: "A", folder: "Posylka / Intern" },
      { id: "B", title: "B", folder: null },
    ]);
  });

  test("gateway: failing folders() yields folder null with 200", async () => {
    const sp = spFake({ "GET /projects": () => json({ ok: true, data: [{ id: "A", title: "A" }] }) });
    const handle = createGateway({
      spUrl: SP_URL,
      spToken: () => SP_TOKEN,
      gatewayToken: GW_TOKEN,
      fetch: sp.fetch,
      folders: async () => {
        throw new Error("backup broken");
      },
    });
    const res = await handle(req("GET", "/projects"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: "A", title: "A", folder: null }]);
  });

  describe("time booking", () => {
    const TODAY = new Date(2026, 10, 17, 23, 30);
    const H = 3_600_000;
    function gwt(model: SpModel) {
      const handle = createGateway({
        spUrl: SP_URL,
        spToken: () => SP_TOKEN,
        gatewayToken: GW_TOKEN,
        fetch: model.fetch,
        now: () => TODAY,
      });
      return { sp: model, handle };
    }
    const seq = (m: SpModel) => m.calls.map((c) => `${c.method} ${c.path}`);

    test("create with hours: parent, done subtask with the log, time on the subtask", async () => {
      const { sp, handle } = gwt(spModel());
      const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Login", notes: "block", hours: 2.5, logTitle: "Login gefixt" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "N1", subtaskId: "N2", timeBooked: true, completed: true });
      expect(seq(sp)).toEqual(["POST /tasks", "POST /tasks", "POST /tasks/N2/time", "PATCH /tasks/N1"]);
      expect(sp.calls[0]!.body).toEqual({ title: "Login", notes: "block", projectId: "A" });
      expect(sp.calls[1]!.body).toEqual({ parentId: "N1", title: "17.11. · Login gefixt", notes: "block", isDone: true });
      expect(sp.calls[2]!.body).toEqual({ date: "2026-11-17", duration: 9_000_000 });
      expect(sp.calls[2]!.auth).toBe(`Bearer ${SP_TOKEN}`);
      expect(sp.total("N1")).toBe(2.5 * H);
      expect(sp.total("N2")).toBe(2.5 * H);
      expect(sp.calls[3]!.body).toEqual({ isDone: true });
      expect(sp.get("N1")!.isDone).toBe(true);
      expect(sp.get("N2")!.isDone).toBe(true);
    });

    test("append with hours: patch, then subtask with the appended block, time on it", async () => {
      const sp = spModel();
      sp.seed({ id: "T", title: "t", notes: "alt", projectId: "A" });
      const { handle } = gwt(sp);
      const res = await handle(req("POST", "/tasks/T/append", { text: "neu", hours: 0.75, logTitle: "Fix" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "T", subtaskId: "N1", timeBooked: true, completed: true });
      expect(seq(sp)).toEqual(["GET /tasks/T", "PATCH /tasks/T", "POST /tasks", "POST /tasks/N1/time", "PATCH /tasks/T"]);
      expect(sp.calls[1]!.body).toEqual({ notes: "alt\n\nneu" });
      expect(sp.calls[2]!.body).toEqual({ parentId: "T", title: "17.11. · Fix", notes: "neu", isDone: true });
      expect(sp.calls[3]!.body).toEqual({ date: "2026-11-17", duration: 2_700_000 });
      expect(sp.total("T")).toBe(0.75 * H);
      expect(sp.get("T")!.isDone).toBe(true);
    });

    test("sessions logged 2–3 times: later logs append to the done task and complete it again", async () => {
      const { sp, handle } = gwt(spModel());
      const first = await handle(req("POST", "/tasks", { projectId: "A", title: "Login", notes: "b1", hours: 1, logTitle: "Eins" }));
      expect(await first.json()).toEqual({ id: "N1", subtaskId: "N2", timeBooked: true, completed: true });
      expect(sp.get("N1")!.isDone).toBe(true);
      for (const [i, title] of ["Zwei", "Drei"].entries()) {
        const res = await handle(req("POST", "/tasks/N1/append", { text: title, hours: 0.5, logTitle: title }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "N1", subtaskId: `N${3 + i}`, timeBooked: true, completed: true });
        expect(sp.get("N1")!.isDone).toBe(true);
      }
      expect(sp.get("N1")!.notes).toBe("b1\n\nZwei\n\nDrei");
      expect(sp.get("N1")!.subTaskIds).toEqual(["N2", "N3", "N4"]);
      expect(sp.total("N1")).toBe(2 * H);
      // A done task is no longer offered as an open candidate, but stays readable.
      expect(await (await handle(req("GET", "/projects/A/tasks"))).json()).toEqual([]);
      expect(await (await handle(req("GET", "/tasks/N1"))).json()).toEqual({ id: "N1", title: "Login", isDone: true });
    });

    test("more than 24h on one day across two logs → two subtasks, both booked", async () => {
      const sp = spModel();
      sp.seed({ id: "T", title: "t", notes: "", projectId: "A" });
      const { handle } = gwt(sp);
      for (const title of ["Eins", "Zwei"]) {
        const res = await handle(req("POST", "/tasks/T/append", { text: title, hours: 20, logTitle: title }));
        expect(((await res.json()) as { timeBooked: boolean }).timeBooked).toBe(true);
      }
      expect(sp.get("T")!.subTaskIds).toEqual(["N1", "N2"]);
      expect(sp.total("T")).toBe(40 * H);
      expect(sp.day("T", "2026-11-17")).toBe(40 * H);
    });

    test("logTitle missing or null → subtask title falls back to Log", async () => {
      for (const extra of [{}, { logTitle: null }]) {
        const { sp, handle } = gwt(spModel());
        await handle(req("POST", "/tasks", { projectId: "A", title: "X", notes: "", hours: 1, ...extra }));
        expect((sp.calls[1]!.body as { title: string }).title).toBe("17.11. · Log");
      }
    });

    test("invalid logTitle → 400 before anything is written", async () => {
      for (const logTitle of ["", "x".repeat(201), 5, ["a"]]) {
        const sp = spModel();
        sp.seed({ id: "T", title: "t", notes: "", projectId: "A" });
        const { handle } = gwt(sp);
        const c = await handle(req("POST", "/tasks", { projectId: "A", title: "X", notes: "", hours: 1, logTitle }));
        expect(c.status).toBe(400);
        expect(await c.json()).toEqual({ error: "invalid-log-title" });
        const a = await handle(req("POST", "/tasks/T/append", { text: "neu", hours: 1, logTitle }));
        expect(a.status).toBe(400);
        expect(sp.calls).toHaveLength(0);
      }
    });

    for (const inherit of [true, false]) {
      test(`legacy parent with direct time is converted first (SP inherits: ${inherit}), idempotently`, async () => {
        const sp = spModel({ inherit });
        sp.seed({ id: "T", title: "t", notes: "alt", projectId: "A", own: { "2026-11-15": 3 * H, "2026-11-17": 20 * H } });
        const { handle } = gwt(sp);
        const res = await handle(req("POST", "/tasks/T/append", { text: "neu", hours: 10, logTitle: "Mehr" }));
        expect(res.status).toBe(200);
        expect(await res.json()).toEqual({ id: "T", subtaskId: "N2", timeBooked: true, completed: true });
        const legacy = sp.get("N1")!;
        expect(legacy.title).toBe("Frühere Logs");
        expect(legacy.isDone).toBe(true);
        expect(legacy.parentId).toBe("T");
        expect(sp.calls.find((c) => c.method === "POST" && c.path === "/tasks")!.body).toEqual({ parentId: "T", title: "Frühere Logs", isDone: true });
        expect(sp.get("T")!.subTaskIds).toEqual(["N1", "N2"]);
        expect(sp.day("N1", "2026-11-15")).toBe(3 * H);
        expect(sp.day("N1", "2026-11-17")).toBe(20 * H);
        expect(sp.total("N2")).toBe(10 * H);
        expect(sp.total("T")).toBe(33 * H);

        // A second log does not convert again.
        const again = await handle(req("POST", "/tasks/T/append", { text: "noch", hours: 1, logTitle: "Noch" }));
        expect(await again.json()).toEqual({ id: "T", subtaskId: "N3", timeBooked: true, completed: true });
        expect(sp.get("T")!.subTaskIds).toEqual(["N1", "N2", "N3"]);
        expect(sp.calls.filter((c) => (c.body as { title?: string } | undefined)?.title === "Frühere Logs")).toHaveLength(1);
        expect(sp.total("T")).toBe(34 * H);
      });
    }

    test("legacy conversion fails → note kept, no log subtask, 200 with sp-convert-failed", async () => {
      const sp = spModel({ failSubtask: true });
      sp.seed({ id: "T", title: "t", notes: "", projectId: "A", own: { "2026-11-16": H } });
      const { handle } = gwt(sp);
      const res = await handle(req("POST", "/tasks/T/append", { text: "neu", hours: 1, logTitle: "x" }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "T", timeBooked: false, timeError: "sp-convert-failed", completed: true });
      expect(sp.get("T")!.isDone).toBe(true);
      expect(sp.get("T")!.notes).toBe("neu");
      expect(sp.calls.filter((c) => c.path === "/tasks")).toHaveLength(1);
    });

    test("duration is an integer of ms", async () => {
      const { sp, handle } = gwt(spModel());
      await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "", hours: 1 / 3 }));
      const d = (sp.calls[2]!.body as { duration: number }).duration;
      expect(Number.isInteger(d)).toBe(true);
      expect(d).toBe(1_200_000);
    });

    test("hours 0, absent or null → no subtask, no booking", async () => {
      for (const extra of [{ hours: 0 }, {}, { hours: null }]) {
        const sp = spModel();
        sp.seed({ id: "T", title: "t", notes: "", projectId: "A" });
        const { handle } = gwt(sp);
        const c = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "", ...extra }));
        expect(c.status).toBe(200);
        expect(await c.json()).toEqual({ id: "N1", completed: true });
        const a = await handle(req("POST", "/tasks/T/append", { text: "neu", ...extra }));
        expect(a.status).toBe(200);
        expect(await a.json()).toEqual({ id: "T", completed: true });
        expect(sp.calls.some((x) => x.path.endsWith("/time"))).toBe(false);
        expect(sp.calls.filter((x) => x.method === "POST" && x.path === "/tasks")).toHaveLength(1);
      }
    });

    test("invalid hours → 400 before anything is written", async () => {
      for (const hours of [-1, 24.01, "2", Number.NaN, true, [1], {}]) {
        const sp = spModel();
        sp.seed({ id: "T", title: "t", notes: "", projectId: "A" });
        const { handle } = gwt(sp);
        const body = JSON.stringify({ projectId: "A", title: "Log", notes: "", hours }).replace('"hours":null', '"hours":"NaN"');
        const c = await handle(req("POST", "/tasks", body));
        expect(c.status).toBe(400);
        expect(await c.json()).toEqual({ error: "invalid-hours" });
        const a = await handle(req("POST", "/tasks/T/append", { text: "neu", hours: typeof hours === "number" && Number.isNaN(hours) ? "NaN" : hours }));
        expect(a.status).toBe(400);
        expect(sp.calls).toHaveLength(0);
      }
    });

    test("hours 24 is allowed", async () => {
      const { sp, handle } = gwt(spModel());
      const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "", hours: 24 }));
      expect(await res.json()).toEqual({ id: "N1", subtaskId: "N2", timeBooked: true, completed: true });
      expect(sp.calls[2]!.body).toEqual({ date: "2026-11-17", duration: 86_400_000 });
    });

    test("rejected booking → 200 with timeBooked false", async () => {
      const { handle } = gwt(spModel({ failTime: true }));
      const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "", hours: 1 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "N1", subtaskId: "N2", timeBooked: false, timeError: "sp-time-rejected", completed: true });
    });

    test("rejected subtask → 200 with sp-subtask-rejected, no booking", async () => {
      const sp = spModel({ failSubtask: true });
      const { handle } = gwt(sp);
      const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "", hours: 1 }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: "N1", timeBooked: false, timeError: "sp-subtask-rejected", completed: true });
      expect(sp.calls.some((x) => x.path.endsWith("/time"))).toBe(false);
    });

    test("unreachable SP during booking → 200 with sp-unreachable", async () => {
      const sp = spModel({ throwOnTime: true });
      sp.seed({ id: "T", title: "t", notes: "", projectId: "A" });
      const { handle } = gwt(sp);
      const res = await handle(req("POST", "/tasks/T/append", { text: "neu", hours: 1 }));
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ id: "T", subtaskId: "N1", timeBooked: false, timeError: "sp-unreachable", completed: true });
      expect(text).not.toContain(SP_TOKEN);
    });

    test("failed create does not book", async () => {
      const { sp, handle } = gwt(spModel({ failCreate: true }));
      const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "", hours: 1 }));
      expect(res.status).toBe(502);
      expect(sp.calls).toHaveLength(1);
    });

    test("default date is the gateway's local today", async () => {
      const sp = spModel();
      const handle = createGateway({ spUrl: SP_URL, spToken: () => SP_TOKEN, gatewayToken: GW_TOKEN, fetch: sp.fetch });
      await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "", hours: 1 }));
      const d = new Date();
      const pad = (x: number) => String(x).padStart(2, "0");
      expect((sp.calls[2]!.body as { date: string }).date).toBe(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
      expect((sp.calls[1]!.body as { title: string }).title).toBe(`${pad(d.getDate())}.${pad(d.getMonth() + 1)}. · Log`);
    });
  });

  test("gateway: candidate list excludes subtasks", async () => {
    const sp = spModel();
    sp.seed({ id: "P", title: "Parent", notes: "", projectId: "A" });
    sp.seed({ id: "S", title: "Sub", notes: "", projectId: "A", parentId: "P" });
    sp.seed({ id: "Q", title: "Other", notes: "", projectId: "A" });
    const handle = createGateway({ spUrl: SP_URL, spToken: () => SP_TOKEN, gatewayToken: GW_TOKEN, fetch: sp.fetch });
    const res = await handle(req("GET", "/projects/A/tasks"));
    expect(((await res.json()) as Array<{ id: string }>).map((t) => t.id)).toEqual(["P", "Q"]);
  });
});

// Stateful fake of the SP 20 Local REST task API, with its rules: subtasks
// must not carry projectId/tagIds, tasks with subtasks reject time, one task
// takes at most 24h per day, and a parent's time is the sum of its subtasks.
type FakeTask = {
  id: string;
  title: string;
  notes: string;
  projectId: string;
  parentId?: string;
  isDone: boolean;
  subTaskIds: string[];
  own: Record<string, number>;
};
type SpModel = ReturnType<typeof spModel>;

function spModel(opts: { inherit?: boolean; failTime?: boolean; failSubtask?: boolean; throwOnTime?: boolean; failCreate?: boolean } = {}) {
  const inherit = opts.inherit ?? true;
  const tasks = new Map<string, FakeTask>();
  const calls: Call[] = [];
  let n = 0;
  const DAY = 86_400_000;

  function day(id: string, date: string): number {
    const t = tasks.get(id)!;
    if (t.subTaskIds.length > 0) return t.subTaskIds.reduce((s, sid) => s + day(sid, date), 0);
    return t.own[date] ?? 0;
  }
  function days(id: string): Record<string, number> {
    const t = tasks.get(id)!;
    if (t.subTaskIds.length === 0) return { ...t.own };
    const out: Record<string, number> = {};
    for (const sid of t.subTaskIds) for (const [d, v] of Object.entries(days(sid))) out[d] = (out[d] ?? 0) + v;
    return out;
  }
  function total(id: string): number {
    return Object.values(days(id)).reduce((s, v) => s + v, 0);
  }
  function view(t: FakeTask) {
    const tsod = days(t.id);
    return {
      id: t.id,
      title: t.title,
      notes: t.notes,
      projectId: t.projectId,
      ...(t.parentId ? { parentId: t.parentId } : {}),
      isDone: t.isDone,
      subTaskIds: [...t.subTaskIds],
      timeSpentOnDay: tsod,
      timeSpent: Object.values(tsod).reduce((s, v) => s + v, 0),
    };
  }
  const bad = (msg: string) => json({ ok: false, error: { code: "INVALID_INPUT", message: msg } }, 400);

  const fetchStub = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const raw = init?.body;
    const body = typeof raw === "string" ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
    calls.push({ method, path: url.pathname + url.search, auth: new Headers(init?.headers).get("authorization"), body });
    const p = url.pathname;
    if (method === "GET" && p === "/tasks") {
      const pid = url.searchParams.get("projectId");
      return json({ ok: true, data: [...tasks.values()].filter((t) => !t.isDone && t.projectId === pid).map(view) });
    }
    if (method === "POST" && p === "/tasks") {
      const b = body ?? {};
      if (typeof b.parentId === "string") {
        if (opts.failSubtask) return bad("nope");
        if ("projectId" in b || "tagIds" in b) return bad("subtask with projectId");
        const parent = tasks.get(b.parentId);
        if (!parent) return json({ ok: false }, 404);
        const id = `N${++n}`;
        const own = inherit && parent.subTaskIds.length === 0 ? { ...parent.own } : {};
        tasks.set(id, { id, title: String(b.title), notes: String(b.notes ?? ""), projectId: parent.projectId, parentId: parent.id, isDone: b.isDone === true, subTaskIds: [], own });
        parent.subTaskIds.push(id);
        parent.own = {};
        return json({ ok: true, data: view(tasks.get(id)!) });
      }
      if (opts.failCreate) return json({ ok: false }, 500);
      const id = `N${++n}`;
      tasks.set(id, { id, title: String(b.title), notes: String(b.notes ?? ""), projectId: String(b.projectId), isDone: false, subTaskIds: [], own: {} });
      return json({ ok: true, data: view(tasks.get(id)!) });
    }
    const m = /^\/tasks\/([^/]+)(\/time)?$/.exec(p);
    const t = m ? tasks.get(m[1]!) : undefined;
    if (!m || !t) return json({ ok: false, error: "not found" }, 404);
    if (!m[2] && method === "GET") return json({ ok: true, data: view(t) });
    if (!m[2] && method === "PATCH") {
      if (typeof body?.notes === "string") t.notes = body.notes;
      if (typeof body?.isDone === "boolean") t.isDone = body.isDone;
      return json({ ok: true, data: view(t) });
    }
    if (m[2] && method === "POST") {
      if (opts.throwOnTime) throw new Error(`boom Bearer ${SP_TOKEN}`);
      if (opts.failTime) return bad("rejected");
      const date = body?.date as string;
      const duration = body?.duration as number;
      if (!Number.isInteger(duration) || duration < 1 || duration > DAY) return bad("duration");
      if (t.subTaskIds.length > 0) return bad("Task has subtasks");
      if ((t.own[date] ?? 0) + duration > DAY) return bad("Time spent on one day cannot exceed 24h");
      t.own[date] = (t.own[date] ?? 0) + duration;
      return json({ ok: true, data: view(t) });
    }
    return json({ ok: false }, 404);
  }) as typeof fetch;

  return {
    calls,
    fetch: fetchStub,
    get: (id: string) => tasks.get(id),
    day,
    total,
    seed(t: { id: string; title: string; notes: string; projectId: string; parentId?: string; own?: Record<string, number> }) {
      tasks.set(t.id, { ...t, isDone: false, subTaskIds: [], own: t.own ?? {} });
      if (t.parentId) tasks.get(t.parentId)!.subTaskIds.push(t.id);
    },
  };
}
