"""Bagiin - split calculation engine.

Free items: split proportionally by servings taken (each picker takes 1+
portions; line total // total_qty per portion).
Slot items: creator declares N slots; each slot costs line total // N; people
take 1+ slots; empty slots stay uncovered (shown to the creator, not
auto-assigned).

Invariant: sum(total_per_person) + uncovered_idr + remaining_to_creator == bill.total.
Rounding leftovers go to the one who fronted the money (`fallback_id`).
"""
from decimal import Decimal


_UNCOVERED_KEY = object()


def _allocate_proportionally(
    buckets: list[tuple[object, int]],
    amount: int,
    preferred_key=None,
) -> dict[object, int]:
    """Allocate an integer amount across positive buckets without losing cents.

    Every bucket is capped at its base.  This cap is defensive for direct
    callers; HTTP validation rejects an order discount larger than the bill's
    effective subtotal before a bill can be persisted.  Floor allocation is
    followed by deterministic one-rupiah remainder distribution, preferring
    the bill owner when that bucket has a positive base.
    """
    positive: list[tuple[object, int]] = []
    for key, base in buckets:
        try:
            base = int(base)
        except (TypeError, ValueError, OverflowError):
            continue
        if base > 0:
            positive.append((key, base))
    allocations = {key: 0 for key, _ in positive}
    base_total = sum(base for _, base in positive)
    if not positive or base_total <= 0:
        return allocations
    try:
        requested = max(0, int(amount or 0))
    except (TypeError, ValueError, OverflowError):
        requested = 0
    target = min(requested, base_total)
    if target <= 0:
        return allocations

    for key, base in positive:
        allocations[key] = base * target // base_total
    remainder = target - sum(allocations.values())

    order = [key for key, _ in positive]
    if preferred_key in allocations:
        order.remove(preferred_key)
        order.insert(0, preferred_key)
    base_by_key = dict(positive)
    while remainder > 0:
        progressed = False
        for key in order:
            if allocations[key] >= base_by_key[key]:
                continue
            allocations[key] += 1
            remainder -= 1
            progressed = True
            if remainder == 0:
                break
        if not progressed:
            # The loop should be unreachable because target <= base_total, but
            # do not spin forever if a future caller supplies duplicate keys.
            break
    return allocations


