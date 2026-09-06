#!/usr/bin/env node
/**
 * Browser regression for Rekap Patungan.
 *
 * It creates a final closed bill and an unresolved open bill on a throwaway
 * server, then drives the real page in Chromium. The browser checks the route,
 * API-to-UI money mapping, exact bill links, separated workflow sections,
 * device-local aliases, truthful empty/error/retry states, and geometry at the
 * supported viewport widths.
 *
 * Requirements: Node >= 22, Chrome on --remote-debugging-port=9222, and a
 * server using a throwaway BAGIIN_DB.
 *
 *   cd backend
 *   BAGIIN_DB=/tmp/recap-browser.db BAGIIN_UPLOAD_DIR=/tmp/recap-browser-up \
 *     venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8099 &
 *   cd ..
 *   node tools/e2e_recap.mjs http://127.0.0.1:8099 http://127.0.0.1:9222
 */

const ORIGIN = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9222";

const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` - ${detail}` : ""}`);
  if (!ok) fails.push(name);
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function call(method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) {
    headers["X-Identity-Id"] = identity.id;
    if (identity.secret) headers["X-Identity-Secret"] = identity.secret;
  }
  const response = await fetch(ORIGIN + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function recapPayload(identity) {
  return {
    identity: { id: identity.id, name: identity.name },
    final: { payable_idr: 0, receivable_idr: 0, net_idr: 0, counterparties: [], bill_count: 0 },
    provisional: { bill_count: 0, payable_idr: 0, receivable_idr: 0, bills: [] },
    actions: { current_user: [], waiting_other: [] },
    counts: { current_user: 0, waiting_other: 0, provisional_bills: 0 },
  };
}

// ---------- seed a final bill and a pending bill ----------
const stamp = Date.now().toString(36);
const host = await call("POST", "/api/identities", { name: `RekapHost${stamp}` });
const guest = await call("POST", "/api/identities", { name: `RekapGuest${stamp}` });

const finalBill = await call("POST", "/api/bills", {
  title: `Rekap final ${stamp}`,
  items: [{ name: "Makan bersama", price: 100000 }],
  subtotal: 100000,
  tax: 0,
  service: 0,
  total: 100000,
  participants: [guest.name],
}, host);
const finalDetail = await call("GET", `/api/bills/${finalBill.id}`, undefined, host);
const finalItemId = finalDetail.items[0].id;
await call("POST", `/api/bills/${finalBill.id}/join`, {}, guest);
await call("POST", `/api/bills/${finalBill.id}/selections`, {
  picks: [{ item_id: finalItemId, qty: 1 }],
}, guest);
await call("POST", `/api/bills/${finalBill.id}/close`, undefined, host);

const pendingBill = await call("POST", "/api/bills", {
  title: `Rekap menunggu ${stamp}`,
  items: [{ name: "Kopi bersama", price: 60000 }],
  subtotal: 60000,
  tax: 0,
  service: 0,
  total: 60000,
  participants: [guest.name],
}, host);
await call("POST", `/api/bills/${pendingBill.id}/join`, {}, guest);

// ---------- Chromium CDP helpers ----------
const tab = await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let messageId = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const item = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) item.reject(new Error(JSON.stringify(message.error)));
    else item.resolve(message.result);
    return;
  }
  if (message.method === "Runtime.exceptionThrown") {
    pageErrors.push(message.params?.exceptionDetails?.exception?.description
      || message.params?.exceptionDetails?.text || "Runtime exception");
  }
  if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
    pageErrors.push(message.params.args?.map(arg => arg.value || arg.description).join(" ") || "Console error");
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++messageId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result?.value;
};
const waitFor = async (expression, timeout = 7000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return true;
    await sleep(80);
  }
  return false;
};
const go = async (hash) => {
  await send("Page.navigate", { url: `${ORIGIN}/?recap_e2e=${Date.now()}${hash}` });
  const ready = await waitFor("document.readyState === 'complete'");
  if (!ready) throw new Error(`Timed out navigating to ${hash}`);
  await sleep(180);
};
const signIn = async (identity) => {
  await evaluate(`localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(identity))})`);
  await evaluate(`localStorage.setItem("bagiin_name", ${JSON.stringify(JSON.stringify(identity.name))})`);
};
const setViewport = async (width) => {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  await sleep(80);
};

try {
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  await send("Page.enable");
  await send("Runtime.enable");
  await setViewport(390);
  await send("Page.navigate", { url: ORIGIN });
  await waitFor("document.readyState === 'complete'");
  await signIn(host);
  await go("#/");

  check("home exposes Rekap Patungan navigation", await waitFor("!!document.querySelector('#recap-btn')"));
  await evaluate("document.querySelector('#recap-btn').click()");
  check("home navigation reaches canonical recap route", await waitFor("location.hash === '#/recap'"), await evaluate("location.hash"));
  check("recap loading skeleton exists before the response", await evaluate("!!document.querySelector('.recap-loading')"));
  check("recap response renders", await waitFor("!!document.querySelector('#recap-title')"));

  const mapped = await evaluate(`(() => ({
    payable: document.querySelector('.recap-money-pay .recap-money-value')?.textContent.trim() || '',
    receivable: document.querySelector('.recap-money-receive .recap-money-value')?.textContent.trim() || '',
    netLabel: document.querySelector('.recap-net-line b')?.textContent.trim() || '',
    sharedName: document.querySelector('.recap-person-name')?.textContent.trim() || '',
    direction: document.querySelector('.recap-person-direction')?.textContent.trim() || '',
    pendingCount: document.querySelector('.recap-person-pending-count')?.textContent.trim() || '',
    pendingCurrent: document.querySelector('.recap-pending-current')?.textContent.trim() || '',
    pendingWaiting: document.querySelector('.recap-pending-waiting')?.textContent.trim() || '',
    finalLinks: [...document.querySelectorAll('.recap-person-card a.recap-bill-link')].map(a => a.getAttribute('href')),
    provisionalLinks: [...document.querySelectorAll('.recap-provisional-row a.recap-bill-link')].map(a => a.getAttribute('href')),
    currentLinks: [...document.querySelectorAll('.recap-current-card a.recap-bill-link')].map(a => a.getAttribute('href')),
    waitingLinks: [...document.querySelectorAll('.recap-waiting-card a.recap-bill-link')].map(a => a.getAttribute('href')),
    currentRows: document.querySelectorAll('.recap-current-card .recap-action-row').length,
    waitingRows: document.querySelectorAll('.recap-waiting-card .recap-action-row').length,
    provisionalRows: document.querySelectorAll('.recap-provisional-row').length,
  }))()`);
  check("final payable stays separate from receivable", mapped.payable === "Rp 0" && mapped.receivable === "Rp 100.000",
    `${mapped.payable} / ${mapped.receivable}`);
  check("final net has an explicit label", mapped.netLabel === "Saldo bersih", mapped.netLabel);
  check("counterparty name and direction map from the API", mapped.sharedName === guest.name
    && mapped.direction.includes(`${guest.name} perlu bayar kamu`), `${mapped.sharedName} / ${mapped.direction}`);
  const pendingAria = await evaluate("document.querySelector('.recap-person-pending')?.getAttribute('aria-label') || ''");
  check("same counterparty card shows matched pending action counts", mapped.pendingCount === "1 hal perlu tindakan · 1 bill"
    && mapped.pendingCurrent === "0 dari kamu"
    && mapped.pendingWaiting === "1 menunggu orang lain"
    && pendingAria.includes("1 hal perlu tindakan")
    && pendingAria.includes("0 dari kamu")
    && pendingAria.includes("1 menunggu orang lain")
    && mapped.receivable === "Rp 100.000",
    `${mapped.pendingCount} / ${mapped.pendingCurrent} / ${mapped.pendingWaiting} / ${pendingAria}`);
  check("final drilldown links to the exact bill", mapped.finalLinks.includes(`#/b/${finalBill.id}`), JSON.stringify(mapped.finalLinks));
  check("provisional bill is visible with an exact bill link", mapped.provisionalRows === 1
    && mapped.provisionalLinks.includes(`#/b/${pendingBill.id}`), JSON.stringify(mapped.provisionalLinks));
  check("current and waiting actions stay in separate sections", mapped.currentRows === 0
    && mapped.waitingRows >= 1 && mapped.waitingLinks.includes(`#/b/${pendingBill.id}`),
    `${mapped.currentRows} current / ${mapped.waitingRows} waiting`);

  await evaluate("document.querySelector('#recap-back').click()");
  check("recap Back returns home", await waitFor("location.hash === '#/'")
    && await evaluate("!!document.querySelector('#create-btn')"));
  await evaluate("document.querySelector('#recap-btn').click()");
  await waitFor("!!document.querySelector('#recap-title')");

  // Error state is tested with a temporary page-local fetch failure. No fake
  // totals may appear while the recap request is unavailable.
  await evaluate(`(() => {
    window.__recapRealFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(input?.url || input || '');
      if (url.includes('/recap')) return Promise.reject(new Error('Uji koneksi gagal'));
      return window.__recapRealFetch(input, init);
    };
    renderRecap();
  })()`);
  check("API error shows a truthful retry state", await waitFor("!!document.querySelector('#recap-retry')")
    && await evaluate("!document.querySelector('.recap-summary')"));
  await evaluate("window.fetch = window.__recapRealFetch; window.__recapRealFetch = null");
  await evaluate("document.querySelector('#recap-retry').click()");
  check("retry reloads the recap", await waitFor("!!document.querySelector('#recap-title')"));

  const empty = recapPayload(host);
  await evaluate(`(() => {
    window.__recapRealFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = String(input?.url || input || '');
      if (url.includes('/recap')) return Promise.resolve(new Response(${JSON.stringify(JSON.stringify(empty))}, { status: 200, headers: { 'Content-Type': 'application/json' } }));
      return window.__recapRealFetch(input, init);
    };
    renderRecap();
  })()`);
  check("empty response shows an honest empty account state", await waitFor("document.body.textContent.includes('Rekap akan terisi')")
    && await evaluate("!document.querySelector('.recap-person-card')"));
  await evaluate("window.fetch = window.__recapRealFetch; window.__recapRealFetch = null; renderRecap()");
  await waitFor("!!document.querySelector('#recap-title')");

  // The alias sheet only writes the device-local map. The API name remains in
  // the canonical secondary line and the value survives a full navigation.
  await evaluate("document.querySelector('.recap-alias-btn').click()");
  check("alias editor opens with an accessible form", await waitFor("!!document.querySelector('#recap-alias-form')")
    && await evaluate("document.querySelector('#recap-alias-input').getAttribute('maxlength') === '40'"));
  await evaluate(`(() => {
    const input = document.querySelector('#recap-alias-input');
    input.value = 'Teman Kantor';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#recap-alias-form').requestSubmit();
  })()`);
  const aliasState = await evaluate(`({
    alias: JSON.parse(localStorage.getItem('bagiin_recap_aliases') || '{}')[${JSON.stringify(guest.id)}] || '',
    visible: document.querySelector('.recap-person-name')?.textContent.trim() || '',
    canonical: document.querySelector('.recap-person-canonical')?.textContent.trim() || '',
  })`);
  check("alias saves locally without replacing the shared name", aliasState.alias === "Teman Kantor"
    && aliasState.visible === "Teman Kantor" && aliasState.canonical.includes(guest.name), JSON.stringify(aliasState));
  await go("#/recap");
  check("local alias persists after reload", await waitFor("document.querySelector('.recap-person-name')?.textContent.trim() === 'Teman Kantor'"));

  for (const width of [320, 360, 390, 412, 430, 480, 600, 768, 820, 1024, 1040, 1280, 1440]) {
    await setViewport(width);
    const geometry = await evaluate(`(() => {
      const controls = [...document.querySelectorAll('button:not([disabled]), a, input, select, textarea')]
        .filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
        .map(el => { const r = el.getBoundingClientRect(); return {
          tag: el.tagName, text: (el.textContent || '').trim().slice(0, 32),
          width: r.width, height: r.height, left: r.left, right: r.right,
        }; });
      return {
        scrollWidth: document.documentElement.scrollWidth,
        viewport: window.innerWidth,
        controls,
        bad: controls.filter(c => c.width < 44 || c.height < 44 || c.left < -0.5 || c.right > window.innerWidth + 0.5),
      };
    })()`);
    check(`responsive geometry ${width}px`, geometry.scrollWidth <= geometry.viewport && geometry.bad.length === 0,
      `scroll ${geometry.scrollWidth}/${geometry.viewport}, bad ${JSON.stringify(geometry.bad)}`);
  }
  check("no uncaught browser errors", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
} finally {
  ws.close();
  await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {});
}

console.log(fails.length ? `\n${fails.length} check(s) FAILED` : "\nall checks passed");
process.exit(fails.length ? 1 : 0);
