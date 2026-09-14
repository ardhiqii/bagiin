#!/usr/bin/env node
/**
 * Browser regression for deleting a manager-owned bill from the React Home
 * route. It seeds one disposable identity and bill through the API, drives a
 * fresh local Chrome tab through CDP, then removes the fixture in all exit
 * paths. Nothing in this harness may target a non-local server.
 *
 *   node tools/e2e_home_delete.mjs [BASE_URL] [CDP_URL]
 *
 * Requires a Bagiin server backed by a throwaway database and Chrome started
 * with --remote-debugging-port=9222. No npm dependency is required.
 */

import { createHash, randomBytes } from "node:crypto";
import { createConnection as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeHost = host => String(host || "").replace(/^\[|\]$/g, "");

function validateHttpUrl(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials`);
  }
  if (!LOCAL_HOSTS.has(normalizeHost(parsed.hostname))) {
    throw new Error(`${label} must target localhost, 127.0.0.1, or ::1`);
  }
  return parsed.href.replace(/\/$/, "");
}

function validateWebSocketUrl(raw) {
  if (!raw) throw new Error("CDP did not advertise a WebSocket debugger URL");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CDP advertised an invalid WebSocket debugger URL");
  }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("CDP advertised an invalid WebSocket debugger URL");
  }
  if (!LOCAL_HOSTS.has(normalizeHost(parsed.hostname))) {
    throw new Error("CDP advertised a non-local WebSocket debugger URL");
  }
  return parsed.href;
}

const ORIGIN = validateHttpUrl(process.argv[2] || "http://127.0.0.1:8099", "BASE_URL");
const CDP = validateHttpUrl(process.argv[3] || "http://127.0.0.1:9222", "CDP_URL");
const failures = [];
const pageErrors = [];

function scrub(value) {
  return String(value || "")
    .replace(/(x-identity-secret|secret|password|token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=[REDACTED]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[REDACTED]");
}

function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${ok || !detail ? "" : ` — ${scrub(detail)}`}`);
}