def compute(bill: dict, items: list[dict], selections: list[dict],
            participants: list[str], fallback_id: str) -> dict:
    """Compute per-identity totals.

    bill: dict with subtotal_idr, tax_idr, service_idr, total_idr, tax_mode
    items: list of item dicts (id, name, price_idr, mode, slot_count,
      quantity). quantity is the purchased unit count and defaults to 1.
    selections: list of {item_id, identity_id, qty}
    participants: list of {name} (creator-declared names, for warnings)
    fallback_id: who absorbs money nobody claimed (unpicked free items, tax
      with no base, rounding leftovers). That's the bill OWNER — the confirmed
      payer if there is one, else the creator. It used to be the creator
      unconditionally, which billed the wrong person once someone else was
      confirmed as the payer, and billed a ghost once the creator left (v58).
    Returns:
      {
        "people": [{identity_id, item_subtotal_idr, order_discount_idr,
          subtotal_idr, tax_idr, total_idr}],
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
        # quantity is the purchased line quantity; selection qty remains the
        # number of servings/slots claimed by each participant.
        quantity = int(it.get("quantity", 1) or 1)
        line_total = eff * quantity
        if it.get("mode") == "slot" and it.get("slot_count"):
            slot_count = max(1, int(it["slot_count"]))
            per_slot = line_total // slot_count
            taken = sum(q for _, q in selectors)
            for ident, qty in selectors:
                subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + per_slot * qty
            if taken >= slot_count:
                # all slots taken: distribute rounding remainder (eff % slot_count)
                # across SLOTS, not people — one person holding qty>1 slots must
                # get +1 per slot (old loop capped at len(selectors) and lost
                # rupiah when rem > number of distinct holders)
                rem = line_total - per_slot * slot_count
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
                amount = line_total - per_slot * taken
                uncovered_idr += amount
                if amount > 0:
                    # a fully discounted item leaves empty slots worth nothing —
                    # reporting them produced "3 bagian kosong = Rp 0" and a
                    # warning the creator could never act on
                    uncovered_slots.append({
                        "item_id": it["id"],
                        "name": it["name"],
                        "per_slot": per_slot,
                        "empty": empty,
                        "amount_idr": amount,
                    })
            continue
        # free mode: split proportionally by servings taken (qty = how many
        # portions this person takes, default 1). line_total // total_qty per serving,
        # rounding remainder round-robin across servings.
        if not selectors:
            # nobody picked this free item -> the owner takes it (matches the
            # warning "masuk ke yang nalangin"). This keeps the split complete:
            # sum(people) + uncovered_idr == bill.total.
            subtotal_by_ident[fallback_id] = subtotal_by_ident.get(fallback_id, 0) + line_total
            continue
        total_qty = sum(q for _, q in selectors)
        share = line_total // total_qty
        rem = line_total - share * total_qty
        for ident, qty in selectors:
            subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + share * qty
        for i in range(rem):
            ident = selectors[i % len(selectors)][0]
            subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + 1

    # Checkout-wide discount is allocated only after every item has been
    # assigned.  The uncovered slot bucket stays separate: its discount share
    # reduces the warning amount instead of silently charging a person.
    gross_subtotal_by_ident = subtotal_by_ident
    gross_uncovered_idr = uncovered_idr
    try:
        order_discount = max(0, int(bill.get("order_discount_idr", 0) or 0))
    except (TypeError, ValueError, OverflowError):
        order_discount = 0
    discount_buckets: list[tuple[object, int]] = list(gross_subtotal_by_ident.items())
    if gross_uncovered_idr > 0:
        discount_buckets.append((_UNCOVERED_KEY, gross_uncovered_idr))
    discount_allocations = _allocate_proportionally(
        discount_buckets,
        order_discount,
        preferred_key=fallback_id,
    )
    allocated_order_discount = sum(discount_allocations.values())
    order_discount_by_ident = {
        ident: discount_allocations.get(ident, 0)
        for ident in gross_subtotal_by_ident
    }
    uncovered_discount = discount_allocations.get(_UNCOVERED_KEY, 0)
    net_subtotal_by_ident = {
        ident: gross - order_discount_by_ident.get(ident, 0)
        for ident, gross in gross_subtotal_by_ident.items()
    }
    net_uncovered_idr = gross_uncovered_idr - uncovered_discount

    if uncovered_discount and uncovered_slots:
        # Keep each actionable warning consistent with the aggregate uncovered
        # amount.  The per-slot rate remains the original item rate because the
        # order discount is not an item discount.
        slot_buckets: list[tuple[object, int]] = [
            (index, slot["amount_idr"])
            for index, slot in enumerate(uncovered_slots)
        ]
        slot_discounts = _allocate_proportionally(slot_buckets, uncovered_discount)
        for index, slot in enumerate(uncovered_slots):
            slot["amount_idr"] -= slot_discounts.get(index, 0)
        uncovered_slots = [slot for slot in uncovered_slots if slot["amount_idr"] > 0]

    # Tax/service split. tax_included means item prices already include PPN —
    # only that portion is dropped; a separate service charge is still split.
    tax_service = int(bill.get("tax_idr", 0) or 0) + int(bill.get("service_idr", 0) or 0)
    if bill.get("tax_included"):
        tax_service = int(bill.get("service_idr", 0) or 0)
    mode = bill.get("tax_mode", "proportional")
    total_subtotal = sum(net_subtotal_by_ident.values()) or 0

    tax_by_ident: dict[str, int] = {}
    if not net_subtotal_by_ident or total_subtotal <= 0:
        # nobody has a positive share yet (fresh bill, or items whose effective
        # price is 0 — e.g. discount == price): the tax still has to land
        # somewhere or it vanishes from the split (total_ok False). Default it
        # to the owner, who absorbs every unclaimed amount.
        # (bug: `subtotal_by_ident` could be non-empty with all-zero values,
        # e.g. {guest: 0}, so the old `not subtotal_by_ident` check missed it
        # and equal-mode tax disappeared entirely)
        tax_by_ident[fallback_id] = tax_service
    elif mode == "equal":
        payers = [k for k, v in net_subtotal_by_ident.items() if v > 0]
        if payers:
            per = tax_service // len(payers)
            rem = tax_service - per * len(payers)
            for idx, ident in enumerate(payers):
                tax_by_ident[ident] = per + (1 if idx < rem else 0)
    elif mode == "creator":
        tax_by_ident[fallback_id] = tax_service
    else:  # proportional
        for ident, sub in net_subtotal_by_ident.items():
            if total_subtotal > 0:
                share = int(Decimal(sub) * Decimal(tax_service) / Decimal(total_subtotal))
                tax_by_ident[ident] = share
        paid = sum(tax_by_ident.values())
        diff = tax_service - paid
        if diff != 0 and net_subtotal_by_ident:
            tax_by_ident[fallback_id] = tax_by_ident.get(fallback_id, 0) + diff

    # totals
    people = []
    all_identities = set(net_subtotal_by_ident) | set(tax_by_ident)
    for ident in all_identities:
        item_subtotal = gross_subtotal_by_ident.get(ident, 0)
        order_discount_share = order_discount_by_ident.get(ident, 0)
        sub = net_subtotal_by_ident.get(ident, 0)
        tax = tax_by_ident.get(ident, 0)
        people.append({
            "identity_id": ident,
            "item_subtotal_idr": item_subtotal,
            "order_discount_idr": order_discount_share,
            "subtotal_idr": sub,
            "tax_idr": tax,
            "total_idr": sub + tax,
        })
    people.sort(key=lambda p: -p["total_idr"])

    by_identity = {p["identity_id"]: p for p in people}

    # unassigned items (free items nobody picked -> owner; slot items with no
    # picks are uncovered, NOT assigned to anyone — design B)
    unassigned = [it for it in items if not sel_by_item.get(it["id"]) and not (
        it.get("mode") == "slot" and it.get("slot_count")
    )]

    # warnings
    warnings = []
    for it in unassigned:
        eff = max(0, it["price_idr"] - int(it.get("discount_idr", 0) or 0))
        quantity = int(it.get("quantity", 1) or 1)
        line_total = eff * quantity
        warnings.append(f"Item tidak dipilih siapa pun: {it['name']} Rp {line_total:,} -> otomatis dibebankan ke pembayar dahulu")
    for u in uncovered_slots:
        warnings.append(
            f"Bagian kosong: {u['name']} {u['empty']} bagian belum terisi "
            f"(total Rp {u['amount_idr']:,})"
        )

    assigned = sum(p["total_idr"] for p in people)
    # Invalid direct inputs must not produce negative person shares or crash.
    # They are rejected at the HTTP boundary; exposing total_ok=False here
    # makes the lost/unallocated discount visible to internal callers too.
    discount_allocation_ok = allocated_order_discount == order_discount
    total_idr = int(bill.get("total_idr", 0) or 0)
    total_ok = discount_allocation_ok and (assigned + net_uncovered_idr) == total_idr

    return {
        "people": people,
        "by_identity": by_identity,
        "unassigned_items": unassigned,
        "uncovered_slots": uncovered_slots,
        "uncovered_idr": net_uncovered_idr,
        "warnings": warnings,
        "total_ok": total_ok,
        "remaining_to_creator": total_idr - assigned - net_uncovered_idr,
    }
