/** Keeps track of work-log drafts the logged session writes itself. */

export const DRAFT_TTL_MS = 15 * 60 * 1000;
/** Consecutive idle polls without the answer after which a draft has failed. */
export const IDLE_POLLS_MAX = 3;
/** Each host call gets this long, so a service request stays well below the panel's 20 s. */
export const HOST_TIMEOUT_MS = 8_000;

/** The session waits on the user (an open form or question); sending would close it. */
export class SessionWaitingError extends Error {
  constructor() {
    super("session is waiting for input");
    this.name = "SessionWaitingError";
  }
}

/** A host call took longer than the local limit. */
export class HostTimeoutError extends Error {
  constructor() {
    super("host call timed out");
    this.name = "HostTimeoutError";
  }
}

export type DraftSessions = {
  send(id: string, prompt: string): Promise<unknown>;
  status(id: string): Promise<"idle" | "busy" | "waiting" | string>;
  lastReply(id: string): Promise<string | null>;
};

export type DraftPoll = {
  state: "pending" | "done" | "failed";
  text?: string;
  sessionStatus: string;
};

type Entry = {
  sessionId: string;
  previousReply: string | null;
  startedAt: number;
  idlePolls: number;
};

export type Drafts = ReturnType<typeof createDrafts>;

export function createDrafts(deps: { sessions: DraftSessions; now: () => number; hostTimeoutMs?: number }) {
  const entries = new Map<string, Entry>();
  const hostTimeoutMs = deps.hostTimeoutMs ?? HOST_TIMEOUT_MS;

  function limited<T>(call: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new HostTimeoutError()), hostTimeoutMs);
    });
    return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  }

  function dropExpired(): void {
    const now = deps.now();
    for (const [logId, entry] of entries) {
      if (now - entry.startedAt > DRAFT_TTL_MS) entries.delete(logId);
    }
  }

  return {
    async start(input: { sessionId: string; logId: string; prompt: string }): Promise<void> {
      dropExpired();
      if ((await limited(deps.sessions.status(input.sessionId))) === "waiting") throw new SessionWaitingError();
      const previousReply = await limited(deps.sessions.lastReply(input.sessionId));
      entries.set(input.logId, {
        sessionId: input.sessionId,
        previousReply,
        startedAt: deps.now(),
        idlePolls: 0,
      });
      await limited(deps.sessions.send(input.sessionId, input.prompt));
    },

    async poll(input: { sessionId: string; logId: string }): Promise<DraftPoll> {
      dropExpired();
      const entry = entries.get(input.logId);
      if (!entry || entry.sessionId !== input.sessionId) {
        return { state: "failed", sessionStatus: "unknown" };
      }
      const sessionStatus = await limited(deps.sessions.status(input.sessionId));
      const reply = await limited(deps.sessions.lastReply(input.sessionId));
      // Only once the turn is over: while busy the reply may still be streaming.
      if (sessionStatus === "idle" && reply !== null && reply !== entry.previousReply && reply.includes(input.logId)) {
        return { state: "done", text: reply, sessionStatus };
      }
      if (sessionStatus === "idle") {
        entry.idlePolls += 1;
        if (entry.idlePolls >= IDLE_POLLS_MAX) return { state: "failed", sessionStatus };
      } else {
        entry.idlePolls = 0;
      }
      return { state: "pending", sessionStatus };
    },
  };
}
