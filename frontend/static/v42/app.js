/* Bagiin frontend - state, router, helpers */
"use strict";

const $ = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
const fmt = (n) => "Rp " + Number(n || 0).toLocaleString("id-ID");
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; };

const LS_KEYS = { ident: "bagiin_identity", name: "bagiin_name" };

function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
  catch (e) { return fallback; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode - ignore */ }
}

const state = {
  identity: lsGet(LS_KEYS.ident, null),
  bill: null,           // current bill data
  selected: new Set(),  // item ids selected by current viewer
  currentBillId: null,
};

// ---------- API ----------
async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  if (state.identity) headers["X-Identity-Id"] = state.identity.id;
  const fetchOpts = Object.assign({}, opts);
  if (opts.json !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchOpts.body = JSON.stringify(opts.json);
    delete fetchOpts.json;
  }
  const res = await fetch(path, Object.assign({}, fetchOpts, { headers }));
  if (res.status === 429) throw new Error("Kebanyakan request, coba lagi nanti");
  if (!res.ok) {
    let msg = "Error " + res.status;
    try { const d = await res.json(); msg = d.detail || msg; } catch (e) {}
    throw new Error(msg);
  }
  return res.json();
}

function apiJson(path, method, data) {
  return api(path, { method, json: data });
}

// ---------- toast ----------
let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- haptic ----------
function buzz(ms = 10) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} }
}

// ---------- identity ----------
async function ensureIdentity(name) {
  if (!state.identity) {
    state.identity = await apiJson("/api/identities", "POST", { name });
    lsSet(LS_KEYS.ident, state.identity);
    lsSet(LS_KEYS.name, name);
  }
  return state.identity;
}

function logout() {
  state.identity = null;
  try { localStorage.removeItem(LS_KEYS.ident); } catch (e) {}
  render();
}

// ---------- router ----------
function parseHash() {
  const h = location.hash.replace(/^#\/?/, "");
  const parts = h.split("/").filter(Boolean);
  return { parts };
}

function render() {
  const app = $("#app");
  const { parts } = parseHash();
  if (parts[0] === "b" && parts[1]) { loadBillView(parts[1]); return; }
  if (!state.identity) { renderOnboarding(); return; }
  if (parts[0] === "history") { renderHistory(); return; }
  if (parts[0] === "settings") { renderSettings(); return; }
  if (parts[0] === "create") { renderCreate(); return; }
  renderHome();
}

window.addEventListener("hashchange", render);
