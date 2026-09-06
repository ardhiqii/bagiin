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
assert.match(screens, /if \(!isCurrent\(\)\) return;\n\s*histBills = bills/);
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
assert.match(recap, /updateAppNavBadge\(data\)/);
assert.match(recap, /Loading and retry states are intentionally badge-free/);
assert.match(recap, /clearAppNavBadge\(\);\n\s*content\.innerHTML = recapErrorHtml/);
assert.doesNotMatch(screens, /recap-btn|settings-btn/);
assert.match(screens, /id="create-btn"/);

// The optimistic split remains available for the picker, but its number must
// be visibly labeled as pending until the authoritative server payload lands.
assert.match(bill, /totalLabel\.textContent = useServer \? "Total kamu" : "Perkiraan total kamu"/);
assert.match(bill, /useServer \? `Total kamu \$\{fmt\(bd\.total\)\}` : `Perkiraan total kamu/);

console.log("frontend logic regression assertions: PASS");
