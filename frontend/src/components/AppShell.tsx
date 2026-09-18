import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, Copy, PencilSimple, Plus, Receipt, ShareNetwork, SignOut, Trash, UserCircle, UsersThree, Wallet } from "@phosphor-icons/react";
import { apiClient } from "../lib/api";
import { getStoredName, setStoredIdentity, setStoredName } from "../lib/identity-storage";

import type { Identity, PaymentAccount } from "../lib/types";
import { brandLabel } from "../lib/brand-logos";
import { BrandLogo } from "./BrandLogo";
import { Button, Card, Input, Label, Spinner } from "./ui/primitives";


export function Brand() {
  return <span className="brand"><span className="brand-mark"><Receipt weight="bold" /></span>Bagiin<span className="brand-dot">.</span></span>;
}

export function Topbar({ title, back, backId, actions }: { title?: string; back?: () => void; backId?: string; actions?: React.ReactNode }) {
  return <header className="topbar">
    {back ? <Button id={backId} variant="ghost" size="icon" aria-label="Kembali" onClick={back}><ArrowLeft /></Button> : <Brand />}
    {title && <div className="topbar-title">{title}</div>}
    <div className="topbar-actions">{actions}</div>
  </header>;
}

const navItems = [
  { key: "recap", label: "Rekap", href: "#/recap", icon: UsersThree },
  { key: "bill", label: "Bill", href: "#/", icon: Receipt },
  { key: "settings", label: "Akun", href: "#/settings", icon: UserCircle }
];

const MAX_NAV_BADGE_COUNT = 99;

function safeNavBadgeCount(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_NAV_BADGE_COUNT, Math.max(0, Math.trunc(value)));
}

export function MobileNav({ active, contextualDock = false, currentUserActionCount }: { active: "recap" | "bill" | "settings" | null; contextualDock?: boolean; currentUserActionCount?: number }) {
  const [eligible, setEligible] = useState(false);
  const badgeCount = safeNavBadgeCount(currentUserActionCount);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setEligible(Boolean(active) && !contextualDock && media.matches);
    sync();
    window.addEventListener("resize", sync);
    media.addEventListener?.("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      media.removeEventListener?.("change", sync);
    };
  }, [active, contextualDock]);
  return <nav id="app-nav" aria-label="Navigasi utama" hidden={!eligible} aria-hidden={!eligible}>
    {navItems.map(({ key, label, href, icon: Icon }) => {
      const activeLink = active === key && eligible;
      const ariaLabel = key === "recap" && badgeCount > 0
        ? `Rekap, ${badgeCount} tindakan yang perlu kamu lakukan`
        : label;
      return <a key={key} data-app-nav={key} href={key === "bill" ? "#/" : href} aria-label={ariaLabel} aria-current={activeLink ? "page" : undefined} className={`app-nav-link ${activeLink ? "is-active" : ""}`}>
        <Icon weight={activeLink ? "fill" : "regular"} /><span>{label}</span>{key === "recap" && eligible && badgeCount > 0 && <span className="app-nav-badge" aria-hidden="true">{badgeCount}</span>}
      </a>;
    })}
  </nav>;
}

function visualViewportGap(): number {
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  return Math.max(0, window.innerHeight - (viewport.offsetTop + viewport.height));
}

type AppShellWindow = Window & { syncDockSpace?: () => void; render?: () => void };

// Keep the legacy browser harness hook working while React owns the router.
// A synthetic hashchange makes history.replaceState repaint the current route.
function renderRoute(): void {
  window.dispatchEvent(new Event("hashchange"));
}

function editableElement(): HTMLElement | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body || active.hasAttribute("disabled") || active.hasAttribute("readonly")) return null;
  if (active.isContentEditable || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return active;
  if (!(active instanceof HTMLInputElement)) return null;
  return ["button", "checkbox", "file", "hidden", "image", "radio", "range", "reset", "submit"].includes(active.type) ? null : active;
}

