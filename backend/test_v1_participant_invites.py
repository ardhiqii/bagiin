"""Peserta yang dipilih dari kontak harus terhubung dan terundang.

Bug yang dijaga file ini: layar Buat bill dulu hanya mengirim NAMA peserta.
Baris peserta tersimpan tanpa identity_id, tidak ada baris undangan, dan orang
yang sudah dipilih tidak pernah tahu dirinya masuk bill. Efek sampingnya,
Rekap tidak bisa membentuk saldo karena tidak ada pasangan identitas — angka
rekap terlihat "tidak berubah" walau bill baru terus bertambah.

Jalankan:
    BAGIIN_DB=/tmp/bagiin_invite.db venv/bin/python -m pytest test_v1_participant_invites.py
"""
import os
import sys
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp()) / "test.db"
os.environ["BAGIIN_DB"] = str(_tmp)
# jangan biarkan backfill saat import ikut campur dengan data uji
os.environ["BAGIIN_SKIP_PARTICIPANT_BACKFILL"] = "1"

sys.path.insert(0, str(Path(__file__).resolve().parent))

import db
from fastapi.testclient import TestClient

db.init_db()

import main

client = TestClient(main.app)
main.app.state.limiter.enabled = False


def _H(who):
    ident = who if isinstance(who, dict) else db.get_identity(who)
    return {"X-Identity-Id": ident["id"], "X-Identity-Secret": ident.get("secret", "")}


def _shared_bill(owner, guest):
    """Bikin mereka jadi kontak: satu bill yang sama, guest gabung."""
    bill = db.create_bill(
        creator_id=owner["id"], title="Bill lama", tax_mode="proportional",
        subtotal=20000, tax=0, service=0, total=20000,
        items=[{"name": "Kopi", "price": 20000}],
        participants=[guest["name"]],
    )
    db.join_bill(bill["id"], guest["id"], guest["name"])
    return bill["id"]


def _create_bill(owner, participants, total=60000):
    response = client.post("/api/bills", headers=_H(owner), json={
        "title": "Bill baru",
        "transacted_at": "2026-11-01 12:00:00",
        "tax_mode": "proportional",
        "subtotal": total, "tax": 0, "service": 0, "total": total,
        "order_discount": 0, "cashback": 0,
        "items": [{"name": "Makan", "price": total, "discount": 0,
                   "quantity": 1, "mode": "free", "slot_count": None}],
        "participants": participants,
    })
    assert response.status_code == 200, response.text
    # bentuknya tetap {"id": ...} seperti kontrak lama
    return response.json()


def test_peserta_dari_kontak_langsung_terhubung_dan_masuk():
    owner = db.new_identity("Aufa Uji", role="creator")
    guest = db.new_identity("Amel Uji")
    _shared_bill(owner, guest)

    bill = _create_bill(owner, [{"name": guest["name"], "identity_id": guest["id"]}])

    # 1) baris peserta menunjuk identitas asli, bukan cuma teks
    participants = db.get_bill(bill["id"])["participants"]
    linked = [p for p in participants if p.get("identity_id") == guest["id"]]
    assert linked, participants

    # 2) auto_accept bawaan 1: dia langsung jadi anggota (punya baris payment)
    assert db.identity_on_bill(bill["id"], guest["id"]) is True

    # 3) bill-nya muncul di beranda dia
    rows = client.get(
        "/api/identities/%s/bills" % guest["id"], headers=_H(guest)
    ).json()
    assert any(row["id"] == bill["id"] for row in rows), [r["title"] for r in rows]


def test_auto_accept_mati_dapat_kartu_undangan():
    owner = db.new_identity("Budi Uji", role="creator")
    guest = db.new_identity("Sari Uji")
    _shared_bill(owner, guest)
    db.set_auto_accept(guest["id"], False)

    bill = _create_bill(owner, [{"name": guest["name"], "identity_id": guest["id"]}])

    invites = client.get(
        "/api/identities/%s/invites" % guest["id"], headers=_H(guest)
    ).json()
    assert len(invites) == 1, invites
    assert invites[0]["bill_id"] == bill["id"]
    # belum jadi anggota, tapi sudah diundang
    assert db.identity_on_bill(bill["id"], guest["id"]) is False


def test_orang_asing_tidak_diundang_tapi_namanya_tetap_ada():
    owner = db.new_identity("Citra Uji", role="creator")
    stranger = db.new_identity("Orang Asing")

    bill = _create_bill(owner, [{"name": stranger["name"], "identity_id": stranger["id"]}])

    invites = client.get(
        "/api/identities/%s/invites" % stranger["id"], headers=_H(stranger)
    ).json()
    assert invites == []
    assert db.identity_on_bill(bill["id"], stranger["id"]) is False
    # nama yang diketik tetap disimpan, cuma tidak ditautkan
    participants = db.get_bill(bill["id"])["participants"]
    assert any(p["name"] == stranger["name"] for p in participants)


