#!/usr/bin/env node
/**
 * CSS-coverage and computed-style regression gate for the Bagiin React app.
 *
 * This is the gate that was missing while the UI was visibly broken and every
 * other driver was green: tools/e2e_uiux_responsive.mjs checks geometry,
 * overflow and a11y, but never asserts that a rendered class has a rule or that
 * a rule still computes the value the design system intends. The React
 * migration shipped frontend/src/styles/globals.css as a partial replacement
 * for the <style> block in frontend/index.html, leaving 63 classes React still
 * renders with no rule at all, and this driver fails on exactly that.
 *
 * It uses Node built-ins + CDP only (no npm dependency), seeds disposable
 * identities and bills through the public API, deletes them in a finally path,
 * opens exactly one CDP tab and closes it on every exit path. BASE_URL,
 * CDP_URL and the advertised debugger WebSocket must all be local.
 *
 * Fails closed. `checksRun` has a floor: a run that walks the matrix but
 * asserts almost nothing is reported as a FAIL, because a vacuous pass is the
 * failure mode this driver exists to prevent.
 *
 *   BASE_URL=http://127.0.0.1:8099 CDP_URL=http://127.0.0.1:9222 \
 *     node tools/e2e_css_coverage.mjs
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const WIDTHS = [320, 360, 390, 412, 768, 1040, 1280];
const HOME_SWAP_BREAKPOINT = 1040;

const ROUTES = [
  { label: "onboarding", identity: null, hash: "#/", ready: "#onboard-form" },
  { label: "home", identity: "creator", hash: "#/", ready: "#create-btn" },
  { label: "home-empty", identity: "empty", hash: "#/", ready: "#create-btn" },
  { label: "create", identity: "creator", hash: "#/create", ready: "#ocr-btn" },
  { label: "create/verify", identity: "creator", hash: "#/create/verify", ready: "#create-bill-btn" },
  { label: "bill-creator", identity: "creator", bill: "dueBill", ready: "#share-btn" },
  { label: "bill-creator-slot", identity: "creator", bill: "slotBill", ready: "#share-btn" },
  { label: "bill-guest", identity: "guest", bill: "slotBill", ready: "#pay-btn" },
  { label: "recap", identity: "creator", hash: "#/recap", ready: "#recap-title" },
  { label: "recap-empty", identity: "empty", hash: "#/recap", ready: "#recap-title" },
  { label: "settings", identity: "creator", hash: "#/settings", ready: "#auto-accept-switch" },
];

/* Every route x width cell must contribute at least its four mandatory
   assertions (reached the ready selector + class coverage + overflow + console
   errors). A run that walks the matrix but asserts almost nothing is the
   vacuous-pass failure mode this gate exists to prevent, so it reports FAIL. */
/* Floor = routes x widths x 5 mandatory assertions, plus the extra dark-mode
   cells (phone widths carry both schemes). The per-cell checks are
   route-dependent (the recap/bill/settings groups only run on their own
   routes), so this is a conservative sanity floor whose job is to catch a run
   that walks the matrix but asserts almost nothing — not to pin the exact
   count. It was *4 before the status-bar colour assertion was added, and the
   dark-mode axis plus the contrast/wrap assertions raised it again. */
const SCHEME_CELLS = WIDTHS.reduce((total, width) => total + (width <= 412 ? 2 : 1), 0);
const MIN_CHECKS = ROUTES.length * SCHEME_CELLS * 6;

const rawBaseUrl = process.argv[2] || process.env.BASE_URL || "http://127.0.0.1:8099";
const rawCdpUrl = process.argv[3] || process.env.CDP_URL || "http://127.0.0.1:9222";

const failures = [];
let checksRun = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const normalizeHost = host => String(host || "").replace(/^\[|\]$/g, "");
const isLocalHost = host => LOCAL_HOSTS.has(normalizeHost(host));

