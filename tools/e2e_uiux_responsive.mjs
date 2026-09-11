#!/usr/bin/env node
/**
 * Bounded responsive/UIUX browser regression harness for Bagiin.
 *
 * No npm dependency is required. The harness creates throwaway identities and
 * one bill through the public API, drives a fresh Chrome tab through CDP, and
 * deletes the throwaway bill during cleanup, and closes that tab in all exit
 * paths. BASE_URL, CDP_URL, and the advertised debugger WebSocket are limited
 * to localhost, 127.0.0.1, or ::1; non-local targets are always refused. The
 * harness does not attempt identity deletion because the API has no such
 * endpoint.
 *
 *   node tools/e2e_uiux_responsive.mjs [BASE_URL] [CDP_URL]
 *   BASE_URL=http://127.0.0.1:8099 CDP_URL=http://127.0.0.1:9222 \
 *     node tools/e2e_uiux_responsive.mjs
 */

import { createHash, randomBytes } from "node:crypto";
import { createConnection as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const normalizeHost = host => String(host || "").replace(/^\[|\]$/g, "");
const isLocalHost = host => LOCAL_HOSTS.has(normalizeHost(host));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function validateBaseUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("BASE_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("BASE_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (!isLocalHost(parsed.hostname)) {
    throw new Error("BASE_URL must target localhost, 127.0.0.1, or ::1; non-local targets are not allowed");
  }
  return parsed.href.replace(/\/$/, "");
}

function validateCdpUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CDP_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("CDP_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (!isLocalHost(parsed.hostname)) {
    throw new Error("CDP_URL must target localhost, 127.0.0.1, or ::1; non-local targets are not allowed");
  }
  return parsed.href.replace(/\/$/, "");
}

function validateDebuggerWebSocketUrl(rawUrl, label) {
  if (!rawUrl) throw new Error(`${label} did not advertise a WebSocket debugger URL`);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${label} advertised an invalid WebSocket debugger URL`);
  }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error(`${label} advertised an invalid WebSocket debugger URL`);
  }
  if (!isLocalHost(parsed.hostname)) {
    throw new Error(`${label} advertised a non-local WebSocket debugger URL; only localhost, 127.0.0.1, or ::1 are allowed`);
  }
  return parsed.href;
}

/* Node 18 has no global WebSocket. This small RFC 6455 client keeps the
 * harness dependency-free while matching the existing e2e_*.mjs style. */
class SimpleWebSocket {
  constructor(rawUrl) {
    this.url = new URL(rawUrl);
    if (!["ws:", "wss:"].includes(this.url.protocol)) throw new Error("CDP URL must use ws:// or wss://");
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
const rawBaseUrl = process.argv[2] || process.env.BASE_URL || process.env.BAGIIN_BASE_URL || "http://127.0.0.1:8099";
const rawCdpUrl = process.argv[3] || process.env.CDP_URL || process.env.BAGIIN_CDP_URL || "http://127.0.0.1:9222";
const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 600, 719, 720, 721, 768, 820, 1024, 1039, 1040, 1041, 1280, 1440];
const HEIGHTS = [568, 667, 844, 900];
const HOME_MATRIX = [
  ...WIDTHS.map(width => ({ width, height: 900 })),
  { width: 320, height: 568 },
  { width: 390, height: 667 },
  { width: 600, height: 844 },
];
const failures = [];
const pageErrors = [];
let executed = 0;

function scrub(value) {
  return String(value || "")
    .replace(/(x-identity-secret|secret|password|token|authorization)\s*[:=]\s*[^\s,;}]+/gi, "$1=[REDACTED]")
    .replace(/[A-Fa-f0-9]{32,}/g, "[REDACTED]");
}

function check(name, ok, detail = "") {
  if (!ok) failures.push(name);
  if (ok) console.log(`  ok  ${name}`);
  else console.log(` FAIL ${name}${detail ? `: ${scrub(detail)}` : ""}`);
}

async function api(baseUrl, method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) {
    headers["X-Identity-Id"] = identity.id;
    if (identity.secret) headers["X-Identity-Secret"] = identity.secret;
  }
  const response = await fetchWithTimeout(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> HTTP ${response.status}`);
  return response.json();
}

