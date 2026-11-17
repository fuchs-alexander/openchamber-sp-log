import type { HostLike } from "./api.ts";

/** One saved log: when (ms) and the hours logged. */
export type LogEntry = { at: number; hours: number };

/**
 * `lastLogId`: the session-draft request whose draft was saved last; null after a Small Model draft or before 0.2.0.
 * `taskTitle`, `projectTitle`, `logs`: null for bindings written before 0.3.0.
 * `directory`: the session's directory at the last save (for the project mapping
 * in the Work Status); missing or null before 0.3.1.
 */
export type Binding = {
  taskId: string;
  lastMessageId: string | null;
  lastCreatedAt: number | null;
  lastLogId: string | null;
  taskTitle: string | null;
  projectTitle: string | null;
  logs: LogEntry[] | null;
  directory?: string | null;
};

const OPTS = { scope: "instance" } as const;

const isLogEntry = (v: unknown): v is LogEntry =>
  !!v &&
  typeof v === "object" &&
  typeof (v as LogEntry).at === "number" &&
  Number.isFinite((v as LogEntry).at) &&
  typeof (v as LogEntry).hours === "number" &&
  Number.isFinite((v as LogEntry).hours);

function asBinding(value: unknown): Binding | null {
  if (!value || typeof value !== "object") return null;
  const { taskId, lastMessageId, lastCreatedAt, lastLogId, taskTitle, projectTitle, logs, directory } = value as {
    taskId?: unknown;
    lastMessageId?: unknown;
    lastCreatedAt?: unknown;
    lastLogId?: unknown;
    taskTitle?: unknown;
    projectTitle?: unknown;
    logs?: unknown;
    directory?: unknown;
  };
  if (typeof taskId !== "string") return null;
  if (lastMessageId !== null && typeof lastMessageId !== "string") return null;
  // Bindings written before lastCreatedAt existed lack the field.
  const createdAt = typeof lastCreatedAt === "number" && Number.isFinite(lastCreatedAt) ? lastCreatedAt : null;
  // Bindings written before 0.2.0 lack lastLogId; before 0.3.0 the titles and logs.
  return {
    taskId,
    lastMessageId,
    lastCreatedAt: createdAt,
    lastLogId: typeof lastLogId === "string" ? lastLogId : null,
    taskTitle: typeof taskTitle === "string" ? taskTitle : null,
    projectTitle: typeof projectTitle === "string" ? projectTitle : null,
    logs: Array.isArray(logs) ? logs.filter(isLogEntry).map((l) => ({ at: l.at, hours: l.hours })) : null,
    directory: typeof directory === "string" ? directory : null,
  };
}

/** A log saved to Super Productivity, kept under `saved:<logId>` so every frame knows it is done. */
export type SavedLog = { taskTitle: string; hours: number; at: number };

function asSaved(value: unknown): SavedLog | null {
  if (!value || typeof value !== "object") return null;
  const { taskTitle, hours, at } = value as { taskTitle?: unknown; hours?: unknown; at?: unknown };
  if (typeof taskTitle !== "string" || typeof hours !== "number" || !Number.isFinite(hours)) return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  return { taskTitle, hours, at };
}

export function createStore(host: HostLike) {
  return {
    async getProject(dir: string): Promise<string | null> {
      const v = await host.storage.get(`project:${dir}`, OPTS);
      return typeof v === "string" ? v : null;
    },
    async setProject(dir: string, spProjectId: string): Promise<void> {
      await host.storage.set(`project:${dir}`, spProjectId, OPTS);
    },
    async getBinding(sessionId: string): Promise<Binding | null> {
      return asBinding(await host.storage.get(`session:${sessionId}`, OPTS));
    },
    async setBinding(sessionId: string, b: Binding): Promise<void> {
      const value = {
        taskId: b.taskId,
        lastMessageId: b.lastMessageId,
        lastCreatedAt: b.lastCreatedAt,
        lastLogId: b.lastLogId,
        taskTitle: b.taskTitle,
        projectTitle: b.projectTitle,
        logs: b.logs ? b.logs.map((l) => ({ at: l.at, hours: l.hours })) : null,
        directory: b.directory ?? null,
      };
      await host.storage.set(`session:${sessionId}`, value, OPTS);
    },
    async clearBinding(sessionId: string): Promise<void> {
      await host.storage.delete(`session:${sessionId}`, OPTS);
    },
    async getSaved(logId: string): Promise<SavedLog | null> {
      return asSaved(await host.storage.get(`saved:${logId}`, OPTS));
    },
    async setSaved(logId: string, s: SavedLog): Promise<void> {
      await host.storage.set(`saved:${logId}`, { taskTitle: s.taskTitle, hours: s.hours, at: s.at }, OPTS);
    },
    /** When the session-draft request `logId` was sent, or its card first shown (ms); null: unknown. */
    async getSeen(logId: string): Promise<number | null> {
      const v = await host.storage.get(`seen:${logId}`, OPTS);
      return typeof v === "number" && Number.isFinite(v) ? v : null;
    },
    /** Keeps the first time only. */
    async markSeen(logId: string, at: number): Promise<void> {
      if ((await this.getSeen(logId)) !== null) return;
      await host.storage.set(`seen:${logId}`, at, OPTS);
    },
  };
}

export type Store = ReturnType<typeof createStore>;

/**
 * A session-draft request the Work Status sent and still waits for. The Work
 * Status frame is unmounted whenever OpenChamber hides the panel, so the
 * request is kept here and a new frame continues it instead of starting over.
 */
export type PendingDraft = { logId: string; startedAt: number; directory: string | null };

function asPending(value: unknown): PendingDraft | null {
  if (!value || typeof value !== "object") return null;
  const { logId, startedAt, directory } = value as { logId?: unknown; startedAt?: unknown; directory?: unknown };
  if (typeof logId !== "string" || typeof startedAt !== "number" || !Number.isFinite(startedAt)) return null;
  return { logId, startedAt, directory: typeof directory === "string" ? directory : null };
}

export function createPendingStore(host: HostLike) {
  return {
    async get(sessionId: string): Promise<PendingDraft | null> {
      return asPending(await host.storage.get(`pending:${sessionId}`, OPTS));
    },
    async set(sessionId: string, p: PendingDraft): Promise<void> {
      await host.storage.set(`pending:${sessionId}`, { logId: p.logId, startedAt: p.startedAt, directory: p.directory }, OPTS);
    },
    /** With `logId`: only when that request is still the pending one. */
    async clear(sessionId: string, logId?: string): Promise<void> {
      if (logId !== undefined && (await this.get(sessionId))?.logId !== logId) return;
      await host.storage.delete(`pending:${sessionId}`, OPTS);
    },
  };
}

export type PendingStore = ReturnType<typeof createPendingStore>;
