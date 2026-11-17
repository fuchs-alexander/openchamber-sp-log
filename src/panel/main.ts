import { connectHost, isGuestSessionItem, type GuestItem } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { createApi } from "./api.ts";
import { createFlow } from "./flow.ts";
import { createStore } from "./store.ts";
import { renderFlow } from "./view.ts";

const host = connectHost();
const flow = createFlow({ api: createApi(host), store: createStore(host), host, now: () => new Date() });

const root = document.getElementById("flow") as HTMLDivElement;
const hint = document.getElementById("hint") as HTMLParagraphElement;
let mounted = false;

function mount(): void {
  if (mounted) return;
  mounted = true;
  hint.hidden = true;
  renderFlow(root, flow, {
    onCancel: () => {
      flow.cancel();
      void host.close().catch(() => {});
    },
  });
}

let started: string | null = null;
function handleItem(item: GuestItem | null): void {
  if (!isGuestSessionItem(item)) {
    if (started === null) hint.hidden = false;
    return;
  }
  const messages = item.messages ?? [];
  // onItem replays the same snapshot; restart only for a new session or new messages.
  const key = `${item.sessionId}:${messages.length}:${messages[messages.length - 1]?.id ?? ""}`;
  if (key === started) return;
  started = key;
  void flow.start({ sessionId: item.sessionId, sessionTitle: item.sessionTitle, directory: item.directory, messages });
  mount();
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  handleItem(ctx.item);
});
host.onItem(handleItem);
