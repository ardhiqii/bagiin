import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, X } from "@phosphor-icons/react";
import { photoUrl } from "../lib/photo-path";

export function ReceiptPhotoGallery({
  paths,
  onRemove,
  removeDisabled = false,
}: {
  paths: string[];
  onRemove?: (index: number) => void;
  removeDisabled?: boolean;
}) {
  const photos = paths
    .map((path, sourceIndex) => ({ path, sourceIndex, url: photoUrl(path) }))
    .filter((photo): photo is { path: string; sourceIndex: number; url: string } => Boolean(photo.url))
    .map((photo, index) => ({ ...photo, index }));
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (viewerIndex == null || !photos.length) return undefined;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setViewerIndex(null);
      } else if (event.key === "Tab") {
        const focusable = [...(viewerRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])') || [])];
        if (focusable.length) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
      } else if (photos.length > 1 && event.key === "ArrowLeft") {
        event.preventDefault();
        setViewerIndex(current => current == null ? 0 : (current - 1 + photos.length) % photos.length);
      } else if (photos.length > 1 && event.key === "ArrowRight") {
        event.preventDefault();
        setViewerIndex(current => current == null ? 0 : (current + 1) % photos.length);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [photos.length, viewerIndex]);

  const current = viewerIndex == null ? undefined : photos[viewerIndex];
  if (!photos.length) return null;

  return <>
    <div className="receipt-photo-grid" aria-label="Foto struk yang terlampir">
      {photos.map(photo => <div className="receipt-photo-tile" key={`${photo.path}-${photo.index}`}>
        <button
          type="button"
          className="receipt-photo-thumb"
          aria-label={`Lihat foto struk ${photo.index + 1}`}
          onClick={() => setViewerIndex(photo.index)}
        >
          <img src={photo.url} alt={`Struk ${photo.index + 1}`} loading="lazy" />
          <span className="receipt-photo-zoom" aria-hidden="true">Lihat</span>
        </button>
        {onRemove && <button
          type="button"
          className="receipt-photo-remove"
          aria-label={`Hapus foto struk ${photo.index + 1}`}
          disabled={removeDisabled}
          onClick={() => onRemove(photo.sourceIndex)}
        ><X weight="bold" /></button>}
      </div>)}
    </div>
    {current && <div
      className="receipt-photo-viewer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Pratinjau foto struk ${current.index + 1} dari ${photos.length}`}
      onMouseDown={event => { if (event.target === event.currentTarget) setViewerIndex(null); }}
    >
      <div ref={viewerRef} className="receipt-photo-viewer">
        <div className="receipt-photo-viewer-topbar">
          <span>{current.index + 1} / {photos.length}</span>
          <button ref={closeButtonRef} type="button" className="receipt-photo-viewer-close" aria-label="Tutup pratinjau foto" onClick={() => setViewerIndex(null)}><X weight="bold" /></button>
        </div>
        <img className="receipt-photo-viewer-image" src={current.url} alt={`Foto struk ${current.index + 1}`} />
        {photos.length > 1 && <div className="receipt-photo-viewer-controls">
          <button type="button" className="receipt-photo-viewer-nav" aria-label="Foto struk sebelumnya" onClick={() => setViewerIndex(index => index == null ? 0 : (index - 1 + photos.length) % photos.length)}><ArrowLeft /> Sebelumnya</button>
          <button type="button" className="receipt-photo-viewer-nav" aria-label="Foto struk berikutnya" onClick={() => setViewerIndex(index => index == null ? 0 : (index + 1) % photos.length)}>Berikutnya <ArrowRight /></button>
        </div>}
      </div>
    </div>}
  </>;
}
