import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ServiceMark, ServiceMarkTarget } from "@openchamber/sdk";
import { createMarkBook, fileStateStore, markFor, MARK_RATE_MAX, type MarkState } from "../src/service/marks.ts";
import { createHandler } from "../src/service/main.ts";
import { createDrafts } from "../src/service/drafts.ts";

const GREY: ServiceMark = { icon: "time-line", tone: "neutral", text: "SP: noch nicht geloggt" };

function memoryStore(initial: Record<string, MarkState> = {}) {
  const saved: Record<string, MarkState>[] = [];
  return {
    saved,
    load: async () => structuredClone(initial),
    save: async (state: Record<string, MarkState>) => {
      saved.push(structuredClone(state));
    },
  };
}

function setup(initial: Record<string, MarkState> = {}) {
  const clock = { t: new Date(2026, 10, 17, 10).getTime() };
  const set: { target: ServiceMarkTarget; mark: ServiceMark | null }[] = [];
  const sleeps: number[] = [];
  const store = memoryStore(initial);
  const book = createMarkBook({
    store,
    setMark: async (target, mark) => {
      set.push({ target, mark });
      return { saved: true };
    },
    now: () => clock.t,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock.t += ms;
    },
  });
  const markOf = (sessionId: string) =>
    set.filter((s) => "sessionId" in s.target && s.target.sessionId === sessionId).at(-1)?.mark;
  return { clock, set, sleeps, store, book, markOf };
}

describe("markFor", () => {
  const base: MarkState = { loggedAt: null, logs: 0, hours: 0, lastTurnAt: null, pendingLogId: null };
  test("nothing without turn or log", () => {
    expect(markFor(base)).toBeNull();
  });
  test("grey, green, orange", () => {
    expect(markFor({ ...base, lastTurnAt: 5 })).toEqual(GREY);
    const logged = { ...base, loggedAt: new Date(2026, 10, 3, 9).getTime(), logs: 2, hours: 1.75 };
    expect(markFor({ ...logged, lastTurnAt: logged.loggedAt })).toEqual({
      icon: "checkbox-circle-line",
      tone: "success",
      text: "SP: 2 Logs · ≈ 1,75 h",
    });
    expect(markFor({ ...logged, logs: 1, hours: 2, lastTurnAt: null })!.text).toBe("SP: 1 Log · ≈ 2 h");
    expect(markFor({ ...logged, lastTurnAt: logged.loggedAt + 1 })).toEqual({
      icon: "time-line",
      tone: "warning",
      text: "SP: neue Arbeit seit Log am 03.11.",
    });
  });
});

describe("mark book", () => {
  test("marks: grey → green → orange → green", async () => {
    const { book, clock, markOf } = setup();
    await book.start();
    book.turnFinished("s1");
    await book.flush();
    expect(markOf("s1")).toEqual(GREY);

    clock.t += 1000;
    book.logged("s1", clock.t, 1.5);
    await book.flush();
    expect(markOf("s1")).toMatchObject({ tone: "success", text: "SP: 1 Log · ≈ 1,5 h" });

    clock.t += 1000;
    book.turnFinished("s1");
    await book.flush();
    expect(markOf("s1")).toMatchObject({ tone: "warning", text: "SP: neue Arbeit seit Log am 17.11." });

    clock.t += 1000;
    book.logged("s1", clock.t, 0.25);
    await book.flush();
    expect(markOf("s1")).toMatchObject({ tone: "success", text: "SP: 2 Logs · ≈ 1,75 h" });
  });

  test("marks: log request turn before save stays green", async () => {
    const { book, clock, markOf, set } = setup();
    await book.start();
    book.logged("s1", clock.t, 1);
    await book.flush();
    expect(markOf("s1")!.tone).toBe("success");

    // the dialog asks the session for its draft; that turn is no new work
    clock.t += 1000;
    book.pending("s1", "log-2");
    book.turnFinished("s1");
    await book.flush();
    expect(set.map((s) => s.mark!.tone)).toEqual(["success"]);

    clock.t += 1000;
    book.logged("s1", clock.t - 5000, 0.5);
    await book.flush();
    expect(markOf("s1")).toMatchObject({ tone: "success", text: "SP: 2 Logs · ≈ 1,5 h" });
    expect(book.state("s1")!.pendingLogId).toBeNull();

    // the next turn is real work again
    clock.t += 1000;
    book.turnFinished("s1");
    await book.flush();
    expect(markOf("s1")!.tone).toBe("warning");
  });

  test("marks: turns ending before the save count as logged", async () => {
    const { book, clock, markOf } = setup();
    await book.start();
    book.turnFinished("s1");
    clock.t += 1000;
    const savedAt = clock.t - 500; // the dialog's clock, before the last turn ended
    book.logged("s1", savedAt, 1);
    await book.flush();
    expect(markOf("s1")!.tone).toBe("success");
  });

  test("marks: restart sets every mark again and persists", async () => {
    const first = setup();
    await first.book.start();
    first.book.turnFinished("s1");
    first.book.logged("s2", first.clock.t, 2);
    await first.book.flush();
    const persisted = first.store.saved.at(-1)!;
    expect(Object.keys(persisted).sort()).toEqual(["s1", "s2"]);

    const second = setup(persisted);
    await second.book.start();
    await second.book.flush();
    expect(second.markOf("s1")).toEqual(GREY);
    expect(second.markOf("s2")!.tone).toBe("success");
  });

  test("marks: restart stays under the rate limit", async () => {
    const many: Record<string, MarkState> = {};
    for (let i = 0; i < MARK_RATE_MAX + 5; i++) {
      many[`s${i}`] = { loggedAt: null, logs: 0, hours: 0, lastTurnAt: 1, pendingLogId: null };
    }
    const { book, set, sleeps } = setup(many);
    await book.start();
    await book.flush();
    expect(set).toHaveLength(MARK_RATE_MAX + 5);
    expect(sleeps.length).toBeGreaterThan(0);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(60_000);
  });

  test("marks: a failing setMark does not stop the queue", async () => {
    const clock = { t: 1 };
    const seen: string[] = [];
    const book = createMarkBook({
      store: memoryStore(),
      setMark: async (target) => {
        const id = (target as { sessionId: string }).sessionId;
        seen.push(id);
        if (id === "bad") throw new Error("refused");
        return { saved: true };
      },
      now: () => clock.t,
      sleep: async () => {},
    });
    await book.start();
    book.turnFinished("bad");
    book.turnFinished("good");
    await book.flush();
    expect(seen).toEqual(["bad", "good"]);
  });
});

