import { describe, expect, test } from "bun:test";
import { ServiceHostError } from "@openchamber/sdk";
import { createDrafts, DRAFT_TTL_MS, HostTimeoutError, SessionWaitingError } from "../src/service/drafts.ts";
import { createHandler } from "../src/service/main.ts";

type FakeSession = { status: string; reply: string | null };

function fakeSessions(initial: FakeSession) {
  const state = { ...initial };
  const sent: { id: string; prompt: string }[] = [];
  return {
    state,
    sent,
    sessions: {
      async send(id: string, prompt: string) {
        sent.push({ id, prompt });
        return { sent: true };
      },
      async status(_id: string) {
        return state.status;
      },
      async lastReply(_id: string) {
        return state.reply;
      },
    },
  };
}

function setup(initial: FakeSession = { status: "idle", reply: null }) {
  const fake = fakeSessions(initial);
  const clock = { t: 1_000_000 };
  const drafts = createDrafts({ sessions: fake.sessions, now: () => clock.t });
  return { ...fake, clock, drafts };
}

describe("service drafts", () => {
  test("service: start sends prompt", async () => {
    const { drafts, sent } = setup();
    await drafts.start({ sessionId: "S1", logId: "L1", prompt: "[SP-Log-Anfrage L1] …" });
    expect(sent).toEqual([{ id: "S1", prompt: "[SP-Log-Anfrage L1] …" }]);
  });

  test("service: ignores old reply", async () => {
    const { drafts, state } = setup({ status: "idle", reply: 'alt {"logId":"L1"}' });
    await drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" });
    expect(await drafts.poll({ sessionId: "S1", logId: "L1" })).toEqual({ state: "pending", sessionStatus: "idle" });
    state.reply = '{"logId":"L1","title":"T","summary":"S","hours":1}';
    expect(await drafts.poll({ sessionId: "S1", logId: "L1" })).toEqual({
      state: "done",
      text: '{"logId":"L1","title":"T","summary":"S","hours":1}',
      sessionStatus: "idle",
    });
  });

  test("service: busy stays pending", async () => {
    const { drafts } = setup({ status: "busy", reply: null });
    await drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" });
    for (let i = 0; i < 5; i++) {
      expect(await drafts.poll({ sessionId: "S1", logId: "L1" })).toEqual({ state: "pending", sessionStatus: "busy" });
    }
  });

  test("service: fails after idle without reply", async () => {
    const { drafts, state } = setup({ status: "idle", reply: "irgendwas" });
    await drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" });
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("pending");
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("pending");
    // a busy phase resets the idle streak
    state.status = "busy";
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("pending");
    state.status = "idle";
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("pending");
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("pending");
    expect(await drafts.poll({ sessionId: "S1", logId: "L1" })).toEqual({ state: "failed", sessionStatus: "idle" });
  });

  test("service: done only once the session is idle", async () => {
    const { drafts, state } = setup({ status: "busy", reply: null });
    await drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" });
    state.reply = '{"logId":"L1","title":"T","summ';
    expect(await drafts.poll({ sessionId: "S1", logId: "L1" })).toEqual({ state: "pending", sessionStatus: "busy" });
    state.status = "idle";
    expect(await drafts.poll({ sessionId: "S1", logId: "L1" })).toEqual({
      state: "done",
      text: '{"logId":"L1","title":"T","summ',
      sessionStatus: "idle",
    });
  });

  test("service: does not send into a waiting session", async () => {
    const { drafts, sent } = setup({ status: "waiting", reply: null });
    await expect(drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" })).rejects.toBeInstanceOf(SessionWaitingError);
    expect(sent).toEqual([]);
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("failed");
  });

  test("service: host calls time out", async () => {
    const never = () => new Promise<never>(() => {});
    const drafts = createDrafts({
      sessions: { send: never, status: never, lastReply: never },
      now: () => 0,
      hostTimeoutMs: 5,
    });
    await expect(drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" })).rejects.toBeInstanceOf(HostTimeoutError);
  });

  test("service: unknown logId", async () => {
    const { drafts } = setup();
    await drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" });
    expect((await drafts.poll({ sessionId: "S1", logId: "L2" })).state).toBe("failed");
    expect((await drafts.poll({ sessionId: "S2", logId: "L1" })).state).toBe("failed");
  });

  test("service: expiry", async () => {
    const { drafts, clock, state } = setup({ status: "busy", reply: null });
    await drafts.start({ sessionId: "S1", logId: "L1", prompt: "p" });
    clock.t += DRAFT_TTL_MS - 1;
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("pending");
    clock.t += 2;
    state.reply = '{"logId":"L1"}';
    expect((await drafts.poll({ sessionId: "S1", logId: "L1" })).state).toBe("failed");
  });
});

describe("service http", () => {
  const TOKEN = "secret-token";

  function http() {
    const fake = setup({ status: "busy", reply: null });
    const handler = createHandler({ token: TOKEN, drafts: fake.drafts });
    return { ...fake, handler };
  }

  const req = (path: string, init: RequestInit & { auth?: string | null } = {}) => {
    const headers = new Headers(init.headers);
    const auth = init.auth === undefined ? `Bearer ${TOKEN}` : init.auth;
    if (auth !== null) headers.set("authorization", auth);
    if (init.body) headers.set("content-type", "application/json");
    return new Request(`http://127.0.0.1${path}`, { ...init, headers });
  };

  test("service: http auth/validation", async () => {
    const { handler, sent } = http();

    expect((await handler(req("/health", { auth: null }))).status).toBe(401);
    expect((await handler(req("/health", { auth: "Bearer wrong" }))).status).toBe(401);
    expect((await handler(req("/draft?sessionId=S1&logId=L1", { auth: null }))).status).toBe(401);
    expect((await handler(req("/health"))).status).toBe(200);

    const post = (body: unknown) => handler(req("/draft", { method: "POST", body: JSON.stringify(body) }));
    expect((await post({ sessionId: "S 1", logId: "L1", prompt: "p" })).status).toBe(400);
    expect((await post({ sessionId: "S1", logId: "x".repeat(129), prompt: "p" })).status).toBe(400);
    expect((await post({ sessionId: "S1", logId: "L1", prompt: "x".repeat(8001) })).status).toBe(400);
    expect((await post({ sessionId: "S1", logId: "L1" })).status).toBe(400);
    expect((await handler(req("/draft", { method: "POST", body: "{nope" }))).status).toBe(400);
    expect(sent).toEqual([]);

    const ok = await post({ sessionId: "S1", logId: "L1", prompt: "x".repeat(8000) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ started: true });
    expect(sent.length).toBe(1);

    expect((await handler(req("/draft?sessionId=S1&logId=L%3B1"))).status).toBe(400);
    const polled = await handler(req("/draft?sessionId=S1&logId=L1"));
    expect(polled.status).toBe(200);
    expect(await polled.json()).toEqual({ state: "pending", sessionStatus: "busy" });

    expect((await handler(req("/elsewhere"))).status).toBe(404);
  });

  test("service: waiting session answers 409", async () => {
    const fake = setup({ status: "waiting", reply: null });
    const handler = createHandler({ token: TOKEN, drafts: fake.drafts });
    const res = await handler(req("/draft", { method: "POST", body: JSON.stringify({ sessionId: "S1", logId: "L1", prompt: "p" }) }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "session-waiting" });
    expect(fake.sent).toEqual([]);
  });

  test("service: host timeout answers 504", async () => {
    const fake = fakeSessions({ status: "busy", reply: null });
    let hang = false;
    const drafts = createDrafts({
      sessions: {
        ...fake.sessions,
        status: (id) => (hang ? new Promise<never>(() => {}) : fake.sessions.status(id)),
        lastReply: (id) => (hang ? new Promise<never>(() => {}) : fake.sessions.lastReply(id)),
      },
      now: () => 0,
      hostTimeoutMs: 5,
    });
    const handler = createHandler({ token: TOKEN, drafts });
    const ok = await handler(req("/draft", { method: "POST", body: JSON.stringify({ sessionId: "S1", logId: "L1", prompt: "p" }) }));
    expect(ok.status).toBe(200);
    hang = true;
    const polled = await handler(req("/draft?sessionId=S1&logId=L1"));
    expect(polled.status).toBe(504);
    expect(await polled.json()).toEqual({ error: "host-timeout" });
    const posted = await handler(req("/draft", { method: "POST", body: JSON.stringify({ sessionId: "S1", logId: "L2", prompt: "p" }) }));
    expect(posted.status).toBe(504);
  });

  test("service: host errors become 502", async () => {
    const drafts = createDrafts({
      sessions: {
        async send() {
          throw new ServiceHostError("no", "FORBIDDEN", 403);
        },
        async status() {
          return "idle";
        },
        async lastReply() {
          return null;
        },
      },
      now: () => 0,
    });
    const handler = createHandler({ token: TOKEN, drafts });
    const res = await handler(req("/draft", { method: "POST", body: JSON.stringify({ sessionId: "S1", logId: "L1", prompt: "p" }) }));
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "FORBIDDEN" });
  });
});
