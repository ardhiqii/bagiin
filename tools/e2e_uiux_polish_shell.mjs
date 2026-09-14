#!/usr/bin/env node
/**
 * Focused responsive shell probe for the React Bagiin frontend.
 *
 * The probe only accepts local BASE_URL and CDP_URL values. It creates one
 * disposable bill, exercises shell states through a fresh CDP tab, reports
 * measured shell geometry, then deletes the bill and closes the tab.
 *
 *   BASE_URL=http://127.0.0.1:8099 CDP_URL=http://127.0.0.1:9222 \
 *     node tools/e2e_uiux_polish_shell.mjs
 */

import { createHash, randomBytes } from "node:crypto";
import { createConnection as netConnect } from "node:net";
import { connect as tlsConnect } from "node:tls";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const WIDTHS = [320, 390, 480, 600, 768, 820, 1024, 1040, 1280, 1440];
const rawBaseUrl = process.argv[2] || process.env.BASE_URL || "http://127.0.0.1:8099";
const rawCdpUrl = process.argv[3] || process.env.CDP_URL || "http://127.0.0.1:9222";
const failures = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeHost = host => String(host || "").replace(/^\[|\]$/g, "");
const isLocalHost = host => LOCAL_HOSTS.has(normalizeHost(host));

function validateLocalUrl(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !isLocalHost(parsed.hostname)) {
    throw new Error(`${label} must target localhost, 127.0.0.1, or ::1 without embedded credentials`);
  }
  return parsed.href.replace(/\/$/, "");
}

function validateWebSocketUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CDP did not advertise a valid WebSocket debugger URL");
  }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password || !isLocalHost(parsed.hostname)) {
    throw new Error("CDP advertised a non-local or invalid WebSocket debugger URL");
  }
  return parsed.href;
}

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

/* Node versions without global WebSocket need this small RFC 6455 client. */
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
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
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
    for (let index = 0; index < maskedPayload.length; index += 1) maskedPayload[index] ^= mask[index % 4];
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

class CdpTab {
  constructor(ws) {
    this.ws = ws;
    this.sequence = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener("message", event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        this.errors.push("invalid CDP message");
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
        this.errors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "page exception");
      } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        this.errors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? "").join(" ") || "console error");
      } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
        this.errors.push(message.params.entry.text || "browser log error");
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "page evaluation failed");
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

  async theme(colorScheme) {
    await this.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: colorScheme }] });
  }

  async waitFor(fn, ...args) {
    const timeoutMs = typeof args.at(-1) === "number" ? args.pop() : 12000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.page(fn, ...args)) return;
      await sleep(100);
    }
    throw new Error(`page condition timed out after ${timeoutMs}ms`);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

