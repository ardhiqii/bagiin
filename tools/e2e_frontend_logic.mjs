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

// The optimistic split remains available for the picker, but its number must
// be visibly labeled as pending until the authoritative server payload lands.
assert.match(bill, /totalLabel\.textContent = useServer \? "Total kamu" : "Perkiraan total kamu"/);
assert.match(bill, /useServer \? `Total kamu \$\{fmt\(bd\.total\)\}` : `Perkiraan total kamu/);

console.log("frontend logic regression assertions: PASS");