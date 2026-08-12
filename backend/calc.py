"""Bagiin - split calculation engine.

Free items: split proportionally by servings taken (each picker takes 1+
portions; price // total_qty per portion).
Slot items: creator declares N slots; each slot costs price // N; people take
1+ slots; empty slots stay uncovered (shown to the creator, not auto-assigned).

Invariant: sum(total_per_person) + uncovered_idr + remaining_to_creator == bill.total.
Rounding leftovers go to the creator (the one who fronted the money).
"""
from decimal import Decimal


def compute(bill: dict, items: list[dict], selections: list[dict],
            participants: list[str], creator_id: str) -> dict:
    """Compute per-identity totals.

    bill: dict with subtotal_idr, tax_idr, service_idr, total_idr, tax_mode
    items: list of item dicts (id, name, price_idr, mode, slot_count)
    selections: list of {item_id, identity_id, qty}
    participants: list of {name} (creator-declared names, for warnings)
    Returns:
      {
        "people": [{identity_id, name, subtotal_idr, tax_idr, total_idr}],
        "by_identity": {identity_id: {...}},
        "unassigned_items": [free item dicts with no selection],
        "uncovered_slots": [{item_id, name, per_slot, empty, amount_idr}],
        "uncovered_idr": int (total rupiah of empty slots),
        "warnings": [...],
        "total_ok": bool
      }
    """
    # Map identity -> {item_id: qty}, then invert to item -> [(identity, qty)]
    sel_map: dict[str, dict[int, int]] = {}
    for s in selections:
        sel_map.setdefault(s["identity_id"], {})[s["item_id"]] = int(s.get("qty", 1))

    sel_by_item: dict[int, list[tuple[str, int]]] = {}
    for ident_id, item_qty in sel_map.items():
        for iid, qty in item_qty.items():
            sel_by_item.setdefault(iid, []).append((ident_id, qty))

    subtotal_by_ident: dict[str, int] = {}
    uncovered_slots: list[dict] = []
    uncovered_idr = 0

    for it in items:
        selectors = sel_by_item.get(it["id"], [])
        eff = max(0, it["price_idr"] - int(it.get("discount_idr", 0) or 0))
        if it.get("mode") == "slot" and it.get("slot_count"):
            slot_count = max(1, int(it["slot_count"]))
            per_slot = eff // slot_count
            taken = sum(q for _, q in selectors)
            for ident, qty in selectors:
                subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + per_slot * qty
            if taken >= slot_count:
                # all slots taken: distribute rounding remainder (eff % slot_count)
                # across SLOTS, not people — one person holding qty>1 slots must
                # get +1 per slot (old loop capped at len(selectors) and lost
                # rupiah when rem > number of distinct holders)
                rem = eff - per_slot * slot_count
                for ident, qty in selectors:
                    for _ in range(qty):
                        if rem <= 0:
                            break
                        subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + 1
                        rem -= 1
                    if rem <= 0:
                        break
            else:
                empty = slot_count - taken
                amount = eff - per_slot * taken
                uncovered_idr += amount
                uncovered_slots.append({
                    "item_id": it["id"],
                    "name": it["name"],
                    "per_slot": per_slot,
                    "empty": empty,
                    "amount_idr": amount,
                })
            continue
        # free mode: split proportionally by servings taken (qty = how many
        # portions this person takes, default 1). eff // total_qty per serving,
        # rounding remainder round-robin across servings.
        if not selectors:
            # nobody picked this free item -> the creator takes it (matches the
            # warning "masuk ke pembuat bill"). This keeps the split complete:
            # sum(people) + uncovered_idr == bill.total.
            subtotal_by_ident[creator_id] = subtotal_by_ident.get(creator_id, 0) + eff
            continue
        total_qty = sum(q for _, q in selectors)
        share = eff // total_qty
        rem = eff - share * total_qty
        for ident, qty in selectors:
            subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + share * qty
        for i in range(rem):
            ident = selectors[i % len(selectors)][0]
            subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + 1

    # Tax/service split. tax_included means item prices already include PPN —
    # only that portion is dropped; a separate service charge is still split.
    tax_service = bill["tax_idr"] + bill["service_idr"]
    if bill.get("tax_included"):
        tax_service = bill["service_idr"]
    mode = bill.get("tax_mode", "proportional")
    total_subtotal = sum(subtotal_by_ident.values()) or 0

    tax_by_ident: dict[str, int] = {}
    if not subtotal_by_ident or total_subtotal <= 0:
        # nobody has a positive share yet (fresh bill, or items whose effective
        # price is 0 — e.g. discount == price): the tax still has to land
        # somewhere or it vanishes from the split (total_ok False). Default it
        # to the creator, who is the fallback owner of uncovered amounts.
        # (bug: `subtotal_by_ident` could be non-empty with all-zero values,
        # e.g. {guest: 0}, so the old `not subtotal_by_ident` check missed it
        # and equal-mode tax disappeared entirely)
        tax_by_ident[creator_id] = tax_service
    elif mode == "equal":
        payers = [k for k, v in subtotal_by_ident.items() if v > 0]
        if payers:
            per = tax_service // len(payers)
            rem = tax_service - per * len(payers)
            for idx, ident in enumerate(payers):
                tax_by_ident[ident] = per + (1 if idx < rem else 0)
    elif mode == "creator":
        tax_by_ident[creator_id] = tax_service
    else:  # proportional
        for ident, sub in subtotal_by_ident.items():
            if total_subtotal > 0:
                share = int(Decimal(sub) * Decimal(tax_service) / Decimal(total_subtotal))
                tax_by_ident[ident] = share
        paid = sum(tax_by_ident.values())
        diff = tax_service - paid
        if diff != 0 and subtotal_by_ident:
            tax_by_ident[creator_id] = tax_by_ident.get(creator_id, 0) + diff

    # totals
    people = []
    all_identities = set(subtotal_by_ident) | set(tax_by_ident)
    for ident in all_identities:
        sub = subtotal_by_ident.get(ident, 0)
        tax = tax_by_ident.get(ident, 0)
        people.append({
            "identity_id": ident,
            "subtotal_idr": sub,
            "tax_idr": tax,
            "total_idr": sub + tax,
        })
    people.sort(key=lambda p: -p["total_idr"])

    by_identity = {p["identity_id"]: p for p in people}

    # unassigned items (free items nobody picked -> creator; slot items with no
    # picks are uncovered, NOT assigned to the creator — design B)
    unassigned = [it for it in items if not sel_by_item.get(it["id"]) and not (
        it.get("mode") == "slot" and it.get("slot_count")
    )]

    # warnings
    warnings = []
    for it in unassigned:
        eff = max(0, it["price_idr"] - int(it.get("discount_idr", 0) or 0))
        warnings.append(f"Item tidak dipilih siapa pun: {it['name']} Rp {eff:,} -> masuk ke pembuat bill")
    for u in uncovered_slots:
        warnings.append(
            f"Bagian kosong: {u['name']} {u['empty']} bagian belum keambil "
            f"(Rp {u['per_slot']:,}/bagian, total Rp {u['amount_idr']:,})"
        )

    assigned = sum(p["total_idr"] for p in people)
    total_ok = (assigned + uncovered_idr) == bill["total_idr"]

    return {
        "people": people,
        "by_identity": by_identity,
        "unassigned_items": unassigned,
        "uncovered_slots": uncovered_slots,
        "uncovered_idr": uncovered_idr,
        "warnings": warnings,
        "total_ok": total_ok,
        "remaining_to_creator": bill["total_idr"] - assigned - uncovered_idr,
    }
