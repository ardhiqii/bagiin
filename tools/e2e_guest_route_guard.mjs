#!/usr/bin/env node
/**
 * Browser regression for unauthenticated hash-route canonicalization.
 *
 * The browser stays a guest while private routes are opened directly. Each
 * private route must render onboarding and replace its hash with #/. A public
 * bill route must keep its #/b/<id> hash and render the guest entry screen.
 *
 * Requirements: Node >= 22 (built-in WebSocket + fetch), a real local Bagiin
 * server, and headful Chrome on --remote-debugging-port=9223.
 *
 *   node tools/e2e_guest_route_guard.mjs
 *   node tools/e2e_guest_route_guard.mjs http://127.0.0.1:8099 http://127.0.0.1:9223
 */

const ORIGIN = (process.argv[2] || "http://127.0.0.1:8099").replace(/\/$/, "");
const CDP = (process.argv[3] || "http://127.0.0.1:9223").replace(/\/$/, "");
const failures = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

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
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

let tab = null;
let ws = null;
const pageErrors = [];
let send;
let evaluate;
let waitFor;
let navigate;

try {
  // Seed one real public bill. The browser itself never receives this identity.
  const stamp = `${Date.now().toString(36)}-${process.pid}`;
  const host = await api("POST", "/api/identities", { name: `Route guard ${stamp}`, creator: true });
  const bill = await api("POST", "/api/bills", {
    title: `Route guard ${stamp}`,
    items: [{ name: "Route guard item", price: 1000 }],
    subtotal: 1000,
    tax: 0,
    service: 0,
    total: 1000,
    tax_included: false,
  }, host);
  check("real server seeded a public bill", Boolean(bill && bill.id), bill?.id || "missing id");

  const versionResponse = await fetch(`${CDP}/json/version`);
  if (!versionResponse.ok) throw new Error(`CDP ${CDP} -> ${versionResponse.status}`);
  const tabResponse = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  if (!tabResponse.ok) throw new Error(`CDP could not create a tab (${tabResponse.status})`);
  tab = await tabResponse.json();
  if (!tab.webSocketDebuggerUrl) throw new Error("CDP tab did not provide a WebSocket URL");
  ws = new WebSocket(tab.webSocketDebuggerUrl);

  let messageId = 0;
  const pending = new Map();
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
      pageErrors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? "").join(" ") || "console error");
    } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
      pageErrors.push(message.params.entry.text || "browser log error");
    }
  });

  const withTimeout = (promise, label) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), 10000)),
  ]);
  send = (method, params = {}) => {
    const id = ++messageId;
    const result = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    return withTimeout(result, `CDP ${method}`).finally(() => pending.delete(id));
  };
  evaluate = async expression => {
    const result = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
    }
    return result.result?.value;
  };
  waitFor = async (expression, timeout = 6000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        // The page may be between document contexts during navigation.
      }
      await sleep(50);
    }
    return false;
  };
  navigate = async hash => {
    const url = `${ORIGIN}/?guest_route_e2e=${Date.now()}${hash}`;
    await send("Page.navigate", { url });
    if (!await waitFor("document.readyState === 'complete'")) {
      throw new Error(`navigation timed out for ${hash}`);
    }
    await sleep(120);
  };

  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket error")), { once: true });
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: "try { localStorage.clear(); sessionStorage.clear(); } catch {}",
  });
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  // Clear any identity left in the operator's existing Chrome profile before
  // each case. The reload after the clear reinitializes the app's in-memory
  // state from the empty localStorage, rather than merely hiding the entry.
  const openAsGuest = async hash => {
    await navigate("#/");
    await evaluate("localStorage.clear(); sessionStorage.clear();");
    await navigate(hash);
  };
  const readLayout = () => evaluate(`(() => ({
    hash: location.hash,
    onboarding: Boolean(document.querySelector("#onboard-form")),
    guestForm: Boolean(document.querySelector("#guest-form")),
    navHidden: document.querySelector("#app-nav")?.hidden === true,
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }))()`);

  for (const route of ["#/settings", "#/recap", "#/create"]) {
    await openAsGuest(route);
    check(`guest ${route} renders onboarding`, await waitFor("!!document.querySelector('#onboard-form')"));
    const state = await readLayout();
    check(`guest ${route} canonicalizes to home`, state.hash === "#/", state.hash);
    check(`guest ${route} keeps mobile nav hidden`, state.navHidden, JSON.stringify(state));
    check(`guest ${route} has no horizontal overflow`, state.scrollWidth <= state.viewport + 1, JSON.stringify(state));
  }

  const publicHash = `#/b/${bill.id}`;
  await openAsGuest(publicHash);
  check("guest public bill renders name entry", await waitFor("!!document.querySelector('#guest-form')"));
  const publicState = await readLayout();
  check("guest public bill hash is preserved", publicState.hash === publicHash, publicState.hash);
  check("guest public bill keeps mobile nav hidden", publicState.navHidden, JSON.stringify(publicState));
  check("guest public bill has no horizontal overflow", publicState.scrollWidth <= publicState.viewport + 1, JSON.stringify(publicState));
  check("no uncaught browser console errors", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (ws) ws.close();
  if (tab?.id) await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {});
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("\nall guest route guard checks passed");
}
