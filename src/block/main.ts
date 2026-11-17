import { connectHost, GUEST_BLOCK_HEIGHT_MAX, type GuestBlockCall, type HostReadyContext } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { createApi } from "../panel/api.ts";
import { createFlow } from "../panel/flow.ts";
import { createPendingStore, createStore } from "../panel/store.ts";
import { ensureStyles, renderFlow } from "../panel/view.ts";
import { decideCardState, describeDraftCard, draftFromArgs, isCardLogId, savedLine, STALE_LINE } from "./card.ts";

/**
 * The SpLogDraft card in the chat. It shows the draft the session wrote and,
 * while the log is open, the shared log flow to save it right here. The
 * session is the one in `ready.session` (the chat the block is drawn in);
 * without one the card only shows the draft.
 */
const host = connectHost();
const store = createStore(host);
const flow = createFlow({
  api: createApi(host),
  store,
  host,
  // A save here also ends a request the Work Status still waits for.
  pending: createPendingStore(host),
  now: () => new Date(),
  // A block frame must not close itself; the card shows the saved state instead.
  closeOnDone: () => false,
});
const root = document.getElementById("root") as HTMLDivElement;
ensureStyles();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text; // model-written text: never as HTML
  return node;
}

function reportHeight(): void {
  const height = Math.min(GUEST_BLOCK_HEIGHT_MAX, Math.ceil(document.body.scrollHeight));
  void host.setHeight(height).catch(() => {});
}

let ctx: HostReadyContext | null = null;
let block: GuestBlockCall | null = null;
/** The logId this frame already set up; onBlock replays the same call. */
let shownFor: string | null = null;
let flowView: { dispose: () => void } | null = null;

function frame(): { box: HTMLDivElement; body: HTMLDivElement } {
  const card = describeDraftCard(block?.args ?? {});
  const head = el("div", "head", "");
  head.append(el("h2", "", card.title), el("span", card.badge === "Aufwand unklar" ? "badge unclear" : "badge", card.badge));
  const box = el("div", "card", "");
  const body = el("div", "body", "");
  box.append(head, el("p", "summary", card.summary), body);
  root.replaceChildren(box);
  return { box, body };
}

function showLine(text: string, className: string): void {
  flowView?.dispose();
  flowView = null;
  const { body } = frame();
  body.append(el("p", className, text));
  reportHeight();
}

async function show(): Promise<void> {
  if (!ctx || !block) return;
  const args = block.args ?? {};
  const logId = args.logId;
  const session = ctx.session;
  if (!isCardLogId(logId) || !session) {
    showLine(describeDraftCard(args).footer, "footer");
    return;
  }
  if (shownFor === logId) return;
  shownFor = logId;
  frame();
  reportHeight();

  const now = Date.now();
  await store.markSeen(logId, now).catch(() => {});
  const [saved, binding, seen] = await Promise.all([
    store.getSaved(logId).catch(() => null),
    store.getBinding(session.id).catch(() => null),
    store.getSeen(logId).catch(() => null),
  ]);
  const state = decideCardState({ logId, saved, binding, createdAt: seen ?? now });
  if (state.kind === "saved") return showLine(savedLine(state), "splog-notice ok");
  if (state.kind === "stale") return showLine(STALE_LINE, "footer");

  const { body } = frame();
  flowView = renderFlow(body, flow, {
    compact: true,
    saveLabel: "In Super Productivity speichern",
    hideCancel: true,
    onCancel: () => {},
    onRender: reportHeight,
  });
  void flow.startWithDraft({
    sessionId: session.id,
    sessionTitle: session.title,
    // The binding's directory wins (as in the Work Status): the project mapping is per directory.
    directory: binding?.directory ?? ctx.directory,
    logId,
    draft: draftFromArgs(args),
  });
}

// After a save (here or, by the guard, elsewhere) the card shows the saved state from storage.
flow.subscribe((s) => {
  if (s.phase !== "done" || !shownFor) return;
  const logId = shownFor;
  void store.getSaved(logId).then(
    (saved) => showLine(saved ? savedLine(saved) : "Gespeichert ✓", "splog-notice ok"),
    () => showLine("Gespeichert ✓", "splog-notice ok"),
  );
});

host.onReady((ready) => {
  applyHostReady(ready, document.documentElement);
  ctx = ready;
  if (ready.block && !block) block = ready.block;
  void show();
});

host.onBlock((call) => {
  block = call;
  void show();
});

new ResizeObserver(reportHeight).observe(document.body);
