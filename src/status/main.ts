import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { createApi } from "../panel/api.ts";
import { createFlow } from "../panel/flow.ts";
import { createPendingStore, createStore } from "../panel/store.ts";
import { ensureStyles, renderFlow } from "../panel/view.ts";
import { createStatusController, type StatusView } from "./controller.ts";

const host = connectHost();
const store = createStore(host);
// This frame is unmounted whenever OpenChamber hides the Work Status; open requests outlive it here.
const pending = createPendingStore(host);
// No host.close() in a status frame; the controller shows „Geloggt ✓“ instead.
const flow = createFlow({
  api: createApi(host),
  store,
  host,
  pending,
  rememberPending: true,
  now: () => new Date(),
  closeOnDone: () => false,
});
const root = document.getElementById("root") as HTMLDivElement;

function reportHeight(): void {
  void host.setHeight(Math.ceil(document.body.scrollHeight)).catch(() => {});
}

let flowView: { dispose: () => void } | null = null;

function paragraph(text: string, className = ""): HTMLParagraphElement {
  const p = document.createElement("p");
  p.textContent = text;
  if (className) p.className = className;
  return p;
}

function render(view: StatusView): void {
  if (view.mode === "flow") {
    if (!flowView) flowView = renderFlow(root, flow, { compact: true, onCancel: () => ctrl.cancelLogging(), onRender: reportHeight });
    return;
  }
  flowView?.dispose();
  flowView = null;
  if (view.mode === "logged") {
    root.replaceChildren(paragraph(view.note ?? "Geloggt ✓", "splog-notice ok"));
  } else {
    const lines = document.createElement("div");
    lines.className = "lines";
    lines.setAttribute("role", "status");
    // The hint („Loggen: … → Export …“) is the last line, kept as secondary text.
    lines.append(...view.lines.map((text, i) => paragraph(text, i === view.lines.length - 1 ? "muted" : "")));
    const children: HTMLElement[] = [lines];
    if (view.button) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "splog-btn primary";
      button.textContent = view.button;
      button.addEventListener("click", () => ctrl.startLogging());
      children.push(button);
    }
    root.replaceChildren(...children);
  }
  reportHeight();
}

const ctrl = createStatusController({
  flow,
  store,
  pending,
  now: () => new Date(),
  delay: (ms, fn) => {
    const t = setTimeout(fn, ms);
    return () => clearTimeout(t);
  },
  onChange: render,
});

ensureStyles();

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  ctrl.setDirectory(ctx.directory);
  ctrl.setSession(ctx.session ? { id: ctx.session.id, title: ctx.session.title } : null);
});
host.onDirectory((directory) => ctrl.setDirectory(directory));
host.onSession((session) => ctrl.setSession(session ? { id: session.id, title: session.title } : null));
// The service tells open frames when a log was saved for a session.
host.onServiceEvent(({ topic, data }) => {
  if (topic !== "logged") return;
  if (data && typeof data === "object" && !Array.isArray(data) && typeof data.sessionId === "string") void ctrl.refresh();
});
// The binding changes in the log dialog; read it again when the section is shown again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void ctrl.refresh();
});
