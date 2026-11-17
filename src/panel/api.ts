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

export type SpProject = { id: string; title: string };

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
    async create(projectId: string, title: string, notes: string): Promise<string> {
      return idOf(await call(post("/tasks", { projectId, title, notes })));
    },
    async append(taskId: string, text: string): Promise<string> {
      return idOf(await call(post(`/tasks/${encodeURIComponent(taskId)}/append`, { text })));
    },
  };
}

export type Api = ReturnType<typeof createApi>;
