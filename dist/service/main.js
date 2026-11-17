// src/service/main.ts
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
// node_modules/@openchamber/sdk/dist/scrollbar-style.js
var GUEST_SCROLLING_ATTRIBUTE = "data-oc-scrolling";
var GUEST_SCROLLBAR_CSS = `
:root {
  /* Quiet at rest like the app's own thumbs; hover gives a clear grab target. */
  --oc-scrollbar-thumb: color-mix(in srgb, var(--oc-muted, currentColor) 18%, transparent);
  --oc-scrollbar-thumb-hover: color-mix(in srgb, var(--oc-muted, currentColor) 36%, transparent);
  scrollbar-gutter: stable;
}
* {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
}
:hover, [${GUEST_SCROLLING_ATTRIBUTE}] {
  scrollbar-color: var(--oc-scrollbar-thumb) transparent;
}
/* Chromium's standard scrollbar properties otherwise override its pseudo-elements. */
@supports selector(::-webkit-scrollbar) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-width: auto; scrollbar-color: auto; }
  ::-webkit-scrollbar { width: 6px; height: 6px; background: transparent; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb {
    background: transparent;
    border-radius: 999px;
    min-width: 24px;
    min-height: 24px;
  }
  :hover::-webkit-scrollbar-thumb, [${GUEST_SCROLLING_ATTRIBUTE}]::-webkit-scrollbar-thumb { background: var(--oc-scrollbar-thumb); }
  ::-webkit-scrollbar-thumb:hover { background: var(--oc-scrollbar-thumb-hover); }
  ::-webkit-scrollbar-corner { background: transparent; }
  ::-webkit-scrollbar-button { display: none; width: 0; height: 0; }
}
@media (forced-colors: active) {
  *, :hover, [${GUEST_SCROLLING_ATTRIBUTE}] { scrollbar-color: auto; }
  ::-webkit-scrollbar-thumb, ::-webkit-scrollbar-thumb:hover { background: CanvasText; }
}
`;
function installGuestScrollbarActivity(doc) {
  const root = doc.documentElement;
  if (root.hasAttribute("data-oc-scrollbar-activity"))
    return;
  root.setAttribute("data-oc-scrollbar-activity", "");
  const timers = new WeakMap;
  doc.addEventListener("scroll", (event) => {
    const target = event.target === doc ? root : event.target;
    if (!(target instanceof Element))
      return;
    if (!target.hasAttribute("data-oc-scrolling"))
      target.setAttribute("data-oc-scrolling", "");
    const pending = timers.get(target);
    if (pending !== undefined)
      clearTimeout(pending);
    timers.set(target, setTimeout(() => {
      timers.delete(target);
      target.removeAttribute("data-oc-scrolling");
    }, 1000));
  }, { capture: true, passive: true });
}
var GUEST_SCROLLBAR_SCRIPT = `(${installGuestScrollbarActivity.toString()})(document);`;
// node_modules/@openchamber/sdk/dist/manifest.js
var GUEST_PROVIDER_LOGO_BYTES_MAX = 1024 * 1024;
var TRACKER_URL_TOKENS = ["{id}", "{segment}", "{segments+}"];
var TRACKER_URL_TOKEN_SET = new Set(TRACKER_URL_TOKENS);
// node_modules/@openchamber/sdk/dist/session-events.js
var GUEST_SESSION_EVENT_TYPES = [
  "turn-finished",
  "turn-failed",
  "permission-asked",
  "question-asked",
  "turn-started",
  "session-created",
  "session-archived",
  "session-deleted"
];
var SESSION_EVENTS_PATH = "/session-events";
var SESSION_EVENTS_WIRE_VERSION = 1;
var SESSION_EVENTS_IDLE_MS = 10 * 60000;
var EVENT_TYPES = new Set(GUEST_SESSION_EVENT_TYPES);
var isGuestSessionEventType = (value) => EVENT_TYPES.has(value);
var readSessionEventRequest = (body) => {
  let wire;
  try {
    const parsed = JSON.parse(body);
    if (Object(parsed) !== parsed || parsed === null)
      return null;
    wire = parsed;
  } catch {
    return null;
  }
  const { v, requestId, event, content } = wire;
  if (v !== SESSION_EVENTS_WIRE_VERSION)
    return null;
  if (String(requestId) !== requestId || requestId.length === 0)
    return null;
  if (Object(event) !== event || event === undefined)
    return null;
  const { id, type, at, session, project, linked, permission, question } = event;
  if (String(id) !== id || id.length === 0)
    return null;
  if (String(type) !== type || !isGuestSessionEventType(type))
    return null;
  if (!Number.isFinite(at))
    return null;
  if (Object(session) !== session || session === undefined)
    return null;
  const sessionId = session.id;
  if (String(sessionId) !== sessionId || sessionId.length === 0)
    return null;
  const parentId = session.parentId;
  if (parentId !== null && (String(parentId) !== parentId || parentId.length === 0))
    return null;
  if (Object(project) !== project || project === undefined)
    return null;
  const directory = project.directory;
  if (directory !== null && (String(directory) !== directory || directory.length === 0))
    return null;
  if (!Array.isArray(linked))
    return null;
  const request = {
    v: SESSION_EVENTS_WIRE_VERSION,
    requestId,
    event: { id, type, at: Number(at), session: { id: sessionId, parentId }, project: { directory }, linked }
  };
  if (permission !== undefined) {
    if (Object(permission) !== permission)
      return null;
    const permissionRequestId = permission.requestId;
    if (String(permissionRequestId) !== permissionRequestId || permissionRequestId.length === 0)
      return null;
    request.event.permission = { requestId: permissionRequestId };
  }
  if (question !== undefined) {
    if (Object(question) !== question)
      return null;
    const { kind, id: questionId } = question;
    if (kind !== "form" && kind !== "page")
      return null;
    if (String(questionId) !== questionId || questionId.length === 0)
      return null;
    request.event.question = { kind, id: questionId };
  }
  if (content !== undefined) {
    if (Object(content) !== content || content.type !== type)
      return null;
    request.content = content;
  }
  return request;
};
// node_modules/@openchamber/sdk/dist/service-host.js
var SERVICE_HOST_PATH = "/service/call";
var OPENCHAMBER_HOST_CALLBACK_URL_ENV = "OPENCHAMBER_HOST_CALLBACK_URL";
var SERVICE_MARKS_MAX = 200;
var SERVICE_MARK_RATE_MAX = 60;
var SERVICE_HOST_TIMEOUT_MS = 30000;
var SERVICE_SCHEDULE_IDLE_MS = 10 * 60000;
var MENTIONS_IDLE_MS = 10 * 60000;
class ServiceHostError extends Error {
  code;
  status;
  constructor(message, code, status) {
    super(message);
    this.name = "ServiceHostError";
    this.code = code;
    this.status = status;
  }
}
var createServiceHost = ({ env }) => {
  const call = async (method, input) => {
    const base = env[OPENCHAMBER_HOST_CALLBACK_URL_ENV];
    const token = env.OPENCHAMBER_SERVICE_TOKEN;
    if (!base || !token)
      throw new ServiceHostError("This service was not started by OpenChamber.", "HOST_UNAVAILABLE", 0);
    let response;
    try {
      response = await fetch(`${base.replace(/\/+$/, "")}${SERVICE_HOST_PATH}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ method, input }),
        signal: AbortSignal.timeout(SERVICE_HOST_TIMEOUT_MS)
      });
    } catch {
      throw new ServiceHostError("OpenChamber did not answer.", "HOST_UNAVAILABLE", 0);
    }
    const body = await response.json().catch(() => null);
    if (response.ok && body?.result !== undefined)
      return body.result;
    throw new ServiceHostError(body?.error?.message ?? `OpenChamber answered HTTP ${response.status}.`, body?.error?.code ?? "HOST_UNAVAILABLE", response.status);
  };
  return {
    sessions: {
      start: (input) => call("sessions.start", input),
      send: (sessionId, prompt) => call("sessions.send", { sessionId, prompt }),
      retry: (sessionId) => call("sessions.retry", { sessionId }),
      status: (sessionId) => call("sessions.status", { sessionId }),
      lastReply: (sessionId) => call("sessions.lastReply", { sessionId }),
      stop: (sessionId) => call("sessions.stop", { sessionId }),
      answerPermission: (sessionId, requestId, answer) => call("sessions.answerPermission", { sessionId, requestId, ...answer }),
      answerForm: (sessionId, formId, values, message) => call("sessions.answerForm", { sessionId, formId, values, ...message === undefined ? {} : { message } })
    },
    setInstructions: (directory, text) => call("instructions.set", { directory, text }),
    emit: (topic, data) => call("panels.emit", { topic, data }),
    readSettings: () => call("settings.read", {}).then(({ settings }) => settings),
    needsConfiguration: (message) => call("status.set", { needsConfiguration: message }),
    setMark: (target, mark) => call("marks.set", { target, mark })
  };
};
// node_modules/@openchamber/sdk/dist/file-editor.js
var patternExpressions = new Map;
// node_modules/@openchamber/sdk/dist/contract.js
var GUEST_FILE_STAT_KINDS = ["file", "directory", "other", "missing"];
var GUEST_GENERATE_LATE_KEEP_MS = 60 * 60000;
var HOST_REQUEST_ERROR_CODES = [
  "HOST_UNAVAILABLE",
  "HOST_TIMEOUT",
  "HOST_REJECTED",
  "DISCONNECTED",
  "DISABLED",
  "BAD_PATH",
  "NO_INTEGRATION",
  "NO_SERVICE",
  "SERVICE_FAILED",
  "REQUEST_FAILED",
  "RESPONSE_TOO_LARGE",
  "NO_SESSION",
  "SESSION_BUSY",
  "NOT_GRANTED",
  "NO_DIRECTORY",
  "NOT_FOUND",
  "FILE_TOO_LARGE",
  "DENIED",
  "NO_MODEL",
  "MODEL_FAILED",
  "UNSUPPORTED"
];
var SERVICE_STATUS_VALUES = ["stopped", "starting", "ready", "failed"];
var hostRequestErrorCodeSet = new Set(HOST_REQUEST_ERROR_CODES);
var serviceStatusSet = new Set(SERVICE_STATUS_VALUES);
var fileStatKindSet = new Set(GUEST_FILE_STAT_KINDS);
var HOST_PUSH_TYPES = new Set([
  "workspace",
  "shells",
  "ready",
  "directory",
  "session",
  "connection",
  "settings",
  "session-lifecycle",
  "item",
  "resolve",
  "action",
  "service-event",
  "status-control-event",
  "popover-closed",
  "file-open",
  "file-snapshot",
  "file-saved",
  "generate-late",
  "microphone-audio",
  "microphone-ended"
]);
// node_modules/@openchamber/sdk/dist/service-providers.js
var BROWSER_CONTROL_ACTIONS = [
  "browser.open",
  "browser.snapshot",
  "browser.click",
  "browser.type",
  "browser.select",
  "browser.scroll",
  "browser.back",
  "browser.forward",
  "browser.inspect",
  "browser.capture",
  "browser.resize",
  "browser.close"
];
var BROWSER_PROVIDER_IDLE_MS = 10 * 60000;
var CONTROL_ACTIONS = new Set(BROWSER_CONTROL_ACTIONS);
var SOURCE_CONTROL_PROVIDER_IDLE_MS = 10 * 60000;
var OPENCHAMBER_SERVICE_DATA_DIR = "OPENCHAMBER_SERVICE_DATA_DIR";
var NOTIFICATIONS_PROVIDER_IDLE_MS = 10 * 60000;
var TRACKER_PROVIDER_IDLE_MS = 10 * 60000;
var QUOTA_PROVIDER_IDLE_MS = 10 * 60000;
// node_modules/@openchamber/sdk/dist/service-surface.js
var SURFACE_CONTROLLERS = ["none", "agent", "user"];
var CONTROLLERS = new Set(SURFACE_CONTROLLERS);
// src/service/drafts.ts
var DRAFT_TTL_MS = 15 * 60 * 1000;
var IDLE_POLLS_MAX = 3;
var HOST_TIMEOUT_MS = 8000;

class SessionWaitingError extends Error {
  constructor() {
    super("session is waiting for input");
    this.name = "SessionWaitingError";
  }
}

class HostTimeoutError extends Error {
  constructor() {
    super("host call timed out");
    this.name = "HostTimeoutError";
  }
}
function createDrafts(deps) {
  const entries = new Map;
  const hostTimeoutMs = deps.hostTimeoutMs ?? HOST_TIMEOUT_MS;
  function limited(call) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new HostTimeoutError), hostTimeoutMs);
    });
    return Promise.race([call, timeout]).finally(() => clearTimeout(timer));
  }
  function dropExpired() {
    const now = deps.now();
    for (const [logId, entry] of entries) {
      if (now - entry.startedAt > DRAFT_TTL_MS)
        entries.delete(logId);
    }
  }
  return {
    async start(input) {
      dropExpired();
      if (await limited(deps.sessions.status(input.sessionId)) === "waiting")
        throw new SessionWaitingError;
      const previousReply = await limited(deps.sessions.lastReply(input.sessionId));
      entries.set(input.logId, {
        sessionId: input.sessionId,
        previousReply,
        startedAt: deps.now(),
        idlePolls: 0
      });
      await limited(deps.sessions.send(input.sessionId, input.prompt));
    },
    async poll(input) {
      dropExpired();
      const entry = entries.get(input.logId);
      if (!entry || entry.sessionId !== input.sessionId) {
        return { state: "failed", sessionStatus: "unknown" };
      }
      const sessionStatus = await limited(deps.sessions.status(input.sessionId));
      const reply = await limited(deps.sessions.lastReply(input.sessionId));
      if (sessionStatus === "idle" && reply !== null && reply !== entry.previousReply && reply.includes(input.logId)) {
        return { state: "done", text: reply, sessionStatus };
      }
      if (sessionStatus === "idle") {
        entry.idlePolls += 1;
        if (entry.idlePolls >= IDLE_POLLS_MAX)
          return { state: "failed", sessionStatus };
      } else {
        entry.idlePolls = 0;
      }
      return { state: "pending", sessionStatus };
    }
  };
}

// src/service/marks.ts
import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
var MARK_RATE_MAX = SERVICE_MARK_RATE_MAX;
var RATE_WINDOW_MS = 60000;
var PENDING_TTL_MS = DRAFT_TTL_MS;
var MARK_RETRY_DELAYS_MS = [5000, 30000, 120000];
var pad = (n) => String(n).padStart(2, "0");
var formatHours = (hours) => String(Math.round(hours * 100) / 100).replace(".", ",");
function markFor(s) {
  if (s.loggedAt === null) {
    return s.lastTurnAt === null ? null : { icon: "time-line", tone: "neutral", text: "SP: noch nicht geloggt" };
  }
  if (s.lastTurnAt !== null && s.lastTurnAt > s.loggedAt) {
    const d = new Date(s.loggedAt);
    return { icon: "time-line", tone: "warning", text: `SP: neue Arbeit seit Log am ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.` };
  }
  return {
    icon: "checkbox-circle-line",
    tone: "success",
    text: `SP: ${s.logs} ${s.logs === 1 ? "Log" : "Logs"} · ≈ ${formatHours(s.hours)} h`
  };
}
var empty = () => ({
  loggedAt: null,
  logs: 0,
  hours: 0,
  lastTurnAt: null,
  pendingLogId: null,
  pendingSince: null
});
var activity = (s) => Math.max(s.loggedAt ?? 0, s.lastTurnAt ?? 0);
var numOrNull = (v) => v === null || typeof v === "number" && Number.isFinite(v);
function readMarkState(value) {
  if (!value || typeof value !== "object")
    return null;
  const s = value;
  if (!numOrNull(s.loggedAt) || !numOrNull(s.lastTurnAt) || typeof s.logs !== "number" || typeof s.hours !== "number" || !(s.pendingLogId === null || typeof s.pendingLogId === "string")) {
    return null;
  }
  const pendingSince = typeof s.pendingSince === "number" && Number.isFinite(s.pendingSince) ? s.pendingSince : null;
  return {
    loggedAt: s.loggedAt,
    logs: s.logs,
    hours: s.hours,
    lastTurnAt: s.lastTurnAt,
    pendingLogId: pendingSince === null ? null : s.pendingLogId,
    pendingSince: s.pendingLogId === null ? null : pendingSince
  };
}
function fileStateStore(dir) {
  const file = join(dir, "state.json");
  return {
    async load() {
      try {
        const raw = JSON.parse(await readFile(file, "utf8"));
        if (!raw || typeof raw !== "object")
          return {};
        const out = {};
        for (const [id, value] of Object.entries(raw)) {
          const s = readMarkState(value);
          if (s)
            out[id] = s;
        }
        return out;
      } catch {
        return {};
      }
    },
    async save(state) {
      const tmp = `${file}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(state));
      await rename(tmp, file);
    }
  };
}
function memoryStateStore() {
  let state = {};
  return {
    load: async () => structuredClone(state),
    save: async (next) => {
      state = structuredClone(next);
    }
  };
}
function createMarkBook(deps) {
  const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const warn = deps.warn ?? ((message) => console.warn(message));
  let states = {};
  let early = [];
  const failures = new Map;
  const retries = new Set;
  const shown = new Map;
  const queue = new Set;
  const sentAt = [];
  let draining = Promise.resolve();
  let saving = Promise.resolve();
  async function waitForRate() {
    for (;; ) {
      const now = deps.now();
      while (sentAt.length && sentAt[0] <= now - RATE_WINDOW_MS)
        sentAt.shift();
      if (sentAt.length < MARK_RATE_MAX)
        return;
      await sleep(sentAt[0] + RATE_WINDOW_MS - now);
    }
  }
  async function drain() {
    for (const id of queue) {
      queue.delete(id);
      const s = states[id];
      const mark = s ? markFor(s) : null;
      const key = JSON.stringify(mark);
      if ((shown.get(id) ?? "null") === key)
        continue;
      await waitForRate();
      sentAt.push(deps.now());
      try {
        await deps.setMark({ sessionId: id }, mark);
        failures.delete(id);
        if (mark)
          shown.set(id, key);
        else
          shown.delete(id);
      } catch {
        retryLater(id);
      }
    }
  }
  function retryLater(id) {
    const attempt = failures.get(id) ?? 0;
    const delay = MARK_RETRY_DELAYS_MS[attempt];
    failures.set(id, attempt + 1);
    if (delay === undefined) {
      warn("sp-log: a sidebar mark was refused; giving up until the session changes");
      return;
    }
    if (attempt === 0)
      warn("sp-log: a sidebar mark was refused; retrying");
    const retry = sleep(delay).then(() => {
      retries.delete(retry);
      apply(id);
    });
    retries.add(retry);
  }
  function apply(id) {
    const wasIdle = queue.size === 0;
    queue.add(id);
    if (wasIdle)
      draining = draining.then(drain);
  }
  function persist() {
    const snapshot = structuredClone(states);
    saving = saving.then(() => deps.store.save(snapshot)).catch(() => {});
  }
  function prune() {
    const ids = Object.keys(states);
    if (ids.length <= SERVICE_MARKS_MAX)
      return;
    ids.sort((a, b) => activity(states[b]) - activity(states[a]));
    for (const id of ids.slice(SERVICE_MARKS_MAX)) {
      delete states[id];
      apply(id);
    }
  }
  function update(id, change) {
    if (early) {
      early.push(() => update(id, change));
      return;
    }
    failures.delete(id);
    const s = states[id] ?? empty();
    change(s);
    states[id] = s;
    prune();
    persist();
    apply(id);
  }
  const clearPending = (s) => {
    s.pendingLogId = null;
    s.pendingSince = null;
  };
  function turnEnded(id) {
    update(id, (s) => {
      const ownTurn = s.pendingLogId !== null && deps.now() - (s.pendingSince ?? 0) <= PENDING_TTL_MS;
      clearPending(s);
      if (!ownTurn)
        s.lastTurnAt = deps.now();
    });
  }
  return {
    async start() {
      if (!early)
        return;
      states = await deps.store.load();
      const waiting = early;
      early = null;
      for (const id of Object.keys(states))
        apply(id);
      for (const change of waiting)
        change();
    },
    turnFinished: turnEnded,
    turnFailed: turnEnded,
    pending(id, logId) {
      update(id, (s) => {
        s.pendingLogId = logId;
        s.pendingSince = deps.now();
      });
    },
    cancelPending(id, logId) {
      if (!early && !states[id])
        return;
      update(id, (s) => {
        if (s.pendingLogId === logId)
          clearPending(s);
      });
    },
    logged(id, hours) {
      update(id, (s) => {
        const now = deps.now();
        s.loggedAt = Math.max(now, s.lastTurnAt ?? now);
        s.logs += 1;
        s.hours += hours;
        clearPending(s);
      });
    },
    state(id) {
      return states[id] ? { ...states[id] } : null;
    },
    async flush() {
      for (;; ) {
        const [d, s] = [draining, saving];
        await d;
        await s;
        if (retries.size > 0)
          await Promise.all(retries);
        else if (d === draining && s === saving && queue.size === 0)
          return;
      }
    }
  };
}