// A focused field can outlive the keyboard. Once the viewport gap closes,
// later positive gaps are browser chrome movement rather than a new keyboard
// session. A pointer on the same field starts a fresh session.
let keyboardGapState: "idle" | "waiting" | "open" | "closed" = "idle";
let keyboardGapFocus: HTMLElement | null = null;

function beginKeyboardGapSession(): void {
  keyboardGapFocus = editableElement();
  keyboardGapState = keyboardGapFocus ? "waiting" : "idle";
}

function keyboardGapOffset(): number {
  const active = editableElement();
  if (active !== keyboardGapFocus) {
    keyboardGapFocus = active;
    keyboardGapState = active ? "waiting" : "idle";
  }
  if (!active) {
    keyboardGapState = "idle";
    return 0;
  }
  if (keyboardGapState === "idle") keyboardGapState = "waiting";
  const gap = visualViewportGap();
  if (!gap) {
    if (keyboardGapState === "open") keyboardGapState = "closed";
    return 0;
  }
  if (keyboardGapState === "closed") return 0;
  keyboardGapState = "open";
  return gap;
}

let activeDockSync: (() => void) | null = null;

/** Public browser hook retained for the legacy responsive regression harness. */
export function syncDockSpace(): void {
  activeDockSync?.();
}

/** Keep focused fields and the last row clear of the real fixed surface. */
export function useDockSpace(): void {
  const sync = useCallback(() => {
    const content = document.querySelector<HTMLElement>(".app-content");
    if (!content) return;
    const mobile = window.matchMedia("(max-width: 767px)").matches;
    const dock = content.querySelector<HTMLElement>(".dock, .sticky-bar");
    const nav = content.querySelector<HTMLElement>("#app-nav:not([hidden])");
    const dockIsVisible = Boolean(dock && getComputedStyle(dock).display !== "none");
    const surface = mobile && dockIsVisible ? dock : mobile ? nav : null;
    const root = document.documentElement;
    if (!surface) {
      content.style.paddingBottom = "";
      content.style.scrollPaddingBottom = "";
      root.style.scrollPaddingBottom = "";
      if (dock) dock.style.bottom = "";
      if (nav) nav.style.bottom = "";
      return;
    }
    const keyboardGap = keyboardGapOffset();
    surface.style.bottom = keyboardGap ? `${keyboardGap}px` : "";
    const configuredClearance = Number.parseFloat(getComputedStyle(content).getPropertyValue("--surface-clearance"));
    const clearance = Number.isFinite(configuredClearance) ? configuredClearance : 24;
    const reserve = `calc(env(safe-area-inset-bottom) + ${surface.offsetHeight + clearance}px)`;
    content.style.paddingBottom = reserve;
    content.style.scrollPaddingBottom = reserve;
    root.style.scrollPaddingBottom = reserve;
  }, []);

  useLayoutEffect(() => {
    activeDockSync = sync;
    const globalWindow = window as AppShellWindow;
    globalWindow.syncDockSpace = syncDockSpace;
    sync();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(sync);
    const content = document.querySelector<HTMLElement>(".app-content");
    const dock = content?.querySelector<HTMLElement>(".dock, .sticky-bar");
    if (dock && observer) observer.observe(dock);
    const mutationObserver = content && typeof MutationObserver !== "undefined" ? new MutationObserver(sync) : null;
    if (content && mutationObserver) mutationObserver.observe(content, { attributes: true, subtree: true, attributeFilter: ["class", "hidden"] });
    const media = window.matchMedia("(max-width: 767px)");
    const viewport = window.visualViewport;
    window.addEventListener("resize", sync);
    const onFocusIn = () => { beginKeyboardGapSession(); sync(); };
    const onFocusOut = () => sync();
    const onPointerDown = (event: Event) => {
      const active = editableElement();
      if (active && event.target instanceof Node && active.contains(event.target) && !visualViewportGap()) {
        beginKeyboardGapSession();
        sync();
      }
    };
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    document.addEventListener("pointerdown", onPointerDown);
    media.addEventListener?.("change", sync);
    viewport?.addEventListener("resize", sync);

    return () => {
      observer?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", sync);
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onPointerDown);
      media.removeEventListener?.("change", sync);
      viewport?.removeEventListener("resize", sync);

      const current = document.querySelector<HTMLElement>(".app-content");
      if (current) {
        current.style.paddingBottom = "";
        current.style.scrollPaddingBottom = "";
      }
      document.documentElement.style.scrollPaddingBottom = "";
      if (activeDockSync === sync) activeDockSync = null;
      if (globalWindow.syncDockSpace === syncDockSpace) delete globalWindow.syncDockSpace;
    };
  }, [sync]);
}

