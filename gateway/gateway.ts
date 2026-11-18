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
  // Clock for the day logged hours are booked on (gateway local date).
  now?: () => Date;
};

export const MAX_BODY_BYTES = 65536;
export const MAX_TITLE_LENGTH = 200;
export const EXCERPT_LENGTH = 300;
export const MAX_HOURS = 100;
const UPSTREAM_TIMEOUT_MS = 10_000;
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;
const LEGACY_TITLE = "Frühere Logs";

type SpResult = { ok: true; data: unknown } | { ok: false; error: "sp-unreachable" | "sp-rejected" };

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

// Optional `hours`: absent, null or 0 → no booking; otherwise 0 < hours ≤ 100.
function checkHours(value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_HOURS) fail(400, "invalid-hours");
  return value;
}

// Optional `logTitle` (the subtask's title after the date): absent or null → "Log".
function checkLogTitle(value: unknown): string {
  if (value === undefined || value === null) return "Log";
  if (typeof value !== "string" || value.trim() === "" || value.length > MAX_TITLE_LENGTH) fail(400, "invalid-log-title");
  return value.trim();
}

const pad = (n: number) => String(n).padStart(2, "0");

function localDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayMonth(d: Date): string {
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
}

// SP's timeSpentOnDay ({ "YYYY-MM-DD": ms }) as whole positive ms per day.
function timeByDay(value: unknown): Map<string, number> {
  const out = new Map<string, number>();
  for (const [date, ms] of Object.entries(asRecord(value))) {
    if (!DATE_PATTERN.test(date) || typeof ms !== "number" || !Number.isFinite(ms)) continue;
    const whole = Math.min(DAY_MS, Math.round(ms));
    if (whole > 0) out.set(date, whole);
  }
  return out;
}

function sumOf(days: Map<string, number>): number {
  let sum = 0;
  for (const ms of days.values()) sum += ms;
  return sum;
}

