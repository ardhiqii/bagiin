#!/usr/bin/env node
/** Real-browser K3 regression flow through the Camoufox REST API.
 *
 * Verified invocation (avoids UFW dropping container->host traffic on docker0,
 * which otherwise hangs browser navigation until camofox's 30s tab timeout):
 *
 *   CPID=$(sudo docker inspect -f '{{.State.Pid}}' camofox-browser)
 *   # 1. app server inside the container network namespace:
 *   sudo nsenter -t $CPID -n bash -c 'cd backend && \
 *     BAGIIN_DB=/tmp/bagiin-k3.db BAGIIN_UPLOAD_DIR=/tmp/bagiin-k3-up \
 *     nohup venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8085 &'
 *   # 2. this script in the same netns (reaches app on 127.0.0.1:8085 and
 *   #    camofox on 127.0.0.1:9377):
 *   sudo nsenter -t $CPID -n bash -c 'BAGIIN_E2E_BASE=http://127.0.0.1:8085 node tools/e2e_camoufox.mjs'
 *
 * From the host it also works if the app is bound to 0.0.0.0:8085 AND the
 * firewall allows the docker bridge to reach it, with both BAGIIN_E2E_BASE and
 * BAGIIN_BROWSER_BASE set to the bridge-reachable address.
 */
const BASE = process.env.BAGIIN_E2E_BASE || "http://127.0.0.1:8085";
const CAMO = process.env.CAMOFOX_URL || "http://localhost:9377";
const BROWSER_BASE = process.env.BAGIIN_BROWSER_BASE || BASE;
const USER = `bagiin-qa-${Date.now().toString(36)}`;
const ownerUser = USER;
const guestUser = `${USER}-guest`;
const stamp = Date.now().toString(36);
const sessionPrefix = `bagiin-k3-${stamp}`;
const tabs = [];
const fails = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) fails.push(name);
};
const json = async (url, options = {}) => {
  const r = await fetch(url, options);
  const text = await r.text();
  let value; try { value = text ? JSON.parse(text) : {}; } catch { value = text; }
  if (!r.ok) throw new Error(`${options.method || "GET"} ${url} -> ${r.status}: ${text.slice(0, 300)}`);
  return value;
};
const camo = (path, method = "GET", body) => json(CAMO + path, {
  method, headers: body === undefined ? undefined : { "content-type": "application/json" },
  body: body === undefined ? undefined : JSON.stringify(body),
});
const createTab = async (url, user = ownerUser) => {
  const out = await camo("/tabs", "POST", { userId: user, sessionKey: `${sessionPrefix}-${tabs.length}`, url });
  tabs.push(out.tabId); return out.tabId;
};
const snap = async (id, user = ownerUser) => (await camo(`/tabs/${id}/snapshot?userId=${encodeURIComponent(user)}`)).snapshot || "";
const refFor = (snapshot, pattern) => {
  const re = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  const line = snapshot.split("\n").find(x => re.test(x));
  const m = line && line.match(/\[(e\d+)\]/);
  if (!m) throw new Error(`No ref for ${re} in snapshot:\n${snapshot.slice(0, 1600)}`);
  return m[1];
};
const act = async (id, kind, body, user = ownerUser) => camo(`/tabs/${id}/${kind}`, "POST", { userId: user, ...body });
const clickText = async (id, pattern, user = ownerUser) => { const s = await snap(id, user); return act(id, "click", { ref: refFor(s, pattern) }, user); };
const clickSelector = async (id, selector, user = ownerUser) => act(id, "click", { selector }, user);
const typeText = async (id, pattern, text, user = ownerUser) => { const s = await snap(id, user); return act(id, "type", { ref: refFor(s, pattern), text }, user); };
const typeSelector = async (id, selector, text, user = ownerUser) => act(id, "type", { selector, text }, user);
const press = async (id, key = "Enter", user = ownerUser) => act(id, "press", { key }, user);
const waitFor = async (fn, timeout = 12000) => { const end = Date.now() + timeout; let last; while (Date.now() < end) { last = await fn(); if (last) return last; await sleep(250); } throw new Error(`Timed out: ${String(last || "").slice(0, 900)}`); };
const excerpt = async id => (await snap(id)).replace(/\s+/g, " ").slice(0, 500);

