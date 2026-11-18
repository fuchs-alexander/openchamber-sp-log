import { connectHost, isGuestSessionItem, type GuestItem, type HostReadyContext } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { createStatusController, type StatusView } from "../status/controller.ts";
import { createApi } from "./api.ts";
import { createDetailsController, DETAILS_CSS, renderDetailsView } from "./details.ts";
import { createFlow } from "./flow.ts";
import { createPendingStore, createStore } from "./store.ts";
import { ensureStyles, renderFlow } from "./view.ts";

const host = connectHost();
const api = createApi(host);
const store = createStore(host);
const pending = createPendingStore(host);
/** Where the host mounted this frame; only the dialog closes itself after a save. */
let surface: string | null = null;
const flow = createFlow({
  api,
  store,
  // A save here also ends a request the Work Status still waits for.
  pending,
  host,
  now: () => new Date(),
  closeOnDone: () => surface === "dialog",
});

const heading = document.getElementById("heading") as HTMLHeadingElement;
const root = document.getElementById("flow") as HTMLDivElement;
const hint = document.getElementById("hint") as HTMLParagraphElement;
const detailsRoot = document.getElementById("details") as HTMLDivElement;
ensureStyles();

/** What this frame shows: the log flow for a session item, or the rail panel's task view. */
let mode: "flow" | "details" | null = null;

function mount(): void {
  if (mode === "flow") return;
  details?.dispose();
  details = null;
  mode = "flow";
  hint.hidden = true;
  detailsRoot.hidden = true;
  heading.hidden = false;
  renderFlow(root, flow, {
    onCancel: () => {
      flow.cancel();
      if (surface === "dialog") void host.close().catch(() => {});
    },
  });
}

let started: string | null = null;
function handleItem(item: GuestItem | null): void {
  if (!isGuestSessionItem(item)) {
    if (mode === null && surface === "panel") mountDetails();
    else if (started === null && mode !== "details") hint.hidden = false;
    return;
  }
  const messages = item.messages ?? [];
  // onItem replays the same snapshot; restart only for a new session or new messages.
  const key = `${item.sessionId}:${messages.length}:${messages[messages.length - 1]?.id ?? ""}`;
  if (key === started) return;
  started = key;
  void flow.start({ sessionId: item.sessionId, sessionTitle: item.sessionTitle, directory: item.directory, messages, allowFallback: true });
  mount();
}

/**
 * The rail panel without a session item: the current session's SP task, read
 * only and live from SP. Without a log, „Jetzt loggen“ runs the Work Status's
 * inline flow (no messages: the session drafts itself).
 */
let details: ReturnType<typeof createDetailsPanel> | null = null;
let session: HostReadyContext["session"] = null;
let directory: string | null = null;

function createDetailsPanel() {
  const style = document.createElement("style");
  style.textContent = DETAILS_CSS;
  document.head.append(style);
  // Its own flow keeps open requests like the Work Status, so either frame continues them.
  const logFlow = createFlow({ api, store, host, pending, rememberPending: true, now: () => new Date(), closeOnDone: () => false });
  let flowView: { dispose: () => void } | null = null;
  let last: StatusView["mode"] = "summary";

  const ctrl = createDetailsController({ store, api, onChange: () => draw() });
  const status = createStatusController({
    flow: logFlow,
    store,
    pending,
    now: () => new Date(),
    delay: (ms, fn) => {
      const t = setTimeout(fn, ms);
      return () => clearTimeout(t);
    },
    onChange: (view) => {
      // Back from the log flow: the task changed, read it again.
      if (view.mode === "summary" && last !== "summary") void ctrl.refresh();
      last = view.mode;
      draw();
    },
  });

  function draw(): void {
    const view = status.view;
    if (view.mode === "flow") {
      if (!flowView) {
        detailsRoot.replaceChildren();
        flowView = renderFlow(detailsRoot, logFlow, { onCancel: () => status.cancelLogging() });
      }
      return;
    }
    flowView?.dispose();
    flowView = null;
    if (view.mode === "logged") {
      const p = document.createElement("p");
      p.className = "splog-notice ok";
      p.textContent = view.note ?? "Geloggt ✓";
      detailsRoot.replaceChildren(p);
      return;
    }
    detailsRoot.replaceChildren(
      renderDetailsView(document, ctrl.view, { onRefresh: () => void refresh(), onLog: () => status.startLogging() }),
    );
  }

  async function refresh(): Promise<void> {
    await Promise.all([status.refresh(), ctrl.refresh()]);
  }

  return {
    setSession(next: HostReadyContext["session"]): void {
      const value = next ? { id: next.id, title: next.title } : null;
      status.setSession(value);
      ctrl.setSession(value?.id ?? null);
    },
    setDirectory: (next: string | null) => status.setDirectory(next),
    refresh,
    dispose(): void {
      flowView?.dispose();
      logFlow.cancel();
      style.remove();
    },
  };
}

function mountDetails(): void {
  mode = "details";
  hint.hidden = true;
  heading.hidden = true;
  detailsRoot.hidden = false;
  details = createDetailsPanel();
  details.setDirectory(directory);
  details.setSession(session);
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  surface = ctx.surface;
  session = ctx.session;
  directory = ctx.directory;
  details?.setDirectory(directory);
  details?.setSession(session);
  handleItem(ctx.item);
});
host.onItem(handleItem);
host.onSession((next) => {
  session = next;
  details?.setSession(next);
});
host.onDirectory((next) => {
  directory = next;
  details?.setDirectory(next);
});
// The service tells open frames when a log was saved (here, in the Work Status or the chat card).
host.onServiceEvent(({ topic }) => {
  if (topic === "logged") void details?.refresh();
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void details?.refresh();
});
