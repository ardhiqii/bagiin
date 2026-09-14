#!/usr/bin/env node
/**
 * Browser regression for restoring a pre-v51 identity without treating its
 * public id as an authenticated session.
 *
 * Requirements: Node >= 22, a Bagiin server using a throwaway BAGIIN_DB, and
 * Chrome on --remote-debugging-port=9222.
 *
 *   cd backend
 *   BAGIIN_DB=/tmp/legacy-recovery.db BAGIIN_UPLOAD_DIR=/tmp/legacy-recovery-up \
 *     venv/bin/python -m uvicorn main:app --port 8099 &
 *   cd ..
 *   node tools/e2e_legacy_recovery.mjs \
 *     http://127.0.0.1:8099 http://127.0.0.1:9222 /tmp/legacy-recovery.db
 *
 * The third argument is optional when BAGIIN_DB is exported. The script only
 * prints check names and safe statuses; the recovery code and identity secrets
 * never appear in output.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
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

const ORIGIN = localHttpUrl(process.argv[2] || "http://127.0.0.1:8099", "BASE_URL");
const CDP = localHttpUrl(process.argv[3] || "http://127.0.0.1:9222", "CDP_URL");
const DB_PATH = process.argv[4] || process.env.BAGIIN_DB || "";
const failures = [];
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const seedSource = `
import hashlib
import sqlite3
import sys

path, identity_id, name = sys.argv[1:4]
code = sys.stdin.read().strip()
if not code:
    raise SystemExit(2)
connection = sqlite3.connect(path, timeout=10)
try:
    columns = {row[1] for row in connection.execute("PRAGMA table_info(identity)")}
    required = {"id", "name", "role", "identity_code_hash", "secret"}
    if not required.issubset(columns):
        raise SystemExit(3)
    identity_code_hash = hashlib.sha256(("bagiin:" + code).encode()).hexdigest()
    connection.execute(
        "INSERT INTO identity (id, name, role, identity_code_hash, secret) VALUES (?, ?, ?, ?, NULL)",
        (identity_id, name, "guest", identity_code_hash),
    )
    connection.commit()
finally:
    connection.close()
`;

let temporaryDirectory = null;
let host = null;
let bill = null;
let tab = null;
let ws = null;
let cleanupFailed = false;
let send;
let evaluate;
let waitFor;
let navigate;

const stamp = `${Date.now().toString(36)}-${process.pid}`;
const legacy = { id: `legacy-${stamp}`, name: `Legacy ${stamp}` };
const recoveryCode = `legacy-${stamp}-recovery`;

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
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

function seedLegacyIdentity() {
  if (!DB_PATH) throw new Error("BAGIIN_DB or a third database-path argument is required");
  temporaryDirectory = mkdtempSync(join(tmpdir(), "bagiin-legacy-recovery-"));
  const seedPath = join(temporaryDirectory, "seed.py");
  writeFileSync(seedPath, seedSource, "utf8");
  const result = spawnSync(
    process.env.PYTHON || "python3",
    [seedPath, resolve(DB_PATH), legacy.id, legacy.name],
    { input: recoveryCode, encoding: "utf8", stdio: ["pipe", "ignore", "ignore"] },
  );
  if (result.error || result.status !== 0) throw new Error("legacy identity seed failed");
}

async function cleanupBill() {
  if (!bill?.id || !host) return;
  try {
    await api("DELETE", `/api/bills/${encodeURIComponent(bill.id)}`, undefined, host);
    const response = await fetch(`${ORIGIN}/api/bills/${encodeURIComponent(bill.id)}`);
    if (response.status !== 404) cleanupFailed = true;
  } catch {
    cleanupFailed = true;
  }
}

try {
  // Let the server initialize the throwaway database before the raw legacy row
  // is inserted, then create one disposable public bill for the guest check.
  host = await api("POST", "/api/identities", { name: `Recovery host ${stamp}`, creator: true });
  seedLegacyIdentity();
  bill = await api("POST", "/api/bills", {
    title: `Legacy recovery ${stamp}`,
    items: [{ name: "Recovery item", price: 1000 }],
    subtotal: 1000,
    tax: 0,
    service: 0,
    total: 1000,
    tax_included: false,
  }, host);
  check("temporary public bill seeded", Boolean(bill?.id));

  const versionResponse = await fetch(`${CDP}/json/version`);
  if (!versionResponse.ok) throw new Error(`CDP ${CDP} -> ${versionResponse.status}`);
  const tabResponse = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  if (!tabResponse.ok) throw new Error(`CDP could not create a tab (${tabResponse.status})`);
  tab = await tabResponse.json();
  if (!tab.webSocketDebuggerUrl) throw new Error("CDP tab did not provide a WebSocket URL");
  const debuggerUrl = new URL(tab.webSocketDebuggerUrl);
  if (![
    "ws:",
    "wss:",
  ].includes(debuggerUrl.protocol) || !LOCAL_HOSTS.has(normalizeHost(debuggerUrl.hostname))) {
    throw new Error("CDP advertised a non-local WebSocket debugger URL");
  }
  ws = new WebSocket(debuggerUrl.href);

  let messageId = 0;
  const pending = new Map();
  const pageErrors = [];
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
    const result = new Promise((resolveResult, rejectResult) => {
      pending.set(id, { resolve: resolveResult, reject: rejectResult });
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
  waitFor = async (expression, timeout = 8000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        // The page can be between document contexts during navigation.
      }
      await sleep(60);
    }
    return false;
  };
  navigate = async hash => {
    const url = `${ORIGIN}/?legacy_recovery_e2e=${Date.now()}${hash}`;
    await send("Page.navigate", { url });
    if (!await waitFor("document.readyState === 'complete'")) {
      throw new Error(`navigation timed out for ${hash}`);
    }
    await sleep(160);
  };

  await new Promise((resolveOpen, rejectOpen) => {
    ws.addEventListener("open", resolveOpen, { once: true });
    ws.addEventListener("error", () => rejectOpen(new Error("CDP WebSocket error")), { once: true });
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
  });

  // Start from a clean origin. The test tab can be reused after another suite;
  // otherwise a stale identity briefly paints HomeRoute and its expected legacy
  // 404 becomes a misleading browser console error.
  const bootstrapReset = await send("Page.addScriptToEvaluateOnNewDocument", { source: "try { localStorage.clear(); sessionStorage.clear(); } catch {}" });
  await navigate("#/");
  await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: bootstrapReset.identifier });
  await evaluate(`(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(legacy))});
  })()`);

  await navigate("#/settings");
  check("legacy private hash shows recovery onboarding", await waitFor("Boolean(document.querySelector('#restore-box'))"));
  const privateState = await evaluate(`(() => ({
    hash: location.hash,
    onboarding: Boolean(document.querySelector('#onboard-form')),
    restore: Boolean(document.querySelector('#restore-box')),
    recoveryExpanded: document.querySelector('#restore-link')?.getAttribute('aria-expanded') || '',
    name: document.querySelector('#name-input')?.value || '',
    authenticatedHome: Boolean(document.querySelector('#create-btn')),
  }))()`);
  check("legacy private hash canonicalizes to home", privateState.hash === "#/", privateState.hash);
  check("legacy recovery is open with the old name", privateState.restore
    && privateState.recoveryExpanded === "true"
    && privateState.name === legacy.name,
    JSON.stringify({ restore: privateState.restore, expanded: privateState.recoveryExpanded, name: privateState.name }));
  check("legacy identity is not shown an authenticated screen", privateState.onboarding && !privateState.authenticatedHome);

  const publicHash = `#/b/${bill.id}`;
  await navigate(publicHash);
  check("unbound legacy public hash stays readable as guest entry", await waitFor("Boolean(document.querySelector('#guest-form'))"));
  const publicState = await evaluate(`(() => {
    const stored = JSON.parse(localStorage.getItem('bagiin_identity') || 'null');
    return {
      hash: location.hash,
      guestForm: Boolean(document.querySelector('#guest-form')),
      picker: Boolean(document.querySelector('#pick-items')),
      hasSecret: typeof stored?.secret === 'string' && stored.secret.trim().length > 0,
    };
  })()`);
  check("public bill hash is preserved before recovery", publicState.hash === publicHash, publicState.hash);
  check("unbound legacy id is not auto-joined", publicState.guestForm && !publicState.picker && !publicState.hasSecret);
  const publicBeforeRecovery = await api("GET", `/api/bills/${encodeURIComponent(bill.id)}`, undefined, host);
  check("public read does not add the legacy identity to the bill", !publicBeforeRecovery.people.some(person => person.identity_id === legacy.id));

  await navigate("#/settings");
  check("recovery form is available again", await waitFor("Boolean(document.querySelector('#restore-code'))"));
  await evaluate(`(() => {
    const input = document.querySelector('#restore-code');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (!input || !setter) return false;
    setter.call(input, ${JSON.stringify(recoveryCode)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#restore-btn')?.click();
    return true;
  })()`);
  check("valid recovery reaches authenticated home", await waitFor("location.hash === '#/' && !!document.querySelector('#create-btn') && !document.querySelector('#onboard-form')", 10000));
  const restored = await evaluate(`(() => {
    const stored = JSON.parse(localStorage.getItem('bagiin_identity') || 'null');
    return {
      hash: location.hash,
      home: Boolean(document.querySelector('#create-btn')),
      hasSecret: typeof stored?.secret === 'string' && stored.secret.trim().length > 0,
      onlyExpectedIdentityShape: Boolean(stored && stored.id && stored.name && !Object.prototype.hasOwnProperty.call(stored, 'code')),
      idMatches: stored?.id === ${JSON.stringify(legacy.id)},
    };
  })()`);
  check("restore persists the normalized bound identity", restored.home && restored.hasSecret
    && restored.onlyExpectedIdentityShape && restored.idMatches,
    JSON.stringify({ home: restored.home, hasSecret: restored.hasSecret, idMatches: restored.idMatches }));

  const protectedResult = await evaluate(`(async () => {
    const stored = JSON.parse(localStorage.getItem('bagiin_identity') || 'null');
    if (!stored?.id || !stored?.secret) return { read: 0, write: 0 };
    const headers = { 'X-Identity-Id': stored.id, 'X-Identity-Secret': stored.secret };
    const read = await fetch('/api/identities/' + encodeURIComponent(stored.id) + '/bills', { headers });
    const write = await fetch('/api/identities/' + encodeURIComponent(stored.id) + '/name', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: stored.name }),
    });
    return { read: read.status, write: write.status };
  })()`);
  check("restored identity can use protected reads and writes", protectedResult.read === 200 && protectedResult.write === 200, JSON.stringify(protectedResult));
  check("no uncaught browser console errors", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
} finally {
  await cleanupBill();
  if (ws) ws.close();
  if (tab?.id) await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {});
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
}

if (cleanupFailed) {
  console.error("ERROR: disposable bill fixture cleanup failed");
  process.exitCode = 1;
}
if (failures.length) {
  console.error(`\n${failures.length} check(s) FAILED`);
  process.exitCode = 1;
} else if (!process.exitCode) {
  console.log("\nall legacy recovery checks passed");
}
