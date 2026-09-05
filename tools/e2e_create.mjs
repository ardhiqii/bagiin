#!/usr/bin/env node
/**
 * Dependency-free browser regression harness for the create-bill editor.
 *
 * Defaults deliberately point at a disposable local server. The harness creates
 * one throwaway identity, drives the real editor in Chrome over CDP, and never
 * submits a bill. It is intentionally a hard failure when no matrix case runs.
 *
 *   node tools/e2e_create.mjs [BASE_URL] [CDP_URL]
 *   BAGIIN_BASE_URL=http://127.0.0.1:8099 BAGIIN_CDP_URL=http://127.0.0.1:9222 node tools/e2e_create.mjs
 */

const BASE_URL = (process.argv[2] || process.env.BAGIIN_BASE_URL || "http://127.0.0.1:8099").replace(/\/$/, "");
const CDP_URL = (process.argv[3] || process.env.BAGIIN_CDP_URL || "http://127.0.0.1:9222").replace(/\/$/, "");
const WIDTHS = [320, 360, 375, 390, 412, 430, 480, 600, 768, 820, 1024, 1040, 1280, 1440];
const HEIGHT = 900;
const failures = [];
let executed = 0;

const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(name);
};
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function api(method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) {
    headers["X-Identity-Id"] = identity.id;
    if (identity.secret) headers["X-Identity-Secret"] = identity.secret;
  }
  const response = await fetch(BASE_URL + path, {
    method, headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  return response.json();
}

async function cdpDiscovery() {
  try {
    const response = await fetch(`${CDP_URL}/json/version`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const version = await response.json();
    if (!version.webSocketDebuggerUrl) throw new Error("browser did not advertise a WebSocket debugger URL");
    return version;
  } catch (error) {
    console.log(`SKIP: Chrome/CDP unavailable at ${CDP_URL} (${error.message})`);
    console.log("Start Chrome with --remote-debugging-port=9222 and rerun against a disposable server.");
    process.exitCode = 2;
    return null;
  }
}

const discovery = await cdpDiscovery();
if (!discovery) process.exit(2);

let identity;
try {
  const stamp = `${Date.now().toString(36)}-${process.pid}`;
  identity = await api("POST", "/api/identities", { name: `E2E Create ${stamp}`, creator: true });
  check("disposable identity has credentials", Boolean(identity.id), identity.id || "missing id");
} catch (error) {
  console.error(`ERROR: disposable Bagiin server unavailable at ${BASE_URL}: ${error.message}`);
  process.exit(1);
}

const tabResponse = await fetch(`${CDP_URL}/json/new?about:blank`, { method: "PUT" });
if (!tabResponse.ok) {
  console.error(`ERROR: CDP could not create a tab (${tabResponse.status})`);
  process.exit(1);
}
const tab = await tabResponse.json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let sequence = 0;
const pending = new Map();
const pageErrors = [];
ws.addEventListener("message", event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  } else if (message.method === "Runtime.exceptionThrown") {
    pageErrors.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "page exception");
  } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
    pageErrors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? "").join(" ") || "console error");
  } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
    pageErrors.push(message.params.entry.text || "browser log error");
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result?.value;
};
const navigate = async url => {
  await send("Page.navigate", { url });
  await sleep(700);
};

const identityJson = JSON.stringify(JSON.stringify(identity));
const createAndManual = async () => {
  await navigate(`${BASE_URL}/?e2e=${Date.now()}#/create`);
  await evaluate(`localStorage.setItem("bagiin_identity", ${identityJson})`);
  await navigate(`${BASE_URL}/?e2e=${Date.now()}#/create`);
  const clicked = await evaluate(`(() => {
    const button = document.querySelector("#manual-btn");
    if (button) button.click();
    return Boolean(button);
  })()`);
  if (!clicked) throw new Error("manual create control was not rendered");
  await sleep(250);
};

