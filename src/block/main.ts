import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { describeDraftCard } from "./card.ts";

const host = connectHost();
const root = document.getElementById("root") as HTMLDivElement;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text; // model-written text: never as HTML
  return node;
}

function reportHeight(): void {
  void host.setHeight(Math.ceil(document.body.scrollHeight)).catch(() => {});
}

host.onReady((ctx) => {
  applyHostReady(ctx, document.documentElement);
  reportHeight();
});

host.onBlock((block) => {
  const card = describeDraftCard(block.args ?? {});
  const head = el("div", "head", "");
  head.append(el("h2", "", card.title), el("span", card.badge === "Aufwand unklar" ? "badge unclear" : "badge", card.badge));
  const box = el("div", "card", "");
  box.append(head, el("p", "summary", card.summary), el("p", "footer", card.footer));
  root.replaceChildren(box);
  reportHeight();
});

new ResizeObserver(reportHeight).observe(document.body);