class CdpTab {
  constructor(ws, errorSink) {
    this.ws = ws;
    this.errorSink = errorSink;
    this.sequence = 0;
    this.pending = new Map();
    ws.addEventListener("message", event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        this.errorSink.push("invalid CDP message");
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const request = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errorSink.push(message.params?.exceptionDetails?.exception?.description
          || message.params?.exceptionDetails?.text || "page exception");
      } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        this.errorSink.push(message.params.args?.map(arg => arg.value ?? arg.description ?? "").join(" ") || "console error");
      } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
        this.errorSink.push(message.params.entry.text || "browser log error");
      }
    });
  }

  async connect() {
    await withTimeout(new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("CDP WebSocket error")), { once: true });
    }), 15000, "CDP WebSocket connection");
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    const request = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
    return withTimeout(request, 15000, `CDP ${method}`).catch(error => {
      this.pending.delete(id);
      throw error;
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "page evaluation failed");
    }
    return result.result?.value;
  }

  page(fn, ...args) {
    const encoded = args.map(value => JSON.stringify(value)).join(",");
    return this.evaluate(`(${fn.toString()})(${encoded})`);
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await sleep(350);
  }

  async viewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: width < 768,
      screenWidth: width,
      screenHeight: height,
      fitWindow: false,
    });
  }

  async waitFor(fn, ...args) {
    const timeoutMs = typeof args.at(-1) === "number" ? args.pop() : 10000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const value = await this.page(fn, ...args);
      if (value) return value;
      await sleep(100);
    }
    throw new Error(`page condition timed out after ${timeoutMs}ms`);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function createTab(cdpUrl) {
  const response = await fetchWithTimeout(`${cdpUrl}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`CDP could not create a tab (HTTP ${response.status})`);
  const tab = await response.json();
  if (!tab.id || !tab.webSocketDebuggerUrl) throw new Error("CDP returned an incomplete tab target");
  return tab;
}

async function closeTab(cdpUrl, tabId) {
  if (!tabId) return true;
  try {
    const response = await fetchWithTimeout(`${cdpUrl}/json/close/${encodeURIComponent(tabId)}`, { method: "GET" }, 5000);
    return response.ok;
  } catch {
    return false;
  }
}

const visibleFn = (el) => {
  if (!el) return false;
  const style = getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  return style.display !== "none"
    && style.visibility !== "hidden"
    && style.visibility !== "collapse"
    && Number(style.opacity || 1) > 0
    && rect.width > 0
    && rect.height > 0
    && !el.closest('[aria-hidden="true"]');
};

const accessibleNameFn = (el) => {
  if (!el) return "";
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "").join(" ").trim();
    if (value) return value;
  }
  const aria = el.getAttribute("aria-label")?.trim();
  if (aria) return aria;
  const title = el.getAttribute("title")?.trim();
  if (title) return title;
  const labelled = el.closest("label")?.innerText?.trim();
  if (labelled) return labelled;
  const id = el.getAttribute("id");
  if (id) {
    const label = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.innerText?.trim()) return label.innerText.trim();
  }
  return (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
};

async function inspectDom(tab) {
  const inspect = (visible, accessibleName) => {
    const rect = el => {
      const r = el?.getBoundingClientRect();
      return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
    };
    const visibleElements = selector => [...document.querySelectorAll(selector)].filter(visible);
    const actionables = [...document.querySelectorAll("button,a[href],[role=button],[role=link],[role=switch]")];
    const visibleActionables = actionables.filter(visible);
    const actionableOutside = visibleActionables
      .filter(el => !el.disabled && el.getAttribute("aria-disabled") !== "true")
      .map(el => ({ id: el.id, text: accessibleName(el).slice(0, 50), rect: rect(el) }))
      .filter(item => item.rect.left < -1 || item.rect.right > innerWidth + 1);
    const missingNames = visibleActionables
      .filter(el => !accessibleName(el))
      .map(el => ({ tag: el.tagName, id: el.id, cls: String(el.className || "").slice(0, 60) }));
    const primary = visibleElements(".btn-primary,.btn-green,.btn-danger,.btn-danger-ghost,#create-btn,#create-bill-btn,#save-bill-btn,#pay-btn,#done-btn,#invite-share-btn")
      .map(el => ({ id: el.id, text: accessibleName(el).slice(0, 50), height: rect(el).height }))
      .filter(item => item.height < 44 - 0.01);
    const ids = new Map();
    [...document.querySelectorAll("[id]")].forEach(el => ids.set(el.id, (ids.get(el.id) || 0) + 1));
    const duplicateIds = [...ids.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
    const dialogs = visibleElements('[role="dialog"]').map(el => {
      const labelledBy = el.getAttribute("aria-labelledby")?.trim() || "";
      const aria = el.getAttribute("aria-label")?.trim() || "";
      const labelText = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "").join(" ").trim();
      return { labelledBy, aria, labelText };
    });
    const viewportWidth = innerWidth;
    const htmlOverflow = document.documentElement.scrollWidth > viewportWidth + 1;
    const bodyOverflow = document.body.scrollWidth > viewportWidth + 1;
    return {
      viewportWidth,
      htmlOverflow,
      bodyOverflow,
      actionableOutside,
      missingNames,
      primaryTooShort: primary,
      duplicateIds,
      dialogs,
      actionableCount: visibleActionables.length,
      route: location.hash,
    };
  };
  return tab.evaluate(`(${inspect.toString()})(${visibleFn.toString()}, ${accessibleNameFn.toString()})`);
}

async function auditRoute(tab, label) {
  const result = await inspectDom(tab);
  check(`${label}: no horizontal overflow`, !result.htmlOverflow && !result.bodyOverflow);
  check(`${label}: actionable controls stay within viewport`, result.actionableOutside.length === 0, JSON.stringify(result.actionableOutside.slice(0, 2)));
  check(`${label}: primary controls are at least 44 CSS px`, result.primaryTooShort.length === 0, JSON.stringify(result.primaryTooShort.slice(0, 3)));
  check(`${label}: visible buttons/links/switches have accessible names`, result.missingNames.length === 0, JSON.stringify(result.missingNames.slice(0, 3)));
  check(`${label}: no duplicate IDs`, result.duplicateIds.length === 0, JSON.stringify(result.duplicateIds));
  check(`${label}: visible dialogs are named`, result.dialogs.every(dialog => (dialog.aria || dialog.labelText) && (!dialog.labelledBy || dialog.labelText)), JSON.stringify(result.dialogs));
  return result;
}

async function route(tab, baseUrl, identity, hash, width, height, readySelector) {
  executed += 1;
  try {
    await tab.viewport(width, height);
    // about:blank has no storage origin. Establish the app origin before
    // touching localStorage, then reload so the router reads the identity during
    // its normal bootstrap rather than briefly rendering onboarding.
    const nonce = `${Date.now()}-${executed}`;
    await tab.navigate(`${baseUrl}/?e2e=${nonce}-origin#/`);
    await tab.waitFor(() => document.readyState === "complete", 12000);
    const identityJson = JSON.stringify(JSON.stringify(identity));
    await tab.evaluate(`localStorage.setItem("bagiin_identity", ${identityJson}); sessionStorage.clear();`);
    await tab.navigate(`${baseUrl}/?e2e=${nonce}${hash}`);
    await tab.waitFor(() => document.readyState === "complete" && location.hash.length > 0, 12000);
    if (readySelector) await tab.waitFor(selector => Boolean(document.querySelector(selector)), readySelector, 12000);
  } catch (error) {
    let diagnostic = "";
    try {
      diagnostic = JSON.stringify(await tab.page(() => ({
        href: location.href,
        hash: location.hash,
        ready: document.readyState,
        hasStoredIdentity: Boolean(localStorage.getItem("bagiin_identity")),
        appText: document.querySelector("#app")?.innerText?.slice(0, 120) || "",
        readySelector: document.querySelector("#auto-accept-switch") ? "#auto-accept-switch" : "missing",
      })));
    } catch {}
    throw new Error(`route ${hash} ${width}x${height} failed: ${error.message}; ${diagnostic}`);
  }
}