const inspectFn = () => {
  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && style.visibility !== "collapse"
      && Number(style.opacity || 1) > 0
      && rect.width > 0
      && rect.height > 0
      && !element.closest('[aria-hidden="true"]');
  };
  const rect = element => {
    const value = element?.getBoundingClientRect();
    return value ? {
      left: value.left,
      right: value.right,
      top: value.top,
      bottom: value.bottom,
      width: value.width,
      height: value.height,
    } : null;
  };
  const intersects = (first, second) => Boolean(first && second && first.right > second.left && first.left < second.right && first.bottom > second.top && first.top < second.bottom);
  const shell = [...document.querySelectorAll(".shell-with-rail")].find(visible);
  const main = shell?.querySelector(":scope > .shell-main");
  const side = shell?.querySelector(":scope > .shell-side");
  const dock = [...document.querySelectorAll(".dock,.sticky-bar")].find(visible);
  const nav = [...document.querySelectorAll("#app-nav")].find(visible);
  const actions = [...document.querySelectorAll("button,a[href],[role=button],[role=link],[role=switch],input:not([type=hidden]):not([type=file]),select,textarea")]
    .filter(visible);
  const tooSmall = actions
    .filter(element => {
      if (element.matches("input[type=checkbox]") && element.closest(".check-label")) return false;
      const value = rect(element);
      return value && (value.width < 44 - 0.01 || value.height < 44 - 0.01);
    })
    .map(element => ({
      tag: element.tagName,
      id: element.id,
      className: String(element.className || "").slice(0, 80),
      rect: rect(element),
      parent: element.parentElement ? {
        tag: element.parentElement.tagName,
        className: String(element.parentElement.className || "").slice(0, 80),
        rect: rect(element.parentElement),
        gridTemplateColumns: getComputedStyle(element.parentElement).gridTemplateColumns,
      } : null,
    }));
  const outside = actions
    .map(element => ({ element, value: rect(element) }))
    .filter(item => item.value && (item.value.left < -1 || item.value.right > innerWidth + 1))
    .map(item => ({ tag: item.element.tagName, id: item.element.id, rect: item.value }));
  const overflowNodes = [...document.querySelectorAll("body *")]
    .map(element => ({ element, value: rect(element) }))
    .filter(item => item.value && (item.value.left < -1 || item.value.right > innerWidth + 1))
    .sort((first, second) => (second.value?.right || 0) - (first.value?.right || 0))
    .slice(0, 4)
    .map(item => ({ tag: item.element.tagName, id: item.element.id, className: String(item.element.className || "").slice(0, 80), rect: item.value }));
  const rootRects = ["html", "body", "#root", "#app"].map(selector => {
    const element = document.querySelector(selector);
    const value = rect(element);
    const style = element ? getComputedStyle(element) : null;
    return { selector, rect: value, width: style?.width || "", minWidth: style?.minWidth || "" };
  });
  const wideScrollers = [...document.querySelectorAll("body *")]
    .filter(element => element.scrollWidth > element.clientWidth + 1)
    .filter(element => ![...element.children].some(child => child.scrollWidth > child.clientWidth + 1))
    .sort((first, second) => second.scrollWidth - first.scrollWidth)
    .slice(0, 6)
    .map(element => ({
      tag: element.tagName,
      id: element.id,
      className: String(element.className || "").slice(0, 80),
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      rect: rect(element),
      overflowX: getComputedStyle(element).overflowX,
      children: [...element.children].length,
    }));
  const layoutDebug = [
    ".home-content",
    ".home-content > .card",
    ".home-content .card-title",
    ".home-content .desktop-controls",
    ".home-content .list-controls",
    ".home-content .filter-chips",
    ".home-content .filter-selects",
    ".home-content .filter-selects > *",
    ".home-content .bill-list",
    ".home-content .bill-row",
  ].flatMap(selector => [...document.querySelectorAll(selector)].map(element => ({
    selector,
    className: String(element.className || "").slice(0, 80),
    rect: rect(element),
    scrollWidth: element.scrollWidth,
    clientWidth: element.clientWidth,
    display: getComputedStyle(element).display,
    gridTemplateColumns: getComputedStyle(element).gridTemplateColumns,
  })));
  const surfaceOverlap = Boolean(intersects(rect(nav), rect(dock)));
  const actionableOverlap = actions
    .filter(element => !element.closest("#app-nav,.dock,.sticky-bar"))
    .map(element => ({ element, value: rect(element) }))
    .filter(item => item.value && (intersects(item.value, rect(nav)) || intersects(item.value, rect(dock))))
    .map(item => ({ tag: item.element.tagName, id: item.element.id, rect: item.value }));
  const shellStyle = shell ? getComputedStyle(shell) : null;
  const sideStyle = side ? getComputedStyle(side) : null;
  const dockStyle = dock ? getComputedStyle(dock) : null;
  const navStyle = nav ? getComputedStyle(nav) : null;
  return {
    viewport: { width: innerWidth, height: innerHeight },
    scroll: { html: document.documentElement.scrollWidth, body: document.body.scrollWidth },
    shell: rect(shell),
    main: rect(main),
    side: rect(side),
    shellDisplay: shellStyle?.display || "",
    gridTemplateColumns: shellStyle?.gridTemplateColumns || "",
    sideDisplay: sideStyle?.display || "",
    sidePosition: sideStyle?.position || "",
    dock: rect(dock),
    dockPosition: dockStyle?.position || "",
    nav: rect(nav),
    navPosition: navStyle?.position || "",
    tooSmall,
    outside,
    overflowNodes,
    rootRects,
    wideScrollers,
    layoutDebug,
    surfaceOverlap,
    actionableOverlap,
    route: location.hash,
  };
};

