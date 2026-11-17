/**
 * Local service: lets the panel ask the logged session for its own work-log
 * draft, and marks sessions in the sidebar by their log state. Listens on
 * 127.0.0.1 only; every request needs the host's bearer.
 */
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  createServiceHost,
  OPENCHAMBER_SERVICE_DATA_DIR,
  readSessionEventRequest,
  ServiceHostError,
  SESSION_EVENTS_PATH,
  type JsonValue,
} from "@openchamber/sdk";
import { createDrafts, HostTimeoutError, SessionWaitingError, type Drafts } from "./drafts.ts";
import { createMarkBook, fileStateStore, type MarkBook } from "./marks.ts";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export const PROMPT_MAX = 8000;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function authorized(header: string | null, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const validId = (value: unknown): value is string => typeof value === "string" && ID_PATTERN.test(value);

async function readJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await req.json()) as unknown;
    return body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createHandler(deps: {
  token: string;
  drafts: Drafts;
  marks: MarkBook;
  /** Tells the extension's open frames; failures are ignored. */
  emit: (topic: string, data: JsonValue) => Promise<unknown>;
}): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!deps.token || !authorized(req.headers.get("authorization"), deps.token)) {
      return json(401, { error: "UNAUTHORIZED" });
    }
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health" && req.method === "GET") {
        return json(200, { ok: true });
      }
      if (url.pathname === "/draft" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json(400, { error: "BAD_JSON" });
        }
        const { sessionId, logId, prompt } = (body ?? {}) as Record<string, unknown>;
        if (!validId(sessionId) || !validId(logId)) return json(400, { error: "BAD_ID" });
        if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > PROMPT_MAX) {
          return json(400, { error: "BAD_PROMPT" });
        }
        await deps.drafts.start({ sessionId, logId, prompt });
        deps.marks.pending(sessionId, logId);
        return json(200, { started: true });
      }
      if (url.pathname === "/logged" && req.method === "POST") {
        const body = await readJson(req);
        if (!body) return json(400, { error: "BAD_JSON" });
        const { sessionId, at, hours } = body;
        if (!validId(sessionId)) return json(400, { error: "BAD_ID" });
        if (typeof at !== "number" || !Number.isFinite(at) || at <= 0) return json(400, { error: "BAD_AT" });
        if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 || hours > 24) {
          return json(400, { error: "BAD_HOURS" });
        }
        deps.marks.logged(sessionId, at, hours);
        void deps.emit("logged", { sessionId }).catch(() => {});
        return json(200, { ok: true });
      }
      if (url.pathname === SESSION_EVENTS_PATH && req.method === "POST") {
        const request = readSessionEventRequest(await req.text());
        if (!request) return json(400, { ok: false, error: "not a session event" });
        const { type, session } = request.event;
        // Subagents' turns belong to their parent's turn.
        if (type === "turn-finished" && session.parentId === null) deps.marks.turnFinished(session.id);
        return json(200, { ok: true });
      }
      if (url.pathname === "/draft" && req.method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        const logId = url.searchParams.get("logId");
        if (!validId(sessionId) || !validId(logId)) return json(400, { error: "BAD_ID" });
        return json(200, await deps.drafts.poll({ sessionId, logId }));
      }
      return json(404, { error: "NOT_FOUND" });
    } catch (error) {
      if (error instanceof SessionWaitingError) return json(409, { error: "session-waiting" });
      if (error instanceof HostTimeoutError) return json(504, { error: "host-timeout" });
      if (error instanceof ServiceHostError) return json(502, { error: error.code });
      return json(500, { error: "INTERNAL" });
    }
  };
}

function serve(port: number, token: string): void {
  const host = createServiceHost({ env: process.env });
  const drafts = createDrafts({
    sessions: {
      send: (id, prompt) => host.sessions.send(id, prompt),
      status: async (id) => (await host.sessions.status(id)).status,
      lastReply: async (id) => (await host.sessions.lastReply(id)).reply,
    },
    now: () => Date.now(),
  });
  const dataDir = process.env[OPENCHAMBER_SERVICE_DATA_DIR] ?? ".";
  const marks = createMarkBook({
    store: fileStateStore(dataDir),
    setMark: (target, mark) => host.setMark(target, mark),
    now: () => Date.now(),
  });
  void marks.start();
  const handler = createHandler({ token, drafts, marks, emit: (topic, data) => host.emit(topic, data) });

  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(chunk as Buffer);
      const headers = new Headers();
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string") headers.set(key, value);
        else if (Array.isArray(value)) headers.set(key, value.join(", "));
      }
      const method = incoming.method ?? "GET";
      const request = new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks),
      });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "INTERNAL" }));
    }
  });
  server.listen(port, "127.0.0.1");
}

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (Number.isInteger(port) && port > 0 && token) serve(port, token);