async function closeAnyOverlay(tab) {
  await tab.page(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))).catch(() => {});
  await sleep(200);
  await tab.waitFor(() => !document.querySelector(".sheet-overlay"), 3000).catch(() => {});
}

async function openSheet(tab, selector, label) {
  const clicked = await tab.page(sel => {
    const el = document.querySelector(sel);
    if (!el || el.disabled) return false;
    el.click();
    return true;
  }, selector);
  check(`${label}: control clicked`, clicked);
  if (!clicked) return false;
  await tab.waitFor(() => Boolean(document.querySelector('.sheet-overlay[role="dialog"]')), 5000);
  const dialog = await tab.page(() => {
    const el = document.querySelector('.sheet-overlay[role="dialog"]');
    const labelledBy = el?.getAttribute("aria-labelledby")?.trim() || "";
    const aria = el?.getAttribute("aria-label")?.trim() || "";
    const labelText = labelledBy.split(/\s+/).map(id => document.getElementById(id)?.innerText || document.getElementById(id)?.textContent || "").join(" ").trim();
    return { present: Boolean(el), labelledBy, aria, labelText };
  });
  check(`${label}: sheet role=dialog has an accessible name`, Boolean(dialog.present && (dialog.aria || dialog.labelText) && (!dialog.labelledBy || dialog.labelText)), JSON.stringify(dialog));
  await closeAnyOverlay(tab);
  return true;
}

