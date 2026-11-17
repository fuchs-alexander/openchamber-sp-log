import type { HostLike } from "./api.ts";

export type Binding = { taskId: string; lastMessageId: string | null; lastCreatedAt: number | null };

const OPTS = { scope: "instance" } as const;

function asBinding(value: unknown): Binding | null {
  if (!value || typeof value !== "object") return null;
  const { taskId, lastMessageId, lastCreatedAt } = value as {
    taskId?: unknown;
    lastMessageId?: unknown;
    lastCreatedAt?: unknown;
  };
  if (typeof taskId !== "string") return null;
  if (lastMessageId !== null && typeof lastMessageId !== "string") return null;
  // Bindings written before lastCreatedAt existed lack the field.
  const createdAt = typeof lastCreatedAt === "number" && Number.isFinite(lastCreatedAt) ? lastCreatedAt : null;
  return { taskId, lastMessageId, lastCreatedAt: createdAt };
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
      await host.storage.set(`session:${sessionId}`, { taskId: b.taskId, lastMessageId: b.lastMessageId, lastCreatedAt: b.lastCreatedAt }, OPTS);
    },
    async clearBinding(sessionId: string): Promise<void> {
      await host.storage.delete(`session:${sessionId}`, OPTS);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
