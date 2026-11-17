// Node HTTP adapter for the gateway. Run with: node gateway/server.ts
// Environment:
//   PORT                   (default 3877)
//   SP_URL                 (default http://127.0.0.1:3876)
//   SP_TOKEN_FILE          (default ~/.config/superProductivity/local-rest-api-token)
//   SP_GATEWAY_TOKEN_FILE  (default ~/.config/sp-gateway/gateway-token)
// Tokens are never logged.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { createGateway } from "./gateway.ts";

const HOST = "127.0.0.1";
const MIN_GATEWAY_TOKEN_LENGTH = 32;

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(1)) : path;
}

function readToken(path: string): string {
  try {
    return readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

const port = Number(process.env.PORT ?? 3877);
const spUrl = process.env.SP_URL ?? "http://127.0.0.1:3876";
const spTokenFile = expandHome(process.env.SP_TOKEN_FILE ?? "~/.config/superProductivity/local-rest-api-token");
const gatewayTokenFile = expandHome(process.env.SP_GATEWAY_TOKEN_FILE ?? "~/.config/sp-gateway/gateway-token");

const gatewayToken = readToken(gatewayTokenFile);
if (gatewayToken.length < MIN_GATEWAY_TOKEN_LENGTH) {
  console.error(
    `sp-gateway: gateway token missing or shorter than ${MIN_GATEWAY_TOKEN_LENGTH} characters (${gatewayTokenFile})`,
  );
  process.exit(1);
}
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error("sp-gateway: invalid PORT");
  process.exit(1);
}

const handle = createGateway({
  spUrl,
  // Re-read on every request so a regenerated SP token works without restart.
  spToken: () => readToken(spTokenFile),
  gatewayToken,
});

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = { method, headers };
  if (hasBody) {
    init.body = Readable.toWeb(req) as unknown as ReadableStream<Uint8Array>;
    init.duplex = "half";
  }
  return new Request(`http://${HOST}:${port}${req.url ?? "/"}`, init);
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => res.setHeader(name, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer((req, res) => {
  let request: Request;
  try {
    request = toRequest(req);
  } catch {
    res.statusCode = 400;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "bad-request" }));
    return;
  }
  handle(request)
    .then((response) => writeResponse(res, response))
    .catch(() => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json; charset=utf-8");
      }
      res.end(JSON.stringify({ error: "internal" }));
    })
    .finally(() => {
      // Drop any unread request body (e.g. after a 401 or 413).
      if (!req.readableEnded) req.resume();
    });
});

server.listen(port, HOST, () => {
  console.log(`sp-gateway listening on http://${HOST}:${port} -> ${spUrl}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
