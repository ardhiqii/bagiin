#!/usr/bin/env node
/**
 * Browser regression for the React manager view.
 *
 * It seeds disposable identities and bills through the API, then drives the real
 * React route in Chromium over CDP. The checks cover the manager-only controls
 * restored from the legacy screen: payer, direct invite, participant removal,
 * slot management, receipt photos, close/reopen state, and permanent deletion.
 *
 * Requirements: Node >= 22, Chrome on --remote-debugging-port=9222, a built
 * frontend, and a server using a throwaway BAGIIN_DB/BAGIIN_UPLOAD_DIR.
 *
 *   cd backend
 *   BAGIIN_DB=/tmp/creator-controls.db BAGIIN_UPLOAD_DIR=/tmp/creator-controls-up \
 *     venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8099 &
 *   cd ..
 *   node tools/e2e_creator_controls.mjs http://127.0.0.1:8099 http://127.0.0.1:9222
 */

import fs from "node:fs/promises";

const ORIGIN = process.argv[2] || "http://127.0.0.1:8099";
const CDP = process.argv[3] || "http://127.0.0.1:9222";
const checks = [];
const failures = [];
const requests = [];
const pageErrors = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function check(name, ok, detail = "") {
  checks.push(name);
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

async function request(method, path, body, identity) {
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
  let value = null;
  try { value = await response.json(); } catch { /* empty 204/error bodies */ }
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status}`);
  return value;
}

async function requestRaw(method, path, body, identity) {
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
  let value = null;
  try { value = await response.json(); } catch { /* empty error bodies */ }
  return { status: response.status, value };
}

let tab;
let ws;
let messageId = 0;
const pending = new Map();
let photoFixture;
let host;
let participant;
let pendingContact;
let mainBill;
let contactBill;
let closedBill;
let settledBill;
let deleteBill;

async function evaluate(expression) {
  const result = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Browser evaluation failed");
  }
  return result.result?.value;
}

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++messageId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitFor(expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      if (await evaluate(expression)) return true;
    } catch {
      // A route transition can briefly detach the execution context.
    }
    await sleep(80);
  }
  return false;
}

async function click(selector) {
  const result = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!result) throw new Error(`Missing browser control: ${selector}`);
}

async function clickText(text, selector = "button") {
  const result = await evaluate(`(() => {
    const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(candidate => candidate.textContent?.trim() === ${JSON.stringify(text)});
    if (!node) return false;
    node.click();
    return true;
  })()`);
  if (!result) throw new Error(`Missing browser button: ${text}`);
}

async function setInput(selector, value) {
  const result = await evaluate(`(() => {
    const node = document.querySelector(${JSON.stringify(selector)});
    if (!node) return false;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(node, ${JSON.stringify(value)});
    node.dispatchEvent(new Event("input", { bubbles: true }));
    node.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  if (!result) throw new Error(`Missing browser input: ${selector}`);
}

async function signIn(identity) {
  await evaluate(`localStorage.setItem("bagiin_identity", ${JSON.stringify(JSON.stringify(identity))})`);
}

async function goBill(billId) {
  await send("Page.navigate", { url: `${ORIGIN}/?creator_controls=${Date.now()}#/b/${billId}` });
  if (!await waitFor("document.readyState === 'complete'")) throw new Error("Page navigation timed out");
  if (!await waitFor("!!document.querySelector('.bill-header')")) throw new Error("Bill route did not render");
  await sleep(180);
}

async function setViewport(width) {
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height: 844,
    deviceScaleFactor: 2,
    mobile: width < 1040,
  });
}