const focusFn = async () => {
  const dock = [...document.querySelectorAll(".dock,.sticky-bar")].find(element => {
    const style = getComputedStyle(element);
    const value = element.getBoundingClientRect();
    return style.display !== "none" && value.width > 0 && value.height > 0;
  });
  const targets = ["#service-input", "#cashback-input"]
    .map(selector => document.querySelector(selector))
    .filter(Boolean);
  const rows = [];
  for (const target of targets) {
    target.focus();
    const root = document.documentElement;
    const previousScrollBehavior = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    target.scrollIntoView({ block: "center", inline: "nearest" });
    root.style.scrollBehavior = previousScrollBehavior;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const input = target.getBoundingClientRect();
    const surface = dock?.getBoundingClientRect();
    rows.push({
      id: target.id,
      active: document.activeElement === target,
      input: { top: input.top, bottom: input.bottom },
      dock: surface ? { top: surface.top, bottom: surface.bottom } : null,
      clearance: surface ? surface.top - input.bottom : null,
      intersects: Boolean(surface && input.right > surface.left && input.left < surface.right && input.bottom > surface.top && input.top < surface.bottom),
    });
  }
  return rows;
};

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures.push(name);
  console.log(` FAIL ${name}${detail ? `: ${detail}` : ""}`);
}

async function createTab(cdpUrl) {
  const response = await fetchWithTimeout(`${cdpUrl}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`CDP could not create a tab (HTTP ${response.status})`);
  const target = await response.json();
  if (!target.id || !target.webSocketDebuggerUrl) throw new Error("CDP returned an incomplete tab target");
  return target;
}

async function closeTab(cdpUrl, targetId) {
  if (!targetId) return;
  await fetchWithTimeout(`${cdpUrl}/json/close/${encodeURIComponent(targetId)}`, { method: "GET" }, 5000).catch(() => undefined);
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

async function loadRoute(tab, baseUrl, identity, hash, width, height, colorScheme, readySelector) {
  await tab.viewport(width, height);
  await tab.theme(colorScheme);
  const nonce = `${Date.now()}-${width}-${Math.random().toString(36).slice(2)}`;
  const qaOrigin = new URL(baseUrl).origin;
  const cleanupScript = await tab.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `(() => {
      if (location.origin !== ${JSON.stringify(qaOrigin)}) return;
      if (new URL(location.href).searchParams.get("shell") !== ${JSON.stringify(`${nonce}-origin`)}) return;
      try { localStorage.clear(); } catch {}
      try { sessionStorage.clear(); } catch {}
    })();`,
  });
  try {
    await tab.navigate(`${baseUrl}/?shell=${nonce}-origin#/`);
    await tab.waitFor(() => document.readyState === "complete", 12000);
  } finally {
    await tab.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: cleanupScript.identifier }).catch(() => undefined);
  }
  await tab.page(value => {
    if (value) localStorage.setItem("bagiin_identity", JSON.stringify(value));
    else localStorage.removeItem("bagiin_identity");
  }, identity);
  await tab.navigate(`${baseUrl}/?shell=${nonce}${hash}`);
  await tab.waitFor(() => document.readyState === "complete" && location.hash.length > 0, 12000);
  if (readySelector) await tab.waitFor(selector => Boolean(document.querySelector(selector)), readySelector, 12000);
}