const readCase = async (width, color) => evaluate(`(() => {
  const app = document.querySelector("#app");
  const dock = document.querySelector(".dock, .sticky-bar");
  const main = document.querySelector(".shell-main");
  const side = document.querySelector(".shell-side");
  const quantity = document.querySelector('[data-role="quantity"]');
  const cta = document.querySelector("#create-bill-btn");
  const firstFocusable = document.querySelector("#title-input, [data-role=name], #subtotal-input");
  const rect = el => el ? el.getBoundingClientRect().toJSON() : null;
  const validControls = [...document.querySelectorAll("#create-bill-btn, #add-item-btn, #verify-add-photo, #verify-paste-photo, .vf-item button")];
  return {
    route: location.hash,
    controls: { title: Boolean(document.querySelector("#title-input")), item: Boolean(document.querySelector('[data-role="name"]')), quantity: Boolean(quantity), subtotal: Boolean(document.querySelector("#subtotal-input")), cta: Boolean(cta) },
    focus: firstFocusable ? (() => {
      firstFocusable.focus();
      const style = getComputedStyle(firstFocusable);
      const targetRect = firstFocusable.getBoundingClientRect();
      const dockRect = dock?.getBoundingClientRect();
      const dockFixed = dock && getComputedStyle(dock).position === "fixed";
      const intersectsDock = dockFixed && dockRect && targetRect.right > dockRect.left && targetRect.left < dockRect.right && targetRect.bottom > dockRect.top && targetRect.top < dockRect.bottom;
      return {
        active: document.activeElement === firstFocusable,
        clear: !intersectsDock || targetRect.bottom <= dockRect.top - 24,
        outline: style.outlineStyle,
        width: targetRect.width,
      };
    })() : null,
    dimensions: { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, app: rect(app), dock: rect(dock), main: rect(main), side: rect(side) },
    dark: matchMedia("(prefers-color-scheme: dark)").matches,
    controlHeights: validControls.map(el => ({ id: el.id || el.getAttribute("aria-label") || el.className, height: el.getBoundingClientRect().height })),
    quantity: quantity ? { value: quantity.value, error: !document.querySelector("[data-role=quantity-error]")?.classList.contains("hidden"), ctaDisabled: Boolean(cta?.disabled) } : null,
    color: ${JSON.stringify(color)},
  };
})()`);

