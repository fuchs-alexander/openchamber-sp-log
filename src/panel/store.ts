import type { HostLike } from "./api.ts";

/** One saved log: when (ms) and the hours logged. */
export type LogEntry = { at: number; hours: number };

/**
 * `lastLogId`: the session-draft request whose draft was saved last; null after a Small Model draft or before 0.2.0.
 * `taskTitle`, `projectTitle`, `logs`: null for bindings written before 0.3.0.
 */
export type Binding = {
  taskId: string;
  lastMessageId: string | null;
  lastCreatedAt: number | null;
  lastLogId: string | null;
  taskTitle: string | null;
  projectTitle: string | null;
  logs: LogEntry[] | null;
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
  const { taskId, lastMessageId, lastCreatedAt, lastLogId, taskTitle, projectTitle, logs } = value as {
    taskId?: unknown;
    lastMessageId?: unknown;
    lastCreatedAt?: unknown;
    lastLogId?: unknown;
    taskTitle?: unknown;
    projectTitle?: unknown;
    logs?: unknown;
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
  };
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
      };
      await host.storage.set(`session:${sessionId}`, value, OPTS);
    },
    async clearBinding(sessionId: string): Promise<void> {
      await host.storage.delete(`session:${sessionId}`, OPTS);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