describe("file state store", () => {
  test("writes state.json atomically and reads it back", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sp-log-marks-"));
    try {
      const store = fileStateStore(dir);
      expect(await store.load()).toEqual({});
      const state = { s1: { loggedAt: 1, logs: 1, hours: 1, lastTurnAt: 1, pendingLogId: null } };
      await store.save(state);
      expect(JSON.parse(await readFile(join(dir, "state.json"), "utf8"))).toEqual(state);
      expect(await store.load()).toEqual(state);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unreadable state.json starts empty", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sp-log-marks-"));
    try {
      await Bun.write(join(dir, "state.json"), "{nope");
      expect(await fileStateStore(dir).load()).toEqual({});
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("service http: marks", () => {
  const TOKEN = "secret-token";

  function http() {
    const env = setup();
    const emitted: { topic: string; data: unknown }[] = [];
    const drafts = createDrafts({
      sessions: { send: async () => ({ sent: true }), status: async () => "idle", lastReply: async () => null },
      now: () => 0,
    });
    const handler = createHandler({
      token: TOKEN,
      drafts,
      marks: env.book,
      emit: async (topic, data) => {
        emitted.push({ topic, data });
      },
    });
    return { ...env, handler, emitted };
  }

  const post = (path: string, body: unknown) =>
    new Request(`http://127.0.0.1${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  const event = (type: string, sessionId: string, parentId: string | null = null) => ({
    v: 1,
    requestId: "r1",
    event: { id: "e1", type, at: 1, session: { id: sessionId, parentId }, project: { directory: "/repo" }, linked: [] },
  });

  test("session-events: turn-finished marks the session", async () => {
    const { handler, book, markOf } = http();
    await book.start();
    const res = await handler(post("/session-events", event("turn-finished", "s1")));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await book.flush();
    expect(markOf("s1")).toEqual(GREY);
  });

  test("session-events: subagent turns and other types are ignored", async () => {
    const { handler, book, set } = http();
    await book.start();
    expect((await handler(post("/session-events", event("turn-finished", "s2", "s1")))).status).toBe(200);
    expect((await handler(post("/session-events", event("turn-failed", "s1")))).status).toBe(200);
    await book.flush();
    expect(set).toEqual([]);
  });

  test("session-events: invalid event is 400", async () => {
    const { handler } = http();
    expect((await handler(post("/session-events", "{nope"))).status).toBe(400);
    expect((await handler(post("/session-events", { v: 2 }))).status).toBe(400);
    expect((await handler(post("/session-events", { ...event("turn-finished", "s1"), v: 9 }))).status).toBe(400);
  });

  test("logged: validates, marks green and tells the frames", async () => {
    const { handler, book, markOf, emitted, clock } = http();
    await book.start();
    expect((await handler(post("/logged", { sessionId: "s 1", at: 1, hours: 1 }))).status).toBe(400);
    expect((await handler(post("/logged", { sessionId: "s1", at: "x", hours: 1 }))).status).toBe(400);
    expect((await handler(post("/logged", { sessionId: "s1", at: 1, hours: 25 }))).status).toBe(400);
    expect((await handler(post("/logged", "{nope"))).status).toBe(400);
    expect(emitted).toEqual([]);

    const res = await handler(post("/logged", { sessionId: "s1", at: clock.t, hours: 1.5 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    await book.flush();
    expect(markOf("s1")).toMatchObject({ tone: "success", text: "SP: 1 Log · ≈ 1,5 h" });
    expect(emitted).toEqual([{ topic: "logged", data: { sessionId: "s1" } }]);
  });

  test("draft: a started request is remembered as pending", async () => {
    const { handler, book } = http();
    await book.start();
    const res = await handler(post("/draft", { sessionId: "s1", logId: "log-1", prompt: "p" }));
    expect(res.status).toBe(200);
    expect(book.state("s1")!.pendingLogId).toBe("log-1");
  });
});
