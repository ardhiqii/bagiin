import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const screens = await readFile(new URL("../frontend/static/screens.js", import.meta.url), "utf8");
const bill = await readFile(new URL("../frontend/static/bill.js", import.meta.url), "utf8");
const app = await readFile(new URL("../frontend/static/app.js", import.meta.url), "utf8");
const recap = await readFile(new URL("../frontend/static/recap.js", import.meta.url), "utf8");
const index = await readFile(new URL("../frontend/index.html", import.meta.url), "utf8");

// Regression contracts for async screen races. Keep these source-level and
// deterministic: they run without a server, browser, or test data.
assert.match(screens, /let billListGeneration\s*=\s*0/);
assert.match(screens, /const generation = \+\+billListGeneration/);
assert.match(screens, /const isCurrent = \(\) => generation === billListGeneration/);
assert.doesNotMatch(screens, /histBills|bagiin:derived-invalidated/);
assert.match(screens, /if \(!isCurrent\(\)\) return;\n\s*if \(!Array\.isArray\(bills\)/);
assert.match(screens, /if \(!isCurrent\(\)\) return;\n\s*box\.innerHTML = identityErrorHtml\(e\)/);

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
assert.match(recap, /updateAppNavBadge\(data\)/);
assert.match(recap, /Loading and retry states are intentionally badge-free/);
assert.match(recap, /clearAppNavBadge\(\);\n\s*content\.innerHTML = recapErrorHtml/);
assert.match(screens, /class="right home-desktop-routes"[\s\S]*id="recap-btn"[\s\S]*id="settings-btn"/);
assert.match(index, /home-desktop-routes/);
assert.match(screens, /id="create-btn"/);

// The optimistic split remains available for the picker, but its number must
// be visibly labeled as pending until the authoritative server payload lands.
assert.match(bill, /totalLabel\.textContent = useServer \? "Total kamu" : "Perkiraan total kamu"/);
assert.match(bill, /useServer \? `Total kamu \$\{fmt\(bd\.total\)\}` : `Perkiraan total kamu/);

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
assert.match(app, /if \(data\.settled \|\| data\.all_paid\)/);
assert.match(app, /if \(method !== "GET" && method !== "HEAD"\) \{[\s\S]*invalidateDerivedData/);

console.log("frontend logic regression assertions: PASS");
