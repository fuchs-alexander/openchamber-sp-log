/**
 * Sidebar marks: per session, whether its work is logged to Super Productivity.
 * The state lives in the service's data folder; marks live only as long as the
 * process, so `start()` sets them all again, within the host's rate limit.
 */
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  SERVICE_MARK_RATE_MAX,
  SERVICE_MARKS_MAX,
  type ServiceMark,
  type ServiceMarkTarget,
} from "@openchamber/sdk";
import { DRAFT_TTL_MS } from "./drafts.ts";

export type MarkState = {
  /** When the last log was saved (or the last turn before it ended, if later). */
  loggedAt: number | null;
  logs: number;
  hours: number;
  /** When the session's last turn with real work ended. */
  lastTurnAt: number | null;
  /** A session-draft request the dialog started; its own turn is no new work. */
  pendingLogId: string | null;
  /** When that request started; after `PENDING_TTL_MS` it no longer hides a turn. */
  pendingSince: number | null;
};

export type MarkStateMap = Record<string, MarkState>;

export type StateStore = {
  load: () => Promise<MarkStateMap>;
  save: (state: MarkStateMap) => Promise<void>;
};

export const MARK_RATE_MAX = SERVICE_MARK_RATE_MAX;
const RATE_WINDOW_MS = 60_000;
/** Matches the draft lifetime: a request older than this has no own turn to come. */
export const PENDING_TTL_MS = DRAFT_TTL_MS;
/** Waits before retrying a refused mark; after the last one, only the next change tries again. */
export const MARK_RETRY_DELAYS_MS = [5_000, 30_000, 120_000] as const;

const pad = (n: number): string => String(n).padStart(2, "0");
const formatHours = (hours: number): string => String(Math.round(hours * 100) / 100).replace(".", ",");

/** The mark a session's state draws, or `null` for none. */
export function markFor(s: MarkState): ServiceMark | null {
  if (s.loggedAt === null) {
    return s.lastTurnAt === null ? null : { icon: "time-line", tone: "neutral", text: "SP: noch nicht geloggt" };
  }
  if (s.lastTurnAt !== null && s.lastTurnAt > s.loggedAt) {
    const d = new Date(s.loggedAt);
    return { icon: "time-line", tone: "warning", text: `SP: neue Arbeit seit Log am ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.` };
  }
  return {
    icon: "checkbox-circle-line",
    tone: "success",
    text: `SP: ${s.logs} ${s.logs === 1 ? "Log" : "Logs"} · ≈ ${formatHours(s.hours)} h`,
  };
}

const empty = (): MarkState => ({
  loggedAt: null,
  logs: 0,
  hours: 0,
  lastTurnAt: null,
  pendingLogId: null,
  pendingSince: null,
});
const activity = (s: MarkState): number => Math.max(s.loggedAt ?? 0, s.lastTurnAt ?? 0);

const numOrNull = (v: unknown): v is number | null => v === null || (typeof v === "number" && Number.isFinite(v));

/** A saved entry, or `null` if it is invalid. A request without a start time counts as expired. */
function readMarkState(value: unknown): MarkState | null {
  if (!value || typeof value !== "object") return null;
  const s = value as Record<string, unknown>;
  if (
    !numOrNull(s.loggedAt) ||
    !numOrNull(s.lastTurnAt) ||
    typeof s.logs !== "number" ||
    typeof s.hours !== "number" ||
    !(s.pendingLogId === null || typeof s.pendingLogId === "string")
  ) {
    return null;
  }
  const pendingSince = typeof s.pendingSince === "number" && Number.isFinite(s.pendingSince) ? s.pendingSince : null;
  return {
    loggedAt: s.loggedAt,
    logs: s.logs,
    hours: s.hours,
    lastTurnAt: s.lastTurnAt,
    pendingLogId: pendingSince === null ? null : s.pendingLogId,
    pendingSince: s.pendingLogId === null ? null : pendingSince,
  };
}

/** `state.json` in `dir`, written to a temp file and renamed into place. */
export function fileStateStore(dir: string): StateStore {
  const file = join(dir, "state.json");
  return {
    async load() {
      try {
        const raw = JSON.parse(await readFile(file, "utf8")) as unknown;
        if (!raw || typeof raw !== "object") return {};
        const out: MarkStateMap = {};
        for (const [id, value] of Object.entries(raw)) {
          const s = readMarkState(value);
          if (s) out[id] = s;
        }
        return out;
      } catch {
        // Missing or unreadable: start empty; the next save writes a fresh file.
        return {};
      }
    },
    async save(state) {
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, file);
    },
  };
}

/** Keeps the state in this process only, for a service without a data folder. */
export function memoryStateStore(): StateStore {
  let state: MarkStateMap = {};
  return {
    load: async () => structuredClone(state),
    save: async (next) => {
      state = structuredClone(next);
    },
  };
}

