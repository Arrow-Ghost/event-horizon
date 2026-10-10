/**
 * PhishGuard browser runtime agent.
 *
 * Loaded before any other script on the page. It wraps the browser APIs a
 * malicious dependency would use to steal data — network sends, script
 * injection, storage, cookies and input listeners — works out which npm
 * package made each call from the call stack, applies the hub's runtime
 * policy, and reports RuntimeEvent v1 batches to the local PhishGuard hub.
 *
 * Events carry names, never values: the domain, the storage key, the field
 * name. Bodies, cookie values and typed text are never read.
 *
 * Contract: PhishGuard.js/src/contracts/runtimeEvent.js
 * Policy rules mirror PhishGuard.js/src/server/sample/sampleAgent.js, plus:
 * the page's own origin is always allowed, so enforce mode cannot break the
 * site itself.
 */

type Api =
  | "fetch" | "xhr" | "beacon" | "websocket" | "script-inject"
  | "storage-read" | "storage-write" | "cookie-read" | "cookie-write" | "input-listener";
type Status = "allowed" | "flagged" | "blocked";
type Mode = "monitor" | "enforce";

interface RuntimeEvent {
  v: 1;
  ts: string;
  sessionId: string;
  agent: "browser";
  package: string;
  api: Api;
  action: string;
  targetDomain: string | null;
  key: string | null;
  status: Status;
  mode: Mode;
  rule: string | null;
  severity: "info" | "warning" | "critical";
  sequenceFlag: boolean;
  count: number;
  details: string;
  stack: string;
}

interface Policy {
  mode: Mode;
  allowDomains: string[];
  blockDomains: string[];
}

import CFG from "virtual:phishguard/config";

const AGENT_MARK = "phishguard-agent";
const SENSITIVE = /(token|auth|session|jwt|bearer|secret|passw|card|cvv|cc_?num|api[-_]?key|credential|otp)/i;
const SEQUENCE_WINDOW_MS = 5000;
const FLUSH_MS = 2000;
const POLICY_MS = 45000;
const MAX_QUEUE = 500;

/* ── originals, captured before anyone else can touch them ─────────────── */

const W = window;
const origFetch = W.fetch.bind(W);
const XHR = W.XMLHttpRequest.prototype;
const origOpen = XHR.open;
const origSend = XHR.send;
const origBeacon = navigator.sendBeacon?.bind(navigator);
const OrigWebSocket = W.WebSocket;
const origAppend = Node.prototype.appendChild;
const origInsertBefore = Node.prototype.insertBefore;
const origGetItem = Storage.prototype.getItem;
const origSetItem = Storage.prototype.setItem;
const origAddListener = EventTarget.prototype.addEventListener;
const cookieDesc = Object.getOwnPropertyDescriptor(Document.prototype, "cookie");

/* ── state ─────────────────────────────────────────────────────────────── */

const sessionId = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => b.toString(16).padStart(2, "0")).join("");
const hubHost = new URL(CFG.hubs[0] ?? "http://127.0.0.1").hostname;
/** the hub we are attached to; rediscovered across CFG.hubs whenever it goes away */
let hub = CFG.hubs[0] ?? "";
let policy: Policy = { mode: "monitor", allowDomains: [], blockDomains: [] };
let online = false;
const queue = new Map<string, RuntimeEvent>();
const lastSensitiveRead = new Map<string, { at: number; key: string }>();
const stats = { sent: 0, blocked: 0, flagged: 0, dropped: 0, byPackage: {} as Record<string, number> };

/* ── attribution ───────────────────────────────────────────────────────── */

