import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError,
  api,
  configureApi,
  identityHeaders,
  normalizeContacts,
  normalizeIdentity,
  normalizeMutationOk,
  normalizeOcrResponse,
  normalizePaymentAccount,
} from "../src/lib/api.ts";
import { createRequestGate } from "../src/lib/async-state.ts";
import {
  contactInitial,
  inviteFailureNotice,
  participantPlaceholders,
  pickerContactCaption,
  togglePickedContact,
} from "../src/lib/types.ts";
import { photoFilename, photoUrl } from "../src/lib/photo-path.ts";
import { inputMoney, rupiahFmt, rupiahParse } from "../src/lib/money.ts";
import { isKnownHashRoute, parseHash, routeHash } from "../src/lib/routes.ts";
import { createSelectionSaveQueue, serializeSelections } from "../src/lib/selection-queue.ts";

test("hash routes preserve public bill links and canonicalize history", () => {
  assert.deepEqual(parseHash("#/b/bill_ABC-123").route, { kind: "bill", billId: "bill_ABC-123" });
  assert.deepEqual(parseHash("#/b/bill%2Fwith%2Fslash").route, { kind: "bill", billId: "bill/with/slash" });
  assert.equal(routeHash({ kind: "bill", billId: "bill/with/slash" }), "#/b/bill%2Fwith%2Fslash");
  assert.deepEqual(parseHash("#/history").route, { kind: "home" });
  assert.equal(isKnownHashRoute(["history"]), true);
  assert.equal(parseHash("#/not-a-route").route.kind, "unknown");
  assert.equal(parseHash("#/b/%E0%A4%A").route.kind, "unknown");
  assert.equal(parseHash("#/b/%E0%A4%A").valid, false);
});

test("identity headers never invent or expose a secret", () => {
  assert.deepEqual(identityHeaders({ id: "public-id", name: "Rina" }), { "X-Identity-Id": "public-id" });
  assert.deepEqual(identityHeaders({ id: "public-id", name: "Rina", secret: "private-secret" }), {
    "X-Identity-Id": "public-id",
    "X-Identity-Secret": "private-secret",
  });
  assert.deepEqual(identityHeaders(null), {});
});

test("api injects both identity headers and maps JSON errors", async () => {
  const originalFetch = globalThis.fetch;
  const seen: Record<string, string> = {};
  configureApi(() => ({ id: "public-id", name: "Rina", secret: "private-secret" }));
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    headers.forEach((value, key) => { seen[key] = value; });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  };
  await api("/api/ping");
  assert.equal(seen["x-identity-id"], "public-id");
  assert.equal(seen["x-identity-secret"], "private-secret");
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Nama wajib diisi" }), { status: 400, headers: { "content-type": "application/json" } });
  await assert.rejects(() => api("/api/ping", { method: "POST", json: {} }), (error: unknown) => error instanceof ApiError && error.status === 400 && error.message === "Nama wajib diisi");
  globalThis.fetch = originalFetch;
  configureApi(() => null);
});

test("response normalizers reject malformed identity/account payloads", () => {
  assert.deepEqual(normalizeIdentity({ id: "abc", name: " Rina ", secret: null }), { id: "abc", name: " Rina ", secret: null });
  assert.throws(() => normalizeIdentity({ id: "abc" }), (error: unknown) => error instanceof ApiError);
  assert.deepEqual(normalizePaymentAccount({ id: 3, brand: "BCA", account_no: "123" }), { id: 3, brand: "BCA", account_no: "123" });
  assert.throws(() => normalizePaymentAccount({ id: "3", brand: "BCA", account_no: "123" }), (error: unknown) => error instanceof ApiError);
});

test("typed endpoint normalizers reject malformed payloads and preserve response intent", () => {
  assert.deepEqual(normalizeMutationOk({ ok: true }), { ok: true });
  assert.throws(() => normalizeMutationOk({ ok: false }), (error: unknown) => error instanceof ApiError);
  assert.deepEqual(normalizeContacts([{ id: "contact-1", name: "Amel" }]), [{ id: "contact-1", name: "Amel" }]);
  assert.throws(() => normalizeContacts([{ id: "contact-1" }]), (error: unknown) => error instanceof ApiError);
  assert.deepEqual(normalizeOcrResponse({ title: "Makan", items: [{ name: "Nasi", price: "12.500", quantity: 1 }] }), {
    title: "Makan",
    items: [{ name: "Nasi", price: "12.500", quantity: 1 }],
  });
});

