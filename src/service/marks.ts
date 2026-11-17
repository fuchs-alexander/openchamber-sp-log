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

export type MarkState = {
  /** When the last log was saved (or the last turn before it ended, if later). */
  loggedAt: number | null;
  logs: number;
  hours: number;
  /** When the session's last turn with real work ended. */
  lastTurnAt: number | null;
  /** A session-draft request the dialog started; its own turn is no new work. */
  pendingLogId: string | null;
};

export type MarkStateMap = Record<string, MarkState>;

export type StateStore = {
  load: () => Promise<MarkStateMap>;
  save: (state: MarkStateMap) => Promise<void>;
};

export const MARK_RATE_MAX = SERVICE_MARK_RATE_MAX;
const RATE_WINDOW_MS = 60_000;

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

const empty = (): MarkState => ({ loggedAt: null, logs: 0, hours: 0, lastTurnAt: null, pendingLogId: null });
const activity = (s: MarkState): number => Math.max(s.loggedAt ?? 0, s.lastTurnAt ?? 0);

function isMarkState(value: unknown): value is MarkState {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  const numOrNull = (v: unknown) => v === null || (typeof v === "number" && Number.isFinite(v));
  return (
    numOrNull(s.loggedAt) &&
    numOrNull(s.lastTurnAt) &&
    typeof s.logs === "number" &&
    typeof s.hours === "number" &&
    (s.pendingLogId === null || typeof s.pendingLogId === "string")
  );
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
        for (const [id, s] of Object.entries(raw)) if (isMarkState(s)) out[id] = s;
        return out;
      } catch {
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

export function createMarkBook(deps: {
  store: StateStore;
  setMark: (target: ServiceMarkTarget, mark: ServiceMark | null) => Promise<unknown>;
  now: () => number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let states: MarkStateMap = {};
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
        if (mark) shown.set(id, key);
        else shown.delete(id);
      } catch {
        // Refused (paused, rate, too many): the next change of this session tries again.
      }
    }
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
    const s = states[id] ?? empty();
    change(s);
    states[id] = s;
    prune();
    persist();
    apply(id);
  }

  return {
    /** Loads the saved state and sets every mark again. */
    async start(): Promise<void> {
      states = await deps.store.load();
      for (const id of Object.keys(states)) apply(id);
    },
    turnFinished(id: string): void {
      update(id, (s) => {
        // The first turn after a session-draft request is that request's own.
        if (s.pendingLogId !== null) s.pendingLogId = null;
        else s.lastTurnAt = deps.now();
      });
    },
    pending(id: string, logId: string): void {
      update(id, (s) => {
        s.pendingLogId = logId;
      });
    },
    logged(id: string, at: number, hours: number): void {
      update(id, (s) => {
        s.loggedAt = Math.max(at, s.lastTurnAt ?? at);
        s.logs += 1;
        s.hours += hours;
        s.pendingLogId = null;
      });
    },
    state(id: string): MarkState | null {
      return states[id] ? { ...states[id] } : null;
    },
    /** Resolves once every queued mark is set and the state is written. */
    async flush(): Promise<void> {
      await draining;
      await saving;
    },
  };
}

export type MarkBook = ReturnType<typeof createMarkBook>;