try {
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("CDP WebSocket error")), { once: true });
  });
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");

  for (const color of ["light", "dark"]) {
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: color }] });
    for (const width of WIDTHS) {
      executed += 1;
      try {
        await send("Emulation.setDeviceMetricsOverride", { width, height: HEIGHT, deviceScaleFactor: 1, mobile: width < 768 });
        await createAndManual();
        await evaluate(`(() => {
          const set = (selector, value) => {
            const input = document.querySelector(selector);
            if (!input) throw new Error("missing " + selector);
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          };
          set('[data-role="name"]', "E2E Item");
          set('[data-role="price"]', "1000");
          set("#subtotal-input", "1000");
        })()`);
        const initial = await readCase(width, color);
        const prefix = `${color} ${width}px`;
        const allControls = Object.values(initial.controls).every(Boolean);
        check(`${prefix}: create controls render`, allControls, JSON.stringify(initial.controls));
        check(`${prefix}: focused control is active and dock-clear`, initial.focus?.active === true && initial.focus.clear === true, JSON.stringify(initial.focus));
        check(`${prefix}: controls meet tap target`, initial.controlHeights.every(control => control.height >= 44), JSON.stringify(initial.controlHeights));
        check(`${prefix}: no horizontal overflow`, initial.dimensions.scrollWidth <= width, `${initial.dimensions.scrollWidth}px`);
        check(`${prefix}: dock geometry`, Boolean(initial.dimensions.dock) && initial.dimensions.dock.height >= 44 && initial.dimensions.dock.right <= width + 1, JSON.stringify(initial.dimensions.dock));
        check(`${prefix}: color preference applied`, initial.dark === (color === "dark"), `dark=${initial.dark}`);

        const invalid = await evaluate(`(() => {
          const input = document.querySelector('[data-role="quantity"]');
          input.value = "1.5";
          input.dispatchEvent(new Event("input", { bubbles: true }));
          return { value: input.value, error: !document.querySelector("[data-role=quantity-error]")?.classList.contains("hidden"), disabled: document.querySelector("#create-bill-btn")?.disabled };
        })()`);
        await sleep(100);
        const invalidDock = await evaluate(`(() => {
          const add = document.querySelector("#add-item-btn");
          const dock = document.querySelector(".dock, .sticky-bar");
          if (!add || !dock) return { clear: false, reason: "missing add action or dock" };
          const a = add.getBoundingClientRect();
          const d = dock.getBoundingClientRect();
          const fixed = getComputedStyle(dock).position === "fixed";
          const overlaps = fixed && a.right > d.left && a.left < d.right && a.bottom > d.top && a.top < d.bottom;
          return { clear: !overlaps && (!fixed || a.bottom <= d.top - 24 || a.top >= d.bottom), rect: a.toJSON(), dock: d.toJSON() };
        })()`);
        invalid.addClear = invalidDock.clear;
        check(`${prefix}: invalid quantity blocks CTA and leaves add action clear`, invalid.error === true && invalid.disabled === true && invalid.addClear === true, JSON.stringify({ invalid, invalidDock }));
        for (const quantity of ["1", "99"]) {
          const valid = await evaluate(`(() => {
            const input = document.querySelector('[data-role="quantity"]');
            input.value = ${JSON.stringify(quantity)};
            input.dispatchEvent(new Event("input", { bubbles: true }));
            const subtotal = document.querySelector("#subtotal-input");
            subtotal.value = ${JSON.stringify(quantity)} + "000";
            subtotal.dispatchEvent(new Event("input", { bubbles: true }));
            subtotal.dispatchEvent(new Event("change", { bubbles: true }));
            return { value: input.value, error: !document.querySelector("[data-role=quantity-error]")?.classList.contains("hidden"), disabled: document.querySelector("#create-bill-btn")?.disabled, total: document.querySelector('[data-role="line-total"]')?.textContent || "" };
          })()`);
          check(`${prefix}: quantity ${quantity} accepted`, valid.error === false && valid.disabled === false && valid.value === quantity, JSON.stringify(valid));
        }

        if (width === 320 || width === 1280) {
          const ocr = await evaluate(`(() => {
            renderVerify({
              merchant: "Warung E2E",
              transacted_at: "2026-09-05",
              items: [
                { name: "Nasi Goreng", price: 30000, quantity: 2, discount: 0, mode: "free" },
                { name: "Nasi Goreng", price: 60000, quantity: 1, discount: 0, mode: "free" },
              ],
              subtotal: 120000,
              tax: 0,
              service: 0,
              total: 120000,
              photos: [],
            }, false);
            return {
              rows: document.querySelectorAll("#items-list .vf-item").length,
              quantities: [...document.querySelectorAll('[data-role="quantity"]')].map(input => input.value),
              title: document.querySelector("#title-input")?.value || "",
              route: location.hash,
            };
          })()`);
          check(`${prefix}: OCR review preserves duplicate rows and quantity`, ocr.rows === 2 && JSON.stringify(ocr.quantities) === JSON.stringify(["2", "1"]) && ocr.title === "Warung E2E", JSON.stringify(ocr));
        }
      } catch (error) {
        check(`${color} ${width}px: case executes`, false, error.message);
      }
    }
  }
} finally {
  await fetch(`${CDP_URL}/json/close/${tab.id}`).catch(() => {});
  ws.close();
}

check("matrix executed at least one case", executed > 0, `${executed} cases`);
check("no uncaught page exceptions", pageErrors.length === 0, [...new Set(pageErrors)].join(" | "));
console.log(`\n${executed} matrix cases executed; ${failures.length} failed`);
process.exit(failures.length || executed === 0 ? 1 : 0);
