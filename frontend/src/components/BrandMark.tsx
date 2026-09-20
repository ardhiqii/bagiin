import { useId } from "react";

/**
 * The real Bagiin mark: a receipt torn down a zigzag seam. This is a port, not
 * a redesign — the gradient stops, the rx=115 tile, the two tear clipPaths and
 * the six receipt lines are the same geometry as the shipped favicon
 * (frontend/static/favicon.svg) and the legacy `brandMark(size)` helper in
 * frontend/static/app.js (v68b). The React port had swapped this artwork for a
 * stock Phosphor `Receipt` glyph, so the product mark never appeared in the app.
 *
 * Legacy sized the mark with inline width/height plus
 * `display:block;border-radius:round(size*0.22)px`, and it was the mark itself
 * that was 26x26: `.brand-mark` in frontend/index.html is a 26x26 TRANSPARENT box
 * (no background property) and the artwork is full-bleed inside it — the orange
 * tile is the svg's own rx=115 gradient rect, not a CSS background. The React
 * port instead painted `background: var(--accent)` on the box and centred a small
 * stock Phosphor glyph inside, which is what the user saw: an orange ring around
 * a tiny generic receipt icon. So there is deliberately no 18px logo rule: the
 * 18px figure is the legacy CONTROL-icon baseline (`svg.ico`) and applies to
 * icons in .btn / .card-title / .link-button, never to the mark.
 *
 * Size is expressed through the width/height PRESENTATION ATTRIBUTES, not an
 * inline style. That matters: legacy generated raw HTML strings with no
 * stylesheet to lean on, so it inlined everything; in the React app the CSS lane
 * owns `.brand-mark > svg { width:100%; height:100%; display:block }` and an
 * inline style would outrank it, leaving that rule permanently inert — the same
 * "rule that can never match" defect this batch exists to fix. Presentation
 * attributes keep the size honest (a standalone mark outside `.brand-mark`
 * still renders at `size`), while stylesheet sizing stays authoritative inside
 * the lockup. Default 26 is the topbar lockup's box; other callers pass `size`.
 *
 * The corner radius is deliberately NOT set here. Legacy applied
 * `round(size*0.22)` (6px at 26) to the svg while the box carried 8px, but the
 * artwork's own `rx=115` on a 512 viewBox is already ~5.8px at 26px — that rect
 * is what visibly rounds the tile, so the CSS `border-radius` is close to a
 * no-op. Following the agreed contract, the radius inherits from the box.
 */
export function BrandMark({ size = 26, className }: { size?: number; className?: string }) {
  // defs are per-instance, so a page with two marks would otherwise share a
  // gradient/clip id: invalid DOM, and the second instance resolves the first
  // instance's defs. Math.random() (what legacy used) is worse in React 18 —
  // every re-render mints new ids, and StrictMode renders twice. useId() is
  // stable across re-renders and unique per component instance; the colons in
  // React's ":r0:" form are stripped so the ids stay CSS-selector safe.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradientId = `bm${uid}bg`;
  const tearLeftId = `bm${uid}tear-l`;
  const tearRightId = `bm${uid}tear-r`;
  const slipId = `bm${uid}slip`;
  return <svg
    viewBox="0 0 512 512"
    width={size}
    height={size}
    className={className}
    // The wordmark beside the mark already names the brand, so the artwork is
    // decorative here (the favicon keeps role="img" + aria-label because it
    // stands alone, and the legacy helper's role="img" was inside a lockup that
    // also said "Bagiin"). Marking it up twice announces the brand twice.
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id={gradientId} x1="0" y1="0" x2="0.25" y2="1">
        <stop offset="0" stopColor="#FB943C" />
        <stop offset="1" stopColor="#DF5208" />
      </linearGradient>
      <clipPath id={tearLeftId}><polygon points="-20,-20 261.5,-20 235.5,26 261.5,72 235.5,118 261.5,164 235.5,210 261.5,256 235.5,302 261.5,348 235.5,394 261.5,440 235.5,486 261.5,532 -20,560" /></clipPath>
      <clipPath id={tearRightId}><polygon points="560,-20 276.5,-20 250.5,26 276.5,72 250.5,118 276.5,164 250.5,210 276.5,256 250.5,302 276.5,348 250.5,394 276.5,440 250.5,486 276.5,532 560,560" /></clipPath>
      <g id={slipId}>
        <path d="M124 110 H388 a16 16 0 0 1 16 16 V366 H108 V126 a16 16 0 0 1 16-16 Z" fill="#FFFDFA" />
        <polygon points="108,366 121.5,384 134.9,366 148.4,384 161.8,366 175.3,384 188.7,366 202.2,384 215.6,366 229.1,384 242.5,366 256.0,384 269.5,366 282.9,384 296.4,366 309.8,384 323.3,366 336.7,384 350.2,366 363.6,384 377.1,366 390.5,384 404.0,366" fill="#FFFDFA" />
        <g fill="#D84E08">
          <rect x="138" y="166" width="98" height="17" rx="8.5" />
          <rect x="138" y="214" width="98" height="17" rx="8.5" />
          <rect x="138" y="262" width="61" height="17" rx="8.5" />
          <rect x="276" y="166" width="98" height="17" rx="8.5" />
          <rect x="276" y="214" width="98" height="17" rx="8.5" />
          <rect x="276" y="262" width="61" height="17" rx="8.5" />
        </g>
      </g>
    </defs>
    <rect width="512" height="512" rx="115" fill={`url(#${gradientId})`} />
    <g clipPath={`url(#${tearLeftId})`}><g transform="translate(0 6)"><use href={`#${slipId}`} /></g></g>
    <g clipPath={`url(#${tearRightId})`}><g transform="translate(0 -6)"><use href={`#${slipId}`} /></g></g>
  </svg>;
}