// src/service/main.ts
var ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
var PROMPT_MAX = 8000;
var json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
function authorized(header, token) {
  if (!header?.startsWith("Bearer "))
    return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
var validId = (value) => typeof value === "string" && ID_PATTERN.test(value);
async function readJson(req) {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? body : null;
  } catch {
    return null;
  }
}
function createHandler(deps) {
  return async (req) => {
    if (!deps.token || !authorized(req.headers.get("authorization"), deps.token)) {
      return json(401, { error: "UNAUTHORIZED" });
    }
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health" && req.method === "GET") {
        return json(200, { ok: true });
      }
      if (url.pathname === "/draft" && req.method === "POST") {
        let body;
        try {
          body = await req.json();
        } catch {
          return json(400, { error: "BAD_JSON" });
        }
        const { sessionId, logId, prompt } = body ?? {};
        if (!validId(sessionId) || !validId(logId))
          return json(400, { error: "BAD_ID" });
        if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > PROMPT_MAX) {
          return json(400, { error: "BAD_PROMPT" });
        }
        deps.marks.pending(sessionId, logId);
        try {
          await deps.drafts.start({ sessionId, logId, prompt });
        } catch (error) {
          deps.marks.cancelPending(sessionId, logId);
          throw error;
        }
        return json(200, { started: true });
      }
      if (url.pathname === "/logged" && req.method === "POST") {
        const body = await readJson(req);
        if (!body)
          return json(400, { error: "BAD_JSON" });
        const { sessionId, at, hours } = body;
        if (!validId(sessionId))
          return json(400, { error: "BAD_ID" });
        if (typeof at !== "number" || !Number.isFinite(at) || at <= 0)
          return json(400, { error: "BAD_AT" });
        if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0 || hours > 100) {
          return json(400, { error: "BAD_HOURS" });
        }
        deps.marks.logged(sessionId, hours);
        deps.emit("logged", { sessionId }).catch(() => {});
        return json(200, { ok: true });
      }
      if (url.pathname === SESSION_EVENTS_PATH && req.method === "POST") {
        const request = readSessionEventRequest(await req.text());
        if (!request)
          return json(400, { ok: false, error: "not a session event" });
        const { type, session } = request.event;
        if (session.parentId === null) {
          if (type === "turn-finished")
            deps.marks.turnFinished(session.id);
          else if (type === "turn-failed")
            deps.marks.turnFailed(session.id);
        }
        return json(200, { ok: true });
      }
      if (url.pathname === "/draft" && req.method === "GET") {
        const sessionId = url.searchParams.get("sessionId");
        const logId = url.searchParams.get("logId");
        if (!validId(sessionId) || !validId(logId))
          return json(400, { error: "BAD_ID" });
        return json(200, await deps.drafts.poll({ sessionId, logId }));
      }
      return json(404, { error: "NOT_FOUND" });
    } catch (error) {
      if (error instanceof SessionWaitingError)
        return json(409, { error: "session-waiting" });
      if (error instanceof HostTimeoutError)
        return json(504, { error: "host-timeout" });
      if (error instanceof ServiceHostError)
        return json(502, { error: error.code });
      return json(500, { error: "INTERNAL" });
    }
  };
}
function stateStoreFor(dataDir, warn) {
  if (dataDir)
    return fileStateStore(dataDir);
  warn("sp-log: no service data folder; sidebar mark state is kept in memory only");
  return memoryStateStore();
}
async function serve(port, token) {
  const host = createServiceHost({ env: process.env });
  const drafts = createDrafts({
    sessions: {
      send: (id, prompt) => host.sessions.send(id, prompt),
      status: async (id) => (await host.sessions.status(id)).status,
      lastReply: async (id) => (await host.sessions.lastReply(id)).reply
    },
    now: () => Date.now()
  });
  const marks = createMarkBook({
    store: stateStoreFor(process.env[OPENCHAMBER_SERVICE_DATA_DIR], (message) => console.warn(message)),
    setMark: (target, mark) => host.setMark(target, mark),
    now: () => Date.now()
  });
  await marks.start();
  const handler = createHandler({ token, drafts, marks, emit: (topic, data) => host.emit(topic, data) });
  const server = createServer(async (incoming, outgoing) => {
    try {
      const chunks = [];
      for await (const chunk of incoming)
        chunks.push(chunk);
      const headers = new Headers;
      for (const [key, value] of Object.entries(incoming.headers)) {
        if (typeof value === "string")
          headers.set(key, value);
        else if (Array.isArray(value))
          headers.set(key, value.join(", "));
      }
      const method = incoming.method ?? "GET";
      const request = new Request(`http://127.0.0.1:${port}${incoming.url ?? "/"}`, {
        method,
        headers,
        body: method === "GET" || method === "HEAD" ? undefined : Buffer.concat(chunks)
      });
      const response = await handler(request);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      outgoing.writeHead(500, { "content-type": "application/json" });
      outgoing.end(JSON.stringify({ error: "INTERNAL" }));
    }
  });
  server.listen(port, "127.0.0.1");
}
var port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
var token = process.env.OPENCHAMBER_SERVICE_TOKEN;
if (Number.isInteger(port) && port > 0 && token)
  await serve(port, token);
export {
  PROMPT_MAX,
  createHandler,
  stateStoreFor
};
