import type { Flow } from "../panel/flow.ts";
import { DRAFT_WAIT_MS } from "../panel/flow.ts";
import type { PendingDraft, PendingStore, Store } from "../panel/store.ts";
import { describeBinding, logButtonLabel } from "./describe.ts";

/** How long the Work Status shows „Geloggt ✓“ before it returns to the summary. */
export const LOGGED_MS = 1500;

/**
 * What the SP Log work status shows:
 * - `summary`: the binding lines (the hint last) and the log button (null without session);
 * - `flow`: the log flow inline;
 * - `logged`: „Geloggt ✓“ right after a save; `note` instead when the flow ended with a
 *   message (the log was already saved through the chat card).
 */
type Summary = { mode: "summary"; lines: string[]; button: string | null };

export type StatusView =
  | Summary
  | { mode: "flow" }
  | { mode: "logged"; note?: string };

type Session = { id: string; title: string };

export function createStatusController(deps: {
  flow: Pick<Flow, "state" | "subscribe" | "start" | "cancel">;
  store: Pick<Store, "getBinding" | "getSaved">;
  /** Open session-draft requests; a new frame continues the session's one. */
  pending?: Pick<PendingStore, "get" | "clear">;
  now: () => Date;
  /** Runs `fn` after `ms`; returns a function that drops it. */
  delay: (ms: number, fn: () => void) => () => void;
  onChange: (view: StatusView) => void;
}) {
  const { flow, store, now, delay, onChange } = deps;
  const pending = deps.pending ?? null;
  let session: Session | null = null;
  let directory: string | null = null;
  let summary: Summary = { mode: "summary", lines: [], button: null };
  let view: StatusView = summary;
  /** Bumped on every refresh so a late read for an older session is dropped. */
  let generation = 0;
  let dropTimer: (() => void) | null = null;
  /** The session's directory from its binding (the dialog's); wins over the Work Status directory. */
  let boundDirectory: string | null = null;

  function show(next: StatusView): void {
    view = next;
    onChange(view);
  }

  function toSummary(): void {
    dropTimer?.();
    dropTimer = null;
    show(summary);
  }

  /** Reads the binding again; the summary is shown only when no flow runs. */
  async function refresh(): Promise<void> {
    const run = ++generation;
    const id = session?.id ?? null;
    boundDirectory = null;
    if (!id) {
      summary = { mode: "summary", lines: ["Keine Session geöffnet."], button: null };
    } else {
      const [binding, open] = await Promise.all([store.getBinding(id).catch(() => null), openRequest(id)]);
      if (run !== generation) return;
      boundDirectory = binding?.directory ?? null;
      summary = { mode: "summary", lines: describeBinding(binding, now()).lines, button: logButtonLabel(binding) };
      // OpenChamber unmounts this frame whenever it hides the Work Status; a request
      // sent by the previous frame goes on here instead of being lost.
      if (open && view.mode === "summary" && session) {
        show({ mode: "flow" });
        void flow.start({
          sessionId: session.id,
          sessionTitle: session.title,
          directory: open.directory ?? boundDirectory ?? directory,
          messages: [],
          resume: { logId: open.logId, startedAt: open.startedAt },
        });
        return;
      }
    }
    if (view.mode === "summary") show(summary);
  }

  /** The session's open request; one past the flow's wait is dropped. */
  async function openRequest(id: string): Promise<PendingDraft | null> {
    if (!pending) return null;
    const open = await pending.get(id).catch(() => null);
    if (!open) return null;
    // Saved meanwhile (e.g. through the chat card): nothing left to continue.
    const saved = await store.getSaved(open.logId).catch(() => null);
    if (!saved && now().getTime() - open.startedAt < DRAFT_WAIT_MS) return open;
    await pending.clear(id, open.logId).catch(() => {});
    return null;
  }

  function leave(): void {
    if (view.mode === "flow") flow.cancel();
    toSummary();
  }

  flow.subscribe((s) => {
    if (view.mode !== "flow" || s.phase !== "done") return;
    show(s.message ? { mode: "logged", note: s.message } : { mode: "logged" });
    dropTimer = delay(LOGGED_MS, () => {
      dropTimer = null;
      toSummary();
      void refresh();
    });
  });

  return {
    get view(): StatusView {
      return view;
    },
    setSession(next: Session | null): void {
      const changed = (next?.id ?? null) !== (session?.id ?? null);
      session = next;
      // Do not show the previous session's lines while the new binding is read.
      if (changed) summary = { mode: "summary", lines: [], button: null };
      if (!changed && summary.lines.length > 0) return;
      if (changed && view.mode !== "summary") leave();
      void refresh();
    },
    setDirectory(next: string | null): void {
      directory = next;
    },
    refresh,
    startLogging(): void {
      if (!session || view.mode !== "summary") return;
      show({ mode: "flow" });
      void flow.start({ sessionId: session.id, sessionTitle: session.title, directory: boundDirectory ?? directory, messages: [] });
    },
    cancelLogging(): void {
      if (view.mode === "summary") return;
      leave();
      // „Abbrechen“ ends the request for good: the next frame must not continue it.
      const id = session?.id;
      void (id && pending ? pending.clear(id).catch(() => {}) : Promise.resolve()).then(refresh);
    },
  };
}
