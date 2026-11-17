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

  test("gateway: create", async () => {
    const { sp, handle } = gw({
      "POST /tasks": () => json({ ok: true, data: { id: "NEW1", title: "t" } }),
    });
    const res = await handle(req("POST", "/tasks", { projectId: "A", title: "Log", notes: "body", extra: "no" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ id: "NEW1" });
    expect(sp.calls).toHaveLength(1);
    expect(sp.calls[0]!.method).toBe("POST");
    expect(sp.calls[0]!.path).toBe("/tasks");
    expect(sp.calls[0]!.body).toEqual({ title: "Log", notes: "body", projectId: "A" });

    expect((await handle(req("POST", "/tasks", { projectId: "A", notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", { projectId: "A", title: "", notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", { projectId: "A", title: "t".repeat(201), notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", { projectId: "../x", title: "t", notes: "x" }))).status).toBe(400);
    expect((await handle(req("POST", "/tasks", "not json"))).status).toBe(400);
    expect(sp.calls).toHaveLength(1);
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
      expect(await res.json()).toEqual({ id: "T" });
      expect(sp.calls.map((c) => `${c.method} ${c.path}`)).toEqual(["GET /tasks/T", "PATCH /tasks/T"]);
      expect(sp.calls[1]!.body).toEqual({ notes: expected });
    };
    await run("alt", "alt\n\nneu");
    await run("", "neu");
    await run(undefined, "neu");
  });

  test("gateway: append to done/missing task", async () => {
    for (const getRoute of [
      () => json({ ok: false, error: "not found" }, 404),
      () => json({ ok: true, data: { id: "T", title: "t", notes: "alt", isDone: true } }),
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

  test("gateway: invalid id", async () => {
    const { sp, handle } = gw();
    const bad = ["a.b", "a%2Fb", "x".repeat(65), "%20"];
    for (const id of bad) {
      expect((await handle(req("GET", `/projects/${id}/tasks`))).status).toBe(400);
      expect((await handle(req("POST", `/tasks/${id}/append`, { text: "x" }))).status).toBe(400);
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
});
