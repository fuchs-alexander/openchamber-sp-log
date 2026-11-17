// Minimal gateway in front of the Super Productivity local REST API.
// Pure request handler: (Request) => Promise<Response>. No dependencies
// beyond `node:` modules, so Node can run it directly via type stripping.
import { timingSafeEqual } from "node:crypto";

export type GatewayOptions = {
  spUrl: string;
  spToken: () => string;
  gatewayToken: string;
  fetch?: typeof fetch;
  // Project id → folder path. Failures are ignored: projects get folder null.
  folders?: () => Promise<Map<string, string>>;
};

export const MAX_BODY_BYTES = 65536;
export const MAX_TITLE_LENGTH = 200;
export const EXCERPT_LENGTH = 300;
const UPSTREAM_TIMEOUT_MS = 10_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function fail(status: number, code: string): never {
  throw new HttpError(status, code);
}

function tokenMatches(header: string | null, expected: string): boolean {
  if (!header || !header.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length).trim(), "utf8");
  const want = Buffer.from(expected, "utf8");
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

function checkId(id: unknown): string {
  if (typeof id !== "string" || !ID_PATTERN.test(id)) fail(400, "invalid-id");
  return id;
}

async function readJsonBody(req: Request): Promise<Record<string, unknown>> {
  const declared = req.headers.get("content-length");
  if (declared !== null && Number(declared) > MAX_BODY_BYTES) fail(413, "body-too-large");
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        fail(413, "body-too-large");
      }
      chunks.push(value);
    }
  }
  const text = Buffer.concat(chunks).toString("utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(400, "invalid-json");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) fail(400, "invalid-json");
  return parsed as Record<string, unknown>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function createGateway(opts: GatewayOptions): (req: Request) => Promise<Response> {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.spUrl.replace(/\/+$/, "");

  // Returns the upstream `data` field, or null on 404 when allowMissing is set.
  async function sp(method: string, path: string, body?: unknown, allowMissing = false): Promise<unknown> {
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${opts.spToken()}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
    } catch {
      // Never forward the upstream error message: it might contain request details.
      fail(503, "sp-unreachable");
    }
    if (allowMissing && res.status === 404) return null;
    if (!res.ok) fail(502, res.status === 401 ? "sp-unauthorized" : "sp-error");
    let payload: unknown;
    try {
      payload = await res.json();
    } catch {
      fail(502, "sp-error");
    }
    const record = asRecord(payload);
    if (record.ok !== true) fail(502, "sp-error");
    return record.data;
  }

  async function listProjects(): Promise<Response> {
    const data = await sp("GET", "/projects");
    let folders = new Map<string, string>();
    if (opts.folders) {
      try {
        folders = await opts.folders();
      } catch {
        // Folders are optional; never fail the project list because of them.
      }
    }
    const projects = (Array.isArray(data) ? data : [])
      .map(asRecord)
      .filter((p) => p.isArchived !== true && p.isHiddenFromMenu !== true && typeof p.id === "string")
      .map((p) => ({ id: p.id as string, title: asString(p.title), folder: folders.get(p.id as string) ?? null }));
    return json(projects);
  }

  async function listTasks(projectId: string): Promise<Response> {
    const data = await sp("GET", `/tasks?projectId=${encodeURIComponent(projectId)}`);
    const tasks = (Array.isArray(data) ? data : [])
      .map(asRecord)
      .filter((t) => typeof t.id === "string" && t.isDone !== true)
      .map((t) => ({
        id: t.id as string,
        title: asString(t.title),
        notesExcerpt: Array.from(asString(t.notes)).slice(0, EXCERPT_LENGTH).join(""),
      }));
    return json(tasks);
  }

  async function createTask(req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    const projectId = checkId(body.projectId);
    const title = body.title;
    if (typeof title !== "string" || title.trim() === "" || title.length > MAX_TITLE_LENGTH) fail(400, "invalid-title");
    const notes = body.notes ?? "";
    if (typeof notes !== "string") fail(400, "invalid-notes");
    const data = asRecord(await sp("POST", "/tasks", { title, notes, projectId }));
    if (typeof data.id !== "string") fail(502, "sp-error");
    return json({ id: data.id });
  }

  async function appendToTask(id: string, req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    const text = body.text;
    if (typeof text !== "string" || text.trim() === "") fail(400, "invalid-text");
    const current = await sp("GET", `/tasks/${id}`, undefined, true);
    if (current === null) fail(404, "task-gone");
    const task = asRecord(current);
    if (task.isDone === true || task.isArchived === true) fail(404, "task-gone");
    const old = asString(task.notes);
    const notes = old === "" ? text : `${old}\n\n${text}`;
    await sp("PATCH", `/tasks/${id}`, { notes });
    return json({ id });
  }

  async function route(req: Request): Promise<Response> {
    if (!tokenMatches(req.headers.get("authorization"), opts.gatewayToken)) fail(401, "unauthorized");
    const { pathname } = new URL(req.url);
    const parts = pathname.split("/").slice(1);
    const method = req.method.toUpperCase();

    if (method === "GET" && pathname === "/me") return json({ name: "Super Productivity" });
    if (method === "GET" && pathname === "/projects") return listProjects();
    if (method === "GET" && parts.length === 3 && parts[0] === "projects" && parts[2] === "tasks") {
      return listTasks(checkId(parts[1]));
    }
    if (method === "POST" && pathname === "/tasks") return createTask(req);
    if (method === "POST" && parts.length === 3 && parts[0] === "tasks" && parts[2] === "append") {
      return appendToTask(checkId(parts[1]), req);
    }
    fail(404, "not-found");
  }

  return async (req: Request): Promise<Response> => {
    try {
      return await route(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code }, err.status);
      return json({ error: "internal" }, 500);
    }
  };
}
