import type { ReactNode } from "react";
import { ArrowClockwise, Receipt } from "@phosphor-icons/react";
import { Button, Card, Dialog, Skeleton } from "./ui/primitives";

export function LoadingState({ label = "Memuat", rows = 3 }: { label?: string; rows?: number }) {
  return <section className="loading-state" aria-busy="true" aria-live="polite" aria-label={label}>
    <Card>
      <div className="stack-sm">
        {Array.from({ length: Math.max(1, rows) }, (_, index) => <div className="skeleton-row" key={index}>
          <Skeleton className="status-mark" />
          <div className="skeleton-copy"><Skeleton style={{ width: "58%", height: 14 }} /><Skeleton style={{ width: "36%", height: 10 }} /></div>
        </div>)}
      </div>
    </Card>
  </section>;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <Card><div className="empty-state"><Receipt aria-hidden="true" /><strong>{title}</strong>{description && <p className="muted">{description}</p>}{action}</div></Card>;
}

export function ErrorState({ message, retry, home = true, title = "Gagal memuat" }: { message: string; retry?: () => void; home?: boolean; title?: string }) {
  return <Card><div className="empty-state"><Receipt aria-hidden="true" /><strong>{title}</strong><p className="muted">{message}</p><div className="row wrap">{retry && <Button variant="primary" size="sm" onClick={retry}><ArrowClockwise /> Coba lagi</Button>}{home && <Button variant="outline" size="sm" onClick={() => { window.location.hash = "#/"; }}>Ke beranda</Button>}</div></div></Card>;
}

export function ConfirmDialog({ open, title = "Buang perubahan?", description = "Perubahan di editor belum disimpan.", onClose, onConfirm }: { open: boolean; title?: string; description?: string; onClose: () => void; onConfirm: () => void }) {
  return <Dialog open={open} title={title} description={description} onClose={onClose}>
    <div className="row wrap sheet-actions">
      <Button type="button" variant="outline" onClick={onClose}>Tetap di sini</Button>
      <Button type="button" variant="danger" onClick={onConfirm}>Buang perubahan</Button>
    </div>
  </Dialog>;
}