export function AppFrame({ children, activeNav = null, contextualDock = false, currentUserActionCount }: { children: React.ReactNode; activeNav?: "recap" | "bill" | "settings" | null; contextualDock?: boolean; currentUserActionCount?: number }) {
  useDockSpace();
  useEffect(() => {
    const globalWindow = window as AppShellWindow;
    globalWindow.render = renderRoute;
    return () => {
      if (globalWindow.render === renderRoute) delete globalWindow.render;
    };
  }, []);
  return <div className={`app-content ${activeNav && !contextualDock ? "nav-space" : ""}`}><MobileNav active={activeNav} contextualDock={contextualDock} currentUserActionCount={currentUserActionCount} />{children}</div>;
}

export function ShellLayout({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return aside
    ? <div className="shell shell-with-rail"><div className="shell-main">{children}</div><aside className="shell-side">{aside}</aside></div>
    : <div className="shell"><div className="shell-main">{children}</div></div>;
}

export function ContextualDock({ children }: { children: React.ReactNode }) {
  return <div className="dock" data-contextual-dock><div className="dock-panel">{children}</div></div>;
}

export function Onboarding({ onIdentity, legacyIdentity = null }: { onIdentity: (identity: Identity) => void; legacyIdentity?: Identity | null }) {
  const [name, setName] = useState(() => legacyIdentity?.name || getStoredName());
  const [recovery, setRecovery] = useState(() => Boolean(legacyIdentity));
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError("Isi nama dulu ya"); return; }
    setBusy(true); setError("");
    try {
      const identity = await apiClient.identities.create({ name: name.trim(), creator: true });
      setStoredIdentity(identity); setStoredName(name.trim()); onIdentity(identity);
    } catch (err) { setError(err instanceof Error ? err.message : "Gagal membuat identitas"); }
    finally { setBusy(false); }
  };
  const restore = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!code.trim()) { setError("Isi kodenya dulu"); return; }
    setBusy(true); setError("");
    try {
      const identity = await apiClient.identities.restore({ code: code.trim() });
      setStoredIdentity(identity); setStoredName(identity.name); onIdentity(identity);
    } catch (err) { setError(err instanceof Error ? err.message : "Kode tidak dapat dipulihkan"); }
    finally { setBusy(false); }
  };
  return <AppFrame><div className="shell"><div className="onboarding">
    <div className="onboarding-mark" aria-hidden="true"><Receipt weight="bold" /></div>
    <p className="eyebrow" style={{ marginTop: 20 }}>Bagi bill bareng</p>
    <h1>Bagi bill dengan teman tanpa rumit.</h1>
    <p className="lede">Foto struk, bagikan tautan, lalu semua orang memilih itemnya sendiri. Pajak ikut terbagi otomatis.</p>
    <Card>
      {legacyIdentity && <div className="info-box" role="status">Identitas lama ditemukan di perangkat ini. Pulihkan dengan kode agar sesi dan bill kamu tetap aman.</div>}
      <form id="onboard-form" onSubmit={submit} noValidate className="stack-sm">
        <div className="field"><Label htmlFor="name-input">Siapa nama kamu?</Label><Input id="name-input" name="name" value={name} onChange={event => setName(event.target.value)} placeholder="Biar teman kamu tahu ini kamu" maxLength={60} autoComplete="name" autoFocus /></div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <Button id="onboard-btn" type="submit" disabled={busy}>{busy ? <><Spinner /> Bentar...</> : "Mulai"}</Button>
      </form>
      <p className="muted onboarding-note">Tanpa akun. Nama kamu disimpan di perangkat ini.</p>
      <Button id="restore-link" type="button" variant="ghost" className="recovery-toggle" aria-expanded={recovery} aria-controls="restore-box" onClick={() => setRecovery(value => !value)}>{legacyIdentity ? "Pulihkan identitas lama" : "Punya kode pemulihan?"}</Button>
      {recovery && <form id="restore-box" onSubmit={restore} className="recovery-box stack-sm" noValidate><div className="field"><Label htmlFor="restore-code">Kode pemulihan</Label><Input id="restore-code" value={code} onChange={event => setCode(event.target.value)} placeholder="XXXX-XXXX-XXXX" autoComplete="one-time-code" /></div><Button id="restore-btn" type="submit" variant="outline" disabled={busy}>{busy ? <Spinner /> : "Pulihkan akun"}</Button></form>}
    </Card>
  </div></div></AppFrame>;
}

