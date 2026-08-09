"""Bagiin - split calculation engine.

Invariant: sum(total_per_person) == bill.total_idr, always.
Rounding leftovers go to the creator (the one who fronted the money).
"""
from decimal import Decimal, ROUND_DOWN


def compute(bill: dict, items: list[dict], selections: list[dict],
            participants: list[str], creator_id: str) -> dict:
    """Compute per-identity totals.

    bill: dict with subtotal_idr, tax_idr, service_idr, total_idr, tax_mode
    items: list of item dicts (id, name, price_idr)
    selections: list of {item_id, identity_id}
    participants: list of {name} (creator-declared names, for warnings)
    Returns:
      {
        "people": [{identity_id, name, subtotal_idr, tax_idr, total_idr}],
        "by_identity": {identity_id: {...}},
        "unassigned_items": [item dicts with no selection],
        "warnings": [...],
        "total_ok": bool
      }
    """
    # Map identity -> selections, then invert to item -> selectors
    sel_map: dict[str, set[int]] = {}
    for s in selections:
        sel_map.setdefault(s["identity_id"], set()).add(s["item_id"])

    sel_by_item: dict[int, list[str]] = {}
    for ident_id, item_ids in sel_map.items():
        for iid in item_ids:
            sel_by_item.setdefault(iid, []).append(ident_id)

    subtotal_by_ident: dict[str, int] = {}
    for it in items:
        selectors = sel_by_item.get(it["id"], [])
        if not selectors:
            continue
        share = it["price_idr"] // len(selectors)
        # distribute remainder among selectors in order (first gets extra rupiah)
        rem = it["price_idr"] - share * len(selectors)
        for idx, ident in enumerate(selectors):
            subtotal_by_ident[ident] = subtotal_by_ident.get(ident, 0) + share + (1 if idx < rem else 0)

    # Tax/service split
    tax_service = bill["tax_idr"] + bill["service_idr"]
    mode = bill.get("tax_mode", "proportional")
    total_subtotal = sum(subtotal_by_ident.values()) or 0

    tax_by_ident: dict[str, int] = {}
    if mode == "equal":
        # equal among people who have subtotal > 0
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
                # proportional share, rounded down, remainder to creator
                share = int(Decimal(sub) * Decimal(tax_service) / Decimal(total_subtotal))
                tax_by_ident[ident] = share
        # remainder to creator (only when someone actually has subtotal;
        # with zero selections the whole tax would otherwise dump on the creator)
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

    # names for identities (from selections join we don't have; caller fills names)
    by_identity = {p["identity_id"]: p for p in people}

    # unassigned items
    unassigned = [it for it in items if not sel_by_item.get(it["id"])]

    # warnings
    warnings = []
    for it in unassigned:
        warnings.append(f"Item tidak dipilih siapa pun: {it['name']} Rp {it['price_idr']:,} -> masuk ke pembuat bill")
    total_ok = sum(p["total_idr"] for p in people) == bill["total_idr"]

    return {
        "people": people,
        "by_identity": by_identity,
        "unassigned_items": unassigned,
        "warnings": warnings,
        "total_ok": total_ok,
        "remaining_to_creator": bill["total_idr"] - sum(p["total_idr"] for p in people),
    }