test("rupiah parsing accepts display formatting without parseInt coercion", () => {
  assert.equal(rupiahParse("Rp 12.500"), 12500);
  assert.equal(rupiahParse("12 500"), 12500);
  assert.equal(rupiahParse("Rp 12abc"), null);
  assert.equal(rupiahFmt(12500), "Rp 12.500");
  assert.equal(inputMoney(12500), "12.500");
  assert.equal(inputMoney(null), "");
});

test("selection payloads are deterministic and queue saves stay serialized", async () => {
  assert.deepEqual(serializeSelections({ 9: 2, 3: 0, 5: 1, 4: Number.NaN }), [
    { item_id: 5, qty: 1 },
    { item_id: 9, qty: 2 },
  ]);
  const queue = createSelectionSaveQueue();
  const order: number[] = [];
  const first = queue.enqueue(async () => { order.push(1); await new Promise(resolve => setTimeout(resolve, 5)); return 1; });
  const second = queue.enqueue(async () => { order.push(2); return 2; });
  assert.deepEqual(await Promise.all([first, second]), [1, 2]);
  assert.deepEqual(order, [1, 2]);
});

test("stale request tokens cannot update current screen state", () => {
  const gate = createRequestGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(gate.isCurrent(first), false);
  assert.equal(gate.isCurrent(second), true);
  gate.invalidate();
  assert.equal(gate.isCurrent(second), false);
});

test("photo cleanup only accepts generated upload filenames", () => {
  assert.equal(photoFilename("/tmp/uploads/0123456789abcdef.jpg"), "0123456789abcdef.jpg");
  assert.equal(photoFilename("../../other-bill.jpg"), null);
  assert.equal(photoFilename("0123456789abcdef.svg"), null);
  assert.equal(photoUrl("/tmp/uploads/0123456789abcdef.webp"), "/uploads/0123456789abcdef.webp");
});

/* The "Yang ikut" picker's two load-bearing rules. Both are the kind that a
   refactor can break silently, because the wrong behaviour still LOOKS fine on
   screen: a picked contact sent as a placeholder shows up as a second row with
   the same name, and a caption that always says "pernah berbagi bill" reads
   plausibly while being false for a contact the server never reported sharing
   with. */
test("a picked proven contact never becomes a participants placeholder", () => {
  const draft = { extra_names: [" Budi ", "", "Sari"] };
  assert.deepEqual(participantPlaceholders(draft), ["Budi", "Sari"]);
  // The same person typed AND picked must still only produce the typed name
  // here; the invite carries the identity, not this array.
  assert.deepEqual(participantPlaceholders({ extra_names: [] }), []);
});

test("picked contacts toggle by identity and keep their last_shared evidence", () => {
  const rina = { id: "id-rina", name: "Rina", last_shared: "2026-09-01 10:00:00" };
  const budi = { id: "id-budi", name: "Budi" };
  const one = togglePickedContact([], rina);
  assert.deepEqual(one, [rina]);
  const two = togglePickedContact(one, budi);
  assert.deepEqual(two.map(contact => contact.id), ["id-rina", "id-budi"]);
  // Toggling the same identity off removes it and leaves the other alone.
  assert.deepEqual(togglePickedContact(two, rina).map(contact => contact.id), ["id-budi"]);
  // No mutation of the input array: the draft is replaced, never patched.
  assert.equal(two.length, 2);
  assert.deepEqual(togglePickedContact([], { id: "x", name: "X" }), [{ id: "x", name: "X", last_shared: undefined }]);
});

test("picker caption and avatar initial match the legacy contact row", () => {
  assert.equal(pickerContactCaption({ last_shared: "2026-09-01 10:00:00" }), "pernah berbagi bill");
  assert.equal(pickerContactCaption({}), "kontak terbukti");
  assert.equal(contactInitial("rina"), "R");
  assert.equal(contactInitial("  budi"), "B");
  assert.equal(contactInitial(""), "");
});

test("invite batch copy distinguishes failure from still-in-flight", () => {
  // A batch that never resolved inside the 8s bound is NOT a failure.
  assert.match(inviteFailureNotice(null), /masih diproses/);
  assert.equal(inviteFailureNotice([{ status: "fulfilled" }, { status: "fulfilled" }]), "");
  assert.match(inviteFailureNotice([{ status: "fulfilled" }, { status: "rejected" }]), /1 undangan gagal/);
  assert.match(inviteFailureNotice([{ status: "rejected" }, { status: "rejected" }]), /2 undangan gagal/);
});
