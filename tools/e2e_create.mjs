#!/usr/bin/env node
/**
 * Browser regression harness for the create-bill editor. It uses the WebSocket
 * implementation bundled with Node, so the project needs no npm dependency.
 *
 * Defaults deliberately point at a disposable local server. The harness creates
 * one throwaway identity, drives the real editor in Chrome over CDP, and never
 * submits a bill. It is intentionally a hard failure when no matrix case runs.
 *
 *   node tools/e2e_create.mjs [BASE_URL] [CDP_URL]
 *   BAGIIN_BASE_URL=http://127.0.0.1:8099 BAGIIN_CDP_URL=http://127.0.0.1:9222 node tools/e2e_create.mjs
 */

import { createHash, randomBytes } from "node:crypto";
import { createConnection as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const normalizeHost = host => host.replace(/^\[|\]$/g, "");
const isLocalHost = host => LOCAL_HOSTS.has(normalizeHost(host));
const validateDebuggerWebSocketUrl = (rawUrl, label) => {
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
  if (!isLocalHost(parsed.hostname) && process.env.BAGIIN_E2E_ALLOW_NONLOCAL_CDP !== "1") {
    throw new Error(`${label} advertised a non-local WebSocket; set BAGIIN_E2E_ALLOW_NONLOCAL_CDP=1 only for an explicit non-local run`);
  }
  return parsed.href;
};

/* Node 18 has no global WebSocket. Keep the harness dependency-free by using
 * a small RFC 6455 client for CDP when a native implementation is absent. */
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
      "Upgrade: websocket",
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
const rawBaseUrl = process.argv[2] || process.env.BAGIIN_BASE_URL || "http://127.0.0.1:8099";
let BASE_URL;
try {
  const parsedBaseUrl = new URL(rawBaseUrl);
  if (!["http:", "https:"].includes(parsedBaseUrl.protocol) || parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error("BASE_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (!isLocalHost(parsedBaseUrl.hostname) && process.env.BAGIIN_E2E_ALLOW_NONLOCAL !== "1") {
    throw new Error("BASE_URL must target localhost; set BAGIIN_E2E_ALLOW_NONLOCAL=1 only for an explicit non-local run");
  }
  BASE_URL = parsedBaseUrl.href.replace(/\/$/, "");
} catch (error) {
  console.error(`ERROR: invalid Bagiin E2E BASE_URL (${error.message})`);
  process.exit(1);
}
const rawCdpUrl = process.argv[3] || process.env.BAGIIN_CDP_URL || "http://127.0.0.1:9222";
let CDP_URL;
try {
  const parsedCdpUrl = new URL(rawCdpUrl);
  if (!["http:", "https:"].includes(parsedCdpUrl.protocol) || parsedCdpUrl.username || parsedCdpUrl.password) {
    throw new Error("CDP_URL must be an HTTP(S) URL without embedded credentials");
  }
  if (!isLocalHost(parsedCdpUrl.hostname) && process.env.BAGIIN_E2E_ALLOW_NONLOCAL_CDP !== "1") {
    throw new Error("CDP_URL must target localhost; set BAGIIN_E2E_ALLOW_NONLOCAL_CDP=1 only for an explicit non-local run");
  }
  CDP_URL = parsedCdpUrl.href.replace(/\/$/, "");
} catch (error) {
  console.error(`ERROR: invalid Bagiin E2E CDP_URL (${error.message})`);
  process.exit(1);
}
const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1040, 1280, 1440];
const HEIGHT = 900;
const failures = [];
let executed = 0;

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const withTimeout = (promise, timeoutMs, label) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};
const fetchWithTimeout = async (url, options = {}, timeoutMs = 15000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

async function api(method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) {
    headers["X-Identity-Id"] = identity.id;
    if (identity.secret) headers["X-Identity-Secret"] = identity.secret;
  }
  const response = await fetchWithTimeout(BASE_URL + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function cdpDiscovery() {
  try {
    const response = await fetchWithTimeout(`${CDP_URL}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const version = await response.json();
    validateDebuggerWebSocketUrl(version.webSocketDebuggerUrl, "browser");
    return version;
  } catch (error) {
    console.log(`SKIP: Chrome/CDP unavailable at ${CDP_URL} (${error.message})`);
    console.log("Start Chrome with --remote-debugging-port=9222 and rerun against a disposable server.");
    process.exitCode = 2;
    return null;
  }
}

const discovery = await cdpDiscovery();
if (!discovery) process.exit(2);

let identity;
try {
  const stamp = `${Date.now().toString(36)}-${process.pid}`;
  identity = await api("POST", "/api/identities", { name: `E2E Create ${stamp}`, creator: true });
  check("disposable identity has credentials", Boolean(identity.id), identity.id ? "created" : "missing id");
} catch (error) {
  console.error(`ERROR: disposable Bagiin server unavailable at ${BASE_URL}: ${error.message}`);
  process.exit(1);
}

let tab = null;
let ws = null;
const pageErrors = [];
try {
  const tabResponse = await fetchWithTimeout(`${CDP_URL}/json/new?about:blank`, { method: "PUT" });
  if (!tabResponse.ok) throw new Error(`CDP could not create a tab (${tabResponse.status})`);
  tab = await tabResponse.json();
  const tabWebSocketUrl = validateDebuggerWebSocketUrl(tab.webSocketDebuggerUrl, "tab");
  ws = new WebSocketImpl(tabWebSocketUrl);
  const wsReady = new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket error")), { once: true });
  });
  let sequence = 0;
const pending = new Map();
ws.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    pageErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "page exception");
  } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
    pageErrors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? "").join(" ") || "console error");
  } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
    pageErrors.push(message.params.entry.text || "browser log error");
  }
});
const send = (method, params = {}) => {
  const id = ++sequence;
  const request = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return withTimeout(request, 15000, `CDP ${method}`).catch(error => {
    pending.delete(id);
    throw error;
  });
};
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const navigate = async url => {
  await send("Page.navigate", { url });
  await sleep(700);
};

const identityJson = JSON.stringify(JSON.stringify(identity));
const createAndManual = async () => {
  await navigate(`${BASE_URL}/?e2e=${Date.now()}#/create`);
  await evaluate(`localStorage.setItem("bagiin_identity", ${identityJson})`);
  await navigate(`${BASE_URL}/?e2e=${Date.now()}#/create`);
  const clicked = await evaluate(`(() => {
    const button = document.querySelector("#manual-btn");
    if (button) button.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error("manual create control was not rendered");
  await sleep(250);
};

const readCase = async (width, color) => evaluate(`(() => {
  const app = document.querySelector("#app");
  const dock = document.querySelector(".dock, .sticky-bar");
  const main = document.querySelector(".shell-main");
  const side = document.querySelector(".shell-side");
  const quantity = document.querySelector('[data-role="quantity"]');
  const cta = document.querySelector("#create-bill-btn");
  const firstFocusable = document.querySelector("#title-input, [data-role=name], #subtotal-input");
  const rect = el => el ? el.getBoundingClientRect().toJSON() : null;
  const validControls = [...document.querySelectorAll("#create-bill-btn, #add-item-btn, #verify-add-photo, #verify-paste-photo, .vf-item button")];
  return {
    route: location.hash,
    controls: { title: Boolean(document.querySelector("#title-input")), item: Boolean(document.querySelector('[data-role="name"]')), quantity: Boolean(quantity), subtotal: Boolean(document.querySelector("#subtotal-input")), cta: Boolean(cta) },
    focus: firstFocusable ? (() => {
      firstFocusable.focus();
      const style = getComputedStyle(firstFocusable);
      const targetRect = firstFocusable.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      const dockFixed = dock && getComputedStyle(dock).position === "fixed";
      const intersectsDock = dockFixed && dockRect && targetRect.right > dockRect.left && targetRect.left < dockRect.right && targetRect.bottom > dockRect.top && targetRect.top < dockRect.bottom;
      return {
        active: document.activeElement === firstFocusable,
        clear: !intersectsDock || targetRect.bottom <= dockRect.top - 24,
        outline: style.outlineStyle,
        width: targetRect.width,
      };
    })() : null,
    dimensions: { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, app: rect(app), dock: rect(dock), main: rect(main), side: rect(side) },
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    controlHeights: validControls.map(el => ({ id: el.id || el.getAttribute("aria-label") || el.className, height: el.getBoundingClientRect().height })),
    quantity: quantity ? { value: quantity.value, error: !document.querySelector("[data-role=quantity-error]")?.classList.contains("hidden"), ctaDisabled: Boolean(cta?.disabled) } : null,
    color: ${JSON.stringify(color)},
  };
})()`);

  await withTimeout(wsReady, 10000, "CDP WebSocket connection");
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  for (const color of ["light", "dark"]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: color }] });
    for (const width of WIDTHS) {
      executed += 1;
      try {
        await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 768 });
        await createAndManual();
        await evaluate(`(() => {
          const set = (selector, value) => {
            const input = document.querySelector(selector);
            if (!input) throw new Error("missing " + selector);
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          };
          set('[data-role="name"]', "E2E Item");
          set('[data-role="price"]', "1000");
          set("#subtotal-input", "1000");
        })()`);
        const initial = await readCase(width, color);
        const prefix = `${color} ${width}px`;
        const allControls = Object.values(initial.controls).every(Boolean);
        check(`${prefix}: create controls render`, allControls, JSON.stringify(initial.controls));
        check(`${prefix}: focused control is active and dock-clear`, initial.focus?.active === true && initial.focus.clear === true, JSON.stringify(initial.focus));
        check(`${prefix}: controls meet tap target`, initial.controlHeights.every(control => control.height >= 44), JSON.stringify(initial.controlHeights));
        check(`${prefix}: no horizontal overflow`, initial.dimensions.scrollWidth <= width, `${initial.dimensions.scrollWidth}px`);
        check(`${prefix}: dock geometry`, Boolean(initial.dimensions.dock) && initial.dimensions.dock.height >= 44 && initial.dimensions.dock.right <= width + 1, JSON.stringify(initial.dimensions.dock));
        check(`${prefix}: color preference applied`, initial.dark === (color === "dark"), `dark=${initial.dark}`);

        const invalid = await evaluate(`(() => {
          const input = document.querySelector('[data-role="quantity"]');
          input.value = "1.5";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return { value: input.value, error: !document.querySelector("[data-role=quantity-error]")?.classList.contains("hidden"), disabled: document.querySelector("#create-bill-btn")?.disabled };
        })()`);
        await sleep(100);
        const invalidDock = await evaluate(`(() => {
          const add = document.querySelector("#add-item-btn");
          const dock = document.querySelector(".dock, .sticky-bar");
          if (!add || !dock) return { clear: false, reason: "missing add action or dock" };
          const a = add.getBoundingClientRect();
          const d = dock.getBoundingClientRect();
          const fixed = getComputedStyle(dock).position === "fixed";
          const overlaps = fixed && a.right > d.left && a.left < d.right && a.bottom > d.top && a.top < d.bottom;
          return { clear: !overlaps && (!fixed || a.bottom <= d.top - 24 || a.top >= d.bottom), rect: a.toJSON(), dock: d.toJSON() };
        })()`);
        invalid.addClear = invalidDock.clear;
        check(`${prefix}: invalid quantity blocks CTA and leaves add action clear`, invalid.error === true && invalid.disabled === true && invalid.addClear === true, JSON.stringify({ invalid, invalidDock }));
        for (const quantity of ["1", "99"]) {
          const valid = await evaluate(`(() => {
            const input = document.querySelector('[data-role="quantity"]');
            input.value = ${JSON.stringify(quantity)};
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const subtotal = document.querySelector("#subtotal-input");
            subtotal.value = ${JSON.stringify(quantity)} + "000";
            subtotal.dispatchEvent(new Event("input", { bubbles: true }));
            subtotal.dispatchEvent(new Event("change", { bubbles: true }));
            return { value: input.value, error: !document.querySelector("[data-role=quantity-error]")?.classList.contains("hidden"), disabled: document.querySelector("#create-bill-btn")?.disabled, total: document.querySelector('[data-role="line-total"]')?.textContent || "" };
          })()`);
          check(`${prefix}: quantity ${quantity} accepted`, valid.error === false && valid.disabled === false && valid.value === quantity, JSON.stringify(valid));
        }

        if (width === 320 || width === 1280) {
          const ocr = await evaluate(`(() => {
            renderVerify({
              merchant: "Warung E2E",
              transacted_at: "2026-09-05",
              items: [
                { name: "Nasi Goreng", price: 30000, quantity: 2, discount: 0, mode: "free" },
                { name: "Nasi Goreng", price: 60000, quantity: 1, discount: 0, mode: "free" },
              ],
              subtotal: 120000,
              tax: 0,
              service: 0,
              total: 120000,
              photos: [],
            }, false);
            return {
              rows: document.querySelectorAll("#items-list .vf-item").length,
              quantities: [...document.querySelectorAll('[data-role="quantity"]')].map(input => input.value),
              title: document.querySelector("#title-input")?.value || "",
              route: location.hash,
            };
          })()`);
          check(`${prefix}: OCR review preserves duplicate rows and quantity`, ocr.rows === 2 && JSON.stringify(ocr.quantities) === JSON.stringify(["2", "1"]) && ocr.title === "Warung E2E", JSON.stringify(ocr));
        }
      } catch (error) {
        check(`${color} ${width}px: case executes`, false, error.message);
      }
    }
  }
} finally {
  if (tab?.id) await fetchWithTimeout(`${CDP_URL}/json/close/${encodeURIComponent(tab.id)}`).catch(() => {});
  if (ws) ws.close();
}

check("matrix executed at least one case", executed > 0, `${executed} cases`);
check("no uncaught page exceptions", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
console.log(`\n${executed} matrix cases executed; ${failures.length} failed`);
process.exit(failures.length || executed === 0 ? 1 : 0);
