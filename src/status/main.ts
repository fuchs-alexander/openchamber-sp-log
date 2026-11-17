import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { createStore } from "../panel/store.ts";
import { describeBinding } from "./describe.ts";

const host = connectHost();
const store = createStore(host);
const list = document.getElementById("lines") as HTMLDivElement;

let sessionId: string | null = null;
/** Bumped on every refresh so a late read for an older session is dropped. */
let generation = 0;

function show(lines: string[]): void {
  list.replaceChildren(
    ...lines.map((text, i) => {
      const p = document.createElement("p");
      p.textContent = text;
      if (i === lines.length - 1) p.className = "muted";
      return p;
    }),
  );
  void host.setHeight(Math.ceil(document.body.scrollHeight)).catch(() => {});
}

async function refresh(): Promise<void> {
  const run = ++generation;
  if (!sessionId) {
    show(["Keine Session geöffnet."]);
    return;
  }
  const binding = await store.getBinding(sessionId).catch(() => null);
  if (run !== generation) return;
  show(describeBinding(binding, new Date()).lines);
}

function setSession(id: string | null): void {
  if (id === sessionId && list.childElementCount > 0) return;
  sessionId = id;
  void refresh();
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  setSession(ctx.session?.id ?? null);
});
host.onSession((session) => setSession(session?.id ?? null));
// The binding changes in the log dialog; read it again when the section is shown again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void refresh();
});
