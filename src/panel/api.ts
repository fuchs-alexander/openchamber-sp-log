import {
  HostRequestError,
  type GenerateRequest,
  type GenerateResult,
  type GuestRequest,
  type GuestRequestResult,
  type GuestStorageOptions,
  type JsonValue,
  type ToastRequest,
} from "@openchamber/sdk";
import type { MatchCandidate } from "../log/match.ts";

/** The part of `connectHost()` the panel uses; a fake is enough in tests. */
export interface HostLike {
  request(request: GuestRequest): Promise<GuestRequestResult>;
  /** A request to this extension's own service (`contributes.service`). */
  serviceRequest(request: GuestRequest): Promise<GuestRequestResult>;
  storage: {
    get(key: string, options?: GuestStorageOptions): Promise<JsonValue | undefined>;
    set(key: string, value: JsonValue, options?: GuestStorageOptions): Promise<void>;
    delete(key: string, options?: GuestStorageOptions): Promise<void>;
  };
  generate(request: GenerateRequest): Promise<GenerateResult>;
  toast(request: ToastRequest): Promise<void>;
  close(): Promise<void>;
}

export class GatewayError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) {
    super(`gateway: ${code}`);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
  }
}

/** `folder`: the SP folder path (" / " between levels); null or missing without folder. */
export type SpProject = { id: string; title: string; folder?: string | null };

function parseBody(body: unknown): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

function errorCode(data: unknown): string | null {
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return null;
}

function idOf(data: unknown): string {
  const id = data && typeof data === "object" ? (data as { id?: unknown }).id : undefined;
  if (typeof id !== "string") throw new GatewayError(200, "bad-response");
  return id;
}

/**
 * A written log. `timeBooked`: whether the hours were booked as tracked time
 * in SP; null when the gateway booked nothing (hours 0, or an older gateway).
 * `completed`: whether the task was marked done after the log; null from an
 * older gateway.
 */
export type SaveResult = { id: string; timeBooked: boolean | null; timeError: string | null; completed: boolean | null };

/** A task looked up by id (open or done). */
export type BoundTask = { id: string; title: string; isDone: boolean };

/** A subtask of the panel's task view; `timeSpentOnDay`: ms per `YYYY-MM-DD`. */
export type SubtaskDetails = { id: string; title: string; isDone: boolean; timeSpentMs: number; timeSpentOnDay: Record<string, number> };

/** The bound task as the panel shows it, live from SP (`GET /tasks/:id/details`). */
export type TaskDetails = {
  id: string;
  title: string;
  isDone: boolean;
  projectId: string | null;
  projectTitle: string | null;
  timeSpentMs: number;
  notes: string;
  subtasks: SubtaskDetails[];
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const ms = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

function days(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== "object" || Array.isArray(v)) return out;
  for (const [day, value] of Object.entries(v)) if (/^\d{4}-\d{2}-\d{2}$/.test(day) && ms(value) > 0) out[day] = ms(value);
  return out;
}

/** The gateway's answer, checked field by field; null without a task id. */
export function parseTaskDetails(data: unknown): TaskDetails | null {
  if (!data || typeof data !== "object" || typeof (data as { id?: unknown }).id !== "string") return null;
  const r = data as Record<string, unknown>;
  const subtasks = (Array.isArray(r.subtasks) ? r.subtasks : [])
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string")
    .map((s) => ({ id: s.id as string, title: str(s.title), isDone: s.isDone === true, timeSpentMs: ms(s.timeSpentMs), timeSpentOnDay: days(s.timeSpentOnDay) }));
  return {
    id: r.id as string,
    title: str(r.title),
    isDone: r.isDone === true,
    projectId: typeof r.projectId === "string" ? r.projectId : null,
    projectTitle: typeof r.projectTitle === "string" ? r.projectTitle : null,
    timeSpentMs: ms(r.timeSpentMs),
    notes: str(r.notes),
    subtasks,
  };
}

function saveResultOf(data: unknown): SaveResult {
  const id = idOf(data);
  const record = data as { timeBooked?: unknown; timeError?: unknown; completed?: unknown };
  return {
    id,
    timeBooked: typeof record.timeBooked === "boolean" ? record.timeBooked : null,
    timeError: typeof record.timeError === "string" ? record.timeError : null,
    completed: typeof record.completed === "boolean" ? record.completed : null,
  };
}

function listOf(data: unknown): unknown[] {
  if (!Array.isArray(data)) throw new GatewayError(200, "bad-response");
  return data;
}

export function createApi(host: HostLike) {
  async function call(req: GuestRequest): Promise<unknown> {
    let res: GuestRequestResult;
    try {
      res = await host.request(req);
    } catch (err) {
      if (err instanceof HostRequestError && err.code === "DISCONNECTED") {
        throw new GatewayError(0, "disconnected");
      }
      throw new GatewayError(0, "request-failed");
    }
    const data = parseBody(res.body);
    if (res.status >= 400) {
      throw new GatewayError(res.status, errorCode(data) ?? `http-${res.status}`);
    }
    return data;
  }

  const post = (path: string, payload: unknown): GuestRequest => ({
    method: "POST",
    path,
    body: JSON.stringify(payload),
  });

  return {
    async projects(): Promise<SpProject[]> {
      return listOf(await call({ method: "GET", path: "/projects" })) as SpProject[];
    },
    async tasks(projectId: string): Promise<MatchCandidate[]> {
      const path = `/projects/${encodeURIComponent(projectId)}/tasks`;
      return listOf(await call({ method: "GET", path })) as MatchCandidate[];
    },
    /** The task by id, open or done; null when it is gone (missing or archived). */
    async task(taskId: string): Promise<BoundTask | null> {
      let data: unknown;
      try {
        data = await call({ method: "GET", path: `/tasks/${encodeURIComponent(taskId)}` });
      } catch (err) {
        if (err instanceof GatewayError && err.code === "task-gone") return null;
        throw err;
      }
      const record = (data ?? {}) as { title?: unknown; isDone?: unknown };
      return { id: idOf(data), title: typeof record.title === "string" ? record.title : "", isDone: record.isDone === true };
    },
    /** The task with its notes and subtasks, for the panel; null when it is gone. */
    async details(taskId: string): Promise<TaskDetails | null> {
      let data: unknown;
      try {
        data = await call({ method: "GET", path: `/tasks/${encodeURIComponent(taskId)}/details` });
      } catch (err) {
        if (err instanceof GatewayError && err.code === "task-gone") return null;
        throw err;
      }
      const details = parseTaskDetails(data);
      if (!details) throw new GatewayError(200, "bad-response");
      return details;
    },
    /** `logTitle`: the draft title; the gateway names the log's SP subtask after it. */
    async create(projectId: string, title: string, notes: string, hours: number, logTitle: string): Promise<SaveResult> {
      return saveResultOf(await call(post("/tasks", { projectId, title, notes, hours, logTitle })));
    },
    async append(taskId: string, text: string, hours: number, logTitle: string): Promise<SaveResult> {
      return saveResultOf(await call(post(`/tasks/${encodeURIComponent(taskId)}/append`, { text, hours, logTitle })));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
