import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const screens = await readFile(new URL("../frontend/static/screens.js", import.meta.url), "utf8");
const bill = await readFile(new URL("../frontend/static/bill.js", import.meta.url), "utf8");

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

// The optimistic split remains available for the picker, but its number must
// be visibly labeled as pending until the authoritative server payload lands.
assert.match(bill, /totalLabel\.textContent = useServer \? "Total kamu" : "Perkiraan total kamu"/);
assert.match(bill, /useServer \? `Total kamu \$\{fmt\(bd\.total\)\}` : `Perkiraan total kamu/);

console.log("frontend logic regression assertions: PASS");
