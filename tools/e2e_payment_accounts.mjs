#!/usr/bin/env node
/**
 * Browser regression for payment-account edit/delete parity in the React
 * settings screen. It creates one disposable identity through the API, puts
 * only that returned session identity into localStorage, then drives the real
 * settings route in a fresh Chrome tab over CDP.
 *
 * Requirements: Node >= 22, a Bagiin server backed by a throwaway database,
 * and Chrome on --remote-debugging-port=9222. No npm dependency is required.
 *
 *   cd backend
 *   BAGIIN_DB=/tmp/payment-accounts.db BAGIIN_UPLOAD_DIR=/tmp/payment-accounts-up \
 *     venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8099 &
 *   cd ..
 *   node tools/e2e_payment_accounts.mjs \
 *     http://127.0.0.1:8099 http://127.0.0.1:9222
 *
 * The script never prints identity secrets or full account numbers. The
 * fixture is removed in finally so a failed browser run does not leave an
 * account behind in the throwaway database.
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeHost = host => String(host || "").replace(/^\[|\]$/g, "");

function localHttpUrl(raw, label) {
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

function localWebSocketUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CDP advertised an invalid WebSocket debugger URL");
  }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password
    || !LOCAL_HOSTS.has(normalizeHost(parsed.hostname))) {
    throw new Error("CDP advertised a non-local WebSocket debugger URL");
  }
  return parsed.href;
}

const ORIGIN = localHttpUrl(process.argv[2] || "http://127.0.0.1:8099", "BASE_URL");
const CDP = localHttpUrl(process.argv[3] || "http://127.0.0.1:9222", "CDP_URL");
const failures = [];
const pageErrors = [];
const accountRequests = [];
let identity = null;
let accountId = null;
let tab = null;
let ws = null;
let messageId = 0;
const pending = new Map();

function scrub(value) {
  let text = String(value || "");
  if (identity?.secret) text = text.replaceAll(identity.secret, "[REDACTED]");
  for (const number of ["8123456789", "9876543210"]) text = text.replaceAll(number, "[ACCOUNT_REDACTED]");
  return text;
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${scrub(detail)}` : ""}`);
  if (!ok) failures.push(name);
}

async function api(method, path, body, authenticatedIdentity) {
  const headers = { "Content-Type": "application/json" };
  if (authenticatedIdentity) {
    headers["X-Identity-Id"] = authenticatedIdentity.id;
    if (authenticatedIdentity.secret) headers["X-Identity-Secret"] = authenticatedIdentity.secret;
  }
  const response = await fetch(`${ORIGIN}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> HTTP ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function send(method, params = {}) {
  const id = ++messageId;
  const result = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
  return Promise.race([
    result,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 10000)),
  ]).finally(() => pending.delete(id));
}

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "browser evaluation failed");
  }
  return result.result?.value;
}

async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      // A route transition can briefly detach the execution context.
    }
    await sleep(60);
  }
  return false;
}

async function navigate(url) {
  await send("Page.navigate", { url });
  if (!await waitFor("document.readyState === 'complete'")) throw new Error("browser navigation timed out");
  await sleep(180);
}

async function click(selector) {
  const clicked = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node || node.disabled) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`missing browser control: ${selector}`);
}

async function clickText(text) {
  const clicked = await evaluate(`(() => {
    const node = [...document.querySelectorAll("button")]
      .find(candidate => candidate.textContent?.trim() === ${JSON.stringify(text)});
    if (!node || node.disabled) return false;
    node.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`missing browser button: ${text}`);
}

async function setInput(selector, value) {
  const changed = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!(node instanceof HTMLInputElement)) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!changed) throw new Error(`missing browser input: ${selector}`);
}

try {
  const stamp = Date.now().toString(36);
  identity = await api("POST", "/api/identities", { name: `Accounts${stamp}`, creator: true });
  check("disposable identity created", Boolean(identity?.id && identity?.secret));

  const versionResponse = await fetch(`${CDP}/json/version`);
  if (!versionResponse.ok) throw new Error(`CDP ${CDP} -> HTTP ${versionResponse.status}`);
  const tabResponse = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  if (!tabResponse.ok) throw new Error(`CDP could not create a tab (${tabResponse.status})`);
  tab = await tabResponse.json();
  ws = new WebSocket(localWebSocketUrl(tab.webSocketDebuggerUrl));
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
    } else if (message.method === "Network.requestWillBeSent") {
      const request = message.params?.request;
      if (request?.url?.includes("/api/accounts/")) {
        accountRequests.push({ method: request.method, url: request.url });
      }
    }
  });

  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", () => rejectOpen(new Error("CDP WebSocket error")), { once: true });
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Network.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 320,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  await navigate(`${ORIGIN}/?payment_accounts_e2e=${Date.now()}`);
  // Only the API response is injected. In particular, the harness does not
  // synthesize or print a secret, and no account data is put in the URL.
  await evaluate(`(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(identity))});
  })()`);
  await navigate(`${ORIGIN}/?payment_accounts_e2e=${Date.now()}#/settings`);
  check("React settings renders the account form", await waitFor("Boolean(document.querySelector('#account-brand'))"));

  await setInput("#account-brand", "BCA");
  await setInput("#account-no", "8123456789");
  await setInput("#account-holder", "Ayu");
  await clickText("Tambah metode bayar");
  check("added account renders in settings", await waitFor(`([...document.querySelectorAll(".payment-account")]).some(row => row.textContent?.includes("BCA") && row.textContent?.includes("8123456789"))`));

  const addedAccounts = await api("GET", `/api/identities/${encodeURIComponent(identity.id)}/accounts`, undefined, identity);
  accountId = Array.isArray(addedAccounts) && addedAccounts.length === 1 ? addedAccounts[0].id : null;
  check("HTTP account list contains the added account", Number.isSafeInteger(accountId));

  const controls = await evaluate(`({
    edit: Boolean(document.querySelector('button[aria-label^="Edit "]')),
    remove: Boolean(document.querySelector('button[aria-label^="Hapus "]')),
  })`);
  check("account row exposes accessible edit and delete controls", controls?.edit === true && controls?.remove === true);
  const mobileLayout = await evaluate(`(() => {
    const row = document.querySelector('.payment-account');
    const viewport = document.documentElement.clientWidth;
    const buttons = row ? [...row.querySelectorAll('button')] : [];
    return {
      noOverflow: document.documentElement.scrollWidth <= viewport,
      controlsFit: buttons.length > 0 && buttons.every(button => {
        const rect = button.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= viewport && rect.height >= 44;
      }),
    };
  })()`);
  check("account row stays usable at 320px", mobileLayout?.noOverflow === true && mobileLayout?.controlsFit === true);

  await click('button[aria-label^="Edit "]');
  check("edit dialog opens", await waitFor("Boolean(document.querySelector('#edit-account-form'))"));
  await setInput("#edit-account-brand", "Mandiri");
  await setInput("#edit-account-no", "9876543210");
  await setInput("#edit-account-holder", "Budi");
  await click("#save-edit-account");
  check("edited account renders updated values", await waitFor(`([...document.querySelectorAll(".payment-account")]).some(row => row.textContent?.includes("Mandiri") && row.textContent?.includes("9876543210"))`));
  check("edit uses one typed account update request", accountRequests.filter(request => request.method === "PUT").length === 1);

  await click('button[aria-label^="Hapus "]');
  const confirmation = await evaluate(`(() => {
    const dialog = document.querySelector('[role="dialog"]');
    const text = dialog?.textContent || "";
    return { open: Boolean(dialog), exactAccount: text.includes("Mandiri") && text.includes("9876543210") };
  })()`);
  check("delete confirmation names the exact account", confirmation?.open === true && confirmation?.exactAccount === true);
  await click("#confirm-delete-account");
  check("deleted account disappears from settings", await waitFor("![...document.querySelectorAll('.payment-account')].some(row => row.textContent?.includes('Mandiri'))"));
  check("delete uses one request while busy", accountRequests.filter(request => request.method === "DELETE").length === 1);

  const finalAccounts = await api("GET", `/api/identities/${encodeURIComponent(identity.id)}/accounts`, undefined, identity);
  check("HTTP account list is exactly empty after delete", Array.isArray(finalAccounts) && finalAccounts.length === 0);
  check("browser has no console or page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (error) {
  check("payment-account browser flow completed", false, error instanceof Error ? error.message : "unknown browser failure");
} finally {
  // Direct API cleanup is only a fallback for an interrupted browser flow;
  // successful deletion above leaves this list empty and performs no request.
  if (identity) {
    try {
      const remaining = await api("GET", `/api/identities/${encodeURIComponent(identity.id)}/accounts`, undefined, identity);
      if (Array.isArray(remaining)) {
        for (const account of remaining) {
          if (Number.isSafeInteger(account?.id)) {
            await api("DELETE", `/api/accounts/${encodeURIComponent(account.id)}`, undefined, identity).catch(() => undefined);
          }
        }
      }
    } catch {
      // The browser assertions remain the useful result if cleanup is offline.
    }
  }
  try { ws?.close(); } catch { /* noop */ }
  if (tab?.id) {
    await fetch(`${CDP}/json/close/${encodeURIComponent(tab.id)}`).catch(() => undefined);
  }
}

if (failures.length) {
  console.error(`${failures.length} payment-account check(s) failed`);
  process.exitCode = 1;
} else {
  console.log("payment-account browser regression passed");
}