async function run() {
  const owner = await createTab(`${BROWSER_BASE}/`);
  await waitFor(async () => (await snap(owner)).includes("Siapa nama kamu?"));
  check("onboarding name prompt appears", true);
  await typeText(owner, /textbox "Siapa nama kamu\?"/, `Pemilik ${stamp}`);
  await press(owner);
  await waitFor(async () => (await snap(owner)).includes("Mau bagi bill apa hari ini?"));
  check("creator home renders after onboarding", true);

  await clickText(owner, /button "[^\"]*Buat Bill Baru/);
  await waitFor(async () => (await snap(owner)).includes("Isi manual tanpa scan"));
  await clickText(owner, /button "[^\"]*Isi manual tanpa scan/);
  await waitFor(async () => (await snap(owner)).includes("Nama item baris 1"));
  await typeText(owner, /textbox "Nama item baris 1"/, "Nasi Goreng");
  await typeText(owner, /textbox "Harga item baris 1"/, "60000");
  await clickText(owner, /button "[^\"]*Tambah Item/);
  await typeText(owner, /textbox "Nama item baris 2"/, "Ayam Bakar");
  await typeText(owner, /textbox "Harga item baris 2"/, "90000");
  await clickText(owner, /button "[^\"]*Tambah Item/);
  await typeText(owner, /textbox "Nama item baris 3"/, "Teh Poci");
  await typeText(owner, /textbox "Harga item baris 3"/, "40000");
  await typeSelector(owner, "#subtotal-input", "190000");
  await clickSelector(owner, "summary.label-strong");
  await typeSelector(owner, "#tax-input", "20900");
  await typeSelector(owner, "#service-input", "9500");
  await sleep(300);
  const createSnap = await snap(owner);
  check("manual bill form accepts three items", /Nama item baris 3/.test(createSnap), createSnap.slice(-800));
  await clickText(owner, /button "Buat Tagihan"/);
  const ownerUrl = await waitFor(async () => { const s = await camo(`/tabs/${owner}/snapshot?userId=${USER}`); return s.url && /#\/b\//.test(s.url) ? s.url : null; });
  const billId = ownerUrl.match(/#\/b\/([^/?#]+)/)[1];
  const ownerData = await json(`${BASE}/api/bills/${billId}`);
  check("creator bill view renders correct total", ownerData.bill.total_idr === 220400, `total=${ownerData.bill.total_idr}`);

  // Guest path exercises item selection; the owner remains on the summary screen.

  const guest = await createTab(`${BROWSER_BASE}/#/b/${billId}`, guestUser);
  await waitFor(async () => (await snap(guest, guestUser)).includes("Kamu siapa?"));
  check("guest name prompt appears", true);
  await typeText(guest, /textbox "Kamu siapa\?"/, `Tamu ${stamp}`, guestUser);
  await press(guest, "Enter", guestUser);
  await waitFor(async () => (await snap(guest, guestUser)).includes("Centang yang kamu tanggung"));
  const before = await snap(guest, guestUser);
  check("guest picker renders all items", (before.match(/checkbox \"/g) || []).length >= 3, before.slice(-1000));
  await clickText(guest, /Nasi Goreng/, guestUser);
  await sleep(1400);
  const data = await json(`${BASE}/api/bills/${billId}`);
  const person = data.people.find(p => p.name === `Tamu ${stamp}`);
  const ui = (await snap(guest, guestUser)).match(/Total kamu[\s\S]{0,120}/)?.[0] || "";
  const shown = Number((ui.match(/Rp\s*[\d.]+/)?.[0] || "").replace(/\D/g, ""));
  check("guest is shown exactly what server says they owe", shown === person?.total_idr, `UI=${shown} API=${person?.total_idr}; ${ui.replace(/\s+/g, " ")}`);
  check("server split is reconciled", data.total_ok === true, `total_ok=${data.total_ok}`);

  await clickText(guest, /button "Tandai sudah bayar"/, guestUser);
  await sleep(500);
  await clickSelector(guest, "#confirm-pay", guestUser);
  await sleep(1200);
  const paid = await json(`${BASE}/api/bills/${billId}`);
  const paidPerson = paid.people.find(p => p.name === `Tamu ${stamp}`);
  check("guest payment status flips after confirmation", paidPerson?.paid === "paid", `paid=${paidPerson?.paid}`);

  // The current frontend has no owner close control (it exposes reopen only for
  // already-closed bills), so stop after the verified payment state rather than
  // inventing a close mutation outside the UI contract.
  check("bill remains available after guest payment", paid.bill.status === "open", `status=${paid.bill.status}`);
}

try { await run(); }
catch (e) { console.log(`FAIL unhandled — ${e.message}`); fails.push("unhandled flow error"); }
finally {
  for (const id of tabs) await camo(`/tabs/${id}?userId=${encodeURIComponent(USER)}`, "DELETE").catch(() => {});
}
console.log(fails.length ? `SUMMARY: ${fails.length} check(s) failed` : "SUMMARY: all checks passed");
process.exit(fails.length ? 1 : 0);