async function setFileInput(path) {
  const documentResult = await send("DOM.getDocument", { depth: -1 });
  const node = await send("DOM.querySelector", {
    nodeId: documentResult.root.nodeId,
    selector: "#creator-photo-input",
  });
  if (!node.nodeId) throw new Error("Missing receipt file input");
  await send("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [path] });
  await evaluate("document.querySelector('#creator-photo-input')?.dispatchEvent(new Event('change', { bubbles: true }))");
}

function requestCount(method, pathPart) {
  return requests.filter(requestItem => requestItem.method === method && requestItem.url.includes(pathPart)).length;
}

try {
  const stamp = Date.now().toString(36);
  host = await request("POST", "/api/identities", { name: `Manager${stamp}`, creator: true });
  participant = await request("POST", "/api/identities", { name: `Participant${stamp}` });
  pendingContact = await request("POST", "/api/identities", { name: `Pending${stamp}` });
  await request("POST", `/api/identities/${pendingContact.id}/auto_accept`, { auto_accept: false }, pendingContact);

  // First share a throwaway bill so the pending identity is a legitimate contact.
  contactBill = await request("POST", "/api/bills", {
    title: `Contact ${stamp}`,
    items: [{ name: "Kontak", price: 10000 }],
    subtotal: 10000,
    tax: 0,
    service: 0,
    total: 10000,
    participants: [pendingContact.name],
  }, host);
  await request("POST", `/api/bills/${contactBill.id}/join`, {}, pendingContact);

  mainBill = await request("POST", "/api/bills", {
    title: `Creator controls ${stamp}`,
    items: [
      { name: "Nasi", price: 60000 },
      { name: "Pizza", price: 100000, mode: "slot", slot_count: 2 },
    ],
    subtotal: 160000,
    tax: 0,
    service: 0,
    total: 160000,
    participants: [participant.name],
  }, host);
  const mainDetail = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  const slotItem = mainDetail.items.find(item => item.mode === "slot");
  await request("POST", `/api/bills/${mainBill.id}/join`, {}, participant);
  await request("POST", `/api/bills/${mainBill.id}/selections`, {
    picks: [{ item_id: slotItem.id, qty: 1 }],
  }, participant);

  closedBill = await request("POST", "/api/bills", {
    title: `Closed controls ${stamp}`,
    items: [{ name: "Tutup", price: 20000 }],
    subtotal: 20000,
    tax: 0,
    service: 0,
    total: 20000,
  }, host);
  await request("POST", `/api/bills/${closedBill.id}/close`, {}, host);

  settledBill = await request("POST", "/api/bills", {
    title: `Settled controls ${stamp}`,
    items: [{ name: "Lunas", price: 30000 }],
    subtotal: 30000,
    tax: 0,
    service: 0,
    total: 30000,
  }, host);
  await request("POST", `/api/bills/${settledBill.id}/settle`, {}, host);

  deleteBill = await request("POST", "/api/bills", {
    title: `Delete controls ${stamp}`,
    items: [{ name: "Hapus", price: 40000 }],
    subtotal: 40000,
    tax: 0,
    service: 0,
    total: 40000,
  }, host);

  photoFixture = `/tmp/bagiin-creator-controls-${stamp}.png`;
  await fs.writeFile(photoFixture, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"));

  const target = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
  tab = await target.json();
  ws = new WebSocket(tab.webSocketDebuggerUrl);
  ws.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const item = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) item.reject(new Error(JSON.stringify(message.error)));
      else item.resolve(message.result);
      return;
    }
    if (message.method === "Network.requestWillBeSent") {
      requests.push({ method: message.params.request.method, url: message.params.request.url });
    }
    if (message.method === "Runtime.exceptionThrown") {
      pageErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Runtime exception");
    }
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") {
      pageErrors.push(message.params.args?.map(arg => arg.value || arg.description).join(" ") || "Console error");
    }
  });
  await new Promise(resolve => ws.addEventListener("open", resolve, { once: true }));
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Network.enable");
  await setViewport(390);
  await send("Page.navigate", { url: ORIGIN });
  await waitFor("document.readyState === 'complete'");

  // The participant must never see manager controls on the same bill.
  await signIn(participant);
  await goBill(mainBill.id);
  const participantView = await evaluate(`(() => ({
    manager: !!document.querySelector('#creator-controls'),
    payer: !!document.querySelector('#set-payer-btn'),
    invite: !!document.querySelector('#invite-person-btn'),
    remove: !!document.querySelector('[data-remove-person]'),
    slots: !!document.querySelector('.slot-mgr'),
    photos: !!document.querySelector('#add-photo-btn'),
    deleteBill: !!document.querySelector('#delete-bill-btn'),
  }))()`);
  check("non-manager cannot see creator controls", Object.values(participantView).every(value => value === false), JSON.stringify(participantView));

  await signIn(host);
  await goBill(mainBill.id);
  const managerOpen = await evaluate(`(() => ({
    manager: !!document.querySelector('#creator-controls'),
    payer: !!document.querySelector('#set-payer-btn'),
    invite: !!document.querySelector('#invite-person-btn'),
    remove: !!document.querySelector('[data-remove-person]'),
    slots: !!document.querySelector('.slot-mgr'),
    photos: !!document.querySelector('#add-photo-btn'),
    deleteBill: !!document.querySelector('#delete-bill-btn'),
    reopen: !!document.querySelector('#reopen-bill-btn'),
    edit: !!document.querySelector('#edit-bill-btn'),
  }))()`);
  check("manager sees open creator controls", managerOpen.manager && managerOpen.payer && managerOpen.invite && managerOpen.remove && managerOpen.slots && managerOpen.photos && managerOpen.deleteBill && !managerOpen.reopen && managerOpen.edit, JSON.stringify(managerOpen));

  // Payer by free text remains display-only until the matching identity joins.
  await click("#set-payer-btn");
  check("payer dialog is accessible", await waitFor("!!document.querySelector('#payer-name-input')"));
  await setInput("#payer-name-input", pendingContact.name);
  await click("#payer-name-save");
  check("payer dialog closes after save", await waitFor("!document.querySelector('#payer-name-input')"));
  let state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  check("name payer stays pending and manager rights stay with creator", state.paid_by_name === pendingContact.name && state.paid_by_confirmed === false && state.can_manage === true);
  check("payer mutation has one request", requestCount("PUT", `/api/bills/${mainBill.id}/paid_by`) === 1, String(requestCount("PUT", `/api/bills/${mainBill.id}/paid_by`)));

  // Change slot count and release the selected slot from the accessible manager.
  await click(".slot-mgr");
  check("slot manager dialog is accessible", await waitFor("!!document.querySelector('#mgr-save')"));
  await clickText("+", "[aria-label='Tambah bagian']");
  await click("#mgr-save");
  check("slot dialog closes after save", await waitFor("!document.querySelector('#mgr-save')"));
  state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  const updatedSlot = state.items.find(item => item.id === slotItem.id);
  check("slot count mutation is reflected by the server", updatedSlot.slot_count === 3);
  check("slot count has one request", requestCount("PUT", `/api/bills/${mainBill.id}/items/${slotItem.id}/slots`) === 1, String(requestCount("PUT", `/api/bills/${mainBill.id}/items/${slotItem.id}/slots`)));

  await click(".slot-mgr");
  check("selected slot appears in manager", await waitFor("!!document.querySelector('.mgr-free')"));
  await click(".mgr-free");
  check("slot release confirmation is accessible", await waitFor("!!document.querySelector('#confirm-release-slot')"));
  await click("#confirm-release-slot");
  check("slot release dialog closes", await waitFor("!document.querySelector('#confirm-release-slot')"));
  state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  const releasedSelections = state.sel_by_item[String(slotItem.id)] || [];
  check("released slot is absent from server state", releasedSelections.every(selection => selection.id !== participant.id));
  check("slot release has one request", requestCount("DELETE", `/api/bills/${mainBill.id}/items/${slotItem.id}/selections/${participant.id}`) === 1, String(requestCount("DELETE", `/api/bills/${mainBill.id}/items/${slotItem.id}/selections/${participant.id}`)));

  // Remove the participant; the modal prevents a second DELETE while in flight.
  await click("[data-remove-person]");
  check("remove confirmation is accessible", await waitFor("!!document.querySelector('#confirm-remove-person')"));
  await click("#confirm-remove-person");
  check("remove confirmation closes", await waitFor("!document.querySelector('#confirm-remove-person')"));
  state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  check("participant removal is reflected by the server", state.people.every(personItem => personItem.identity_id !== participant.id));
  check("participant removal has one request", requestCount("DELETE", `/api/bills/${mainBill.id}/people/${participant.id}`) === 1, String(requestCount("DELETE", `/api/bills/${mainBill.id}/people/${participant.id}`)));

  // Upload and delete a disposable real image through the browser file input.
  await click("#add-photo-btn");
  await setFileInput(photoFixture);
  check("receipt upload completes", await waitFor("document.querySelectorAll('.bill-photo-del').length === 1", 10000));
  state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  check("receipt upload is reflected by the server", Array.isArray(state.photos) && state.photos.length === 1);
  check("receipt upload has one request", requestCount("POST", `/api/bills/${mainBill.id}/photo`) === 1, String(requestCount("POST", `/api/bills/${mainBill.id}/photo`)));
  await click(".bill-photo-del");
  check("photo deletion confirmation is accessible", await waitFor("!!document.querySelector('#confirm-delete-photo')"));
  await click("#confirm-delete-photo");
  check("receipt deletion completes", await waitFor("!document.querySelector('.bill-photo-del')"));
  state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  check("receipt deletion is reflected by the server", Array.isArray(state.photos) && state.photos.length === 0);
  check("receipt deletion has one request", requestCount("DELETE", `/api/bills/${mainBill.id}/photos/`) === 1, String(requestCount("DELETE", `/api/bills/${mainBill.id}/photos/`)));

  // Direct invite: the pending contact is shown truthfully and double activation
  // still produces one request. It is a contact because of contactBill above.
  await click("#invite-person-btn");
  check("invite dialog is accessible", await waitFor("!!document.querySelector('#invite-search')"));
  check("contacts endpoint is used", await waitFor(`!![...document.querySelectorAll('[data-invite-id]')].find(button => button.dataset.inviteId === ${JSON.stringify(pendingContact.id)})`, 10000));
  const inviteBefore = requestCount("POST", `/api/bills/${mainBill.id}/invite`);
  await evaluate(`(() => { const button = [...document.querySelectorAll('[data-invite-id]')].find(node => node.dataset.inviteId === ${JSON.stringify(pendingContact.id)}); button?.click(); button?.click(); })()`);
  check("invite button disables while pending", await waitFor("!!document.querySelector('[data-invite-id][disabled]')", 10000));
  const inviteAfter = requestCount("POST", `/api/bills/${mainBill.id}/invite`);
  check("duplicate invite activation makes one request", inviteAfter - inviteBefore === 1, String(inviteAfter - inviteBefore));
  const targetInvites = await request("GET", `/api/identities/${pendingContact.id}/invites`, undefined, pendingContact);
  check("pending invite result is truthful", Array.isArray(targetInvites) && targetInvites.some(invite => invite.bill_id === mainBill.id && invite.status === "pending"));
  await clickText("Selesai");

  // The target accepts through the API; the name-resolved payer stays pending
  // until the manager explicitly confirms its identity.
  await request("POST", `/api/bills/${mainBill.id}/join`, {}, pendingContact);
  await goBill(mainBill.id);
  state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  check("joining resolves the named payer without auto-confirming", state.paid_by_id === pendingContact.id && state.paid_by_confirmed === false && state.can_manage === true);
  check("pending payer confirmation is visible", await waitFor("!!document.querySelector('#confirm-payer-btn')"));
  await click("#confirm-payer-btn");
  check("payer confirmation completes", await waitFor("!document.querySelector('#creator-controls')"));
  state = await request("GET", `/api/bills/${mainBill.id}`, undefined, host);
  const targetState = await request("GET", `/api/bills/${mainBill.id}`, undefined, pendingContact);
  check("confirmation transfers management only after explicit identity selection", state.can_manage === false && targetState.can_manage === true && state.paid_by_confirmed === true);

  // Closed bills expose only reopen (and permanent delete, which the backend
  // still permits); open mutation controls are not rendered.
  await signIn(host);
  await goBill(closedBill.id);
  const closedView = await evaluate(`({
    reopen: !!document.querySelector('#reopen-bill-btn'),
    payer: !!document.querySelector('#set-payer-btn'),
    invite: !!document.querySelector('#invite-person-btn'),
    slots: !!document.querySelector('.slot-mgr'),
    photos: !!document.querySelector('#add-photo-btn'),
    pick: !!document.querySelector('#pick-mine-btn'),
    edit: !!document.querySelector('#edit-bill-btn'),
    deleteBill: !!document.querySelector('#delete-bill-btn'),
  })`);
  check("closed manager view only offers reopen and delete", closedView.reopen && closedView.deleteBill && !closedView.payer && !closedView.invite && !closedView.slots && !closedView.photos && !closedView.pick && !closedView.edit, JSON.stringify(closedView));
  await click("#reopen-bill-btn");
  check("reopen confirmation is accessible", await waitFor("!!document.querySelector('#confirm-reopen')"));
  await click("#confirm-reopen");
  check("reopen stays on the bill", await waitFor("!!document.querySelector('#set-payer-btn')"));
  state = await request("GET", `/api/bills/${closedBill.id}`, undefined, host);
  check("reopen mutation is reflected by the server", state.bill.status === "open");
  check("reopen has one request", requestCount("POST", `/api/bills/${closedBill.id}/reopen`) === 1, String(requestCount("POST", `/api/bills/${closedBill.id}/reopen`)));

  await goBill(settledBill.id);
  const settledView = await evaluate(`({
    manager: !!document.querySelector('#creator-controls'),
    payer: !!document.querySelector('#set-payer-btn'),
    invite: !!document.querySelector('#invite-person-btn'),
    slots: !!document.querySelector('.slot-mgr'),
    photos: !!document.querySelector('#add-photo-btn'),
    pick: !!document.querySelector('#pick-mine-btn'),
    edit: !!document.querySelector('#edit-bill-btn'),
    paidToggle: !!document.querySelector('.toggle-paid'),
    deleteBill: !!document.querySelector('#delete-bill-btn'),
  })`);
  check("settled manager view hides bill mutations", settledView.manager && settledView.deleteBill && !settledView.payer && !settledView.invite && !settledView.slots && !settledView.photos && !settledView.pick && !settledView.edit && !settledView.paidToggle, JSON.stringify(settledView));

  await goBill(deleteBill.id);
  check("delete control is present on its disposable fixture", await waitFor("!!document.querySelector('#delete-bill-btn')"));
  await click("#delete-bill-btn");
  check("delete confirmation is accessible", await waitFor("!!document.querySelector('#confirm-delete-bill')"));
  await click("#confirm-delete-bill");
  const deleteHomeReady = await waitFor("location.hash === '#/'", 10000);
  await sleep(300);
  const deleteHomeState = await evaluate("({ hash: location.hash, hasTitle: document.body.textContent.includes(" + JSON.stringify(deleteBill.title) + "), text: document.body.textContent.replace(/\\s+/g, ' ').trim().slice(0, 240) })");
  check("delete navigates home without a ghost route", deleteHomeReady && deleteHomeState.hasTitle === false, JSON.stringify(deleteHomeState));
  const deleted = await requestRaw("GET", `/api/bills/${deleteBill.id}`, undefined, host);
  check("delete is reflected by the server", deleted.status === 404);
  check("bill delete has one request", requestCount("DELETE", `/api/bills/${deleteBill.id}`) === 1, String(requestCount("DELETE", `/api/bills/${deleteBill.id}`)));

  check("no uncaught page or console errors", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
} catch (error) {
  console.error(`creator-controls e2e aborted: ${error instanceof Error ? error.message : "unknown error"}`);
  failures.push("script completed");
} finally {
  // The database/upload directory are disposable, but still attempt explicit
  // cleanup so this script is safe against a long-lived local test server.
  if (mainBill) {
    await requestRaw("DELETE", `/api/bills/${mainBill.id}`, undefined, pendingContact);
    await requestRaw("DELETE", `/api/bills/${mainBill.id}`, undefined, host);
  }
  for (const bill of [contactBill, closedBill, settledBill]) {
    if (bill) await requestRaw("DELETE", `/api/bills/${bill.id}`, undefined, host);
  }
  if (photoFixture) await fs.rm(photoFixture, { force: true }).catch(() => {});
  if (tab?.id) await fetch(`${CDP}/json/close/${tab.id}`).catch(() => {});
  if (ws) ws.close();
}

console.log(`\nchecks: ${checks.length}, failures: ${failures.length}`);
console.log(failures.length ? `${failures.length} creator-control check(s) FAILED` : "all creator-control checks passed");
process.exit(failures.length ? 1 : 0);