export function createMarkBook(deps: {
  store: StateStore;
  setMark: (target: ServiceMarkTarget, mark: ServiceMark | null) => Promise<unknown>;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Short, content-free warnings; defaults to `console.warn`. */
  warn?: (message: string) => void;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  let states: MarkStateMap = {};
  /** Changes that arrive before the saved state is loaded; run right after it. */
  let early: (() => void)[] | null = [];
  /** Failed attempts per session since its last change or success. */
  const failures = new Map<string, number>();
  const retries = new Set<Promise<void>>();
  /** What this process has put on each row; a new process starts with none. */
  const shown = new Map<string, string>();
  const queue = new Set<string>();
  const sentAt: number[] = [];
  let draining: Promise<void> = Promise.resolve();
  let saving: Promise<void> = Promise.resolve();

  async function waitForRate(): Promise<void> {
    for (;;) {
      const now = deps.now();
      while (sentAt.length && sentAt[0]! <= now - RATE_WINDOW_MS) sentAt.shift();
      if (sentAt.length < MARK_RATE_MAX) return;
      await sleep(sentAt[0]! + RATE_WINDOW_MS - now);
    }
  }

  async function drain(): Promise<void> {
    for (const id of queue) {
      queue.delete(id);
      const s = states[id];
      const mark = s ? markFor(s) : null;
      const key = JSON.stringify(mark);
      if ((shown.get(id) ?? "null") === key) continue;
      await waitForRate();
      sentAt.push(deps.now());
      try {
        await deps.setMark({ sessionId: id }, mark);
        failures.delete(id);
        if (mark) shown.set(id, key);
        else shown.delete(id);
      } catch {
        retryLater(id);
      }
    }
  }

  /** Refused (paused, rate, host busy): try again with backoff, then wait for the next change. */
  function retryLater(id: string): void {
    const attempt = failures.get(id) ?? 0;
    const delay = MARK_RETRY_DELAYS_MS[attempt];
    failures.set(id, attempt + 1);
    if (delay === undefined) {
      warn("sp-log: a sidebar mark was refused; giving up until the session changes");
      return;
    }
    if (attempt === 0) warn("sp-log: a sidebar mark was refused; retrying");
    const retry: Promise<void> = sleep(delay).then(() => {
      retries.delete(retry);
      apply(id);
    });
    retries.add(retry);
  }

  function apply(id: string): void {
    const wasIdle = queue.size === 0;
    queue.add(id);
    if (wasIdle) draining = draining.then(drain);
  }

  function persist(): void {
    const snapshot = structuredClone(states);
    saving = saving.then(() => deps.store.save(snapshot)).catch(() => {});
  }

  /** Keeps the most recently active sessions within the host's mark limit. */
  function prune(): void {
    const ids = Object.keys(states);
    if (ids.length <= SERVICE_MARKS_MAX) return;
    ids.sort((a, b) => activity(states[b]!) - activity(states[a]!));
    for (const id of ids.slice(SERVICE_MARKS_MAX)) {
      delete states[id];
      apply(id);
    }
  }

  function update(id: string, change: (s: MarkState) => void): void {
    if (early) {
      early.push(() => update(id, change));
      return;
    }
    failures.delete(id);
    const s = states[id] ?? empty();
    change(s);
    states[id] = s;
    prune();
    persist();
    apply(id);
  }

  const clearPending = (s: MarkState): void => {
    s.pendingLogId = null;
    s.pendingSince = null;
  };

  /** The first turn after a live session-draft request is that request's own, not new work. */
  function turnEnded(id: string): void {
    update(id, (s) => {
      const ownTurn = s.pendingLogId !== null && deps.now() - (s.pendingSince ?? 0) <= PENDING_TTL_MS;
      clearPending(s);
      if (!ownTurn) s.lastTurnAt = deps.now();
    });
  }

  return {
    /** Loads the saved state, applies changes that came meanwhile, and sets every mark again. */
    async start(): Promise<void> {
      if (!early) return;
      states = await deps.store.load();
      const waiting = early;
      early = null;
      for (const id of Object.keys(states)) apply(id);
      for (const change of waiting) change();
    },
    turnFinished: turnEnded,
    /** A turn that ended in an error: the request's own turn, or else work like a finished one. */
    turnFailed: turnEnded,
    pending(id: string, logId: string): void {
      update(id, (s) => {
        s.pendingLogId = logId;
        s.pendingSince = deps.now();
      });
    },
    /** Drops a request that could not be sent. */
    cancelPending(id: string, logId: string): void {
      if (!early && !states[id]) return;
      update(id, (s) => {
        if (s.pendingLogId === logId) clearPending(s);
      });
    },
    /** A log was saved; uses the service clock, so turns before it count as logged. */
    logged(id: string, hours: number): void {
      update(id, (s) => {
        const now = deps.now();
        s.loggedAt = Math.max(now, s.lastTurnAt ?? now);
        s.logs += 1;
        s.hours += hours;
        clearPending(s);
      });
    },
    state(id: string): MarkState | null {
      return states[id] ? { ...states[id] } : null;
    },
    /** Resolves once every queued mark and retry is done and the state is written. */
    async flush(): Promise<void> {
      for (;;) {
        const [d, s] = [draining, saving];
        await d;
        await s;
        if (retries.size > 0) await Promise.all(retries);
        else if (d === draining && s === saving && queue.size === 0) return;
      }
    },
  };
}

export type MarkBook = ReturnType<typeof createMarkBook>;