function validateLocalUrl(raw, label) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${label} must be an HTTP(S) URL without embedded credentials`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || !isLocalHost(parsed.hostname)) {
    throw new Error(`${label} must target localhost, 127.0.0.1, or ::1 without embedded credentials`);
  }
  return parsed.href.replace(/\/$/, "");
}

function validateWebSocketUrl(raw) {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("CDP did not advertise a valid WebSocket debugger URL");
  }
  if (!["ws:", "wss:"].includes(parsed.protocol) || parsed.username || parsed.password || !isLocalHost(parsed.hostname)) {
    throw new Error("CDP advertised a non-local or invalid WebSocket debugger URL");
  }
  return parsed.href;
}

/* Navigation and network noise that is not an application error. Kept short and
   explicit so a real console error can never hide behind it. */
const IGNORED_ERROR_PATTERNS = [
  /net::ERR_ABORTED/i,
  /Failed to load resource: net::ERR_ABORTED/i,
  /WebSocket is closed before the connection is established/i,
];
const isIgnoredError = text => IGNORED_ERROR_PATTERNS.some(pattern => pattern.test(String(text || "")));

/**
 * Names that legitimately carry no CSS rule of their own: they are behaviour
 * hooks that live on an element which already gets a ruled class from a UI
 * primitive (Button/Card/Input/Badge/Alert/Select/Skeleton), and the existing
 * e2e drivers use several of them as selectors, so they must not be renamed.
 * `checks` (b/e) verify this stays honest: for every allowlisted name that
 * renders, the element must also carry at least one class that IS ruled.
 */
const ALLOWLIST = [
  // behaviour/selector hooks on a primitive that already supplies the styling
  ["bill-mobile-breakdown", "Card in the guest bill view"],
  ["bill-payment-card", "Card in the guest bill view"],
  ["bill-photo-del", "Button size=icon"],
  ["bill-summary-card", "Card (also .bill-header)"],
  ["edit-bill-main", "class hook on the edit form"],
  ["edit-bill-shell", "class hook on the edit <main>"],
  ["edit-qty-dec", "Button size=icon inside .qty-control"],
  ["edit-qty-inc", "Button size=icon inside .qty-control"],
  ["mgr-free", "Button in the slot-manager sheet"],
  ["qty-dec", "Button size=icon inside .qty-control"],
  ["qty-inc", "Button size=icon inside .qty-control"],
  ["recap-current-card", "Card in the recap action section"],
  ["recap-loading", "Card in the recap skeleton"],
  ["recap-pending-current", "Badge"],
  ["recap-pending-waiting", "Badge"],
  ["recap-state", "Card in the recap error state"],
  ["recap-waiting-card", "Card in the recap action section"],
  ["remove-person", "Button in the participants list"],
  ["slot-adjuster", "class hook on the slot stepper row"],
  ["step-dec", "Button inside .step-button"],
  ["step-inc", "Button inside .step-button"],
  ["toggle-paid", "Button in the payment-status list"],
  ["verify-detail-card", "Card in the create/verify editor"],
  ["verify-items-card", "Card in the create/verify editor"],
  ["verify-people-card", "Card (<details>) in the create/verify editor"],
];
const ALLOWLIST_NAMES = new Set(ALLOWLIST.map(([name]) => name));

/**
 * The recovery set: classes frontend/src/** emits that had a rule in the legacy
 * <style> block of frontend/index.html and no rule in globals.css before v89.
 * Each one must have a rule in the built stylesheet, whether or not a route
 * happened to render it during this run. A route that fails to materialise is
 * reported separately (rendered-coverage line) so a reviewer can see the gap.
 */
const EXPECTED_RECOVERY = [
  "avatar-me", "brand-chip", "brand-logo", "btn-row", "chip", "delete-bill", "hidden", "history-row",
  "is-pay", "is-receive", "is-unknown", "item-full", "item-row",
  "recap-account-empty", "recap-action-amount", "recap-action-aside",
  "recap-action-card", "recap-action-copy", "recap-action-icon",
  "recap-action-link", "recap-action-list", "recap-action-row",
  "recap-action-target", "recap-action-title", "recap-actions-grid",
  "recap-alias-btn", "recap-bill-copy", "recap-bill-link", "recap-bill-list",
  "recap-bill-row", "recap-empty", "recap-empty-inline", "recap-estimate-grid",
  "recap-heading", "recap-money-cell", "recap-money-grid", "recap-money-label",
  "recap-money-note", "recap-money-pay", "recap-money-receive",
  "recap-money-value", "recap-net-line", "recap-person-amount",
  "recap-person-canonical", "recap-person-card", "recap-person-copy",
  "recap-person-direction", "recap-person-head", "recap-person-name",
  "recap-person-pending", "recap-person-pending-breakdown",
  "recap-person-pending-count", "recap-provisional", "recap-provisional-amounts",
  "recap-provisional-copy", "recap-provisional-list", "recap-provisional-row",
  "recap-reason-list", "recap-section", "recap-section-heading", "recap-summary",
  "recap-summary-note", "selected", "slot-mgr", "toggle-row",
  // restored alongside the set above (bare containers with no primitive class)
  "chip-green", "chip-red", "chip-grey", "chip-accent", "date-helper",
  "list-controls-inline", "list-ctl-btn", "loading-state", "route-fallback",
  "settings-page", "status-danger", "status-neutral", "status-success",
  "history-month", "item-share",
];

/* ---------------------------------------------------------------- CDP plumbing */

class CdpTab {
  constructor(ws) {
    this.ws = ws;
    this.sequence = 0;
    this.pending = new Map();
    this.errors = [];
    ws.addEventListener("message", event => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        this.errors.push("invalid CDP message");
        return;
      }
      if (message.id && this.pending.has(message.id)) {
        const request = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(JSON.stringify(message.error)));
        else request.resolve(message.result);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        this.errors.push(message.params?.exceptionDetails?.exception?.description
          || message.params?.exceptionDetails?.text || "page exception");
      } else if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
        this.errors.push(message.params.args?.map(arg => arg.value ?? arg.description ?? "").join(" ") || "console error");
      } else if (message.method === "Log.entryAdded" && message.params?.entry?.level === "error") {
        const entry = message.params.entry;
        this.errors.push(`${entry.text || "browser log error"}${entry.url ? ` (${entry.url})` : ""}`);
      }
    });
  }

  async connect() {
    await new Promise((resolve, reject) => {
      if (this.ws.readyState === 1) return resolve();
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("CDP WebSocket error")), { once: true });
    });
    await this.send("Page.enable");
    await this.send("Runtime.enable");
    await this.send("Log.enable");
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "page evaluation failed");
    return result.result?.value;
  }

  page(fn, ...args) {
    return this.evaluate(`(${fn.toString()})(${args.map(value => JSON.stringify(value)).join(",")})`);
  }

  async viewport(width, height) {
    await this.send("Emulation.setDeviceMetricsOverride", {
      width, height, deviceScaleFactor: 1, mobile: width < 768,
      screenWidth: width, screenHeight: height, fitWindow: false,
    });
  }

  /* Emulate a colour scheme. The dark tokens are a separate set of values, so a
     light-only run cannot see a dark-mode contrast regression. */
  async colorScheme(scheme) {
    await this.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: scheme }],
    });
  }

  async navigate(url) {
    await this.send("Page.navigate", { url });
    await sleep(250);
  }

  async waitFor(fn, ...args) {
    const timeoutMs = typeof args.at(-1) === "number" ? args.pop() : 12000;
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (await this.page(fn, ...args)) return true;
      await sleep(100);
    }
    return false;
  }

  close() {
    try { this.ws.close(); } catch { /* already closed */ }
  }
}

/* -------------------------------------------------------------- in-page audit */

/**
 * Everything measured inside the page. Kept as one function so the selector
 * sets below stay reviewable next to each other.
 *
 * The CSSOM walk MUST test `rule.selectorText` before `rule.cssRules`: Chrome's
 * CSSStyleRule now also exposes `.cssRules` (CSS nesting), so the usual
 * `if (rule.cssRules) { recurse; continue; }` shape skips every style rule,
 * produces an empty `known` set and reports every class as unstyled.
 */
const auditFn = () => {
  const visible = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && style.visibility !== "collapse"
      && Number(style.opacity || 1) > 0
      && rect.width > 0
      && rect.height > 0
      && !element.closest('[aria-hidden="true"]');
  };
  /* Coverage uses a different notion of "rendered" than the a11y checks above:
     an aria-hidden decorative element (the Home status mark, the recap action
     icon) is still painted and still needs a CSS rule, so it must NOT be
     filtered out or the scan reports those classes as unreachable. */
  const rendered = element => {
    if (!element) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none"
      && style.visibility !== "hidden"
      && style.visibility !== "collapse"
      && rect.width >= 1
      && rect.height >= 1;
  };
  const known = new Set();
  const walk = list => {
    for (const rule of list) {
      if (rule.selectorText) {
        for (const match of rule.selectorText.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) known.add(match[1]);
      }
      if (rule.cssRules && rule.cssRules.length) walk(rule.cssRules);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.cssRules) walk(sheet.cssRules);
    } catch {
      /* cross-origin sheet; every Bagiin sheet is same-origin */
    }
  }
  const classCounts = new Map();
  const ruledSiblings = new Map();
  for (const element of Array.from(document.querySelectorAll("body *")).filter(rendered)) {
    const owner = Array.from(element.classList);
    const ruledAmongOwner = owner.filter(name => known.has(name));
    for (const name of owner) {
      classCounts.set(name, (classCounts.get(name) || 0) + 1);
      if (!ruledSiblings.has(name)) ruledSiblings.set(name, new Set());
      for (const other of ruledAmongOwner) if (other !== name) ruledSiblings.get(name).add(other);
    }
  }
  /* For an allowlisted hook: the element must also carry a RULED class, or the
     allowlist has become a dumping ground. */
  const unstyled = [];
  const hookViolations = [];
  for (const [name, count] of classCounts) {
    if (known.has(name)) continue;
    const siblings = Array.from(ruledSiblings.get(name) || []);
    unstyled.push({ name, count, hasRuledSibling: siblings.length > 0, siblings: siblings.slice(0, 3) });
  }
  hookViolations.push(...unstyled.filter(item => !item.hasRuledSibling).map(item => item.name));

  const style = (selector, pseudo) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const computed = getComputedStyle(element, pseudo);
    return {
      display: computed.display,
      fontSize: parseFloat(computed.fontSize),
      paddingLeft: parseFloat(computed.paddingLeft),
      paddingTop: parseFloat(computed.paddingTop),
      marginTop: parseFloat(computed.marginTop),
      order: computed.order,
      borderRadius: parseFloat(computed.borderTopLeftRadius),
      minHeight: parseFloat(computed.minHeight),
      gridTemplateColumns: computed.gridTemplateColumns,
      backgroundColor: computed.backgroundColor,
      color: computed.color,
    };
  };
  /* Status tone: assert EXACT token equality per tone. "not transparent"
     passes on the broken build (every row measured --accent-soft because
     .avatar outranked .status-* on source order), so it proves nothing. */
  const tokens = getComputedStyle(document.documentElement);
  const tokenOf = name => tokens.getPropertyValue(name).trim();
  const toRgb = value => {
    const probe = document.createElement("span");
    probe.style.color = value;
    document.body.appendChild(probe);
    const rgb = getComputedStyle(probe).color;
    probe.remove();
    return rgb;
  };
  const tones = {};
  for (const tone of ["danger", "neutral", "success", "due", "ok", "idle"]) {
    const mark = document.querySelector(`.status-mark.status-${tone}`);
    tones[tone] = mark ? getComputedStyle(mark).backgroundColor : null;
  }
  const toneTokens = {
    danger: toRgb(tokenOf("--red-soft")),
    success: toRgb(tokenOf("--green-soft")),
    neutral: toRgb(tokenOf("--surface-2")),
    borderStrong: toRgb(tokenOf("--border-strong")),
  };
  /* The status bar colour per row, keyed by the tone class the row carries.
     Read from the row's own ::before so a selector that keys on the wrong
     name shows up as the --border-strong fallback instead of a real tint. */
  const barByTone = {};
  for (const tone of ["danger", "neutral", "success", "due", "ok", "idle"]) {
    const row = document.querySelector(`.history-row:has(.status-${tone})`);
    barByTone[tone] = row ? getComputedStyle(row, "::before").backgroundColor : null;
  }
  const homeFilter = (() => {
    const inline = document.querySelector(".list-controls-inline");
    const button = document.querySelector("#list-ctl-btn");
    const rect = element => { const r = element?.getBoundingClientRect(); return r ? { width: r.width, height: r.height } : null; };
    return {
      present: Boolean(inline),
      inlineDisplay: inline ? getComputedStyle(inline).display : null,
      inlineVisible: visible(inline),
      buttonDisplay: button ? getComputedStyle(button).display : null,
      buttonVisible: visible(button),
      buttonRect: rect(button),
      inlineChips: inline ? Array.from(inline.querySelectorAll(".filter-chip")).filter(visible).length : 0,
      inlineSelects: inline ? Array.from(inline.querySelectorAll("select")).filter(visible).length : 0,
      firstRowTop: (() => {
        const row = Array.from(document.querySelectorAll(".history-row")).find(visible);
        return row ? Math.round(row.getBoundingClientRect().top) : null;
      })(),
    };
  })();
  const overflowing = Array.from(document.querySelectorAll("body *"))
    .map(element => ({ element, rect: element.getBoundingClientRect() }))
    .filter(item => visible(item.element) && !item.element.closest(".dock,.sticky-bar,#app-nav")
      && (item.rect.left < -1 || item.rect.right > innerWidth + 1))
    .slice(0, 4)
    .map(item => ({ tag: item.element.tagName, id: item.element.id, className: String(item.element.className).slice(0, 70), right: Math.round(item.rect.right) }));

  /* ---- contrast of text on its OWN opaque fill (WCAG AA) ---- */
  /* Reading the fill off the element itself, not by walking ancestors: a button
     paints its own background, and the ancestor walk reports the page colour
     instead, which produced four phantom failures during the v90 investigation. */
  const parseRgb = value => {
    const match = String(value).match(/rgba?\(([^)]+)\)/);
    if (!match) return null;
    const parts = match[1].split(",").map(part => parseFloat(part.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  };
  const relLum = c => {
    const channel = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
  };
  const contrastRatio = (a, b) => {
    const l1 = relLum(a), l2 = relLum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  /* How many rendered lines does this element's own text occupy? Range rects
     beat height/line-height maths, which break when min-height dominates the
     box (a 46px control with 16px text looked like "3 lines"). */
  const lineCount = root => {
    let lines = 0;
    const walk = node => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3 && child.textContent.trim()) {
          const range = document.createRange();
          range.selectNodeContents(child);
          lines += range.getClientRects().length;
        } else if (child.nodeType === 1) walk(child);
      }
    };
    walk(root);
    return lines;
  };
  const solidControls = [];
  const wrappedLabels = [];

  /* Payment-brand tiles. `rows` counts ACCOUNT ROWS independently of whether a
     logo element exists, so a row still using the old generic wallet glyph is
     counted and fails the check below (counting only .brand-logo/.brand-chip
     made the assertion vacuous: on the broken tree there were zero tiles, so the
     assertion never ran and the gate stayed green). */
  const brandLogos = { rows: 0, chips: 0, images: 0, empty: 0 };
  for (const row of document.querySelectorAll(".payment-account")) {
    if (!visible(row)) continue;
    brandLogos.rows += 1;
    const logo = row.querySelector(".brand-logo");
    const chip = row.querySelector(".brand-chip");
    if (logo) {
      const img = logo.querySelector("img");
      if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) brandLogos.images += 1;
      else brandLogos.empty += 1;
      continue;
    }
    if (chip) {
      if ((chip.textContent || "").trim()) brandLogos.chips += 1;
      else brandLogos.empty += 1;
      continue;
    }
    // account row with no brand tile at all (the pre-fix wallet glyph)
    brandLogos.empty += 1;
  }
  for (const element of document.querySelectorAll("button, .btn, [role=button]")) {
    if (!visible(element) || element.closest(".visually-hidden")) continue;
    const computed = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    /* Contrast only applies to a control that actually paints TEXT on its own
       fill. A toggle switch (.switch) has a solid track but no text child, so
       measuring its track against its own colour is meaningless - that produced
       11 phantom failures. Require a real text child. */
    const hasOwnText = Array.from(element.childNodes)
      .some(node => node.nodeType === 3 && node.textContent.trim());
    if (!hasOwnText) continue;
    const own = parseRgb(computed.backgroundColor);
    if (!own || own.a < 0.9) continue;          // outline/ghost: no own fill
    const fg = parseRgb(computed.color);
    if (!fg) continue;
    const lines = lineCount(element);
    if (lines > 1) {
      wrappedLabels.push({
        label: element.textContent.trim().slice(0, 28),
        id: element.id || null,
        width: Math.round(rect.width),
        lines,
      });
    }
    const px = parseFloat(computed.fontSize);
    const bold = parseInt(computed.fontWeight, 10) >= 700;
    const need = (px >= 24 || (px >= 18.66 && bold)) ? 3.0 : 4.5;
    solidControls.push({
      label: (element.textContent || "").trim().slice(0, 28) || element.id || element.tagName,
      id: element.id || null,
      ratio: +contrastRatio(fg, own).toFixed(2),
      need,
      pass: contrastRatio(fg, own) >= need,
    });
  }

  return {
    known: Array.from(known),
    rendered: Array.from(classCounts.keys()),
    unstyled,
    hookViolations,
    styles: {
      recapMoneyLabel: style(".recap-money-label"),
      recapMoneyValue: style(".recap-money-value"),
      recapMoneyNote: style(".recap-money-note"),
      recapMoneyCell: style(".recap-money-cell"),
      recapMoneyGrid: style(".recap-money-grid"),
      historyRow: style(".history-row"),
      historyRowBefore: style(".history-row", "::before"),
      chip: style(".chip"),
      itemRow: style(".item-row"),
      itemStepper: style(".item-stepper"),
      recapActionRow: style(".recap-action-row"),
      recapActionIcon: style(".recap-action-icon"),
      btnRow: style(".btn-row"),
      toggleRow: style(".toggle-row"),
      recapPersonDirection: style(".recap-person-direction"),
      recapPersonGrid: style(".recap-person-grid"),
      recapAliasBtn: style(".recap-alias-btn"),
      itemFull: style(".item-full"),
      slotMgr: style(".slot-mgr"),
    },
    tones,
    toneTokens,
    barByTone,
    homeFilter,
    solidControls,
    wrappedLabels,
    brandLogos,
    overflow: {
      html: document.documentElement.scrollWidth,
      body: document.body.scrollWidth,
      innerWidth,
      offending: overflowing,
    },
    route: location.hash,
  };
};

const setIdentityFn = value => {
  try {
    if (value) localStorage.setItem("bagiin_identity", JSON.stringify(value));
    else localStorage.removeItem("bagiin_identity");
  } catch { /* private mode */ }
};

/* ------------------------------------------------------------------ fixtures */

async function api(baseUrl, method, path, body, identity) {
  const headers = { "Content-Type": "application/json" };
  if (identity) {
    headers["X-Identity-Id"] = identity.id;
    if (identity.secret) headers["X-Identity-Secret"] = identity.secret;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${method} ${path} -> HTTP ${response.status} ${await response.text()}`);
  return response.json();
}