def test_rekap_bergerak_setelah_pasangan_identitas_ada():
    owner = db.new_identity("Dewi Uji", role="creator")
    guest = db.new_identity("Eko Uji")
    _shared_bill(owner, guest)

    before = client.get(
        "/api/identities/%s/recap" % owner["id"], headers=_H(owner)
    ).json()

    bill = _create_bill(owner, [{"name": guest["name"], "identity_id": guest["id"]}])
    detail = client.get("/api/bills/%s" % bill["id"], headers=_H(guest)).json()
    item_id = detail["items"][0]["id"]
    picked = client.post(
        "/api/bills/%s/selections" % bill["id"], headers=_H(guest),
        json={"picks": [{"item_id": item_id, "qty": 1}]},
    )
    assert picked.status_code == 200, picked.text

    after = client.get(
        "/api/identities/%s/recap" % owner["id"], headers=_H(owner)
    ).json()
    assert after["final"]["receivable_idr"] > before["final"]["receivable_idr"]
    assert any(
        c["identity_id"] == guest["id"] for c in after["final"]["counterparties"]
    )
    # dan sisi tamu melihat kewajiban yang sama besarnya
    guest_recap = client.get(
        "/api/identities/%s/recap" % guest["id"], headers=_H(guest)
    ).json()
    assert guest_recap["final"]["payable_idr"] == after["final"]["receivable_idr"]


def test_hapus_nama_dari_bill_membatalkan_undangan_menunggu():
    """Mengedit daftar nama harus ikut mencabut undangan yang masih pending.

    Tanpa ini, layar bill menyimpan kartu "Undangan menunggu" untuk orang yang
    namanya sudah dihapus pembuat bill.
    """
    owner = db.new_identity("Hana Uji", role="creator")
    guest = db.new_identity("Indra Uji")
    _shared_bill(owner, guest)
    db.set_auto_accept(guest["id"], False)

    bill = _create_bill(owner, [{"name": guest["name"], "identity_id": guest["id"]}])
    invites = client.get(
        "/api/identities/%s/invites" % guest["id"], headers=_H(guest)
    ).json()
    assert len(invites) == 1, invites

    # pembuat menghapus nama itu dari daftar (item tetap seperti semula)
    detail = client.get("/api/bills/%s" % bill["id"], headers=_H(owner)).json()
    money = detail["bill"]
    response = client.put("/api/bills/%s" % bill["id"], headers=_H(owner), json={
        "title": money["title"],
        "tax_mode": money.get("tax_mode", "proportional"),
        "subtotal": money["subtotal_idr"],
        "order_discount": money.get("order_discount_idr", 0),
        "cashback": money.get("cashback_idr", 0),
        "tax": money.get("tax_idr", 0),
        "service": money.get("service_idr", 0),
        "total": money["total_idr"],
        "items": [
            {
                "id": item["id"], "name": item["name"], "price": item["price_idr"],
                "quantity": item.get("quantity", 1), "discount": item.get("discount_idr", 0),
                "mode": item.get("mode", "free"), "slot_count": item.get("slot_count"),
            }
            for item in detail["items"]
        ],
        "participants": [],
    })
    assert response.status_code == 200, response.text

    invites_after = client.get(
        "/api/identities/%s/invites" % guest["id"], headers=_H(guest)
    ).json()
    assert invites_after == [], invites_after


def test_backfill_menautkan_bill_lama_yang_cuma_menyimpan_nama():
    owner = db.new_identity("Fajar Uji", role="creator")
    guest = db.new_identity("Gita Uji")
    _shared_bill(owner, guest)

    # bill gaya lama: peserta hanya nama, tanpa identity_id
    legacy = db.create_bill(
        creator_id=owner["id"], title="Bill lama tanpa tautan",
        tax_mode="proportional", subtotal=30000, tax=0, service=0, total=30000,
        items=[{"name": "Nasi", "price": 30000}], participants=[guest["name"]],
    )
    assert not any(
        p.get("identity_id") for p in db.get_bill(legacy["id"])["participants"]
    )

    candidates = db.participant_link_candidates()
    assert any(c["bill_id"] == legacy["id"] for c in candidates), candidates

    # backfill sengaja dimatikan saat import modul; di sini kita minta jalan
    os.environ.pop("BAGIIN_SKIP_PARTICIPANT_BACKFILL", None)
    try:
        main._backfill_participant_links()
    finally:
        os.environ["BAGIIN_SKIP_PARTICIPANT_BACKFILL"] = "1"

    linked = db.get_bill(legacy["id"])["participants"]
    assert any(p.get("identity_id") == guest["id"] for p in linked), linked
    assert db.identity_on_bill(legacy["id"], guest["id"]) is True
