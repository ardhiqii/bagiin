#!/usr/bin/env node
/**
 * Browser check for the bug class that keeps coming back in this app: two
 * contradicting statements about the same bill, one scroll apart.
 *
 * A bill the owner declares lunas by hand ("Tandai Lunas Semua", v60) does NOT
 * touch anyone's payment row — that is deliberate (see test_regressions_v60).
 * So every screen has to read `settled_manual`, or the manager sees a green
 * "Lunas" header above rows still offering "Tandai Lunas", and the guest who
 * never paid is told to pay a bill everyone considers done.
 *
 * Requirements: Node >= 22 (built-in WebSocket + fetch), a Chrome started with
 * --remote-debugging-port=9222, and a Bagiin server on a throwaway BAGIIN_DB.
 *
 *   cd backend
 *   BAGIIN_DB=/tmp/e2e.db BAGIIN_UPLOAD_DIR=/tmp/e2e-uploads \
 *     venv/bin/python -m uvicorn main:app --port 8099 &
 *   node ../tools/e2e_settled.mjs [http://127.0.0.1:8099] [http://127.0.0.1:9222]
 */

const ORIGIN = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9222";

const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// ---------- seed: a bill with a guest who never paid ----------
const stamp = Date.now().toString(36);
const host = await call("POST", "/api/identities", { name: "Host" + stamp, creator: true });
const guest = await call("POST", "/api/identities", { name: "Tamu" + stamp });
const items = [{ name: "Nasi Goreng", price: 60000 }, { name: "Es Teh", price: 15000 }];
const subtotal = 75000, tax = 8250;
const bill = await call("POST", "/api/bills", {
  title: "Settle " + stamp, items, subtotal, tax, service: 0, total: subtotal + tax,
}, host);
const ids = (await call("GET", `/api/bills/${bill.id}`, undefined, host)).items.map(i => i.id);
await call("POST", `/api/bills/${bill.id}/join`, {}, guest);
await call("POST", `/api/bills/${bill.id}/selections`, { picks: [{ item_id: ids[0], qty: 1 }] }, guest);

const before = await call("GET", `/api/bills/${bill.id}`, undefined, host);
check("a bill with an unpaid guest is not settled on its own", before.settled === false);

// the owner declares it done (cash settled outside the app)
await call("POST", `/api/bills/${bill.id}/settle`, {}, host);
const after = await call("GET", `/api/bills/${bill.id}`, undefined, host);
check("manual settle settles the bill", after.settled === true && after.settled_manual === true);
const guestRow = after.people.find(p => p.identity_id === guest.id);
check("but the payment record stays honest", guestRow.paid === "unpaid", guestRow.paid);

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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result?.value;
};
const signIn = (who) => evaluate(`localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(who))})`);
const go = async (hash) => {
  await send("Page.navigate", { url: `${ORIGIN}/?r=${Date.now()}${hash}` });
  await sleep(1600);
};

try {
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await send("Page.navigate", { url: ORIGIN });
  await sleep(600);

  await signIn(host);
  await go("#/b/" + bill.id);
  const owner = await evaluate(`({
    chip: (document.querySelector('.chip') || {}).textContent || '',
    rows: [...document.querySelectorAll('.toggle-paid')].map(b => b.textContent.trim()),
    dock: (document.querySelector('.dock') || {}).textContent || '',
    owed: document.body.textContent.includes('belum dibayar'),
  })`);
  check("manager header says lunas", /[Ll]unas/.test(owner.chip), owner.chip.trim());
  check("no person row still offers 'Tandai Lunas'",
        owner.rows.every(t => !/^Tandai/.test(t)), JSON.stringify(owner.rows));
  check("the dock does not say 'belum beres'", !/[Bb]elum beres/.test(owner.dock),
        owner.dock.replace(/\s+/g, " ").trim().slice(0, 60));
  check("nothing on the page still claims money is owed", owner.owed === false);

  await signIn(guest);
  await go("#/b/" + bill.id);
  const view = await evaluate(`({
    chip: (document.querySelector('.chip') || {}).textContent || '',
    cta: (document.querySelector('#pay-btn') || {}).textContent || '',
  })`);
  check("the guest who never paid is not asked to pay", !/Tandai Udah Bayar/.test(view.cta),
        view.cta.trim() || "(no pay button)");
  check("the guest sees the same status as the manager", /[Ll]unas/.test(view.chip), view.chip.trim());

  await go("#/history");
  const row = await evaluate(`[...document.querySelectorAll('.history-row')]
    .map(r => r.textContent.replace(/\\s+/g, ' ').trim())
    .find(t => t.includes("Settle ${stamp}")) || ''`);
  check("the list row agrees too", /Lunas/.test(row) && !/Belum/.test(row), row.slice(0, 80));
  check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {});
  ws.close();
}

console.log(fails.length ? `\n${fails.length} FAILED` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