/**
 * Fixtures are part of the matrix, not optional: the coverage check can only
 * see a class that actually rendered, so the states below are chosen to reach
 * the whole recovery set (bill rows per tone, slot-full, guest picker, recap
 * final/provisional/actions, settings).
 */
async function seed(baseUrl) {
  const stamp = `${Date.now().toString(36)}-${process.pid}`;
  const creator = await api(baseUrl, "POST", "/api/identities", { name: `CSS Creator ${stamp}`, creator: true });
  const guest = await api(baseUrl, "POST", "/api/identities", { name: `CSS Guest ${stamp}`, creator: false });
  const other = await api(baseUrl, "POST", "/api/identities", { name: `CSS Other ${stamp}`, creator: false });
  const empty = await api(baseUrl, "POST", "/api/identities", { name: `CSS Empty ${stamp}`, creator: true });
  const bills = [];

  /* Give the creator and the guest real payment methods with known brands, so
     the payer-account rows actually render brand tiles under test. Without this
     the brand-logo assertion below never fires and the empty-pill regression
     would stay invisible. GoPay is one of the 34 brands with a logo file; the
     odd name exercises the chip fallback path. */
  await api(baseUrl, "POST", `/api/identities/${encodeURIComponent(creator.id)}/accounts`,
    { brand: "GoPay", account_no: "08990821878" }, creator);
  await api(baseUrl, "POST", `/api/identities/${encodeURIComponent(creator.id)}/accounts`,
    { brand: "Bank Nusantara Fantasi", account_no: "1234567890" }, creator);
  await api(baseUrl, "POST", `/api/identities/${encodeURIComponent(guest.id)}/accounts`,
    { brand: "Mandiri", account_no: "104276913799" }, guest);

  const createBill = async (title, items, extra = {}, owner = creator) => {
    const subtotal = items.reduce((sum, item) => sum + item.price * (item.quantity || 1), 0);
    const bill = await api(baseUrl, "POST", "/api/bills", {
      title, merchant: "Fixture", transacted_at: "2026-01-02", tax_mode: "proportional",
      subtotal, tax: 0, service: 0, order_discount: 0, cashback: 0, total: subtotal,
      items, participants: [], tax_included: false, ...extra,
    }, owner);
    const billId = String(bill?.id || bill?.bill?.id || "");
    if (!billId) throw new Error("bill API response did not include an id");
    /* DELETE /api/bills/{id} is owner-only, so remember which identity owns it. */
    bills.push({ billId, owner });
    return billId;
  };
  const detail = async (billId, viewer = creator) => api(baseUrl, "GET", `/api/bills/${encodeURIComponent(billId)}`, undefined, viewer);
  const join = (billId, who = guest) => api(baseUrl, "POST", `/api/bills/${encodeURIComponent(billId)}/join`, undefined, who);
  const pick = (billId, who, itemId, qty = 1) => api(baseUrl, "POST", `/api/bills/${encodeURIComponent(billId)}/selections`, { picks: [{ item_id: itemId, qty }] }, who);

  /* due: guest joined, picked, and has not paid -> "Belum lunas" (danger) */
  const dueBill = await createBill(`CSS due ${stamp}`, [{ name: "Nasi Goreng Spesial", price: 50000, discount: 0, quantity: 1, mode: "free" }], { participants: [guest.name] });
  await join(dueBill);
  const dueDetail = await detail(dueBill);
  await pick(dueBill, guest, dueDetail.items[0].id);

  /* idle: nobody picked anything -> "Belum dipilih" (neutral) */
  const idleBill = await createBill(`CSS idle ${stamp}`, [{ name: "Kopi", price: 30000, discount: 0, quantity: 1, mode: "free" }], { participants: [guest.name] });
  await join(idleBill);

  /* pending: named participant who has not joined -> "Menunggu memilih" */
  const pendingBill = await createBill(`CSS pending ${stamp}`, [{ name: "Teh", price: 20000, discount: 0, quantity: 1, mode: "free" }], { participants: [`CSS Absent ${stamp}`] });

  /* settled: two people, all picked and paid -> "Lunas" (success) */
  const settledBill = await createBill(`CSS settled ${stamp}`, [{ name: "Bakso", price: 40000, discount: 0, quantity: 1, mode: "free" }], { participants: [guest.name] });
  await join(settledBill);
  const settledDetail = await detail(settledBill);
  await pick(settledBill, guest, settledDetail.items[0].id);
  await pick(settledBill, creator, settledDetail.items[0].id);
  const settledAfter = await detail(settledBill);
  for (const person of settledAfter.people || []) {
    await api(baseUrl, "POST", `/api/bills/${encodeURIComponent(settledBill)}/payments/${encodeURIComponent(person.identity_id)}/paid`, {}, creator);
  }

  /* slot bill: the guest takes the only slot, so the CREATOR view renders
     .item-full / .is-full and the manager's .slot-mgr, while the GUEST view
     renders .item-row.selected / .item-stepper / .step-dec / .step-inc. */
  const slotBill = await createBill(`CSS slot ${stamp}`, [
    { name: "Pizza", price: 60000, discount: 0, quantity: 1, mode: "free" },
    { name: "Es Teh", price: 20000, discount: 0, quantity: 1, mode: "slot", slot_count: 1 },
  ], { participants: [guest.name] });
  await join(slotBill);
  const slotDetail = await detail(slotBill);
  await pick(slotBill, guest, slotDetail.items.find(item => item.mode === "slot").id);

  /* recap directions: `guest` ends up owing the creator (receive edge) and the
     creator ends up owing `other` (pay edge), and the two nets must not cancel,
     or the recap shows no counterparty card at all. */
  const otherBill = await createBill(`CSS otherowned ${stamp}`, [{ name: "Sate", price: 90000, discount: 0, quantity: 1, mode: "free" }], { participants: [creator.name] }, other);
  await join(otherBill, creator);
  const otherBillDetail = await detail(otherBill, other);
  await pick(otherBill, creator, otherBillDetail.items[0].id);

  return { creator, guest, other, empty, dueBill, idleBill, pendingBill, settledBill, slotBill, otherBill, bills, stamp };
}

