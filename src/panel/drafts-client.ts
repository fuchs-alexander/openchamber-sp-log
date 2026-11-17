import type { HostLike } from "./api.ts";

/** What `GET /draft` of the extension's own service reports. */
export type DraftPoll = {
  state: "pending" | "done" | "failed";
  text?: string;
  sessionStatus: string;
};

/**
 * A service call that did not work: no service, not granted, HTTP error or an unreadable answer.
 * `reason` is the service's own `error` field, e.g. "session-waiting" or "host-timeout".
 */
export class DraftServiceError extends Error {
  code: string;
  reason: string | null;
  constructor(code: string, reason: string | null = null) {
    super(`draft service: ${code}`);
    this.name = "DraftServiceError";
    this.code = code;
    this.reason = reason;
  }
}

function errorReason(body: string): string | null {
  try {
    const data: unknown = JSON.parse(body);
    const error = data && typeof data === "object" ? (data as { error?: unknown }).error : undefined;
    return typeof error === "string" ? error : null;
  } catch {
    return null;
  }
}

function parsePoll(body: string): DraftPoll {
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    throw new DraftServiceError("BAD_RESPONSE");
  }
  const d = data as Partial<DraftPoll> | null;
  if (
    !d ||
    typeof d !== "object" ||
    (d.state !== "pending" && d.state !== "done" && d.state !== "failed") ||
    typeof d.sessionStatus !== "string" ||
    (d.text !== undefined && typeof d.text !== "string")
  ) {
    throw new DraftServiceError("BAD_RESPONSE");
  }
  return { state: d.state, text: d.text, sessionStatus: d.sessionStatus };
}

/** Talks to the extension's service, which asks the logged session itself for the draft. */
export function createDraftsClient(host: Pick<HostLike, "serviceRequest">) {
  async function call(method: "GET" | "POST", query?: Record<string, string>, body?: string): Promise<string> {
    let res;
    try {
      res = await host.serviceRequest({ method, path: "/draft", query, body });
    } catch (err) {
      const code = err && typeof err === "object" ? (err as { code?: unknown }).code : undefined;
      throw new DraftServiceError(typeof code === "string" ? code : "REQUEST_FAILED");
    }
    if (res.status >= 400) throw new DraftServiceError(`HTTP_${res.status}`, errorReason(res.body));
    return res.body;
  }

  return {
    async start(sessionId: string, logId: string, prompt: string): Promise<void> {
      await call("POST", undefined, JSON.stringify({ sessionId, logId, prompt }));
    },
    async poll(sessionId: string, logId: string): Promise<DraftPoll> {
      return parsePoll(await call("GET", { sessionId, logId }));
    },
  };
}