function packageFromUrl(url: string): string {
  let m = url.match(/\/node_modules\/\.vite\/deps\/([^/?#]+)\.js/);
  if (m) {
    const base = m[1];
    if (base.startsWith("chunk-")) return "unknown"; // shared pre-bundle chunk
    if (base.startsWith("@")) {
      const [scope, name] = base.slice(1).split("_");
      return `@${scope}/${name}`;
    }
    return base.split("_")[0];
  }
  m = url.match(/\/node_modules\/((?:@[^/]+\/)?[^/?#]+)/);
  if (m) return m[1];
  m = url.match(/\/_astro\/pkg-([^./]+)\./);
  if (m) return m[1].includes("__") ? `@${m[1].replace("__", "/")}` : m[1];
  if (/\/@vite\/|\/@id\//.test(url)) return "vite";
  try {
    return new URL(url).origin === location.origin ? "(app)" : "unknown";
  } catch {
    return "(app)";
  }
}

/** Who called us: the innermost stack frame that is not this agent. */
function attribute(): { pkg: string; stack: string } {
  const raw = new Error().stack ?? "";
  const frames = raw.split("\n").slice(1).filter((l) => !l.includes(AGENT_MARK));
  for (const f of frames) {
    const url = f.match(/(https?:\/\/[^\s)]+?)(?::\d+){1,2}\)?\s*$/)?.[1];
    if (url) return { pkg: packageFromUrl(url), stack: frames.slice(0, 6).map((s) => s.trim()).join("\n") };
  }
  return { pkg: "(app)", stack: "" };
}

/* ── policy ────────────────────────────────────────────────────────────── */

function domainOf(target: string | URL | undefined | null): string | null {
  if (!target) return null;
  try {
    return new URL(String(target), location.href).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function decide(api: Api, domain: string | null, pkg: string): { status: Status; rule: string | null } {
  if (domain && domain !== location.hostname && domain !== hubHost) {
    if (policy.blockDomains.includes(domain)) return { status: "blocked", rule: `blockDomains: ${domain}` };
    if (policy.mode === "enforce" && !policy.allowDomains.includes(domain)) {
      return { status: "blocked", rule: `enforce: ${domain} is not on the allow list` };
    }
  }
  if (api === "script-inject" && pkg !== "(app)") return { status: "flagged", rule: "script injected by dependency code" };
  return { status: "allowed", rule: null };
}

/* ── reporting ─────────────────────────────────────────────────────────── */

function record(
  api: Api,
  o: { pkg: string; stack: string; action: string; domain?: string | null; key?: string | null; status: Status; rule: string | null; details?: string; severity?: RuntimeEvent["severity"]; sequenceFlag?: boolean },
) {
  const severity = o.severity ?? (o.status === "blocked" ? "critical" : o.status === "flagged" || o.sequenceFlag ? "warning" : "info");
  // identical events inside one flush window collapse into `count`
  const id = [o.pkg, api, o.domain ?? "", o.key ?? "", o.status, o.rule ?? "", o.sequenceFlag ? 1 : 0].join("|");
  const prev = queue.get(id);
  if (prev) {
    prev.count++;
  } else {
    if (queue.size >= MAX_QUEUE) {
      stats.dropped++;
      return;
    }
    queue.set(id, {
      v: 1,
      ts: new Date().toISOString(),
      sessionId,
      agent: "browser",
      package: o.pkg,
      api,
      action: o.action.slice(0, 200),
      targetDomain: o.domain ?? null,
      key: o.key ?? null,
      status: o.status,
      mode: policy.mode,
      rule: o.rule,
      severity,
      sequenceFlag: !!o.sequenceFlag,
      count: 1,
      details: (o.details ?? "").slice(0, 500),
      stack: o.stack.slice(0, 2000),
    });
  }
  stats.byPackage[o.pkg] = (stats.byPackage[o.pkg] ?? 0) + 1;
  if (o.status === "blocked") {
    stats.blocked++;
    console.warn(`[phishguard] blocked ${api} from ${o.pkg}${o.domain ? ` → ${o.domain}` : ""} (${o.rule})`);
  } else if (o.status === "flagged" || o.sequenceFlag) stats.flagged++;
}

function noteRead(pkg: string, key: string | null) {
  if (key && SENSITIVE.test(key)) lastSensitiveRead.set(pkg, { at: Date.now(), key });
}

/** A sensitive read followed by a network send from the same package. */
function sequenceFor(pkg: string) {
  const r = lastSensitiveRead.get(pkg);
  if (!r || Date.now() - r.at > SEQUENCE_WINDOW_MS || pkg === "(app)") return null;
  return r;
}

/** Shared path for every outbound request. Returns true when it must be blocked. */
function onSend(api: Api, url: string | URL | null | undefined, method: string, bytes: number | null): boolean {
  const domain = domainOf(url);
  if (domain === hubHost) return false; // our own reports
  const { pkg, stack } = attribute();
  const d = decide(api, domain, pkg);
  const seq = sequenceFor(pkg);
  let { status, rule } = d;
  if (seq && status === "allowed") {
    status = "flagged";
    rule = "sensitive read followed by network send";
  }
  record(api, {
    pkg,
    stack,
    action: `${method} ${domain ?? "?"}${safePath(url)}`,
    domain,
    status,
    rule,
    sequenceFlag: !!seq,
    details: [bytes != null ? `body ${bytes} bytes` : "", seq ? `sent ${Date.now() - seq.at} ms after a read of ${seq.key}` : ""].filter(Boolean).join(", "),
  });
  return status === "blocked";
}

function safePath(url: string | URL | null | undefined) {
  try {
    const p = new URL(String(url), location.href).pathname;
    return p.length > 60 ? `${p.slice(0, 60)}…` : p;
  } catch {
    return "";
  }
}

function bodySize(body: unknown): number | null {
  if (body == null) return null;
  if (typeof body === "string") return body.length;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return body.toString().length;
  return null;
}

/* ── hooks ─────────────────────────────────────────────────────────────── */

function installHooks() {
function blockedError() {
  return new TypeError("Blocked by PhishGuard runtime policy");
}

W.fetch = function phishguardFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = input instanceof Request ? input.url : input;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (onSend("fetch", url, method, bodySize(init?.body))) return Promise.reject(blockedError());
  return origFetch(input, init);
};

const xhrTarget = new WeakMap<XMLHttpRequest, { url: string | URL; method: string }>();
XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  xhrTarget.set(this, { url, method: method.toUpperCase() });
  return (origOpen as (...a: unknown[]) => void).call(this, method, url, ...rest);
} as typeof XHR.open;
XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
  const t = xhrTarget.get(this);
  if (t && onSend("xhr", t.url, t.method, bodySize(body))) {
    queueMicrotask(() => this.dispatchEvent(new ProgressEvent("error")));
    return;
  }
  return origSend.call(this, body);
};

if (origBeacon) {
  navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null) {
    if (onSend("beacon", url, "BEACON", bodySize(data))) return false;
    return origBeacon(url, data);
  };
}

W.WebSocket = new Proxy(OrigWebSocket, {
  construct(target, args: [string | URL, (string | string[])?]) {
    if (onSend("websocket", args[0], "WS", null)) throw new DOMException("Blocked by PhishGuard runtime policy", "SecurityError");
    return new target(...args);
  },
});

function guardScript<T extends Node>(node: T): boolean {
  if (!(node instanceof HTMLScriptElement) || !node.src) return false;
  const domain = domainOf(node.src);
  const { pkg, stack } = attribute();
  const { status, rule } = decide("script-inject", domain, pkg);
  record("script-inject", { pkg, stack, action: `insert <script src=${domain}${safePath(node.src)}>`, domain, status, rule, details: "Script tag inserted at runtime" });
  if (status === "blocked") {
    queueMicrotask(() => node.dispatchEvent(new Event("error")));
    return true;
  }
  return false;
}
Node.prototype.appendChild = function <T extends Node>(this: Node, node: T): T {
  if (guardScript(node)) return node;
  return origAppend.call(this, node) as T;
};
Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
  if (guardScript(node)) return node;
  return origInsertBefore.call(this, node, child) as T;
};

Storage.prototype.getItem = function (this: Storage, key: string) {
  const { pkg, stack } = attribute();
  noteRead(pkg, key);
  const which = this === W.sessionStorage ? "sessionStorage" : "localStorage";
  record("storage-read", { pkg, stack, action: `${which}.getItem(${key})`, key, status: "allowed", rule: null, severity: SENSITIVE.test(key) && pkg !== "(app)" ? "warning" : "info" });
  return origGetItem.call(this, key);
};
Storage.prototype.setItem = function (this: Storage, key: string, value: string) {
  const { pkg, stack } = attribute();
  const which = this === W.sessionStorage ? "sessionStorage" : "localStorage";
  record("storage-write", { pkg, stack, action: `${which}.setItem(${key})`, key, status: "allowed", rule: null });
  return origSetItem.call(this, key, value);
};

if (cookieDesc?.get && cookieDesc.set) {
  Object.defineProperty(Document.prototype, "cookie", {
    configurable: true,
    enumerable: cookieDesc.enumerable,
    get(this: Document) {
      const value = cookieDesc.get!.call(this) as string;
      const { pkg, stack } = attribute();
      const names = value ? value.split(/;\s*/).map((c) => c.split("=")[0]).filter(Boolean) : [];
      const sensitive = names.find((n) => SENSITIVE.test(n)) ?? null;
      if (sensitive) noteRead(pkg, sensitive);
      record("cookie-read", { pkg, stack, action: "document.cookie read", key: names.slice(0, 8).join(",") || null, status: "allowed", rule: null, severity: sensitive && pkg !== "(app)" ? "warning" : "info" });
      return value;
    },
    set(this: Document, v: string) {
      const { pkg, stack } = attribute();
      const name = String(v).split("=")[0].trim();
      record("cookie-write", { pkg, stack, action: `document.cookie = ${name}=…`, key: name, status: "allowed", rule: null });
      cookieDesc.set!.call(this, v);
    },
  });
}

const KEY_EVENTS = new Set(["input", "change", "keydown", "keyup", "keypress"]);
EventTarget.prototype.addEventListener = function (this: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
  if (KEY_EVENTS.has(type)) {
    const t = this as unknown as Element;
    const field =
      t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement
        ? t.name || t.id || t.getAttribute("type") || t.tagName.toLowerCase()
        : this === W ? "window" : this === document ? "document" : null;
    if (field) {
      const { pkg, stack } = attribute();
      const isPassword = t instanceof HTMLInputElement && t.type === "password";
      const global = field === "window" || field === "document";
      record("input-listener", {
        pkg,
        stack,
        action: `addEventListener(${type}) on ${global ? field : `#${field}`}`,
        key: field,
        status: "allowed",
        rule: null,
        severity: pkg !== "(app)" && (isPassword || SENSITIVE.test(field) || (global && type.startsWith("key"))) ? "warning" : "info",
        details: global ? "Page-wide keyboard listener" : isPassword ? "Listener on a password field" : "",
      });
    }
  }
  return origAddListener.call(this, type, listener, options);
};

}

/* ── transport ─────────────────────────────────────────────────────────── */

const headers = { "content-type": "application/json", "x-phishguard-agent-key": CFG.key };

/** Ask one hub for the policy. A 401 means another project's hub owns that port. */
async function fetchPolicy(base: string): Promise<Partial<Policy> | null> {
  try {
    // a port held by something that never answers must not stall discovery
    const r = await origFetch(`${base}/api/agent/policy`, { headers, cache: "no-store", signal: AbortSignal.timeout(1500) });
    return r.ok ? ((await r.json()) as Partial<Policy>) : null;
  } catch {
    return null;
  }
}

async function pullPolicy() {
  try {
    let p = online ? await fetchPolicy(hub) : null;
    if (!p) {
      // (re)discover: the hub may have started on any of the fallback ports
      for (const base of CFG.hubs) {
        p = await fetchPolicy(base);
        if (p) {
          if (base !== hub) online = false;
          hub = base;
          break;
        }
      }
    }
    if (!p) throw new Error("no hub");
    policy = {
      mode: p.mode === "enforce" ? "enforce" : "monitor",
      allowDomains: Array.isArray(p.allowDomains) ? p.allowDomains.map((d) => String(d).toLowerCase()) : [],
      blockDomains: Array.isArray(p.blockDomains) ? p.blockDomains.map((d) => String(d).toLowerCase()) : [],
    };
    if (!online) console.info(`[phishguard] agent connected to ${hub} · ${policy.mode} mode · session ${sessionId}`);
    online = true;
  } catch {
    online = false;
  }
}

let nextFlushAt = 0;
let retryAt = 0;
let retryDelay = 2000;

async function flush(final = false) {
  if (!queue.size || !online) return;
  if (!final && Date.now() < nextFlushAt) return;
  const batch = [...queue.entries()].slice(0, 200);
  for (const [id] of batch) queue.delete(id);
  const events = batch.map(([, e]) => e);
  try {
    const r = await origFetch(`${hub}/api/agent/events`, {
      method: "POST",
      headers,
      body: JSON.stringify({ events }),
      keepalive: final,
    });
    if (r.status === 429) {
      // over the hub's rate limit: put the batch back and wait as told
      nextFlushAt = Date.now() + Number(r.headers.get("retry-after") ?? 30) * 1000;
      for (const [id, e] of batch) if (!queue.has(id)) queue.set(id, e);
      return;
    }
    if (r.ok) stats.sent += events.length;
  } catch {
    online = false;
    stats.dropped += events.length;
  }
}

let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    await tickOnce();
  } finally {
    ticking = false;
  }
}

async function tickOnce() {
  if (online) return flush();
  // hub not running: retry with exponential backoff instead of spamming the console
  if (Date.now() < retryAt) return;
  await pullPolicy();
  if (online) retryDelay = 2000;
  else {
    retryDelay = Math.min(retryDelay * 2, 64000);
    retryAt = Date.now() + retryDelay;
  }
}

if (CFG.enabled) {
  installHooks();
  void tick();
  setInterval(() => void tick(), FLUSH_MS);
  setInterval(() => online && void pullPolicy(), POLICY_MS);
  origAddListener.call(W, "pagehide", () => void flush(true));
}

(W as unknown as { __phishguard: unknown }).__phishguard = {
  get status() {
    return { enabled: CFG.enabled, online, hub, sessionId, policy, queued: queue.size, ...stats };
  },
  flush: () => flush(true),
};