async function api(method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) {
    headers["X-Identity-Id"] = identity.id;
    if (identity.secret) headers["X-Identity-Secret"] = identity.secret;
  }
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> HTTP ${response.status}`);
  return response.json();
}

/* Node 18 has no global WebSocket. This small RFC 6455 client keeps the
 * harness dependency-free while allowing the same script on older Node. */
class SimpleWebSocket {
  constructor(rawUrl) {
    this.url = new URL(rawUrl);
    this.readyState = 0;
    this.listeners = new Map();
    this.buffer = Buffer.alloc(0);
    this.handshakeDone = false;
    this.fragmentOpcode = 0;
    this.fragmentParts = [];
    this.clientKey = randomBytes(16).toString("base64");
    const host = normalizeHost(this.url.hostname);
    const port = Number(this.url.port) || (this.url.protocol === "wss:" ? 443 : 80);
    const options = { host, port };
    if (this.url.protocol === "wss:") options.servername = host;
    this.socket = this.url.protocol === "wss:" ? tlsConnect(options) : netConnect(options);
    this.socket.setNoDelay?.(true);
    this.socket.once(this.url.protocol === "wss:" ? "secureConnect" : "connect", () => this.writeHandshake());
    this.socket.on("data", chunk => this.receive(chunk));
    this.socket.on("error", error => this.fail(error));
    this.socket.on("close", () => {
      if (this.readyState !== 3) {
        this.readyState = 3;
        this.emit("close", { type: "close", target: this });
      }
    });
  }

  addEventListener(type, handler, options = {}) {
    if (type === "open" && this.readyState === 1) {
      queueMicrotask(() => handler({ type: "open", target: this }));
      return;
    }
    const entries = this.listeners.get(type) || [];
    entries.push({ handler, once: options === true || options.once === true });
    this.listeners.set(type, entries);
  }

  removeEventListener(type, handler) {
    const entries = this.listeners.get(type) || [];
    this.listeners.set(type, entries.filter(entry => entry.handler !== handler));
  }

  emit(type, event) {
    const entries = [...(this.listeners.get(type) || [])];
    for (const entry of entries) {
      if (entry.once) this.removeEventListener(type, entry.handler);
      entry.handler(event);
    }
  }

  writeHandshake() {
    const host = normalizeHost(this.url.hostname);
    const displayHost = host.includes(":") ? `[${host}]` : host;
    const hostHeader = this.url.port ? `${displayHost}:${this.url.port}` : displayHost;
    const path = `${this.url.pathname || "/"}${this.url.search}`;
    this.socket.write([
      `GET ${path} HTTP/1.1`,
      `Host: ${hostHeader}`,
      "Upgrade: WebSocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${this.clientKey}`,
      "Sec-WebSocket-Version: 13",
      "\r\n",
    ].join("\r\n"));
  }

  receive(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    if (!this.handshakeDone) {
      const end = this.buffer.indexOf("\r\n\r\n");
      if (end < 0) return;
      const header = this.buffer.subarray(0, end).toString("ascii");
      const accept = header.match(/^Sec-WebSocket-Accept:\s*(.+)$/im)?.[1]?.trim();
      const expected = createHash("sha1")
        .update(`${this.clientKey}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
        .digest("base64");
      if (!/^HTTP\/1\.1 101\b/m.test(header) || accept !== expected) {
        this.fail(new Error("CDP WebSocket handshake failed"));
        return;
      }
      this.buffer = this.buffer.subarray(end + 4);
      this.handshakeDone = true;
      this.readyState = 1;
      this.emit("open", { type: "open", target: this });
    }
    this.readFrames();
  }

  readFrames() {
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const fin = (first & 0x80) !== 0;
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < 4) return;
        length = this.buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        if (this.buffer.length < 10) return;
        const wideLength = this.buffer.readBigUInt64BE(2);
        if (wideLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("CDP frame is too large");
        length = Number(wideLength);
        offset = 10;
      }
      let mask;
      if (masked) {
        if (this.buffer.length < offset + 4) return;
        mask = this.buffer.subarray(offset, offset + 4);
        offset += 4;
      }
      if (this.buffer.length < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      this.buffer = this.buffer.subarray(offset + length);
      if (masked) {
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
      }
      if (opcode === 0x8) {
        this.readyState = 3;
        this.socket.end();
        this.emit("close", { type: "close", target: this });
        return;
      }
      if (opcode === 0x9) {
        this.writeFrame(0xA, payload);
        continue;
      }
      if (opcode === 0xA) continue;
      if (opcode === 0x0) {
        if (!this.fragmentOpcode) continue;
        this.fragmentParts.push(payload);
        if (fin) {
          this.emitMessage(this.fragmentOpcode, Buffer.concat(this.fragmentParts));
          this.fragmentOpcode = 0;
          this.fragmentParts = [];
        }
      } else if (fin) {
        this.emitMessage(opcode, payload);
      } else {
        this.fragmentOpcode = opcode;
        this.fragmentParts = [payload];
      }
    }
  }

  emitMessage(opcode, payload) {
    if (opcode === 0x1) this.emit("message", { type: "message", data: payload.toString("utf8"), target: this });
  }

  writeFrame(opcode, payload) {
    const mask = randomBytes(4);
    const maskedPayload = Buffer.from(payload);
    for (let i = 0; i < maskedPayload.length; i += 1) maskedPayload[i] ^= mask[i % 4];
    let header;
    if (maskedPayload.length < 126) {
      header = Buffer.from([0x80 | opcode, 0x80 | maskedPayload.length]);
    } else if (maskedPayload.length <= 0xffff) {
      header = Buffer.alloc(4);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(maskedPayload.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | opcode;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(maskedPayload.length), 2);
    }
    this.socket.write(Buffer.concat([header, mask, maskedPayload]));
  }

  send(data) {
    if (this.readyState !== 1) throw new Error("CDP WebSocket is not open");
    this.writeFrame(0x1, Buffer.from(String(data)));
  }

  close() {
    if (this.readyState === 3) return;
    if (this.readyState === 1) this.writeFrame(0x8, Buffer.alloc(0));
    this.readyState = 2;
    this.socket.end();
  }

  fail(error) {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.socket.destroy();
    this.emit("error", error);
  }
}

const WebSocketImpl = globalThis.WebSocket || SimpleWebSocket;

async function createTab() {
  const response = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`CDP could not create a tab (HTTP ${response.status})`);
  const tab = await response.json();
  if (!tab.id || !tab.webSocketDebuggerUrl) throw new Error("CDP returned an incomplete tab target");
  return { ...tab, webSocketDebuggerUrl: validateWebSocketUrl(tab.webSocketDebuggerUrl) };
}

async function closeTab(tabId) {
  if (!tabId) return true;
  try {
    const response = await fetch(`${CDP}/json/close/${encodeURIComponent(tabId)}`);
    return response.ok;
  } catch {
    return false;
  }
}

let tabTarget;
let ws;
let sequence = 0;
const pending = new Map();
const deleteRequests = [];

function send(method, params = {}) {
  const id = ++sequence;
  const request = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    try {
      ws.send(JSON.stringify({ id, method, params }));
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
  return request;
}

function evaluate(expression) {
  return send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }).then(result => {
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "page evaluation failed");
    return result.result?.value;
  });
}

function page(fn, ...args) {
  return evaluate(`(${fn.toString()})(${args.map(value => JSON.stringify(value)).join(",")})`);
}

async function waitFor(fn, ...args) {
  const timeoutMs = typeof args.at(-1) === "number" ? args.pop() : 10000;
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await page(fn, ...args);
    if (value) return value;
    await sleep(100);
  }
  throw new Error(`page condition timed out after ${timeoutMs}ms`);
}

async function navigate(url) {
  await send("Page.navigate", { url });
  await sleep(400);
}

async function cleanupBill(billId, identity) {
  if (!billId || !identity) return true;
  const headers = {
    "X-Identity-Id": identity.id,
    "X-Identity-Secret": identity.secret,
  };
  const current = await fetch(`${ORIGIN}/api/bills/${encodeURIComponent(billId)}`, { headers });
  if (current.status === 404) return true;
  if (!current.ok) throw new Error(`GET fixture -> HTTP ${current.status}`);
  const deleted = await fetch(`${ORIGIN}/api/bills/${encodeURIComponent(billId)}`, { method: "DELETE", headers });
  if (!deleted.ok && deleted.status !== 404) throw new Error(`DELETE fixture -> HTTP ${deleted.status}`);
  const after = await fetch(`${ORIGIN}/api/bills/${encodeURIComponent(billId)}`, { headers });
  return after.status === 404;
}

let manager;
let billId = "";
const stamp = `${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
const title = `E2E home delete ${stamp}`;

try {
  // ---------- seed the disposable fixture through the API ----------
  manager = await api("POST", "/api/identities", { name: `Delete host ${stamp}`, creator: true });
  const bill = await api("POST", "/api/bills", {
    title,
    items: [{ name: "Fixture item", price: 1000 }],
    subtotal: 1000,
    tax: 0,
    service: 0,
    total: 1000,
  }, manager);
  billId = bill.id;

  // ---------- drive the React Home route in a fresh Chrome tab ----------
  tabTarget = await createTab();
  ws = new WebSocketImpl(tabTarget.webSocketDebuggerUrl);
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(JSON.stringify(message.error)));
      else request.resolve(message.result);
      return;
    }
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(message.params?.exceptionDetails?.exception?.description
        || message.params?.exceptionDetails?.text || "page exception");
    } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      pageErrors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? "").join(" ") || "console.error");
    } else if (message.method === "Network.requestWillBeSent") {
      const request = message.params?.request;
      if (request?.method === "DELETE" && request.url === `${ORIGIN}/api/bills/${encodeURIComponent(billId)}`) {
        deleteRequests.push(request.url);
      }
    }
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");

  const nonce = Date.now().toString(36);
  await navigate(`${ORIGIN}/?e2e=${nonce}-origin#/`);
  await waitFor(() => document.readyState === "complete", 12000);
  await evaluate(`localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(manager))}); sessionStorage.clear();`);
  await navigate(`${ORIGIN}/?e2e=${nonce}#/`);
  await waitFor(() => Boolean(document.querySelector("#home-history")), 12000);
  await waitFor(expectedTitle => [...document.querySelectorAll(".bill-row strong")]
    .some(element => element.textContent === expectedTitle), title, 12000);

  const beforeClick = await page(expectedTitle => {
    const row = [...document.querySelectorAll(".bill-row")]
      .find(element => element.querySelector("strong")?.textContent === expectedTitle);
    const button = row?.querySelector(".delete-bill");
    return {
      route: location.hash,
      row: Boolean(row),
      deleteButton: Boolean(button),
      deleteDisabled: button?.hasAttribute("disabled") || false,
    };
  }, title);
  check("manager-owned bill appears in React Home", beforeClick.row);
  check("manager row has an enabled delete control", beforeClick.deleteButton && !beforeClick.deleteDisabled, JSON.stringify(beforeClick));

  const clickResult = await page(expectedTitle => {
    const row = [...document.querySelectorAll(".bill-row")]
      .find(element => element.querySelector("strong")?.textContent === expectedTitle);
    const button = row?.querySelector(".delete-bill");
    button?.click();
    return { route: location.hash, clicked: Boolean(button) };
  }, title);
  const dialogBeforeConfirm = await waitFor(() => {
    const dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    const labelledBy = dialog.getAttribute("aria-labelledby") || "";
    return {
      route: location.hash,
      role: dialog.getAttribute("role"),
      labelledBy,
      accessibleTitle: document.getElementById(labelledBy)?.textContent?.trim() || "",
      text: dialog.textContent || "",
      confirm: Boolean(dialog.querySelector("#confirm-delete-bill")),
    };
  }, 5000);
  check("delete control stops row navigation before confirmation", clickResult.clicked && clickResult.route === "#/" && dialogBeforeConfirm.route === "#/", JSON.stringify(clickResult));
  check("delete confirmation is an accessible dialog", dialogBeforeConfirm.role === "dialog" && Boolean(dialogBeforeConfirm.labelledBy) && dialogBeforeConfirm.accessibleTitle === "Hapus bill ini?", JSON.stringify(dialogBeforeConfirm));
  check("delete confirmation contains the bill title", dialogBeforeConfirm.text.includes(title));

  await page(() => {
    const confirm = document.querySelector("#confirm-delete-bill");
    confirm?.click();
    confirm?.click();
    return Boolean(confirm);
  });
  await waitFor(expectedTitle => ![...document.querySelectorAll(".bill-row strong")]
    .some(element => element.textContent === expectedTitle), title, 12000);
  await waitFor(() => !document.querySelector('[role="dialog"]'), 5000);
  await sleep(250);

  check("React Home sends exactly one DELETE request", deleteRequests.length === 1, `requests=${deleteRequests.length}`);
  const deleted = await fetch(`${ORIGIN}/api/bills/${encodeURIComponent(billId)}`, {
    headers: { "X-Identity-Id": manager.id, "X-Identity-Secret": manager.secret },
  });
  check("deleted bill returns 404", deleted.status === 404, `status=${deleted.status}`);
  check("successful deletion keeps the browser on Home", await page(() => location.hash === "#/") === true);
  check("no uncaught page or console errors", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
} catch (error) {
  check("harness execution completed", false, error instanceof Error ? error.message : String(error));
} finally {
  if (ws) ws.close();
  if (billId) {
    try {
      check("disposable bill fixture deleted", await cleanupBill(billId, manager));
    } catch (error) {
      check("disposable bill fixture deleted", false, error instanceof Error ? error.message : String(error));
    }
  }
  if (tabTarget?.id) check("disposable CDP tab closed", await closeTab(tabTarget.id));
}

console.log(failures.length ? `\n${failures.length} check(s) FAILED` : "\nall checks passed");
process.exitCode = failures.length ? 1 : 0;
