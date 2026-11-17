import { describe, expect, test } from "bun:test";
import { HostRequestError, type HostClient, type GuestRequest } from "@openchamber/sdk";
import { createApi, GatewayError, type HostLike } from "../src/panel/api.ts";
import { createStore } from "../src/panel/store.ts";

// Compile-time check: the real host from connectHost() must satisfy HostLike.
const _hostIsHostLike = (h: HostClient): HostLike => h;
void _hostIsHostLike;

type Reply = { status: number; body: unknown } | Error;

function fakeHost(reply: (req: GuestRequest) => Reply = () => ({ status: 200, body: "{}" })) {
  const requests: GuestRequest[] = [];
  const data = new Map<string, unknown>();
  const scopes: (string | undefined)[] = [];
  const host = {
    request: async (req: GuestRequest) => {
      requests.push(req);
      const r = reply(req);
      if (r instanceof Error) throw r;
      return r as { status: number; body: string };
    },
    storage: {
      get: async (key: string, opts?: { scope?: "instance" | "device" }) => {
        scopes.push(opts?.scope);
        return data.get(key) as never;
      },
      set: async (key: string, value: unknown, opts?: { scope?: "instance" | "device" }) => {
        scopes.push(opts?.scope);
        data.set(key, structuredClone(value));
      },
      delete: async (key: string, opts?: { scope?: "instance" | "device" }) => {
        scopes.push(opts?.scope);
        data.delete(key);
      },
    },
    generate: async () => ({ text: "" }),
    toast: async () => {},
    close: async () => {},
  } satisfies HostLike;
  return { host, requests, data, scopes };
}

describe("api", () => {
  test("sends string body", async () => {
    const { host, requests } = fakeHost(() => ({ status: 200, body: '{"id":"t1"}' }));
    const id = await createApi(host).create("p1", "Titel", "Notiz");
    expect(id).toBe("t1");
    expect(requests).toEqual([
      {
        method: "POST",
        path: "/tasks",
        body: JSON.stringify({ projectId: "p1", title: "Titel", notes: "Notiz" }),
      },
    ]);
  });

  test("append sends string body to encoded path", async () => {
    const { host, requests } = fakeHost(() => ({ status: 200, body: { id: "a/b" } }));
    expect(await createApi(host).append("a/b", "Text")).toBe("a/b");
    expect(requests[0]).toEqual({
      method: "POST",
      path: "/tasks/a%2Fb/append",
      body: JSON.stringify({ text: "Text" }),
    });
  });

  test("parses string and object bodies", async () => {
    const list = [
      { id: "p1", title: "Eins" },
      { id: "p2", title: "Zwei" },
    ];
    const fromString = await createApi(fakeHost(() => ({ status: 200, body: JSON.stringify(list) })).host).projects();
    const fromObject = await createApi(fakeHost(() => ({ status: 200, body: list })).host).projects();
    expect(fromString).toEqual(list);
    expect(fromObject).toEqual(list);
  });

  test("task-gone", async () => {
    const { host } = fakeHost(() => ({ status: 404, body: '{"error":"task-gone"}' }));
    const err = await createApi(host)
      .append("t1", "x")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).status).toBe(404);
    expect((err as GatewayError).code).toBe("task-gone");
  });

  test("error without code falls back to http-<status>", async () => {
    const { host } = fakeHost(() => ({ status: 500, body: "nope" }));
    const err = await createApi(host)
      .projects()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe("http-500");
  });

  test("disconnected", async () => {
    const { host } = fakeHost(() => new HostRequestError("DISCONNECTED", "gone"));
    const err = await createApi(host)
      .projects()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe("disconnected");
  });

  test("other host error → request-failed", async () => {
    const { host } = fakeHost(() => new HostRequestError("HOST_TIMEOUT", "slow"));
    const err = await createApi(host)
      .projects()
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect((err as GatewayError).code).toBe("request-failed");
  });

  test("path encoding", async () => {
    const tasks = [{ id: "t1", title: "T", notesExcerpt: "N" }];
    const { host, requests } = fakeHost(() => ({ status: 200, body: JSON.stringify(tasks) }));
    expect(await createApi(host).tasks("a/b")).toEqual(tasks);
    expect(requests[0]).toEqual({ method: "GET", path: `/projects/${encodeURIComponent("a/b")}/tasks` });
    expect(requests[0]!.path).toBe("/projects/a%2Fb/tasks");
  });
});

describe("store", () => {
  test("roundtrip", async () => {
    const { host, data, scopes } = fakeHost();
    const store = createStore(host);
    expect(await store.getBinding("s1")).toBeNull();
    const b = { taskId: "t1", lastMessageId: "m9", lastCreatedAt: 1234 };
    await store.setBinding("s1", b);
    expect(await store.getBinding("s1")).toEqual(b);
    expect(data.has("session:s1")).toBe(true);
    await store.clearBinding("s1");
    expect(await store.getBinding("s1")).toBeNull();
    expect(scopes.every((s) => s === "instance")).toBe(true);
  });

  test("project roundtrip", async () => {
    const { host, data } = fakeHost();
    const store = createStore(host);
    expect(await store.getProject("/w/x")).toBeNull();
    await store.setProject("/w/x", "sp1");
    expect(await store.getProject("/w/x")).toBe("sp1");
    expect(data.get("project:/w/x")).toBe("sp1");
  });

  test("old binding without lastCreatedAt is read", async () => {
    const { host, data } = fakeHost();
    data.set("session:s1", { taskId: "t1", lastMessageId: "m9" });
    expect(await createStore(host).getBinding("s1")).toEqual({ taskId: "t1", lastMessageId: "m9", lastCreatedAt: null });
  });

  test("malformed binding → null", async () => {
    const { host, data } = fakeHost();
    data.set("session:s1", { taskId: 5 });
    expect(await createStore(host).getBinding("s1")).toBeNull();
  });
});