function geometryProblems(label, result, width, contextualDock) {
  const problems = [];
  if (result.scroll.html > width + 1 || result.scroll.body > width + 1) problems.push("horizontal overflow");
  if (result.outside.length) problems.push("action outside viewport");
  if (result.tooSmall.length) problems.push(`small target ${result.tooSmall[0].id || result.tooSmall[0].className} ${JSON.stringify(result.tooSmall[0].rect)}`);
  if (result.surfaceOverlap) problems.push("nav/dock overlap");
  if (result.shell) {
    if (width < 1040) {
      if (result.shellDisplay !== "block") problems.push(`shell display ${result.shellDisplay}`);
      if (result.main.width < width - 64) problems.push(`main too narrow ${Math.round(result.main.width)}px`);
      if (width < 768 && result.sideDisplay !== "contents") problems.push(`mobile side display ${result.sideDisplay}`);
      if (width >= 768 && result.sidePosition !== "static") problems.push(`tablet side position ${result.sidePosition}`);
    } else {
      if (result.shellDisplay !== "grid") problems.push(`desktop shell display ${result.shellDisplay}`);
      if (result.main.width < 600) problems.push(`desktop main too narrow ${Math.round(result.main.width)}px`);
      if (result.side.width < 240) problems.push(`desktop rail too narrow ${Math.round(result.side.width)}px`);
      if (result.sideDisplay !== "block" || result.sidePosition !== "sticky") problems.push(`desktop rail ${result.sideDisplay}/${result.sidePosition}`);
    }
  }
  if (contextualDock && result.dock) {
    const expected = width < 768 ? "fixed" : width < 1040 ? "sticky" : "static";
    if (result.dockPosition !== expected) problems.push(`dock position ${result.dockPosition}, expected ${expected}`);
    if (width < 768 && result.nav) problems.push("contextual nav visible");
  }
  return problems;
}

function printMeasurement(label, width, result) {
  const shell = result.shell ? `${Math.round(result.shell.width)}w/${Math.round(result.shell.height)}h` : "none";
  const main = result.main ? `${Math.round(result.main.width)}w` : "none";
  const side = result.side ? `${Math.round(result.side.width)}w` : "none";
  const dock = result.dock ? `${result.dockPosition}/${Math.round(result.dock.height)}h` : "none";
  const nav = result.nav ? `${result.navPosition}/${Math.round(result.nav.height)}h` : "none";
  const overflow = result.overflowNodes.length || result.wideScrollers.length
    ? ` overflow=${JSON.stringify(result.overflowNodes)} wide=${JSON.stringify(result.wideScrollers)} debug=${JSON.stringify(result.layoutDebug)}`
    : ` roots=${JSON.stringify(result.rootRects)}`;
  console.log(`  measure ${label} ${width}px: shell=${result.shellDisplay}/${shell} main=${main} side=${side} dock=${dock} nav=${nav} scroll=${result.scroll.html}/${result.scroll.body}${overflow}`);
}

