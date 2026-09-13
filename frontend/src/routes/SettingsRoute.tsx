import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Key, Plus, SignOut, Trash, UserCircle, Wallet } from "@phosphor-icons/react";
import { apiClient } from "../lib/api";
import { createRequestGate } from "../lib/async-state";
import { navigate } from "../lib/routes";
import type { Identity, PaymentAccount } from "../lib/types";
import { AccountRows, AppFrame, Topbar } from "../components/AppShell";
import { Alert, Badge, Button, Card, Input, Label, Spinner, Switch } from "../components/ui/primitives";

export function SettingsRoute({ identity, onIdentity, onLogout }: { identity: Identity; onIdentity: (value: Identity) => void; onLogout: () => void }) {
  const [profile, setProfile] = useState({ name: identity.name, has_code: Boolean(identity.has_code), auto_accept: identity.auto_accept !== false });
  const [accounts, setAccounts] = useState<PaymentAccount[]>([]);
  const [busy, setBusy] = useState(false);
  const [accountForm, setAccountForm] = useState({ brand: "", account_no: "", holder_name: "" });
  const [generatedCode, setGeneratedCode] = useState("");
  const [error, setError] = useState("");
  const requestGate = useRef(createRequestGate());
  useEffect(() => {
    const app = document.querySelector("#app");
    app?.classList.add("settings-page");
    return () => app?.classList.remove("settings-page");
  }, []);
  const load = async () => {
    const token = requestGate.current.begin();
    try {
      const [me, list] = await Promise.all([apiClient.identities.profile(identity.id), apiClient.identities.accounts(identity.id)]);
      if (requestGate.current.isCurrent(token)) { setProfile(me); setAccounts(list); }
    } catch (err) {
      if (requestGate.current.isCurrent(token)) setError(err instanceof Error ? err.message : "Gagal memuat akun");
    }
  };
  useEffect(() => { void load(); return () => requestGate.current.invalidate(); }, [identity.id]);
  const saveName = async (event: React.FormEvent) => { event.preventDefault(); if (!profile.name.trim()) return; setBusy(true); try { await apiClient.identities.rename(identity.id, { name: profile.name.trim() }); onIdentity({ ...identity, name: profile.name.trim() }); } catch (err) { setError(err instanceof Error ? err.message : "Gagal menyimpan nama"); } finally { setBusy(false); } };
  const addAccount = async (event: React.FormEvent) => { event.preventDefault(); if (!accountForm.brand.trim() || !accountForm.account_no.trim()) return; setBusy(true); try { const account = await apiClient.identities.addAccount(identity.id, accountForm); setAccounts(current => [...current, account]); setAccountForm({ brand: "", account_no: "", holder_name: "" }); } catch (err) { setError(err instanceof Error ? err.message : "Gagal menambah metode bayar"); } finally { setBusy(false); } };
  const toggleAutoAccept = async (value: boolean) => { setProfile(current => ({ ...current, auto_accept: value })); try { await apiClient.identities.setAutoAccept(identity.id, { auto_accept: value }); } catch (err) { setProfile(current => ({ ...current, auto_accept: !value })); setError(err instanceof Error ? err.message : "Gagal mengubah pengaturan undangan"); } };
  return <AppFrame activeNav="settings"><Topbar title="Akun" backId="back-btn" back={() => navigate({ kind: "home" })} /><div className="shell shell-solo settings-grid"><Card style={{ marginBottom: 6 }}><div className="profile-line"><div className="avatar"><UserCircle /></div><div className="grow"><p className="eyebrow">Identitas perangkat</p><strong>{identity.name}</strong><p className="muted">Nama ini dipakai saat kamu bergabung ke bill.</p></div></div><form className="stack-sm" style={{ marginTop: 18 }} onSubmit={saveName}><div className="field"><Label htmlFor="settings-name">Nama</Label><Input id="settings-name" value={profile.name} onChange={event => setProfile(current => ({ ...current, name: event.target.value }))} maxLength={60} /></div><Button type="submit" variant="outline" disabled={busy}>Simpan nama</Button></form></Card><Card><div className="card-title"><span><Wallet /> Metode pembayaran</span><Badge tone="neutral">Hanya kamu</Badge></div><p className="muted">Simpan rekening atau dompet digital untuk ditampilkan ke teman yang perlu transfer.</p><AccountRows accounts={accounts} name={identity.name} /><form className="stack-sm" style={{ marginTop: 13 }} onSubmit={addAccount}><div className="form-grid"><div className="field"><Label htmlFor="account-brand">Brand</Label><Input id="account-brand" value={accountForm.brand} onChange={event => setAccountForm(current => ({ ...current, brand: event.target.value }))} placeholder="BCA, Mandiri, GoPay" /></div><div className="field"><Label htmlFor="account-no">Nomor</Label><Input id="account-no" value={accountForm.account_no} onChange={event => setAccountForm(current => ({ ...current, account_no: event.target.value }))} inputMode="numeric" /></div><div className="field full"><Label htmlFor="account-holder">Nama pemilik, opsional</Label><Input id="account-holder" value={accountForm.holder_name} onChange={event => setAccountForm(current => ({ ...current, holder_name: event.target.value }))} /></div></div><Button type="submit" variant="outline" disabled={busy}><Plus /> Tambah metode bayar</Button></form></Card><Card><div className="row-between toggle-row"><div><div className="card-title" style={{ marginBottom: 4 }}>Undangan langsung</div><p className="muted">Terima undangan dari kontak secara otomatis atau cek dulu di beranda.</p></div><Switch id="auto-accept-switch" checked={profile.auto_accept} onCheckedChange={toggleAutoAccept} label="Terima undangan otomatis" /></div></Card><Card><div className="card-title"><span><Key /> Kode pemulihan</span>{profile.has_code && <Badge tone="success">Sudah dibuat</Badge>}</div><p className="muted">Kode ini membantu memulihkan identitas di perangkat lain. Simpan di tempat aman.</p>{generatedCode && <Alert tone="success"><strong>{generatedCode}</strong></Alert>}<Button variant="outline" onClick={async () => { try { const result = await apiClient.identities.generateCode(identity.id); setGeneratedCode(result.code); setProfile(current => ({ ...current, has_code: true })); } catch (err) { setError(err instanceof Error ? err.message : "Gagal membuat kode"); } }}>{profile.has_code ? "Buat kode baru" : "Buat kode"}</Button></Card>{error && <Alert tone="danger">{error}</Alert>}<Button id="logout-btn" variant="ghost" className="btn-danger-link" onClick={onLogout}><SignOut /> Keluar dari perangkat ini</Button></div></AppFrame>;
}
