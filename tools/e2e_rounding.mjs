#!/usr/bin/env node
/**
 * The dock's local estimate must equal the server's own figure TO THE RUPIAH,
 * including the rounding remainder calc.py distributes.
 *
 * bill.js recomputes the viewer's share in JS so the dock can react to a tap
 * before the response lands. That mirror drifted by a rupiah for years: calc.py
 * spreads `eff - share*total_qty` round-robin across selectors (and
 * `eff - per_slot*slot_count` across slot units), while the JS used a bare
 * floor(). The number visibly ticked when the server answered.
 *
 * Every price here is chosen NOT to divide evenly. Checks the number both
 * optimistically (right after the tap) and after the payload lands.
 *
 *   cd backend
 *   BAGIIN_DB=/tmp/e2e.db BAGIIN_UPLOAD_DIR=/tmp/e2e-uploads \
 *     venv/bin/python -m uvicorn main:app --port 8099 &
 *   node ../tools/e2e_rounding.mjs [http://127.0.0.1:8099] [http://127.0.0.1:9222]
 */
const ORIGIN = process.argv[2] || "http://127.0.0.1:8099", CDP = "http://127.0.0.1:9222";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fails = []; const check = (n, ok, d="") => { console.log(`${ok?"  ok  ":" FAIL "} ${n}${d?" — "+d:""}`); if(!ok) fails.push(n); };
async function call(m, p, b, i) {
  const h = { "Content-Type": "application/json" };
  if (i) { h["X-Identity-Id"] = i.id; if (i.secret) h["X-Identity-Secret"] = i.secret; }
  const r = await fetch(ORIGIN + p, { method: m, headers: h, body: b === undefined ? undefined : JSON.stringify(b) });
  if (!r.ok) throw new Error(`${m} ${p} -> ${r.status} ${await r.text()}`);
  return r.json();
}
const stamp = Date.now().toString(36);
const host = await call("POST", "/api/identities", { name: "H" + stamp, creator: true }, null);
const me   = await call("POST", "/api/identities", { name: "Me" + stamp }, null);
const o1   = await call("POST", "/api/identities", { name: "O1" + stamp }, null);
const o2   = await call("POST", "/api/identities", { name: "O2" + stamp }, null);
// none of these divide evenly: 10.000/3, 55.000/4 slots, 28.001-5.000 over 3
const items = [
  { name: "Es Teh", price: 10000 },                                  // 3-way free split
  { name: "Sate", price: 55000, mode: "slot", slot_count: 4 },        // 4 slots, 55000/4 = 13750 r0 -> use 55001 below
  { name: "Kangkung", price: 28001, discount: 5000 },                 // effective 23001 over 3
  { name: "Kopi", price: 55001, mode: "slot", slot_count: 4 },        // 55001/4 = 13750 r1
];
const subtotal = items.reduce((s, i) => s + i.price - (i.discount || 0), 0);
const tax = 9137, service = 4111;                                    // odd on purpose
const bill = await call("POST", "/api/bills", { title: "Rem " + stamp, items,
  subtotal, tax, service, total: subtotal + tax + service }, host);
const ids = (await call("GET", `/api/bills/${bill.id}`, undefined, host)).items.map(i => i.id);
for (const who of [me, o1, o2]) await call("POST", `/api/bills/${bill.id}/join`, {}, who);
// two other people take shares so remainders actually have to be distributed
await call("POST", `/api/bills/${bill.id}/selections`, { picks: [
  { item_id: ids[0], qty: 1 }, { item_id: ids[2], qty: 1 }, { item_id: ids[1], qty: 2 }, { item_id: ids[3], qty: 1 }] }, o1);
await call("POST", `/api/bills/${bill.id}/selections`, { picks: [
  { item_id: ids[0], qty: 1 }, { item_id: ids[2], qty: 1 }, { item_id: ids[3], qty: 1 }] }, o2);

const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let n = 0; const pend = new Map(); const errs = [];
ws.addEventListener("message", e => { const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
  else if (m.method === "Runtime.exceptionThrown") errs.push(m.params?.exceptionDetails?.text); });
const send = (m2, p={}) => new Promise((res, rej) => { const i = ++n; pend.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method: m2, params: p })); });
const ev = async e2 => { const r = await send("Runtime.evaluate", { expression: e2, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result?.value; };
try {
  await new Promise(r => ws.addEventListener("open", r, { once: true }));
  await send("Page.enable"); await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Page.navigate", { url: ORIGIN }); await sleep(700);
  await ev(`localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(me))})`);
  await send("Page.navigate", { url: `${ORIGIN}/?r=${Date.now()}#/b/${bill.id}` }); await sleep(1800);

  const dock = () => ev(`parseInt(((document.querySelector('#my-total')||{}).textContent||'').replace(/\\D/g,''),10) || 0`);
  const server = () => ev(`fetch("/api/bills/${bill.id}", { headers: { "X-Identity-Id": ${JSON.stringify(me.id)}, "X-Identity-Secret": ${JSON.stringify(me.secret)} } })
     .then(r=>r.json()).then(d => { const p = d.people.find(x=>x.identity_id===${JSON.stringify(me.id)}); return p ? p.total_idr : -1; })`);
  const rows = () => ev(`[...document.querySelectorAll('#pick-items .item-row')].length`);
  console.log("item rows:", await rows());
  const taps = [
    ["free 10.000 dibagi 3", 0],
    ["item diskon 23.001 dibagi 3", 2],
    ["slot 55.001 / 4 (sisa 1 rupiah)", 3],
    ["slot 55.000 / 4", 1],
  ];
  for (const [label, idx] of taps) {
    await ev(`[...document.querySelectorAll('#pick-items .item-row')][${idx}].click()`);
    await sleep(250);
    const optimistic = await dock();          // BEFORE the response lands
    await sleep(1400);
    const settled = await dock();             // AFTER
    const srv = await server();
    check(`estimasi == server: ${label}`, optimistic === srv && settled === srv,
          `tap=${optimistic} setelah=${settled} server=${srv}`);
  }
  check("no page errors", errs.length === 0, errs.join(" | "));
} finally { await fetch(`${CDP}/json/close/${tab.id}`).catch(()=>{}); ws.close(); }
console.log(fails.length ? `\n${fails.length} FAILED` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