/* -------------------------------------------------------------- check helpers */

function check(name, condition, detail = "") {
  checksRun += 1;
  if (condition) {
    console.log(`  ok  ${name}`);
    return true;
  }
  failures.push(name);
  console.log(` FAIL ${name}${detail ? `: ${detail}` : ""}`);
  return false;
}

function checkStyle(label, value, predicate, expectation) {
  if (value === null) return check(`${label} present`, false, "selector did not render on this route");
  return check(`${label} ${expectation}`, predicate(value), JSON.stringify(value));
}

const near = (value, expected) => value !== null && Math.abs(value - expected) < 0.01;

/* -------------------------------------------------------------------- routes */

async function main() {
  let baseUrl;
  let cdpUrl;
  try {
    baseUrl = validateLocalUrl(rawBaseUrl, "BASE_URL");
    cdpUrl = validateLocalUrl(rawCdpUrl, "CDP_URL");
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
    return;
  }
  if (typeof globalThis.WebSocket !== "function") {
    console.error("ERROR: this Node build has no global WebSocket; use Node >= 22");
    process.exitCode = 1;
    return;
  }

  let fixtures = null;
  let target = null;
  let tab = null;
  const renderedRecovery = new Set();

  const cleanup = async () => {
    tab?.close();
    if (target?.id) {
      await fetch(`${cdpUrl}/json/close/${encodeURIComponent(target.id)}`, { method: "GET" }).catch(() => undefined);
    }
  };
  process.on("SIGINT", () => { void cleanup().then(() => process.exit(130)); });
  process.on("SIGTERM", () => { void cleanup().then(() => process.exit(143)); });

  try {
    fixtures = await seed(baseUrl);
    console.log(`  ok  disposable fixtures created (${fixtures.bills.length} bills, 2 identities)`);

    const created = await fetch(`${cdpUrl}/json/new?about:blank`, { method: "PUT" });
    if (!created.ok) throw new Error(`CDP could not create a tab (HTTP ${created.status})`);
    target = await created.json();
    if (!target.id || !target.webSocketDebuggerUrl) throw new Error("CDP returned an incomplete tab target");
    tab = new CdpTab(new WebSocket(validateWebSocketUrl(target.webSocketDebuggerUrl)));
    await tab.connect();
    console.log("  ok  single disposable CDP tab opened");

    /* (a) style-rule coverage: a rule must exist for every expected recovery
       name regardless of rendering, and no visible class may be unstyled. */
    const globalUnstyled = new Map();
    const globalHookViolations = new Set();
    let expectedMissing = null;
    let rulesSeen = 0;

    for (const route of ROUTES) {
      for (const width of WIDTHS) {
       /* Dark mode is a separate token set, so a light-only matrix cannot see a
          dark contrast regression (this is how white-on-orange shipped at
          2.8:1). Walk dark on the phone widths where the controls are tightest;
          the full width ladder stays light to keep the run bounded. */
       for (const scheme of (width <= 412 ? ["light", "dark"] : ["light"])) {
        const identity = route.identity ? fixtures[route.identity] : null;
        const hash = route.bill
          ? `#/b/${encodeURIComponent(fixtures[route.bill])}`
          : route.hash;
        const height = width < 768 ? (width === 320 ? 568 : 667) : 900;
        const nonce = `${Date.now()}-${scheme}-${width}-${route.label.replace(/\W/g, "")}`;
        const errorsBefore = tab.errors.length;
        /* Any route whose label starts with "home" or "recap" is a surface with
           the checks below; keep the label match in one place so a new fixture
           variant cannot silently skip them. */
        const isHome = route.label.startsWith("home");
        const isRecap = route.label.startsWith("recap");

        await tab.colorScheme(scheme);
        await tab.viewport(width, height);
        /* The identity must be written BEFORE the app boots, so navigate to a
           nonce'd URL first, set storage, then navigate again with the hash.
           Boot-then-hash would render the onboarding screen for every route.

           The boot navigation must ALSO clear any leftover QA storage first.
           A previous driver (tools/e2e_legacy_recovery.mjs writes a
           `legacy-<stamp>` identity and never restores it) leaves a stale
           `bagiin_identity` on the QA origin, which paints Home on this boot
           navigation and fires GET /api/identities/<stale-id>/bills -> 404/403
           recorded as a page console error. That produced a false 2-of-460
           FAIL on a correct tree. One-shot and nonce-scoped, the same shape as
           tools/e2e_uiux_polish_shell.mjs, so it clears exactly once on the
           boot document and never races the identity write below. */
        const qaOrigin = new URL(baseUrl).origin;
        const cleanupScript = await tab.send("Page.addScriptToEvaluateOnNewDocument", {
          source: `(() => {
            if (location.origin !== ${JSON.stringify(qaOrigin)}) return;
            if (new URL(location.href).searchParams.get("css") !== ${JSON.stringify(`${nonce}-boot`)}) return;
            try { localStorage.clear(); } catch {}
            try { sessionStorage.clear(); } catch {}
          })();`,
        });
        try {
          await tab.navigate(`${baseUrl}/?css=${nonce}-boot`);
          await tab.waitFor(() => document.readyState === "complete", 12000);
        } finally {
          await tab.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: cleanupScript.identifier }).catch(() => undefined);
        }
        await tab.page(setIdentityFn, identity);
        await tab.navigate(`${baseUrl}/?css=${nonce}${hash}`);
        const ready = await tab.waitFor(selector => Boolean(document.querySelector(selector)), route.ready, 12000);
        if (!ready) {
          check(`${route.label} ${width}px reached ${route.ready}`, false, "ready selector never appeared");
          continue;
        }
        if (isHome) await sleep(150);
        const result = await tab.page(auditFn);
        const where = `${route.label} ${width}px`;

        rulesSeen = result.known.length;
        for (const name of result.rendered) if (EXPECTED_RECOVERY.includes(name)) renderedRecovery.add(name);
        const missing = EXPECTED_RECOVERY.filter(name => !result.known.includes(name));
        if (missing.length) expectedMissing = expectedMissing || { where, missing };

        const unstyledNames = result.unstyled.map(item => item.name).filter(name => !ALLOWLIST_NAMES.has(name)).sort();
        for (const item of result.unstyled) {
          if (!ALLOWLIST_NAMES.has(item.name)) globalUnstyled.set(item.name, item.count);
        }
        for (const name of result.hookViolations) if (ALLOWLIST_NAMES.has(name)) globalHookViolations.add(name);

        check(`${where} every visible class resolves to a CSS rule`, unstyledNames.length === 0, unstyledNames.join(", "));
        check(`${where} no horizontal overflow`, result.overflow.html <= width + 1 && result.overflow.body <= width + 1,
          `html=${result.overflow.html} body=${result.overflow.body} offenders=${JSON.stringify(result.overflow.offending)}`);
        const newErrors = tab.errors.slice(errorsBefore).filter(text => !isIgnoredError(text));
        check(`${where} no console error or page exception`, newErrors.length === 0, newErrors.slice(0, 2).join(" | "));

        /* (b2) Text on a solid control fill must clear WCAG AA. This is the
           class of bug the coverage walk cannot see: `.btn-primary` had a rule
           and resolved fine, but the dark-mode token made white-on-orange
           2.8:1, so the UI looked styled while being unreadable. */
        const contrastFails = result.solidControls.filter(control => !control.pass);
        check(`${where} solid-fill control text clears WCAG AA`, contrastFails.length === 0,
          contrastFails.map(control => `${control.id || control.label}=${control.ratio}:1<${control.need}`).join(", "));

        /* (b3) A control label must fit on one line. Two buttons sharing a
           ~320px row wrapped "Metode pembayaran" onto two lines and
           "Pilih bagian kamu" onto three inside a 46px control. */
        check(`${where} no control label wraps`, result.wrappedLabels.length === 0,
          result.wrappedLabels.map(item => `"${item.label}" ${item.lines}ln @${item.width}px`).join(", "));

        /* (b4) Payment-brand logos must actually render, not just have a rule.
           Every method used to show the same generic wallet glyph, and a logo
           that 404s would leave an empty pill next to someone's account number.

           The check counts ACCOUNT ROWS, not logo elements, so a row carrying
           the old wallet glyph is counted as empty and fails. Gating this on
           "a logo element exists" was a vacuous pass: the broken tree renders no
           logo at all, so the assertion never ran and the gate stayed green. */
        if (result.brandLogos.rows > 0) {
          check(`${where} every payment-brand row renders a logo or a labelled chip`,
            result.brandLogos.empty === 0,
            `${result.brandLogos.empty} row(s) without a brand tile of ${result.brandLogos.rows}`);
          /* And the logos must be real images, not just a chip standing in for
             everything: the fixture brands all have logo files. */
          check(`${where} known brands render decoded logo images`,
            result.brandLogos.images >= 1,
            `images=${result.brandLogos.images} chips=${result.brandLogos.chips} rows=${result.brandLogos.rows}`);
        }

        /* (c) Home filter surfaces: exactly one, on the right side of 1040px */
        if (isHome) {
          const surfaceCount = (result.homeFilter.inlineVisible ? 1 : 0) + (result.homeFilter.buttonVisible ? 1 : 0);
          const hasRows = result.homeFilter.firstRowTop !== null;
          const label = route.label;
          if (width < HOME_SWAP_BREAKPOINT) {
            /* The Atur affordance is rendered only once the list has rows (or is
               loading), so an empty list legitimately has neither surface. */
            const hasSurfaces = result.homeFilter.buttonDisplay !== null || result.homeFilter.present;
            check(`${label} ${width}px shows only the Atur affordance`,
              hasRows
                ? result.homeFilter.inlineVisible === false && result.homeFilter.buttonVisible === true
                : result.homeFilter.inlineVisible === false,
              JSON.stringify(result.homeFilter));
            if (hasRows) {
              check(`${label} ${width}px Atur keeps a 44px tap target`,
                result.homeFilter.buttonRect !== null && result.homeFilter.buttonRect.height >= 44 && result.homeFilter.buttonRect.width >= 44,
                JSON.stringify(result.homeFilter.buttonRect));
            } else {
              check(`${label} ${width}px has no orphan filter surface`, hasSurfaces, JSON.stringify(result.homeFilter));
            }
            check(`${label} ${width}px inline chips/selects are hidden`,
              result.homeFilter.inlineChips === 0 && result.homeFilter.inlineSelects === 0,
              JSON.stringify({ chips: result.homeFilter.inlineChips, selects: result.homeFilter.inlineSelects }));
            if (width === 390 && hasRows) {
              const top = result.homeFilter.firstRowTop;
              console.log(`  measure ${label} 390x844 firstRowTop=${top} surfaces=${surfaceCount}`);
              check(`${label} 390px first bill row is reachable in the top half`,
                top < 500, `firstRowTop=${top}`);
            }
          } else {
            check(`${label} ${width}px shows only the inline controls`,
              result.homeFilter.inlineVisible === true && result.homeFilter.buttonVisible === false
                && result.homeFilter.inlineDisplay === "block",
              JSON.stringify(result.homeFilter));
            if (width === 1280 && hasRows) {
              console.log(`  measure ${label} 1280x900 firstRowTop=${result.homeFilter.firstRowTop} surfaces=${surfaceCount}`);
            }
          }
        }

        /* (b) computed-style regression on the named selector set */
        const s = result.styles;
        if (isRecap) {
          checkStyle(`${where} .recap-money-label`, s.recapMoneyLabel, v => v.display === "block", "is display:block");
          checkStyle(`${where} .recap-money-value`, s.recapMoneyValue,
            v => v.display === "block" && v.fontSize > 16, "is block and larger than 16px");
          checkStyle(`${where} .recap-money-note`, s.recapMoneyNote, v => v.display === "block", "is display:block");
          checkStyle(`${where} .recap-money-cell`, s.recapMoneyCell, v => v.paddingLeft > 0, "has cell padding");
          if (s.recapMoneyGrid) {
            const singleColumn = s.recapMoneyGrid.gridTemplateColumns.trim().split(/\s+/).length === 1;
            check(`${where} .recap-money-grid columns`, width < 360 ? singleColumn : !singleColumn,
              s.recapMoneyGrid.gridTemplateColumns);
          }
          if (s.recapActionRow) {
            checkStyle(`${where} .recap-action-row`, s.recapActionRow, v => v.display === "grid" && /^\d/.test(v.gridTemplateColumns), "is a grid");
            checkStyle(`${where} .recap-action-icon`, s.recapActionIcon, v => near(v.borderRadius, 10), "has the 10px radius");
          }
          if (s.recapPersonDirection) {
            checkStyle(`${where} .recap-person-direction`, s.recapPersonDirection, v => v.paddingTop > 0, "has direction padding");
          }
          if (s.recapPersonGrid) {
            const columns = s.recapPersonGrid.gridTemplateColumns.trim().split(/\s+/).length;
            check(`${where} .recap-person-grid is single column below 1040px and two above`,
              width < HOME_SWAP_BREAKPOINT ? columns === 1 : columns === 2, s.recapPersonGrid.gridTemplateColumns);
          }
        }
        if (isHome) {
          if (result.homeFilter.firstRowTop === null) {
            /* home-empty: no bill row exists, so only the empty state is
               asserted and the row-derived checks are skipped on purpose. */
            check(`${where} empty state renders`, result.rendered.includes("empty-state"),
              JSON.stringify(result.rendered.slice(0, 20)));
          } else {
            checkStyle(`${where} .history-row`, s.historyRow, v => v.paddingLeft >= 14, "keeps a 16px left inset");
            checkStyle(`${where} .history-row::before`, s.historyRowBefore, v => v.display === "block", "renders the status bar");
            /* The bar must actually carry its tone. Asserting only that it
               renders let a tone-name mismatch through: the bar keyed on
               ok/due/idle while HomeRoute emits danger/neutral/success, so
               every row's bar measured --border-strong in every state. Assert
               the COLOUR, read against the border-strong fallback. */
            if (s.historyRowBefore && s.historyRowBefore.backgroundColor) {
              const barColors = new Set(
                Object.entries(result.barByTone || {})
                  .filter(([, value]) => value)
                  .map(([, value]) => value),
              );
              check(`${where} .history-row::before is tinted per status tone`,
                barColors.size > 0 && ![...barColors].every(color => color === result.toneTokens.borderStrong),
                JSON.stringify({ barByTone: result.barByTone, borderStrong: result.toneTokens.borderStrong }));
            }
            checkStyle(`${where} .chip`, s.chip, v => v.borderRadius >= 99 && v.paddingLeft >= 9.99, "is a pill with 10px padding");
            const tone = result.tones;
            const expected = result.toneTokens;
            const renderedTones = Object.entries(tone).filter(([, value]) => value !== null);
            check(`${where} renders at least one tinted status-mark`, renderedTones.length > 0, JSON.stringify(tone));
            if (width === 390) {
              const summary = renderedTones.map(([name, value]) => `${name}=${value}`).join(" ");
              console.log(`  measure ${where} status tones: ${summary} (danger token ${expected.danger}, success token ${expected.success}, neutral token ${expected.neutral})`);
            }
            for (const [name, value] of renderedTones) {
              const key = name === "due" ? "danger" : name === "ok" ? "success" : name === "idle" ? "neutral" : name;
              check(`${where} status-${name} uses the ${key} token`, value === expected[key],
                `computed=${value} expected=${expected[key]}`);
            }
            if (tone.danger && tone.success) {
              check(`${where} danger and success tones differ`, tone.danger !== tone.success, `${tone.danger} vs ${tone.success}`);
            }
          }
        }
        if (route.label === "bill-guest") {
          checkStyle(`${where} .item-row`, s.itemRow, v => v.display === "flex", "is flex (legacy layout)");
          if (s.itemStepper) {
            checkStyle(`${where} .item-stepper`, s.itemStepper, v => v.display === "flex" || v.display === "inline-flex", "is a flex container");
          }
        }
        if (route.label.startsWith("bill-creator")) {
          if (s.btnRow) {
            /* The row is flex on desktop and stacks to a single-column grid on
               phones (v90: two buttons sharing a ~320px row wrapped "Metode
               pembayaran" onto 2 lines and "Pilih bagian kamu" onto 3). Both
               shapes are correct; a third value is not. */
            checkStyle(`${where} .btn-row`, s.btnRow,
              v => v.display === "flex" || v.display === "grid",
              "is a flex row or a stacked phone grid");
          }
          if (route.bill === "slotBill" && s.slotMgr) {
            /* Legacy's `.item-price, .item-row .slot-mgr { order:2 }` is scoped
               to a button INSIDE an item row. This fixture renders the slot
               manager in the `Bagian per porsi` list, which is not an item row,
               so it must keep the default order there. */
            check(`${where} .slot-mgr is not reordered outside an item row`,
              s.slotMgr.order === "0", JSON.stringify({ order: s.slotMgr.order, display: s.slotMgr.display }));
          }
          if (route.bill === "slotBill" && s.itemFull) {
            checkStyle(`${where} .item-full`, s.itemFull, v => v.display === "flex", "keeps the flex row");
          }
        }
        if (route.label === "settings") {
          if (s.toggleRow) {
            checkStyle(`${where} .toggle-row`, s.toggleRow, v => v.minHeight >= 44, "keeps a 44px minimum height");
          }
        }
       }
      }
    }

    /* Coverage summary: independent of which states happened to render. */
    check("CSSOM walk found the built stylesheet rules", rulesSeen > 100, `rules=${rulesSeen}`);
    check("every expected recovery class has a CSS rule", expectedMissing === null,
      expectedMissing ? `${expectedMissing.missing.join(", ")} (first seen on ${expectedMissing.where})` : "");
    check("no visible class is unstyled", globalUnstyled.size === 0,
      Array.from(globalUnstyled.keys()).sort().join(", "));
    check("the allowlist stays honest (every hook has a ruled sibling class)",
      globalHookViolations.size === 0, Array.from(globalHookViolations).sort().join(", "));
    const notRendered = EXPECTED_RECOVERY.filter(name => !renderedRecovery.has(name)).sort();
    console.log(`  cover rendered recovery classes: ${EXPECTED_RECOVERY.length - notRendered.length}/${EXPECTED_RECOVERY.length}`
      + (notRendered.length ? ` (not reached by a fixture state: ${notRendered.join(", ")})` : ""));

    await sleep(250);
    check("no console error or page exception in the whole run",
      tab.errors.filter(text => !isIgnoredError(text)).length === 0,
      tab.errors.filter(text => !isIgnoredError(text)).slice(0, 3).join(" | "));
  } catch (error) {
    check("css coverage driver completed", false, error.message);
  } finally {
    if (fixtures) {
      for (const { billId, owner } of fixtures.bills) {
        try {
          await api(baseUrl, "DELETE", `/api/bills/${encodeURIComponent(billId)}`, undefined, owner);
        } catch (error) {
          check(`disposable bill ${billId} deleted`, false, error.message);
        }
      }
      console.log(`  ok  ${fixtures.bills.length} disposable fixture bills deleted`);
    }
    await cleanup();
    console.log("  ok  disposable CDP tab closed");
  }

  if (checksRun < MIN_CHECKS) {
    console.log(`RESULT FAIL (only ${checksRun} checks ran; floor is ${MIN_CHECKS})`);
    process.exitCode = 1;
    return;
  }
  if (failures.length) {
    console.log(`RESULT FAIL (${failures.length} of ${checksRun} checks failed)`);
    process.exitCode = 1;
  } else {
    console.log(`RESULT PASS (checks=${checksRun}; routes=${ROUTES.length}; widths=${WIDTHS.join(",")}; recovery=${EXPECTED_RECOVERY.length})`);
    process.exitCode = 0;
  }
}

await main();
