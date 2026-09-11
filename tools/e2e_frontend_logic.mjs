import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const screens = await readFile(new URL("../frontend/static/screens.js", import.meta.url), "utf8");
const bill = await readFile(new URL("../frontend/static/bill.js", import.meta.url), "utf8");
const app = await readFile(new URL("../frontend/static/app.js", import.meta.url), "utf8");
const recap = await readFile(new URL("../frontend/static/recap.js", import.meta.url), "utf8");
const create = await readFile(new URL("../frontend/static/create.js", import.meta.url), "utf8");
const index = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");

// Regression contracts for async screen races. Keep these source-level and
// deterministic: they run without a server, browser, or test data.
assert.match(screens, /let billListGeneration\s*=\s*0/);
assert.match(screens, /const generation = \+\+billListGeneration/);
assert.match(screens, /const isCurrent = \(\) => generation === billListGeneration/);
assert.doesNotMatch(screens, /histBills|bagiin:derived-invalidated/);
assert.match(screens, /if \(!isCurrent\(\)\) return;\n\s*if \(!Array\.isArray\(bills\)/);
const loadBillListSource = screens.slice(
  screens.indexOf("async function loadBillList"),
  screens.indexOf("// ---------- Settings / Akun ----------"),
);
const loadBillListCatchStart = loadBillListSource.indexOf("  } catch (e) {");
const loadBillListCatchEnd = loadBillListSource.indexOf("\n  }\n}", loadBillListCatchStart);
const loadBillListCatch = loadBillListSource.slice(loadBillListCatchStart, loadBillListCatchEnd);
assert.match(
  loadBillListCatch,
  /if \(!isCurrent\(\)\) return;\n\s*(?:const ctlBtn = \$\("#list-ctl-btn"\);\n\s*if \(ctlBtn\) \{\n\s*ctlBtn\.disabled = true;\n\s*ctlBtn\.setAttribute\("aria-busy", "false"\);\n\s*\}\n\s*)?box\.innerHTML = identityErrorHtml\(e\)/,
);

assert.match(screens, /let settingsRenderGeneration\s*=\s*0/);
assert.match(screens, /const renderGeneration = \+\+settingsRenderGeneration/);
assert.match(screens, /const isCurrentSettings = \(\) => renderGeneration === settingsRenderGeneration/);
assert.match(screens, /const info = await api\([^;]+\);\n\s*if \(!isCurrentSettings\(\)\) return;/);
assert.match(screens, /const accts = await api\([^;]+\);\n\s*if \(!isCurrentSettings\(\)\) return;/);
const accountCreateStart = screens.indexOf("/api/identities/${me.id}/accounts");
assert.ok(accountCreateStart >= 0, "account-create request must remain present");
const accountCreate = screens.slice(accountCreateStart, screens.indexOf("// paste-text account parser", accountCreateStart));
assert.match(accountCreate, /await apiJson[\s\S]*?if \(!isCurrentSettings\(\)\) return;[\s\S]*?account-form/);
assert.match(accountCreate, /catch \(err\) \{\s*if \(!isCurrentSettings\(\)\) return;\s*toast\(err\.message\)/);

assert.match(screens, /let inviteGeneration\s*=\s*0/);
assert.match(screens, /function renderHome\(\) \{[\s\S]*?billListGeneration \+= 1;\n\s*inviteGeneration \+= 1;/);
assert.match(screens, /const generation = \+\+inviteGeneration/);
assert.match(screens, /const isCurrent = \(\) => generation === inviteGeneration[\s\S]*box\.isConnected/);
const inviteSource = screens.slice(screens.indexOf("async function loadHomeInvites"), screens.indexOf("/** The row tone"));
assert.doesNotMatch(inviteSource, /billListGeneration/);
assert.match(inviteSource, /invites\/\$\{invId\}\/accept[\s\S]*loadHomeInvites\(\);\n\s*loadBillList\(false\)/);
assert.match(inviteSource, /invites\/\$\{invId\}\/decline[\s\S]*loadHomeInvites\(\);/);
assert.match(screens, /await api\([^;]+invites[\s\S]*if \(!isCurrent\(\)\) return;\n\s*if \(!invites\.length\)/);
assert.match(screens, /await apiJson\([^;]+invites\/\$\{invId\}\/accept[\s\S]*if \(!isCurrent\(\)\) return;\n\s*toast/);
assert.match(screens, /await apiJson\([^;]+invites\/\$\{invId\}\/decline[\s\S]*if \(!isCurrent\(\)\) return;\n\s*toast/);

assert.match(screens, /const showGeneratedCode = \(code\) => \{\n\s*if \(!isCurrentSettings\(\)\) return;/);
assert.match(screens, /await apiJson\([^;]+code\/generate[\s\S]*if \(!isCurrentSettings\(\)\) return;\n\s*showGeneratedCode/);
assert.match(screens, /await apiJson\([^;]+auto_accept[\s\S]*if \(!isCurrentSettings\(\)\) return;\n\s*toast/);
assert.match(screens, /catch \(e\) \{\n\s*if \(!isCurrentSettings\(\)\) return;\n\s*sw\.setAttribute/);
assert.match(screens, /finally \{\n\s*if \(!isCurrentSettings\(\)\) return;\n\s*sw\.disabled = false/);

// The mobile app nav is a route surface, not a second router. Keep the exact
// three destinations and make the visibility/active-state lifecycle explicit
// so a later refactor cannot quietly reintroduce duplicate home controls.
assert.match(index, /<nav id="app-nav" aria-label="Navigasi utama" hidden><\/nav>/);
assert.match(app, /key: "recap", label: "Rekap", href: "#\/recap"/);
assert.match(app, /key: "bill", label: "Bill", href: "#\//);
assert.match(app, /key: "settings", label: "Akun", href: "#\/settings"/);
assert.match(app, /function setAppNavRoute\(route\)/);
assert.match(app, /nav\.hidden = !eligible/);
assert.match(app, /link\.classList\.toggle\("is-active", active\)/);
assert.match(app, /link\.setAttribute\("aria-current", "page"\)/);
assert.match(app, /const surface = activeDock \|\| \(!onDesktop \? appNav : null\)/);
assert.match(app, /const reserve = `calc\(env\(safe-area-inset-bottom\) \+ \$\{surface\.offsetHeight \+ 24\}px\)`/);
assert.match(app, /setAppNavRoute\(null\);[\s\S]*setAppNavRoute\("settings"\)/);
assert.match(app, /setAppNavRoute\(null\);[\s\S]*setAppNavRoute\("recap"\)/);
assert.match(app, /setAppNavRoute\(null\);[\s\S]*setAppNavRoute\("bill"\)/);
assert.match(app, /function clearAppNavBadge\(\)/);
assert.match(app, /function updateAppNavBadge\(data\)/);
assert.match(app, /counts\.current_user/);
assert.match(app, /Array\.isArray\(actions\.current_user\)/);
assert.match(app, /syncDerivedCacheIdentity\(nextId\);[\s\S]*clearAppNavBadge\(\);/);
assert.match(app, /derivedDataCache\.billList = newDerivedCacheEntry\(\);\n\s*clearAppNavBadge\(\);/);
assert.doesNotMatch(app, /has-app-nav|bagiin:derived-invalidated/);
const appNavSetter = app.slice(app.indexOf("function setAppNavRoute"), app.indexOf("// v68b: real brand logos"));
assert.doesNotMatch(appNavSetter, /syncAppNav\(\)/);
assert.match(appNavSetter, /syncDockSpace\(\)/);

// Hash routing accepts the exact public route set only. Execute the production
// parser and predicate so suffixes cannot silently render a private screen.
const routerSource = app.slice(
  app.indexOf("function parseHash"),
  app.indexOf("function render()", app.indexOf("function parseHash")),
);
const routerHarness = vm.runInNewContext(`
  const location = { hash: "" };
  ${routerSource}
  ({ location, parseHash, isKnownHashRoute });
`);
const routeCases = [
  ["", true],
  ["#/", true],
  ["#/history", true],
  ["#/recap", true],
  ["#/settings", true],
  ["#/create", true],
  ["#/create/verify", true],
  ["#/b/bill-123", true],
  ["#/settings/", false],
  ["#//settings", false],
  ["#/create//verify", false],
  ["#/b/bill-123/", false],
  ["#/history/extra", false],
  ["#/recap/extra", false],
  ["#/settings/extra", false],
  ["#/create/extra", false],
  ["#/create/verify/extra", false],
  ["#/b/bill-123/extra", false],
  ["#/b", false],
];
for (const [hash, valid] of routeCases) {
  routerHarness.location.hash = hash;
  const { parts } = routerHarness.parseHash();
  assert.equal(
    routerHarness.isKnownHashRoute(parts),
    valid,
    `${hash || "(empty hash)"} route acceptance`,
  );
}
const routerRenderSource = app.slice(
  app.indexOf("function render()"),
  app.indexOf("// ---------- navigation leave-guard"),
);
assert.match(
  routerRenderSource,
  /if \(!knownRoute\) \{[\s\S]*history\.replaceState\(null, "", "#\/"\);[\s\S]*return render\(\);/,
  "invalid hash routes must canonicalize to #/",
);

// Focus scrolling uses the document scroll container on mobile. Keep the
// measured reserve mirrored there, and clear it on routes/surfaces that do not
// have a fixed dock so desktop and app-nav layouts do not inherit mobile space.
const dockSpaceSource = app.slice(app.indexOf("function syncDockSpace"), app.indexOf("const dockObserver"));
assert.match(dockSpaceSource, /document\.documentElement\.style\.scrollPaddingBottom = reserve/);
assert.match(dockSpaceSource, /document\.documentElement\.style\.scrollPaddingBottom = ""/);
assert.match(dockSpaceSource, /if \(!app\) \{[\s\S]*document\.documentElement\.style\.scrollPaddingBottom = ""/);

// Every generated dialog must expose an accessible name. Prefer a generated,
// DOM-safe title id; sheets without a title get an explicit fallback label.
assert.match(app, /function nameSheetDialog\(overlay, sheet, opts\)/);
assert.match(app, /const titleId = `bagiin-sheet-title-\$\{\+\+sheetTitleSerial\}`/);
assert.match(app, /overlay\.setAttribute\("aria-labelledby", titleId\)/);
assert.match(app, /overlay\.setAttribute\("aria-label", fallback\)/);
assert.match(app, /nameSheetDialog\(overlay, sheet, opts\);/);
const sheetA11ySource = app.slice(
  app.indexOf("let sheetTitleSerial"),
  app.indexOf("function drainSelfPops"),
);
const sheetA11yHarness = vm.runInNewContext(`
  let sheetTitleSerial = 0;
  const $ = (selector, root) => root.querySelector(selector);
  ${sheetA11ySource.replace("let sheetTitleSerial = 0;", "")}
  ({ nameSheetDialog });
`);
function fakeSheet(titleText) {
  const title = titleText == null ? null : { textContent: titleText, id: "" };
  const attrs = {};
  return {
    title,
    sheet: { querySelector(selector) { assert.equal(selector, ".sheet-title"); return title; } },
    overlay: {
      setAttribute(name, value) { attrs[name] = value; },
      attrs,
    },
  };
}
const titledSheet = fakeSheet("Nama lokal");
sheetA11yHarness.nameSheetDialog(titledSheet.overlay, titledSheet.sheet, {});
assert.equal(titledSheet.title.id, "bagiin-sheet-title-1");
assert.equal(titledSheet.overlay.attrs["aria-labelledby"], "bagiin-sheet-title-1");
const secondTitledSheet = fakeSheet("Metode bayar");
sheetA11yHarness.nameSheetDialog(secondTitledSheet.overlay, secondTitledSheet.sheet, {});
assert.equal(secondTitledSheet.title.id, "bagiin-sheet-title-2");
assert.equal(secondTitledSheet.overlay.attrs["aria-labelledby"], "bagiin-sheet-title-2");
const fallbackSheet = fakeSheet(null);
sheetA11yHarness.nameSheetDialog(fallbackSheet.overlay, fallbackSheet.sheet, {});
assert.equal(fallbackSheet.overlay.attrs["aria-label"], "Dialog");
const customFallbackSheet = fakeSheet("");
sheetA11yHarness.nameSheetDialog(customFallbackSheet.overlay, customFallbackSheet.sheet, { ariaLabel: "Foto struk" });
assert.equal(customFallbackSheet.overlay.attrs["aria-label"], "Foto struk");

// Payment brand values are persisted as entered, so both the initial HTML
// renderer and the async chip upgrade must resolve manifest keys by casing,
// while unknown values keep the escaped text-chip fallback.
const brandSource = app.slice(
  app.indexOf("// v68b: real brand logos"),
  app.indexOf("// Shared bill status source of truth"),
);
assert.match(brandSource, /function brandLogoFile\(code\)/);
assert.match(brandSource, /brandLogoFile\(chip\.dataset\.code\)/);
assert.match(brandSource, /const file = brandLogoFile\(code\)/);
const escSource = app.match(/function esc\(s\) \{[^\n]*\}/)?.[0];
const brandChipHtmlSource = screens.match(/function brandChipHtml\(code\) \{[\s\S]*?\n\}/)?.[0];
const brandLogoFileSource = brandSource.match(/function brandLogoFile\(code\) \{[\s\S]*?\n\}/)?.[0];
const brandLogoHtmlSource = brandSource.match(/function brandLogoHtml\(code\) \{[\s\S]*?\n\}/)?.[0];
const upgradeBrandChipsSource = brandSource.match(/function upgradeBrandChips\(root\) \{[\s\S]*?\n\}/)?.[0];
assert.ok(escSource, "production esc renderer must be executable");
assert.ok(brandChipHtmlSource, "production brand chip renderer must be executable");
assert.ok(brandLogoFileSource, "brand manifest lookup must be executable");
assert.ok(brandLogoHtmlSource, "brand logo renderer must be executable");
assert.ok(upgradeBrandChipsSource, "async brand upgrade must be executable");

const upgradedLogoNode = { kind: "bca-logo" };
const chips = [
  { dataset: { code: "bca" }, replaceWith(node) { this.replacedWith = node; } },
  { dataset: { code: "mystery-bank" }, replaceWith(node) { this.replacedWith = node; } },
];
const fakeRoot = {
  querySelectorAll(selector) {
    assert.equal(selector, ".brand-chip[data-code]");
    return chips;
  },
};
const fakeDocument = {
  createElement(tag) {
    assert.equal(tag, "template");
    const template = { content: { firstElementChild: null } };
    Object.defineProperty(template, "innerHTML", {
      set(value) {
        template.content.firstElementChild = value.includes("/bca.svg") ? upgradedLogoNode : null;
      },
    });
    return template;
  },
};
const brandHarness = vm.runInNewContext(`
  const BRAND_LOGOS = { BCA: "bca.svg", Mandiri: "mandiri.svg" };
  function brandInfo() { return null; }
  function chipTextColor() { return "#fff"; }
  ${escSource}
  ${brandChipHtmlSource}
  ${brandLogoFileSource}
  ${brandLogoHtmlSource}
  ${upgradeBrandChipsSource}
  ({ brandLogoFile, brandLogoHtml, brandChipHtml, upgradeBrandChips });
`, { document: fakeDocument });
assert.equal(brandHarness.brandLogoFile("bca"), "bca.svg");
assert.equal(brandHarness.brandLogoFile("BCA"), "bca.svg");
assert.equal(brandHarness.brandLogoFile(" bca "), "bca.svg");
assert.equal(brandHarness.brandLogoFile("mystery-bank"), null);
assert.equal(brandHarness.brandLogoFile("toString"), null);
assert.match(brandHarness.brandLogoHtml("bca"), /class="brand-logo"/);
assert.match(brandHarness.brandLogoHtml("bca"), /\/bca\.svg/);
assert.equal(
  brandHarness.brandLogoHtml("mystery-bank"),
  '<span class="brand-chip" data-code="mystery-bank" style="background:#6B6259;color:#fff">mystery-bank</span>',
);
assert.equal(
  brandHarness.brandLogoHtml("toString"),
  '<span class="brand-chip" data-code="toString" style="background:#6B6259;color:#fff">toString</span>',
);
const maliciousUnknownBrand = '"><script>alert(\'x\')</script>&';
const escapedMaliciousUnknownBrand = "&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;";
const maliciousFallback = brandHarness.brandLogoHtml(maliciousUnknownBrand);
assert.equal(
  maliciousFallback,
  `<span class="brand-chip" data-code="${escapedMaliciousUnknownBrand}" style="background:#6B6259;color:#fff">${escapedMaliciousUnknownBrand}</span>`,
);
assert.doesNotMatch(maliciousFallback, /<script\b/i);
brandHarness.upgradeBrandChips(fakeRoot);
assert.equal(chips[0].replacedWith, upgradedLogoNode);
assert.equal(chips[1].replacedWith, undefined);

assert.match(recap, /updateAppNavBadge\(data\)/);
assert.match(recap, /Loading and retry states are intentionally badge-free/);
assert.match(recap, /clearAppNavBadge\(\);\n\s*content\.innerHTML = recapErrorHtml/);
assert.match(screens, /class="right home-desktop-routes"[\s\S]*id="recap-btn"[\s\S]*id="settings-btn"/);
assert.match(index, /home-desktop-routes/);
assert.match(screens, /id="create-btn"/);

// The optimistic split remains available for the picker, but its number must
// be visibly labeled as pending until the authoritative server payload lands.
assert.match(bill, /totalLabel\.textContent = cashbackPending[\s\S]*?"Perkiraan sebelum cashback"[\s\S]*?useServer \? "Total kamu" : "Perkiraan total kamu"/);
assert.match(bill, /cashbackPending[\s\S]*?`Perkiraan sebelum cashback \$\{fmt\(bd\.total\)\}`/);

// A final allocation can remain open and unpaid. The creator no longer has a
// Close Bill control, but pending allocation warnings, legacy reopen handling,
// and payment-state rendering must remain intact.
const creatorView = bill.slice(
  bill.indexOf("function renderCreatorView"),
  bill.indexOf("// ---------- Creator toggles"),
);
assert.doesNotMatch(creatorView, /close-bill-btn/);
assert.doesNotMatch(creatorView, /openCloseConfirm|closeBillWarningBody/);
assert.doesNotMatch(bill, /function closeBillWarningBody\(data\)/);
assert.doesNotMatch(bill, /function openCloseConfirm\(data\)/);
assert.doesNotMatch(bill, /\/api\/bills\/\$\{data\.bill\.id\}\/close/);
assert.match(bill, /function pendingPickerNamesFor\(data\)/);
assert.match(bill, /pendingPickerNames/);
assert.match(bill, /data\.uncovered_slots/);
assert.match(bill, /data\.warnings/);
assert.match(bill, /pendingPickerNamesFor\(data\)/);
assert.match(bill, /pendingPickerNames\.map\(m => esc\(m\)/);
assert.match(creatorView, /const dedup = \(data\.warnings \|\| \[\]\)/);
assert.match(creatorView, /id="reopen-bill-btn"/);
assert.match(bill, /function openReopenConfirm\(data\)/);
assert.match(bill, /\/api\/bills\/\$\{data\.bill\.id\}\/reopen/);
assert.match(bill, /data\.settled/);
assert.match(bill, /data\.all_paid/);
assert.match(bill, /data\.settled_manual/);
assert.match(app, /function renderBillStatusChip\(data, closed, totalUnpaid, soloSoFar\)/);
const statusChip = app.slice(
  app.indexOf("function renderBillStatusChip"),
  app.indexOf("// ---------- API ----------"),
);
const uncoveredCheck = statusChip.indexOf("if (uncoveredIdr > 0)");
const allPaidCheck = statusChip.indexOf("if (data.all_paid)");
assert.ok(uncoveredCheck >= 0, "status chip must explain uncovered money");
assert.ok(allPaidCheck > uncoveredCheck, "all_paid must not mask uncovered money");
assert.match(statusChip, /if \(data\.settled\)\s*\n\s*return [\s\S]*Lunas/);
assert.match(screens, /function billListUncoveredIdr\(b\)/);
assert.match(screens, /all_paid: b\.all_paid, uncovered_idr: uncoveredIdr/);
assert.match(app, /if \(method !== "GET" && method !== "HEAD"\) \{[\s\S]*invalidateDerivedData/);

// The create flow sends a selected receipt batch as one ordered OCR request,
// while the manual fallback still uses the existing one-photo endpoint. Keep
// these source-level so the two-photo cap and cleanup wiring stay deterministic
// without needing a browser, server, or provider credentials.
assert.match(create, /const MAX_RECEIPT_PHOTOS = 2/);
assert.match(create, /const MAX_RECEIPT_PHOTO_BYTES = 5 \* 1024 \* 1024/);
assert.match(create, /const MAX_RECEIPT_BATCH_BYTES = 10 \* 1024 \* 1024/);
assert.match(create, /RECEIPT_PHOTO_GUIDE_COPY = .*harga asli dan harga diskon/);
assert.doesNotMatch(create, /RECEIPT_PHOTO_(?:LIMIT|SIZE|GUIDE)_COPY = [^;\n]*—/);
assert.match(create, /function validateReceiptPhotoBatch\(files/);
assert.match(create, /const source = files && typeof files\.type === "string" \? \[files\] : files/);
assert.match(create, /if \(photoFiles\.length > maxCount\)/);
assert.match(create, /if \(totalBytes > MAX_RECEIPT_BATCH_BYTES\)/);
assert.match(create, /Array\.from\(e\.dataTransfer\?\.files \|\| \[\]\)/);
assert.match(create, /Array\.from\(fileInput\.files \|\| \[\]\)/);
assert.match(create, /accept="image\/\*" multiple/);

const photoNormalizer = create.slice(
  create.indexOf("function photoPathsFromResponse"),
  create.indexOf("function newCreateFlow"),
);
assert.match(photoNormalizer, /if \(legacyPath\) photos\.push\(legacyPath\)/);
assert.match(photoNormalizer, /!photos\.includes\(path\)/);
assert.match(photoNormalizer, /photo_path: photos\[0\] \|\| null/);

const ocrSource = create.slice(
  create.indexOf("async function uploadAndOcr"),
  create.indexOf("// ---------- Clipboard", create.indexOf("async function uploadAndOcr")),
);
assert.match(ocrSource, /const fd = new FormData\(\);/);
assert.match(ocrSource, /for \(const file of photoFiles\) \{\s*fd\.append\("file", file\);\s*\}/);
assert.equal((ocrSource.match(/api\(["']\/api\/ocr["']/g) || []).length, 1,
  "a selected photo batch must make exactly one /api/ocr request");
assert.match(ocrSource, /normalizedResult\.photos/);

// The editor remains compatible with legacy photo_path responses, preserves
// the first path, and keeps the same hard limit after re-renders and retry.
assert.match(create, /ocrRetryFiles/);
assert.match(create, /verifyState\.photos\.length < MAX_RECEIPT_PHOTOS/);
assert.match(create, /\(verifyState\.photos \|\| \[\]\)\.length >= MAX_RECEIPT_PHOTOS/);
assert.match(create, /input\.multiple = true/);
assert.match(create, /const uploadedPhotoPaths = \[\]/);
assert.match(create, /releaseAbandonedPhotos\(uploadedPhotoPaths\.filter/);
assert.match(create, /releaseReturnedPhotos\(returnedPhotoPaths\(e\)\)/);

// Shared payment cashback is a separate user-entered adjustment. Keep its
// copy, payload key, and validation contract executable so it cannot drift
// back into the receipt/order-discount field.
assert.match(create, /label for="cashback-input">Cashback yang dibagi \(Rp\)<\/label>/);
assert.match(create, /Cashback ini tidak tercetak di struk\. Isi hanya kalau yang bayar mau membaginya; kalau cashback milik yang bayar saja, isi 0\./);
assert.match(bill, /label for="cashback-input">Cashback yang dibagi \(Rp\)<\/label>/);
assert.match(bill, /Cashback ini tidak tercetak di struk\. Isi hanya kalau yang bayar mau membaginya; kalau cashback milik yang bayar saja, isi 0\./);
assert.match(create, /order_discount: totals\.orderDiscount,\n\s*cashback: totals\.cashback,/);
assert.match(bill, /order_discount: totals\.orderDiscount,\n\s*cashback: totals\.cashback,/);
assert.match(create, /function renderVerify\(ocr, manual = false, preserveCashback = false\)/);
assert.match(create, /cashback: preserveCashback \? \(ocr\.cashback \?\? ocr\.cashback_idr \?\? 0\) : 0,/);
assert.match(create, /renderVerify\(next, verifyState\.manual, true\)/);

const verifyCalcSource = create.slice(
  create.indexOf("function recalculateVerifyDraft"),
  create.indexOf("async function createBillFinal"),
);
const editCalcSource = bill.slice(
  bill.indexOf("function updateEditTotal"),
  bill.indexOf("async function saveEditBill"),
);
for (const [name, source] of [["verify", verifyCalcSource], ["edit", editCalcSource]]) {
  assert.match(source, /preCashbackTotal[\s\S]*subtotal \+ tax \+ service - orderDiscount/,
    `${name} total must subtract cashback after fees`);
  assert.match(source, /preCashbackTotal - cashback/,
    `${name} total must use the post-cashback equation`);
  assert.match(source, /cashbackTooHigh/,
    `${name} editor must cap cashback at the pre-cashback total`);
}

const verifyCashbackSource = create.slice(
  create.indexOf("function verifyCashbackDraft"),
  create.indexOf("function renderVerify"),
);
const editCashbackSource = bill.slice(
  bill.indexOf("function editCashbackDraft"),
  bill.indexOf("function renderEditBill"),
);
const cashbackHarness = vm.runInNewContext(`
  ${verifyCashbackSource}
  ${editCashbackSource}
  ({ verifyCashbackDraft, editCashbackDraft });
`);
for (const draft of [cashbackHarness.verifyCashbackDraft, cashbackHarness.editCashbackDraft]) {
  assert.equal(draft(null).value, 0);
  assert.equal(draft(50_000).value, 50_000);
  assert.equal(draft(50_000).invalid, false);
  assert.equal(draft(-1).invalid, true);
  assert.equal(draft(1.5).invalid, true);
  assert.equal(draft("50.000").invalid, true);
  assert.equal(draft(10 ** 12 + 1).invalid, true);
}

// The displayed breakdown must use the server row, while old/missing fields
// stay on the zero-cashback visual path.
const breakdownSource = bill.slice(
  bill.indexOf("function moneyField"),
  bill.indexOf("function myBreakdown"),
);
const breakdownRenderSource = bill.slice(
  bill.indexOf("function billCostSummaryHtml"),
  bill.indexOf("function personalBreakdownHtml"),
);
const serverBreakdownHarness = vm.runInNewContext(`
  ${breakdownSource}
  const fmt = value => String(value);
  ${breakdownRenderSource}
  ({ serverPersonBreakdown, billCostSummaryHtml, personBreakdownRowsHtml });
`);
const legacyBreakdown = serverBreakdownHarness.serverPersonBreakdown({
  subtotal_idr: 100_000, tax_idr: 10_000, total_idr: 110_000,
});
assert.equal(legacyBreakdown.cashback, 0);
assert.equal(serverBreakdownHarness.billCostSummaryHtml({ bill: {
  subtotal_idr: 100_000, tax_idr: 10_000, service_idr: 0, total_idr: 110_000,
} }), "");
const sharedBreakdown = serverBreakdownHarness.serverPersonBreakdown({
  item_subtotal_idr: 100_000, subtotal_idr: 90_000, order_discount_idr: 10_000,
  cashback_idr: 20_000, tax_idr: 9_000, total_idr: 79_000,
});
assert.equal(sharedBreakdown.cashback, 20_000);
assert.match(serverBreakdownHarness.personBreakdownRowsHtml({}, sharedBreakdown), /Cashback dibagi/);
assert.match(serverBreakdownHarness.billCostSummaryHtml({ bill: {
  subtotal_idr: 100_000, tax_idr: 9_000, service_idr: 0,
  order_discount_idr: 0, cashback_idr: 20_000, total_idr: 89_000,
} }), /Cashback dibagi/);
assert.doesNotMatch(
  serverBreakdownHarness.personBreakdownRowsHtml({}, legacyBreakdown),
  /Cashback dibagi/,
);

const paySheetSource = bill.slice(
  bill.indexOf("function openPaySheet"),
  bill.indexOf("// ---------- Where the money goes"),
);
assert.match(paySheetSource, /billOrderDiscount\(data\) > 0 \|\| billCashback\(data\) > 0[\s\S]*personBreakdownRowsHtml/,
  "cashback-only pay sheets must render the server breakdown");
assert.match(bill, /function personBreakdownRowsHtml\(data, bd, withIds = false, forceCashback = false\)/,
  "picker breakdown must support pending cashback structure");
const pendingRows = serverBreakdownHarness.personBreakdownRowsHtml(
  { bill: { cashback_idr: 40_000 } },
  { grossSub: 100_000, orderDiscount: 0, sub: 100_000, cashback: 0, tax: 15_000, total: 115_000 },
  true,
  true,
);
assert.match(pendingRows, /id="my-cashback"/);
assert.match(pendingRows, /id="my-final-total"/);

const orderedSummary = serverBreakdownHarness.billCostSummaryHtml({ bill: {
  subtotal_idr: 100_000, tax_idr: 9_000, service_idr: 3_000,
  order_discount_idr: 10_000, cashback_idr: 20_000, total_idr: 82_000,
} });
const summaryOrder = ["Subtotal item", "Diskon pesanan", "PPN", "Service", "Cashback dibagi", "Total final"]
  .map(label => orderedSummary.indexOf(label));
assert.ok(summaryOrder.every(index => index >= 0), "all summary rows must render");
assert.deepEqual(summaryOrder, [...summaryOrder].sort((a, b) => a - b),
  "summary rows must put fees before cashback and final total last");

const orderedPerson = serverBreakdownHarness.personBreakdownRowsHtml({}, sharedBreakdown);
const personOrder = ["Item sebelum diskon", "Diskon pesanan", "Item sebelum cashback", "PPN &amp; service", "Cashback dibagi", "Total akhir"]
  .map(label => orderedPerson.indexOf(label));
assert.deepEqual(personOrder, [...personOrder].sort((a, b) => a - b),
  "personal rows must put fees before cashback and final total last");

// Creator rows must not infer a voucher from the presence of the newer
// item-subtotal field. A cashback-only server row has no promo segment, while
// a genuine voucher-plus-cashback row keeps the voucher segment.
const creatorBreakdownSource = bill.slice(
  bill.indexOf("function moneyField"),
  bill.indexOf("// Merge a mutating endpoint"),
);
const creatorBreakdownHarness = vm.runInNewContext(`
  const fmt = value => String(value);
  function hasPickedAny() { return false; }
  ${creatorBreakdownSource}
  ({ creatorPersonSubHtml, serverPersonBreakdown });
`);
const cashbackOnlyPerson = {
  identity_id: "creator-test",
  item_subtotal_idr: 100_000,
  subtotal_idr: 100_000,
  order_discount_idr: 0,
  cashback_idr: 40_000,
  tax_idr: 15_000,
  total_idr: 75_000,
};
const cashbackOnlyHtml = creatorBreakdownHarness.creatorPersonSubHtml(
  { bill: { order_discount_idr: 0, cashback_idr: 40_000 } },
  cashbackOnlyPerson,
);
assert.doesNotMatch(cashbackOnlyHtml, /promo|Diskon pesanan/i,
  "cashback-only creator rows must not show a voucher segment");
assert.match(cashbackOnlyHtml, /100000 item/);
assert.match(cashbackOnlyHtml, /100000 sebelum cashback/);
assert.match(cashbackOnlyHtml, /40000 cashback/);
assert.match(cashbackOnlyHtml, /15000 pajak &amp; service/);
assert.ok(cashbackOnlyHtml.indexOf("15000 pajak &amp; service") < cashbackOnlyHtml.indexOf("40000 cashback"),
  "creator rows must put fees before cashback");
assert.equal(creatorBreakdownHarness.serverPersonBreakdown(cashbackOnlyPerson).total, 75_000);

const voucherCashbackHtml = creatorBreakdownHarness.creatorPersonSubHtml(
  { bill: { order_discount_idr: 10_000, cashback_idr: 40_000 } },
  { ...cashbackOnlyPerson, subtotal_idr: 90_000, order_discount_idr: 10_000, total_idr: 55_000 },
);
assert.match(voucherCashbackHtml, /100000 item/);
assert.match(voucherCashbackHtml, /10000 promo/);
assert.match(voucherCashbackHtml, /90000 sebelum cashback/);
assert.match(voucherCashbackHtml, /40000 cashback/);

// Execute the picker renderer against a tiny DOM double: while the selection
// POST is pending, preserve the pre-cashback estimate but never invent a zero
// cashback or a final total. Once the server row is available, both fields
// must switch to the exact server values.
const renderPickSource = bill.slice(
  bill.indexOf("function renderPickRows"),
  bill.indexOf("async function updateGuestSelection"),
);
assert.match(renderPickSource, /billCashback\(data\) > 0 && !\$\("#my-cashback", mbEl\)/,
  "guest picker must materialize cashback nodes when the initial row has no share");
assert.match(renderPickSource, /mbEl\.innerHTML = personBreakdownRowsHtml\(data, bd, true, true\)/,
  "guest picker must use the pending cashback breakdown structure");
const pickerBreakdownSource = bill.slice(
  bill.indexOf("function myPersonRow"),
  bill.indexOf("function billCostSummaryHtml"),
);
const renderNodes = {};
const makeRenderNode = () => ({
  textContent: "",
  style: {},
  attrs: {},
  setAttribute(name, value) { this.attrs[name] = value; },
});
for (const selector of ["#my-total", ".dock-total .label", "#my-breakdown", "#my-gross-sub", "#my-order-discount", "#my-sub", "#my-cashback", "#my-tax", "#my-final-total"]) {
  renderNodes[selector] = makeRenderNode();
}
const renderPickHarness = vm.runInNewContext(`
  const state = { currentBillId: "cashback-bill", selQty: new Map() };
  const fmt = value => "Rp " + value;
  function $(selector) { return renderNodes[selector] || null; }
  function $$(selector) { return []; }
  function computeMyBreakdown() {
    return { grossSub: 100000, orderDiscount: 0, sub: 100000, tax: 15000, total: 115000 };
  }
  function taxServiceTotal() { return 15000; }
  ${pickerBreakdownSource}
  ${renderPickSource}
  ({ renderPickRows });
`, { renderNodes });
const pendingData = {
  bill: { id: "cashback-bill", cashback_idr: 40_000, order_discount_idr: 0, tax_idr: 15_000, service_idr: 0 },
  items: [], sel_by_item: {}, people: [],
};
renderPickHarness.renderPickRows(pendingData, { id: "me" }, false);
assert.equal(renderNodes["#my-total"].textContent, "Rp 115000");
assert.equal(renderNodes[".dock-total .label"].textContent, "Perkiraan sebelum cashback");
assert.equal(renderNodes["#my-total"].attrs["aria-label"], "Perkiraan sebelum cashback Rp 115000");
assert.equal(renderNodes["#my-cashback"].textContent, "menunggu server");
assert.equal(renderNodes["#my-final-total"].textContent, "menunggu server");
assert.doesNotMatch(renderNodes["#my-cashback"].textContent, /−Rp 0/);
assert.doesNotMatch(renderNodes["#my-final-total"].textContent, /Rp 115000/);

const exactData = {
  bill: { id: "cashback-bill", cashback_idr: 40_000, order_discount_idr: 0, tax_idr: 15_000, service_idr: 0 },
  items: [], sel_by_item: {},
  people: [{ identity_id: "me", subtotal_idr: 100_000, cashback_idr: 40_000, tax_idr: 15_000, total_idr: 75_000 }],
};
renderPickHarness.renderPickRows(exactData, { id: "me" }, true);
assert.equal(renderNodes[".dock-total .label"].textContent, "Total kamu");
assert.equal(renderNodes["#my-cashback"].textContent, "−Rp 40000");
assert.equal(renderNodes["#my-final-total"].textContent, "Rp 75000");

console.log("frontend logic regression assertions: PASS");