async function main() {
  let baseUrl;
  let cdpUrl;
  try {
    baseUrl = validateLocalUrl(rawBaseUrl, "BASE_URL");
    cdpUrl = validateLocalUrl(rawCdpUrl, "CDP_URL");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  let creator;
  let guest;
  let billId;
  let target;
  let tab;
  try {
    const stamp = `${Date.now().toString(36)}-${process.pid}`;
    creator = await api(baseUrl, "POST", "/api/identities", { name: `E2E Shell Creator ${stamp}`, creator: true });
    guest = await api(baseUrl, "POST", "/api/identities", { name: `E2E Shell Guest ${stamp}`, creator: false });
    const bill = await api(baseUrl, "POST", "/api/bills", {
      title: `E2E Shell Bill ${stamp}`,
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
    if (!billId) throw new Error("bill API response did not include an id");
    await api(baseUrl, "POST", `/api/bills/${encodeURIComponent(billId)}/join`, undefined, guest);
    console.log("  ok  disposable shell identities and bill created");

    target = await createTab(cdpUrl);
    tab = new CdpTab(new WebSocketImpl(validateWebSocketUrl(target.webSocketDebuggerUrl)));
    await tab.connect();

    await loadRoute(tab, baseUrl, null, "#/", 320, 568, "light", "#onboard-form");
    const onboarding = await tab.page(inspectFn);
    check("onboarding 320px has no horizontal overflow", onboarding.scroll.html <= 321 && onboarding.scroll.body <= 321);
    check("onboarding 320px controls stay in viewport", onboarding.outside.length === 0, JSON.stringify(onboarding.outside.slice(0, 2)));

    const states = [
      { label: "home", identity: creator, hash: "#/", selector: "#create-btn", contextualDock: false },
      { label: "verify", identity: creator, hash: "#/create/verify", selector: "#create-bill-btn", contextualDock: true },
      { label: "creator-bill", identity: creator, hash: `#/b/${encodeURIComponent(billId)}`, selector: "#share-btn", contextualDock: true },
      { label: "guest-picker", identity: guest, hash: `#/b/${encodeURIComponent(billId)}`, selector: "#pay-btn", contextualDock: true },
    ];

    for (const state of states) {
      for (const width of WIDTHS) {
        const height = width < 768 ? (width === 320 ? 568 : 667) : 900;
        await loadRoute(tab, baseUrl, state.identity, state.hash, width, height, "light", state.selector);
        const result = await tab.page(inspectFn);
        const problems = geometryProblems(state.label, result, width, state.contextualDock);
        printMeasurement(state.label, width, result);
        check(`${state.label} ${width}px shell geometry`, problems.length === 0, problems.join(", "));
        if (state.label === "verify" && width === 320) {
          const focus = await tab.page(focusFn);
          const focusProblems = focus.filter(row => !row.active || row.intersects || row.clearance == null || row.clearance < 24 - 0.01);
          check("verify focused inputs clear the live dock by 24px", focus.length === 2 && focusProblems.length === 0, JSON.stringify(focus));
        }
      }
    }

    const supportingRoutes = [
      { label: "create", hash: "#/create", selector: "#manual-btn", width: 390, height: 667 },
      { label: "settings", hash: "#/settings", selector: "#auto-accept-switch", width: 390, height: 667 },
      { label: "recap", hash: "#/recap", selector: "#app", width: 1440, height: 900 },
      { label: "unknown", hash: "#/not-a-real-route", selector: "#create-btn", width: 390, height: 667 },
    ];
    for (const route of supportingRoutes) {
      await loadRoute(tab, baseUrl, creator, route.hash, route.width, route.height, "light", route.selector);
      const result = await tab.page(inspectFn);
      const problems = geometryProblems(route.label, result, route.width, false);
      check(`${route.label} ${route.width}x${route.height} geometry`, problems.length === 0, problems.join(", "));
    }

    for (const colorScheme of ["light", "dark"]) {
      await loadRoute(tab, baseUrl, creator, "#/create/verify", 820, 900, colorScheme, "#create-bill-btn");
      const result = await tab.page(inspectFn);
      const problems = geometryProblems(`verify-${colorScheme}`, result, 820, true);
      check(`verify 820px ${colorScheme} theme`, problems.length === 0, problems.join(", "));
    }
    await sleep(250);
    check("no page or console errors", tab.errors.length === 0, tab.errors.slice(0, 3).join(" | "));
  } catch (error) {
    check("shell probe completed", false, error.message);
  } finally {
    if (billId && creator?.id) {
      try {
        await api(baseUrl, "DELETE", `/api/bills/${encodeURIComponent(billId)}`, undefined, creator);
        console.log("  ok  disposable shell bill deleted");
      } catch (error) {
        check("disposable shell bill deleted", false, error.message);
      }
    }
    tab?.close();
    await closeTab(cdpUrl, target?.id);
    if (target?.id) console.log("  ok  disposable CDP tab closed");
  }

  if (failures.length) {
    console.log(`RESULT FAIL (${failures.length} failed checks)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT PASS (shell states=${statesCountLabel()}; widths=${WIDTHS.join(",")}; themes=light,dark)`);
  }
}

function statesCountLabel() {
  return "home,verify,creator-bill,guest-picker";
}

await main();