export { EmptyState, ErrorState, LoadingState } from "./feedback";

type AccountRowsProps = {
  accounts?: PaymentAccount[];
  name: string;
  onEdit?: (account: PaymentAccount) => void;
  onDelete?: (account: PaymentAccount) => void;
  actionDisabled?: boolean;
};

export function AccountRows({ accounts, name, onEdit, onDelete, actionDisabled = false }: AccountRowsProps) {
  if (!accounts?.length) return <p className="muted">Belum ada metode pembayaran yang disimpan oleh {name}.</p>;
  return <div className="account-list">{accounts.map(account => <div className="payment-account" key={account.id} data-account-id={account.id} style={{ minWidth: 0 }}><BrandLogo code={account.brand} /><div className="payment-account-copy"><strong>{brandLabel(account.brand)}</strong><div className="account-number">{account.account_no}</div>{account.holder_name && <div className="caption">a.n. {account.holder_name}</div>}</div><div className="payment-account-actions"><Button variant="ghost" size="icon" aria-label={`Salin nomor ${account.brand}`} onClick={() => { void navigator.clipboard?.writeText(account.account_no); }}><Copy /></Button>{onEdit && <Button variant="ghost" size="icon" aria-label={`Edit ${account.brand} ${account.account_no}`} data-account-edit={account.id} disabled={actionDisabled} onClick={() => onEdit(account)}><PencilSimple /></Button>}{onDelete && <Button variant="ghost" size="icon" aria-label={`Hapus ${account.brand} ${account.account_no}`} data-account-delete={account.id} disabled={actionDisabled} onClick={() => onDelete(account)}><Trash /></Button>}</div></div>)}</div>;
}

export function ShareDialogContent({ billId, title, onClose }: { billId: string; title: string; onClose: () => void }) {
  const url = `${window.location.origin}/#/b/${billId}`;
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(url); setCopied(true); } catch { /* manual copy remains visible */ } };
  return <div className="stack-sm"><p className="muted">Siapa pun yang memegang link ini bisa memilih item sendiri. Tidak perlu membuat akun.</p><div className="input" style={{ height: "auto", minHeight: 46, display: "flex", alignItems: "center", overflowWrap: "anywhere" }}>{url}</div><Button onClick={copy}>{copied ? <><Check /> Link disalin</> : <><Copy /> Salin link</>}</Button><Button variant="outline" onClick={() => { window.open(`https://wa.me/?text=${encodeURIComponent(`Yuk bagi bill "${title}" di Bagiin: ${url}`)}`, "_blank", "noopener,noreferrer"); onClose(); }}><ShareNetwork /> Kirim lewat WhatsApp</Button></div>;
}

export function useIsMounted() { const [mounted, setMounted] = useState(false); useEffect(() => setMounted(true), []); return mounted; }

export function useClipboard() { return useMemo(() => async (text: string) => { try { await navigator.clipboard.writeText(text); return true; } catch { return false; } }, []); }

export { Plus, SignOut };