async function main() {
  let baseUrl;
  let cdpUrl;
  try {
    baseUrl = validateBaseUrl(rawBaseUrl);
    cdpUrl = validateCdpUrl(rawCdpUrl);
  } catch (error) {
    console.error(`ERROR: ${scrub(error.message)}`);
    process.exitCode = 1;
    return;
  }

  let creator;
  let guest;
  let billId;
  let tabTarget;
  let tab;
  let closed = false;
  try {
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    creator = await api(baseUrl, "POST", "/api/identities", { name: `E2E Responsive Creator ${stamp}`, creator: true });
    guest = await api(baseUrl, "POST", "/api/identities", { name: `E2E Responsive Guest ${stamp}`, creator: false });
    check("disposable creator and guest identities created", Boolean(creator?.id && guest?.id && creator?.secret && guest?.secret));
    await api(baseUrl, "POST", `/api/identities/${creator.id}/accounts`, {
      brand: "BCA", account_no: "987654321012", holder_name: "E2E Responsive Creator",
    }, creator);
    const bill = await api(baseUrl, "POST", "/api/bills", {
      title: `E2E Responsive Bill ${stamp}`,
      merchant: "E2E Fixture",
      transacted_at: "2026-01-02",
      tax_mode: "proportional",
      subtotal: 120000,
      tax: 0,
      service: 0,
      order_discount: 0,
      cashback: 0,
      total: 120000,
      items: [
        { name: "Nasi", price: 50000, discount: 0, quantity: 1, mode: "free" },
        { name: "Minum", price: 70000, discount: 0, quantity: 1, mode: "slot", slot_count: 2 },
      ],
      participants: [],
      tax_included: false,
    }, creator);
    billId = String(bill?.id || bill?.bill?.id || "");
    check("disposable bill created", Boolean(billId));
    if (!billId) throw new Error("bill API response did not include an id");
    await api(baseUrl, "POST", `/api/bills/${encodeURIComponent(billId)}/join`, undefined, guest);
    const verifiedBill = await api(baseUrl, "GET", `/api/bills/${encodeURIComponent(billId)}`, undefined, creator);
    check("disposable bill is readable after guest join", String(verifiedBill?.bill?.id || verifiedBill?.id || "") === billId);

    tabTarget = await createTab(cdpUrl);
    const wsUrl = validateDebuggerWebSocketUrl(tabTarget.webSocketDebuggerUrl, "tab");
    const ws = new WebSocketImpl(wsUrl);
    tab = new CdpTab(ws, pageErrors);
    await tab.connect();

    // Home filter loading gate: hold only the authenticated bill-list request,
    // prove the control stays disabled, then release and use the real sheet.
    await route(tab, baseUrl, creator, "#/settings", 390, 667, "#auto-accept-switch");
    await tab.page(() => {
      window.invalidateDerivedData?.();
      const original = window.fetch.bind(window);
      window.__e2eListCalls = 0;
      window.__e2eListReleased = false;
      window.__e2eRealFetch = original;
      window.__e2eListGate = new Promise(resolve => { window.__e2eListResolve = resolve; });
      window.fetch = (input, init) => {
        const raw = typeof input === "string" ? input : input?.url || "";
        const url = new URL(raw, location.href);
        if (url.pathname.endsWith(`/api/identities/${window.__bagiinIdentity?.id || ""}/bills`)
          || /\/api\/identities\/[^/]+\/bills$/.test(url.pathname)) {
          window.__e2eListCalls += 1;
          return window.__e2eListGate.then(() => window.__e2eRealFetch(input, init));
        }
        return window.__e2eRealFetch(input, init);
      };
    });
    // The application reads localStorage, not the probe variable; the broad
    // endpoint match above deliberately avoids exposing the identity secret.
    // Keep the fetch stub on the same document; a full navigation would unload
    // the override before the home renderer starts its bill-list request.
    await tab.page(() => { location.hash = "#/"; });
    await tab.waitFor(() => Number(window.__e2eListCalls || 0) > 0 && Boolean(document.querySelector("#list-ctl-btn")), 12000);
    const gated = await tab.page(() => ({
      disabled: Boolean(document.querySelector("#list-ctl-btn")?.disabled),
      ariaBusy: document.querySelector("#list-ctl-btn")?.getAttribute("aria-busy"),
      sheets: document.querySelectorAll(".sheet-overlay").length,
    }));
    await tab.page(() => document.querySelector("#list-ctl-btn")?.click());
    const blockedFilter = await tab.page(() => document.querySelectorAll(".sheet-overlay").length === 0);
    check("home list control disabled while delayed bill-list fetch is pending", gated.disabled && gated.ariaBusy === "true" && gated.sheets === 0 && blockedFilter, JSON.stringify(gated));
    await tab.page(() => { window.__e2eListReleased = true; window.__e2eListResolve?.(); });
    await tab.waitFor(() => {
      const btn = document.querySelector("#list-ctl-btn");
      return Boolean(btn && !btn.disabled && btn.getAttribute("aria-busy") !== "true");
    }, 12000);
    await tab.page(() => { window.fetch = window.__e2eRealFetch; delete window.__e2eListGate; delete window.__e2eListResolve; });
    const filterOpenedAndClosed = await openSheet(tab, "#list-ctl-btn", "home filter");
    check("home filter closes after opening", filterOpenedAndClosed && !(await tab.page(() => Boolean(document.querySelector(".sheet-overlay")))));

    // Exercise the full home width matrix. The three extra cases cover every
    // required height while the 19 width cases catch both breakpoint edges.
    const matrixResults = [];
    for (const { width, height } of HOME_MATRIX) {
      await tab.viewport(width, height);
      await tab.page(() => {
        if (location.hash !== "#/") history.replaceState(null, "", "#/");
        window.scrollTo(0, 0);
      });
      await sleep(120);
      const result = await inspectDom(tab);
      matrixResults.push({ width, height, result });
    }
    const matrixProblems = matrixResults.flatMap(({ width, height, result }) => [
      ...((result.htmlOverflow || result.bodyOverflow) ? [`${width}x${height}:overflow`] : []),
      ...(result.actionableOutside.length ? [`${width}x${height}:outside`] : []),
      ...(result.primaryTooShort.length ? [`${width}x${height}:short-cta`] : []),
      ...(result.missingNames.length ? [`${width}x${height}:unnamed`] : []),
      ...(result.duplicateIds.length ? [`${width}x${height}:duplicate-id`] : []),
    ]);
    check(`home responsive matrix (${matrixResults.length} bounded cases; widths ${WIDTHS.length}, heights ${HEIGHTS.join(",")})`, matrixProblems.length === 0, matrixProblems.slice(0, 8).join(", "));

    // Mobile and desktop composition are checked at the exact application
    // breakpoints: contextual bill docks suppress app-nav; 720px keeps the
    // fixed contextual dock; 1040px switches the shell to a desktop rail.
    await route(tab, baseUrl, creator, "#/", 390, 667, "#create-btn");
    await tab.viewport(719, 667);
    await tab.waitFor(() => Boolean(document.querySelector("#create-btn")), 5000);
    const homeMobileComposition = await tab.page(() => {
      const nav = document.querySelector("#app-nav");
      return { navVisible: Boolean(nav && !nav.hidden && getComputedStyle(nav).display !== "none"), shellSide: Boolean(document.querySelector(".shell-side")) };
    });
    await tab.viewport(1040, 900);
    const homeDesktopComposition = await tab.page(() => {
      const nav = document.querySelector("#app-nav");
      return { navVisible: Boolean(nav && !nav.hidden && getComputedStyle(nav).display !== "none") };
    });
    check("home mobile nav vs desktop nav composition", homeMobileComposition.navVisible && !homeDesktopComposition.navVisible, JSON.stringify({ homeMobileComposition, homeDesktopComposition }));

    // Settings page scoping and exactly-one toggle mutation.
    await route(tab, baseUrl, creator, "#/settings", 390, 667, "#auto-accept-switch");
    await auditRoute(tab, "settings 390x667");
    const settingsScope = await tab.page(() => {
      const app = document.querySelector("#app");
      const card = app?.querySelector(".shell-solo > .card");
      return {
        appClass: Boolean(app?.classList.contains("settings-page")),
        cardCount: app?.querySelectorAll(".shell-solo > .card").length || 0,
        marginBottom: card ? getComputedStyle(card).marginBottom : "",
      };
    });
    check("settings page class/style scope", settingsScope.appClass && settingsScope.cardCount > 0 && settingsScope.marginBottom === "6px", JSON.stringify(settingsScope));
    const toggleResult = await tab.page(async () => {
      const sw = document.querySelector("#auto-accept-switch");
      const row = sw?.closest(".toggle-row");
      if (!sw || !row) return { ok: false, changes: 0 };
      const initial = sw.getAttribute("aria-checked");
      let changes = 0;
      const observer = new MutationObserver(records => {
        changes += records.filter(record => record.type === "attributes" && record.attributeName === "aria-checked").length;
      });
      observer.observe(sw, { attributes: true });
      const iconTarget = sw.querySelector("path,svg") || sw;
      iconTarget.click();
      await new Promise(resolve => setTimeout(resolve, 900));
      observer.disconnect();
      return { ok: true, initial, final: sw.getAttribute("aria-checked"), changes };
    });
    check("settings descriptive toggle changes aria-checked exactly once", toggleResult.ok && toggleResult.initial !== toggleResult.final && toggleResult.changes === 1, JSON.stringify(toggleResult));

    // Manual create -> real renderVerify click -> lower field focus guard.
    await route(tab, baseUrl, creator, "#/create", 390, 667, "#manual-btn");
    await auditRoute(tab, "create 390x667");
    const manualClicked = await tab.page(() => {
      const button = document.querySelector("#manual-btn");
      button?.click();
      return Boolean(button);
    });
    await tab.waitFor(() => location.hash === "#/create/verify" && Boolean(document.querySelector("#create-bill-btn")), 7000);
    check("create manual control reaches #/create/verify by real click", manualClicked && (await tab.page(() => location.hash)) === "#/create/verify");
    const participantName = await tab.page(() => {
      const button = document.querySelector("#person-name-add");
      const section = button?.closest("details");
      if (section) section.open = true;
      return button?.getAttribute("aria-label") || button?.innerText?.trim() || "";
    });
    check("create participant control has an accessible name", Boolean(participantName));
    await tab.viewport(320, 568);
    await sleep(150);
    const focusResult = await tab.page(async () => {
      const details = document.querySelector("details.progressive-section");
      if (details) details.open = true;
      const dock = document.querySelector(".dock, .sticky-bar");
      const targets = ["#service-input", "#cashback-input"].map(selector => document.querySelector(selector)).filter(Boolean);
      const rows = [];
      for (const target of targets) {
        target.focus();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const targetRect = target.getBoundingClientRect();
        const dockRect = dock?.getBoundingClientRect();
        const dockFixed = Boolean(dock && getComputedStyle(dock).position === "fixed" && dockRect && dockRect.bottom > 0 && dockRect.top < innerHeight);
        const intersects = Boolean(dockFixed && targetRect.right > dockRect.left && targetRect.left < dockRect.right && targetRect.bottom > dockRect.top && targetRect.top < dockRect.bottom);
        rows.push({ id: target.id, active: document.activeElement === target, top: targetRect.top, bottom: targetRect.bottom, dockTop: dockRect?.top ?? null, intersects });
      }
      return rows;
    });
    check("native focus keeps lower editor fields above the fixed dock", focusResult.length === 2 && focusResult.every(row => row.active && !row.intersects), JSON.stringify(focusResult));
    await auditRoute(tab, "create verify 320x568");

    // Creator bill: real share/payment/edit/picker interactions plus the
    // short-phone action-row/dock intersection invariant.
    await route(tab, baseUrl, creator, `#/b/${encodeURIComponent(billId)}`, 320, 568, "#share-btn");
    await auditRoute(tab, "creator bill 320x568");
    const actionGeometry = await tab.page(() => {
      const row = document.querySelector("#pay-methods-btn")?.closest(".btn-row");
      const dock = document.querySelector(".dock, .sticky-bar");
      const rr = row?.getBoundingClientRect();
      const dr = dock?.getBoundingClientRect();
      const fixedDock = Boolean(dock && getComputedStyle(dock).position === "fixed" && dr && dr.bottom > 0 && dr.top < innerHeight);
      const intersects = Boolean(fixedDock && rr && dr && rr.right > dr.left && rr.left < dr.right && rr.bottom > dr.top && rr.top < dr.bottom);
      return { row: rr ? { top: rr.top, bottom: rr.bottom } : null, dock: dr ? { top: dr.top, bottom: dr.bottom } : null, fixedDock, intersects };
    });
    check("creator action row does not intersect the 320x568 dock", Boolean(actionGeometry.row) && !actionGeometry.intersects, JSON.stringify(actionGeometry));
    await openSheet(tab, "#share-btn", "creator share");
    await openSheet(tab, "#pay-methods-btn", "creator payment methods");
    // The 720px breakpoint changes sheet presentation only. The contextual
    // bill dock remains fixed until the actual 1040px shell-to-rail switch.
    const creatorDesktop = async () => {
      await tab.viewport(720, 844);
      await sleep(150);
      await auditRoute(tab, "creator bill 720x844");
      const at720 = await tab.page(() => {
        const nav = document.querySelector("#app-nav");
        const side = document.querySelector(".shell-side");
        const dock = document.querySelector(".dock, .sticky-bar");
        return {
          navHidden: !nav || nav.hidden || getComputedStyle(nav).display === "none",
          sideDisplay: side ? getComputedStyle(side).display : "",
          dockPosition: dock ? getComputedStyle(dock).position : "",
        };
      });
      check("bill 720px keeps the fixed mobile dock outside phone nav", at720.navHidden && at720.sideDisplay === "contents" && at720.dockPosition === "fixed", JSON.stringify(at720));
      await tab.viewport(1040, 900);
      await sleep(150);
      await auditRoute(tab, "creator bill 1040x900");
      const at1040 = await tab.page(() => {
        const nav = document.querySelector("#app-nav");
        const side = document.querySelector(".shell-side");
        const dock = side?.querySelector(".dock, .sticky-bar") || document.querySelector(".dock, .sticky-bar");
        return {
          navHidden: !nav || nav.hidden || getComputedStyle(nav).display === "none",
          sideDisplay: side ? getComputedStyle(side).display : "",
          dockPosition: dock ? getComputedStyle(dock).position : "",
        };
      });
      check("bill mobile nav is replaced by a desktop rail at 1040px", at1040.navHidden && at1040.sideDisplay === "block" && at1040.dockPosition === "static", JSON.stringify(at1040));
    };
    await creatorDesktop();
    const editClicked = await tab.page(() => { const el = document.querySelector("#edit-bill-btn"); el?.click(); return Boolean(el); });
    check("creator edit control clicked", editClicked);
    await tab.waitFor(() => Boolean(document.querySelector("#save-bill-btn")), 5000);
    await auditRoute(tab, "creator edit 720x844");
    await tab.page(() => document.querySelector("#back-btn")?.click());
    await tab.waitFor(() => Boolean(document.querySelector("#edit-bill-btn")), 7000);
    const pickerClicked = await tab.page(() => { const el = document.querySelector("#pick-mine-btn"); el?.click(); return Boolean(el); });
    check("creator picker control clicked", pickerClicked);
    await tab.waitFor(() => Boolean(document.querySelector("#done-btn")) && Boolean(document.querySelector("#pick-items")), 5000);
    await auditRoute(tab, "creator picker 720x844");
    await tab.page(() => document.querySelector("#back-btn")?.click());
    await tab.waitFor(() => Boolean(document.querySelector("#edit-bill-btn")), 7000);

    // Guest route: the guest was joined through the API, so this is an
    // authenticated guest view rather than the public name prompt.
    await route(tab, baseUrl, guest, `#/b/${encodeURIComponent(billId)}`, 390, 667, "#pay-btn");
    await auditRoute(tab, "guest bill 390x667");
    await openSheet(tab, "#pay-btn", "guest pay");

    // Recap and legacy/invalid route canonicalization.
    await route(tab, baseUrl, creator, "#/recap", 1440, 900, "#app");
    await tab.waitFor(() => !document.querySelector('[aria-busy="true"]'), 12000).catch(() => {});
    await auditRoute(tab, "recap 1440x900");
    check("recap route is rendered", await tab.page(() => location.hash === "#/recap"));
    await route(tab, baseUrl, creator, "#/recap", 390, 844, "#app");
    await sleep(250);
    await auditRoute(tab, "recap 390x844");
    const recapHeading = await tab.page(() => {
      const title = document.querySelector("#recap-people-title");
      const group = title?.parentElement;
      return {
        title: Boolean(title),
        grouped: Boolean(group && group.querySelector("#recap-people-title") && group.querySelector("p")),
        titleWidth: title?.getBoundingClientRect().width || 0,
        viewport: innerWidth,
      };
    });
    check("recap mobile heading keeps title and description grouped", recapHeading.title && recapHeading.grouped && recapHeading.titleWidth <= recapHeading.viewport, JSON.stringify(recapHeading));

    await route(tab, baseUrl, creator, "#/history", 390, 667, "#app");
    await tab.waitFor(() => location.hash === "#/") ;
    await auditRoute(tab, "history canonical home 390x667");
    check("#/history canonicalizes to #/", await tab.page(() => location.hash === "#/"));

    await route(tab, baseUrl, creator, `#/b/${encodeURIComponent(billId)}/invalid-suffix`, 390, 667, "#app");
    await tab.waitFor(() => location.hash === "#/");
    check("invalid bill suffix canonicalizes to #/", await tab.page(() => location.hash === "#/"));

    check("no console/page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
  } catch (error) {
    check("harness execution completed", false, error.message);
  } finally {
    if (billId) {
      try {
        if (!creator?.id) throw new Error("creator identity unavailable for bill cleanup");
        await api(baseUrl, "DELETE", `/api/bills/${encodeURIComponent(billId)}`, undefined, creator);
        let deleted = false;
        try {
          await api(baseUrl, "GET", `/api/bills/${encodeURIComponent(billId)}`, undefined, creator);
        } catch (error) {
          if (!String(error.message || "").endsWith("HTTP 404")) throw error;
          deleted = true;
        }
        if (!deleted) throw new Error("deleted bill remained readable after cleanup");
        check("disposable bill fixture deleted", true);
      } catch (error) {
        check("disposable bill fixture deleted", false, error.message);
      }
    }
    if (tab) tab.close();
    if (tabTarget?.id) {
      closed = await closeTab(cdpUrl, tabTarget.id);
      check("disposable CDP tab closed", closed);
    }
  }

  if (failures.length) {
    console.log(`RESULT FAIL (${failures.length} failed checks)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT PASS (${executed} navigations; ${HOME_MATRIX.length} matrix cases; widths=${WIDTHS.join(",")}; heights=${HEIGHTS.join(",")})`);
    process.exitCode = 0;
  }
}

await main();
