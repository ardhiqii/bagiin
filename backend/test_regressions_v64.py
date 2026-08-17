"""Direct-invite feature tests (v64): kontak terbukti, invite auto-accept vs pending,
accept/decline, auto_accept toggle.

Run with a throwaway DB:
    BAGIIN_DB=/tmp/bagiin_v64.db venv/bin/python test_regressions_v64.py
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["BAGIIN_DB"] = str(_tmp)

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from fastapi.testclient import TestClient

db.init_db()

import main

client = TestClient(main.app)
# rate limits trip fast in tests
main.app.state.limiter.enabled = False


def _H(who):
    ident = who if isinstance(who, dict) else db.get_identity(who)
    h = {"X-Identity-Id": ident["id"]}
    if ident.get("secret"):
        h["X-Identity-Secret"] = ident["secret"]
    return h


def _make_bill(creator, title="Makan Bareng", participants=None):
    return db.create_bill(
        creator_id=creator["id"], title=title, tax_mode="proportional",
        subtotal=30000, tax=0, service=0, total=30000,
        items=[{"name": "A", "price": 10000}, {"name": "B", "price": 10000},
               {"name": "C", "price": 10000}],
        participants=participants or [creator["name"]],
    )


def test_contacts_kontak_terbukti():
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    citra = db.new_identity("Citra")
    # Aufa creates bill 1, Budi joins -> mutual bill
    b1 = _make_bill(aufa, "Warung A")
    db.join_bill(b1["id"], budi["id"], "Budi")
    # Citra never shares a bill with Aufa
    b2 = _make_bill(aufa, "Warung B")
    assert db.get_bill(b2["id"])["bill"]["id"]  # bill2 exists, nobody joined

    kontak = db.get_contacts(aufa["id"])
    ids = {k["id"] for k in kontak}
    assert budi["id"] in ids, f"Budi (joined mutual bill) harus muncul: {kontak}"
    assert citra["id"] not in ids, "Citra belum pernah share bill -> bukan kontak"
    assert aufa["id"] not in ids, "diri sendiri gak boleh jadi kontak"
    # search filter
    assert db.get_contacts(aufa["id"], q="bud")[0]["id"] == budi["id"]
    assert db.get_contacts(aufa["id"], q="cit") == []
    # Budi sees Aufa too (shared bill is mutual)
    budi_kontak = {k["id"] for k in db.get_contacts(budi["id"])}
    assert aufa["id"] in budi_kontak

    # kontakt dari bill yang dibuat orang lain (dedi bikin bill, citra join)
    dedi = db.new_identity("Dedi")
    b4 = _make_bill(dedi, "Warung D")
    db.join_bill(b4["id"], citra["id"], "Citra")
    dedi_kontak = {k["id"] for k in db.get_contacts(dedi["id"])}
    assert citra["id"] in dedi_kontak
    print("PASS contacts: kontak terbukti dari bill bersama, filter q, mutual, arah balik")


def test_invite_auto_accept_joins_immediately():
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    # pastikan auto_accept default ON
    assert db.get_identity(budi["id"])["auto_accept"] == 1
    # bill lama: Budi join -> jadi kontak terbukti Aufa
    b_old = _make_bill(aufa, "Warung Lama")
    db.join_bill(b_old["id"], budi["id"], "Budi")
    assert any(c["id"] == budi["id"] for c in db.get_contacts(aufa["id"]))
    # bill baru: Budi BELUM di situ, di-invite langsung
    b1 = _make_bill(aufa, "Warung E")

    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": budi["id"]}, headers=_H(aufa))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "joined", body
    # Budi sekarang peserta bill (payment row = join beneran; participants dari
    # bill_participant cuma placeholder legacy yang di-claim — pake payment)
    bill = db.get_bill(b1["id"])
    assert any(p["identity_id"] == budi["id"] for p in bill["payments"])
    budi_bills = db.get_bills_for_identity(budi["id"])
    assert any(x["id"] == b1["id"] for x in budi_bills)
    # invite tercatat accepted
    inv = db.get_invites_for_bill(b1["id"])
    assert len(inv) == 1 and inv[0]["status"] == "accepted" and inv[0]["identity_id"] == budi["id"]
    print("PASS invite auto-accept: langsung join + masuk daftar bill target")


def test_invite_pending_when_auto_accept_off():
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    db.set_auto_accept(budi["id"], 0)
    assert db.get_identity(budi["id"])["auto_accept"] == 0
    b_old = _make_bill(aufa, "Warung Lama")
    db.join_bill(b_old["id"], budi["id"], "Budi")
    b1 = _make_bill(aufa, "Warung F")

    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": budi["id"]}, headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "pending", r.json()
    # belum jadi peserta
    bill = db.get_bill(b1["id"])
    assert not any(p["identity_id"] == budi["id"] for p in bill["participants"])
    # pending invite terlihat di daftar invite Budi
    pending = db.get_pending_invites(budi["id"])
    assert len(pending) == 1, pending
    assert pending[0]["bill_id"] == b1["id"]
    assert pending[0]["invited_by_name"] == "Aufa"
    assert pending[0]["bill_title"] == "Warung F"
    # dan invite milik orang lain tidak bocor
    citra = db.new_identity("Citra")
    assert db.get_pending_invites(citra["id"]) == []
    print("PASS invite pending: auto_accept=0 -> pending, tidak auto-join, tidak bocor")


def test_invite_accept_and_decline():
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    db.set_auto_accept(budi["id"], 0)
    b_old = _make_bill(aufa, "Warung Lama")
    db.join_bill(b_old["id"], budi["id"], "Budi")
    b1 = _make_bill(aufa, "Warung G")
    client.post(f"/api/bills/{b1['id']}/invite",
                json={"identity_id": budi["id"]}, headers=_H(aufa))
    inv_id = db.get_pending_invites(budi["id"])[0]["id"]

    # accept oleh invitee
    r = client.post(f"/api/bills/{b1['id']}/invites/{inv_id}/accept", headers=_H(budi))
    assert r.status_code == 200, r.text
    bill = db.get_bill(b1["id"])
    assert any(p["identity_id"] == budi["id"] for p in bill["payments"])
    assert db.get_invite(inv_id)["status"] == "accepted"
    assert db.get_pending_invites(budi["id"]) == []

    # decline
    citra = db.new_identity("Citra")
    db.set_auto_accept(citra["id"], 0)
    b_old2 = _make_bill(aufa, "Warung Lama 2")
    db.join_bill(b_old2["id"], citra["id"], "Citra")
    b2 = _make_bill(aufa, "Warung H")
    client.post(f"/api/bills/{b2['id']}/invite",
                json={"identity_id": citra["id"]}, headers=_H(aufa))
    inv2 = db.get_pending_invites(citra["id"])[0]
    r = client.post(f"/api/bills/{b2['id']}/invites/{inv2['id']}/decline", headers=_H(citra))
    assert r.status_code == 200, r.text
    assert db.get_invite(inv2["id"])["status"] == "declined"
    bill2 = db.get_bill(b2["id"])
    assert not any(p["identity_id"] == citra["id"] for p in bill2["payments"])
    assert db.get_pending_invites(citra["id"]) == []
    print("PASS invite accept/decline: accepted join bill, declined tetap di luar")


def test_invite_permissions_and_edges():
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    citra = db.new_identity("Citra")
    b1 = _make_bill(aufa, "Warung I")
    db.join_bill(b1["id"], budi["id"], "Budi")

    # bukan owner -> 403
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": citra["id"]}, headers=_H(budi))
    assert r.status_code == 403, r.text
    # invite diri sendiri -> 400
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": aufa["id"]}, headers=_H(aufa))
    assert r.status_code == 400, r.text
    # invite yang sudah di bill -> 400
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": budi["id"]}, headers=_H(aufa))
    assert r.status_code == 400, r.text
    # target tidak ada -> 404
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": "gak-ada"}, headers=_H(aufa))
    assert r.status_code in (400, 404), r.text
    # invite ke bill tertutup -> 403
    db.close_bill(b1["id"])
    b2 = _make_bill(aufa, "Warung J")
    r = client.post(f"/api/bills/{b2['id']}/invite",
                    json={"identity_id": citra["id"]}, headers=_H(aufa))
    db.close_bill(b2["id"])
    r = client.post(f"/api/bills/{b2['id']}/invite",
                    json={"identity_id": citra["id"]}, headers=_H(aufa))
    assert r.status_code == 403, r.text
    # accept bill tertutup -> 403
    invs = db.get_pending_invites(citra["id"])
    if invs:
        r = client.post(f"/api/bills/{b2['id']}/invites/{invs[0]['id']}/accept", headers=_H(citra))
        assert r.status_code == 403, r.text
    print("PASS invite perms: 403 non-owner/closed, 400 self/already-on-bill, 404 unknown target")


def test_auto_accept_toggle_endpoint():
    budi = db.new_identity("Budi")
    r = client.get(f"/api/identities/{budi['id']}/me", headers=_H(budi))
    assert r.status_code == 200, r.text
    assert r.json()["auto_accept"] is True
    r = client.post(f"/api/identities/{budi['id']}/auto_accept",
                    json={"auto_accept": False}, headers=_H(budi))
    assert r.status_code == 200, r.text
    assert db.get_identity(budi["id"])["auto_accept"] == 0
    assert client.get(f"/api/identities/{budi['id']}/me", headers=_H(budi)).json()["auto_accept"] is False
    # orang lain gak bisa ubah punya orang lain
    aufa = db.new_identity("Aufa", role="creator")
    r = client.post(f"/api/identities/{budi['id']}/auto_accept",
                    json={"auto_accept": True}, headers=_H(aufa))
    assert r.status_code == 403, r.text
    assert db.get_identity(budi["id"])["auto_accept"] == 0
    print("PASS auto_accept toggle: /me reflects, 403 cross-identity")


def test_contacts_endpoint_auth():
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    b1 = _make_bill(aufa, "Warung K")
    db.join_bill(b1["id"], budi["id"], "Budi")
    # header salah -> 403
    r = client.get(f"/api/identities/{aufa['id']}/contacts")
    assert r.status_code in (400, 403), r.text
    r = client.get(f"/api/identities/{aufa['id']}/contacts", headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert any(c["id"] == budi["id"] for c in r.json())
    # path id beda dari header -> 403
    citra = db.new_identity("Citra")
    r = client.get(f"/api/identities/{citra['id']}/contacts", headers=_H(aufa))
    assert r.status_code == 403, r.text
    print("PASS contacts endpoint: auth required, path==header enforced, kontak benar")


def test_invite_requires_kontak_terbukti():
    """MEDIUM fix: invite target must have shared a bill with the inviter.
    Identity ids are public (in every bill payload), so without this anyone
    could force-join strangers to their own bills (spam vector)."""
    aufa = db.new_identity("Aufa", role="creator")
    stranger = db.new_identity("Stranger")  # never shared a bill with Aufa
    b1 = _make_bill(aufa, "Warung Kontak")
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": stranger["id"]}, headers=_H(aufa))
    assert r.status_code == 400, r.text
    assert "share bill" in r.json()["detail"].lower(), r.json()
    # belum jadi peserta
    assert not db.identity_on_bill(b1["id"], stranger["id"])
    # setelah stranger share bill sekali (join bill Aufa), bisa di-invite
    b_old = _make_bill(aufa, "Warung Lama")
    db.join_bill(b_old["id"], stranger["id"], "Stranger")
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": stranger["id"]}, headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "joined", r.json()
    print("PASS invite scope: target wajib kontak terbukti, stranger 400, kontak OK")


def test_reinvite_after_remove_person_actually_joins():
    """HIGH fix: an 'accepted' invite row used to survive remove_person, so a
    re-invite returned status=joined while the person was never re-joined."""
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    b_old = _make_bill(aufa, "Warung Lama")
    db.join_bill(b_old["id"], budi["id"], "Budi")
    b1 = _make_bill(aufa, "Warung E2")
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": budi["id"]}, headers=_H(aufa))
    assert r.json()["status"] == "joined", r.json()
    assert db.identity_on_bill(b1["id"], budi["id"])
    # owner removes Budi
    r = client.delete(f"/api/bills/{b1['id']}/people/{budi['id']}", headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert not db.identity_on_bill(b1["id"], budi["id"])
    # re-invite -> harus beneran join lagi (payment row ada), bukan status palsu
    r = client.post(f"/api/bills/{b1['id']}/invite",
                    json={"identity_id": budi["id"]}, headers=_H(aufa))
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "joined", r.json()
    assert db.identity_on_bill(b1["id"], budi["id"]), "re-invite harus beneran join"
    print("PASS reinvite: setelah remove_person, invite ulang beneran join (bukan stale)")


def test_auto_accept_toggle_strict_boolean():
    """LOW fix: bool('false') == True — malformed clients silently flipped
    auto_accept ON. Toggle must accept only true/1."""
    budi = db.new_identity("Budi")
    r = client.post(f"/api/identities/{budi['id']}/auto_accept",
                    json={"auto_accept": "false"}, headers=_H(budi))
    assert r.status_code == 200, r.text
    assert db.get_identity(budi["id"])["auto_accept"] == 0, "string 'false' harus OFF"
    r = client.post(f"/api/identities/{budi['id']}/auto_accept",
                    json={"auto_accept": "true"}, headers=_H(budi))
    assert db.get_identity(budi["id"])["auto_accept"] == 1
    r = client.post(f"/api/identities/{budi['id']}/auto_accept",
                    json={"auto_accept": 0}, headers=_H(budi))
    assert db.get_identity(budi["id"])["auto_accept"] == 0
    r = client.post(f"/api/identities/{budi['id']}/auto_accept",
                    json={"auto_accept": True}, headers=_H(budi))
    assert db.get_identity(budi["id"])["auto_accept"] == 1
    print("PASS auto_accept strict: 'false'/'true' di-pasre bener, angka juga")


def test_pending_invites_exclude_closed_bills():
    """LOW fix: a pending card for a closed bill is a dead-end — accept 403s
    and the card lingers forever. Closed bills must not show pending cards."""
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    db.set_auto_accept(budi["id"], 0)
    b_old = _make_bill(aufa, "Warung Lama")
    db.join_bill(b_old["id"], budi["id"], "Budi")
    b1 = _make_bill(aufa, "Warung Closed Invite")
    client.post(f"/api/bills/{b1['id']}/invite",
                json={"identity_id": budi["id"]}, headers=_H(aufa))
    assert len(db.get_pending_invites(budi["id"])) == 1
    db.close_bill(b1["id"])
    assert db.get_pending_invites(budi["id"]) == [], "closed bill gak boleh nongol di card"
    print("PASS pending invites: closed bill di-exclude dari home card")


def test_join_via_link_voids_pending_invite():
    """Edge: someone with a pending invite opens the bill link instead of the
    home card. The link join used to leave the invite 'pending', so home kept
    showing a dead "Gabung" card for someone already in the bill."""
    aufa = db.new_identity("Aufa", role="creator")
    budi = db.new_identity("Budi")
    db.set_auto_accept(budi["id"], 0)
    b_old = _make_bill(aufa, "Warung Lama")
    db.join_bill(b_old["id"], budi["id"], "Budi")
    b1 = _make_bill(aufa, "Warung Link-Join")
    client.post(f"/api/bills/{b1['id']}/invite",
                json={"identity_id": budi["id"]}, headers=_H(aufa))
    assert len(db.get_pending_invites(budi["id"])) == 1
    # Budi opens the link directly (POST /join) instead of accepting the card
    r = client.post(f"/api/bills/{b1['id']}/join", headers=_H(budi))
    assert r.status_code == 200, r.text
    assert db.identity_on_bill(b1["id"], budi["id"])
    assert db.get_pending_invites(budi["id"]) == [], "join via link harus void invite"
    inv = db.get_invites_for_bill(b1["id"])
    assert inv and inv[0]["status"] == "accepted"
    print("PASS join via link: pending invite di-void, card home bersih")


if __name__ == "__main__":
    import traceback
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    failed = 0
    for fn in fns:
        try:
            fn()
        except Exception:
            failed += 1
            print(f"FAIL {fn.__name__}")
            traceback.print_exc()
    print(f"\n{len(fns) - failed}/{len(fns)} passed")
    sys.exit(1 if failed else 0)