export function createGateway(opts: GatewayOptions): (req: Request) => Promise<Response> {
  const doFetch = opts.fetch ?? fetch;
  const base = opts.spUrl.replace(/\/+$/, "");
  const now = opts.now ?? (() => new Date());

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

  // Like sp(), but never throws: the note/task is already written when these
  // calls run, so failures are reported in the response instead.
  async function trySp(method: string, path: string, body?: unknown): Promise<SpResult> {
    try {
      return { ok: true, data: await sp(method, path, body) };
    } catch (err) {
      return { ok: false, error: err instanceof HttpError && err.code === "sp-unreachable" ? "sp-unreachable" : "sp-rejected" };
    }
  }

  // SP caps tracked time at 24h per task and day, but not across tasks. So
  // each log becomes its own done subtask carrying the log's time; the parent
  // shows the sum of its subtasks. A log over 24h is split into several
  // subtasks "(i/n)" of 24h each, the remainder last, all on the same day.
  // The first carries the log's notes, the others a short "Teil i/n". A
  // failed chunk stops the split; booked chunks stay and are reported.
  async function logAsSubtask(id: string, hours: number, logTitle: string, notes: string): Promise<Record<string, unknown>> {
    if (hours <= 0) return { id };
    const today = now();
    const total = Math.max(1, Math.round(hours * 3_600_000));
    const chunks: number[] = [];
    for (let left = total; left > 0; left -= DAY_MS) chunks.push(Math.min(DAY_MS, left));
    const n = chunks.length;
    const ids: string[] = [];
    let bookedMs = 0;
    const result = (extra: Record<string, unknown>): Record<string, unknown> => ({
      id,
      ...(ids.length > 0 ? { subtaskId: ids[0] } : {}),
      ...(n > 1 ? { subtaskIds: [...ids] } : {}),
      ...extra,
      ...(n > 1 && extra.timeBooked === false ? { bookedHours: bookedMs / 3_600_000 } : {}),
    });
    for (const [i, duration] of chunks.entries()) {
      const suffix = n > 1 ? ` (${i + 1}/${n})` : "";
      const title = `${dayMonth(today)} · ${logTitle}${suffix}`;
      const body = i === 0 ? notes : `Teil ${i + 1}/${n}`;
      const created = await trySp("POST", "/tasks", { parentId: id, title, notes: body, isDone: true });
      const subtaskId = created.ok ? asRecord(created.data).id : undefined;
      if (typeof subtaskId !== "string" || !ID_PATTERN.test(subtaskId)) {
        const timeError = !created.ok && created.error === "sp-unreachable" ? "sp-unreachable" : "sp-subtask-rejected";
        return result({ timeBooked: false, timeError });
      }
      ids.push(subtaskId);
      const booked = await trySp("POST", `/tasks/${subtaskId}/time`, { date: localDate(today), duration });
      if (!booked.ok) {
        const timeError = booked.error === "sp-unreachable" ? "sp-unreachable" : "sp-time-rejected";
        return result({ timeBooked: false, timeError });
      }
      bookedMs += duration;
    }
    return result({ timeBooked: true });
  }

  // A logged task is finished: the parent is marked done last, after its log
  // subtask and time, so SP never sees new work under a done parent. Failure
  // is reported as completed: false; the log itself is already written.
  async function complete(id: string, result: Record<string, unknown>): Promise<Response> {
    const done = await trySp("PATCH", `/tasks/${id}`, { isDone: true });
    return json({ ...result, completed: done.ok });
  }

  // The task by id, or null when SP no longer has it (missing, or archived:
  // archived tasks are not addressable for updates).
  async function readTask(id: string): Promise<Record<string, unknown> | null> {
    const current = await sp("GET", `/tasks/${id}`, undefined, true);
    if (current === null) return null;
    const task = asRecord(current);
    return task.isArchived === true ? null : task;
  }

  async function getTask(id: string): Promise<Response> {
    const task = await readTask(id);
    if (task === null) fail(404, "task-gone");
    return json({ id, title: asString(task.title), isDone: task.isDone === true });
  }

  // Tracked time of a task: SP's timeSpent, else the sum of its days.
  function spentMs(task: Record<string, unknown>, days: Map<string, number>): number {
    const total = task.timeSpent;
    if (typeof total === "number" && Number.isFinite(total) && total >= 0) return Math.round(total);
    return sumOf(days);
  }

  // Read-only view of a task for the panel: its project's title, its notes and
  // its subtasks (one GET each, in parallel, in SP's order; missing or archived
  // ones are skipped). The project list is optional: failures give null.
  async function taskDetails(id: string): Promise<Response> {
    const task = await readTask(id);
    if (task === null) fail(404, "task-gone");
    const projectId = typeof task.projectId === "string" ? task.projectId : null;
    const subIds = (Array.isArray(task.subTaskIds) ? task.subTaskIds : []).filter(
      (s): s is string => typeof s === "string" && ID_PATTERN.test(s),
    );
    const [projects, subs] = await Promise.all([
      projectId ? trySp("GET", "/projects") : Promise.resolve<SpResult>({ ok: false, error: "sp-rejected" }),
      Promise.all(subIds.map((sub) => readTask(sub).catch(() => null))),
    ]);
    const project = projects.ok && Array.isArray(projects.data) ? projects.data.map(asRecord).find((p) => p.id === projectId) : undefined;
    const days = timeByDay(task.timeSpentOnDay);
    const subtasks = subs
      .map((sub, i) => {
        if (sub === null) return null;
        const subDays = timeByDay(sub.timeSpentOnDay);
        return {
          id: subIds[i]!,
          title: asString(sub.title),
          isDone: sub.isDone === true,
          timeSpentMs: spentMs(sub, subDays),
          timeSpentOnDay: Object.fromEntries(subDays),
        };
      })
      .filter((sub) => sub !== null);
    return json({
      id,
      title: asString(task.title),
      isDone: task.isDone === true,
      projectId,
      projectTitle: project ? asString(project.title) : null,
      timeSpentMs: spentMs(task, days),
      notes: asString(task.notes),
      subtasks,
    });
  }

  // A parent with its own tracked time but no subtasks (logged before 0.5.0)
  // first moves that time onto a done subtask "Frühere Logs"; otherwise the
  // next log subtask would take it over (SP hands a parent's time to its first
  // subtask). Only books what the new subtask lacks, so it works whether or
  // not SP copies the time itself. Returns false when the move failed.
  async function convertLegacy(id: string, task: Record<string, unknown>): Promise<boolean> {
    const subtasks = Array.isArray(task.subTaskIds) ? task.subTaskIds : [];
    if (subtasks.length > 0) return true;
    const old = timeByDay(task.timeSpentOnDay);
    if (old.size === 0) return true;
    const created = await trySp("POST", "/tasks", { parentId: id, title: LEGACY_TITLE, isDone: true });
    const legacyId = created.ok ? asRecord(created.data).id : undefined;
    if (typeof legacyId !== "string" || !ID_PATTERN.test(legacyId)) return false;
    const before = await trySp("GET", `/tasks/${legacyId}`);
    if (!before.ok) return false;
    const have = timeByDay(asRecord(before.data).timeSpentOnDay);
    for (const [date, duration] of old) {
      const missing = duration - (have.get(date) ?? 0);
      if (missing <= 0) continue;
      const booked = await trySp("POST", `/tasks/${legacyId}/time`, { date, duration: missing });
      if (!booked.ok) return false;
    }
    // Verify: the legacy subtask now holds exactly the parent's old time.
    const after = await trySp("GET", `/tasks/${legacyId}`);
    if (!after.ok) return false;
    return sumOf(timeByDay(asRecord(after.data).timeSpentOnDay)) === sumOf(old);
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
    // SP lists subtasks too; logs go to top-level tasks only.
    const tasks = (Array.isArray(data) ? data : [])
      .map(asRecord)
      .filter((t) => typeof t.id === "string" && t.isDone !== true && !t.parentId)
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
    const hours = checkHours(body.hours);
    const logTitle = checkLogTitle(body.logTitle);
    const data = asRecord(await sp("POST", "/tasks", { title, notes, projectId }));
    if (typeof data.id !== "string" || !ID_PATTERN.test(data.id)) fail(502, "sp-error");
    return complete(data.id, await logAsSubtask(data.id, hours, logTitle, notes));
  }

  async function appendToTask(id: string, req: Request): Promise<Response> {
    const body = await readJsonBody(req);
    const text = body.text;
    if (typeof text !== "string" || text.trim() === "") fail(400, "invalid-text");
    const hours = checkHours(body.hours);
    const logTitle = checkLogTitle(body.logTitle);
    // A done task still takes logs: sessions are often logged several times.
    const task = await readTask(id);
    if (task === null) fail(404, "task-gone");
    const old = asString(task.notes);
    const notes = old === "" ? text : `${old}\n\n${text}`;
    await sp("PATCH", `/tasks/${id}`, { notes });
    if (hours > 0 && !(await convertLegacy(id, task))) return complete(id, { id, timeBooked: false, timeError: "sp-convert-failed" });
    return complete(id, await logAsSubtask(id, hours, logTitle, text));
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
    if (method === "GET" && parts.length === 2 && parts[0] === "tasks") return getTask(checkId(parts[1]));
    if (method === "GET" && parts.length === 3 && parts[0] === "tasks" && parts[2] === "details") {
      return taskDetails(checkId(parts[1]));
    }
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
