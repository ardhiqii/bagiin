#!/usr/bin/env node
/**
 * Browser smoke test for the guest picker — the one flow where a wrong number
 * costs someone real money.
 *
 * It seeds a bill through the API, drives the real UI in Chrome, and asserts
 * that the total the guest is shown equals the total the server computes for
 * them. That equality is the regression this guards: the frontend used to
 * re-implement the split in JS and told guests to transfer Rp 145.000 when
 * they owed Rp 122.500.
 *
 * Requirements: Node >= 22 (built-in WebSocket + fetch), a Chrome started with
 * --remote-debugging-port=9222, and a Bagiin server. Nothing to install.
 *
 *   cd backend
 *   BAGIIN_DB=/tmp/e2e.db BAGIIN_UPLOAD_DIR=/tmp/e2e-uploads \
 *     venv/bin/python -m uvicorn main:app --port 8099 &
 *   node ../tools/e2e_smoke.mjs [http://127.0.0.1:8099] [http://127.0.0.1:9222]
 *
 * Point it at a throwaway BAGIIN_DB — it creates identities and bills.
 */

const ORIGIN = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9222";

const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- seed through the API ----------
async function call(method, path, body, ident) {
  const headers = { "Content-Type": "application/json" };
  if (ident) {
    headers["X-Identity-Id"] = ident.id;
    if (ident.secret) headers["X-Identity-Secret"] = ident.secret;
  }
  const res = await fetch(ORIGIN + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.json();
}

const stamp = Date.now().toString(36);
const host = await call("POST", "/api/identities", { name: "Host" + stamp, creator: true });
const guest = await call("POST", "/api/identities", { name: "Tamu" + stamp });

// two free items and one 4-slot item, plus tax and service, so the guest's
// share exercises the proportional tax path AND the uncovered-slot path
const items = [
  { name: "Nasi Goreng", price: 60000 },
  { name: "Ayam Bakar", price: 90000 },
  { name: "Teh Poci", price: 40000, mode: "slot", slot_count: 4 },
];
const subtotal = 190000, tax = 20900, service = 9500;
const bill = await call("POST", "/api/bills", {
  title: "E2E " + stamp, items, subtotal, tax, service,
  total: subtotal + tax + service,
}, host);
await call("POST", `/api/bills/${bill.id}/join`, {}, guest);

// ---------- drive the browser ----------
const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let msgId = 0; const pending = new Map(); const pageErrors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const p = pending.get(m.id); pending.delete(m.id);
    m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
  } else if (m.method === "Runtime.exceptionThrown") {
    pageErrors.push(m.params?.exceptionDetails?.exception?.description
                 || m.params?.exceptionDetails?.text);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++msgId; pending.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return r.result?.value;
};
const openBill = async () => {
  await send("Page.navigate", { url: `${ORIGIN}/?r=${Date.now()}#/b/${bill.id}` });
  await sleep(1500);
};
const picker = () => evaluate(`(() => {
  const rows = [...document.querySelectorAll('#pick-items .item-row')];
  return { rows: rows.length,
           selected: rows.filter(r => r.classList.contains('selected')).length,
           total: document.querySelector('#my-total')?.textContent || '' };
})()`);

try {
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });

  // sign in as the guest, then open the shared bill
  await send("Page.navigate", { url: ORIGIN });
  await sleep(600);
  await evaluate(`localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(guest))})`);
  await openBill();

  const start = await picker();
  check("bill screen renders every item", start.rows === items.length, `${start.rows} rows`);
  check("guest starts with nothing picked", start.selected === 0);

  // pick a free item, then take one slot of the shared pot
  await evaluate(`[...document.querySelectorAll('#pick-items .item-row')][0].click()`);
  await sleep(1200);
  const afterFree = await picker();
  check("tapping a free item selects it", afterFree.selected === 1, `selected=${afterFree.selected}`);
  check("dock total reacts to the pick", /[1-9]/.test(afterFree.total), afterFree.total);

  // the headline number must equal the server's own figure for this person
  const server = await evaluate(`fetch("/api/bills/${bill.id}", {
    headers: { "X-Identity-Id": ${JSON.stringify(guest.id)},
               "X-Identity-Secret": ${JSON.stringify(guest.secret)} }
  }).then(r => r.json()).then(d => {
    const me = d.people.find(p => p.identity_id === ${JSON.stringify(guest.id)});
    return { total: me ? me.total_idr : -1, ok: d.total_ok, uncovered: d.uncovered_idr };
  })`);
  const shown = parseInt(String(afterFree.total).replace(/\D/g, ""), 10);
  check("guest is shown exactly what they owe", shown === server.total,
        `UI ${shown} vs API ${server.total}`);
  check("split reconciles with unpicked items in the tax base", server.ok === true);
  check("unclaimed slots stay uncovered, not silently assigned",
        server.uncovered === 40000, `uncovered=${server.uncovered}`);

  // a pick has to survive a reload — an optimistic-only update is a lost tap
  await openBill();
  const reloaded = await picker();
  check("pick persisted across a reload", reloaded.selected === 1,
        `selected=${reloaded.selected}`);
  check("total is stable across a reload", reloaded.total === afterFree.total,
        `${afterFree.total} -> ${reloaded.total}`);

  check("no uncaught page errors", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
} finally {
  ws.close();
  await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {});
}

console.log(fails.length ? `\n${fails.length} check(s) FAILED` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
