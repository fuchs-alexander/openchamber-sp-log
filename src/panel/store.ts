import type { HostLike } from "./api.ts";

/** `lastLogId`: the session-draft request whose draft was saved last; null after a Small Model draft or before 0.2.0. */
export type Binding = { taskId: string; lastMessageId: string | null; lastCreatedAt: number | null; lastLogId: string | null };

const OPTS = { scope: "instance" } as const;

function asBinding(value: unknown): Binding | null {
  if (!value || typeof value !== "object") return null;
  const { taskId, lastMessageId, lastCreatedAt, lastLogId } = value as {
    taskId?: unknown;
    lastMessageId?: unknown;
    lastCreatedAt?: unknown;
    lastLogId?: unknown;
  };
  if (typeof taskId !== "string") return null;
  if (lastMessageId !== null && typeof lastMessageId !== "string") return null;
  // Bindings written before lastCreatedAt existed lack the field.
  const createdAt = typeof lastCreatedAt === "number" && Number.isFinite(lastCreatedAt) ? lastCreatedAt : null;
  // Bindings written before 0.2.0 lack lastLogId.
  return { taskId, lastMessageId, lastCreatedAt: createdAt, lastLogId: typeof lastLogId === "string" ? lastLogId : null };
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
      await host.storage.set(`session:${sessionId}`, { taskId: b.taskId, lastMessageId: b.lastMessageId, lastCreatedAt: b.lastCreatedAt, lastLogId: b.lastLogId }, OPTS);
    },
    async clearBinding(sessionId: string): Promise<void> {
      await host.storage.delete(`session:${sessionId}`, OPTS);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
