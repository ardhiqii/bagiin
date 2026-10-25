/**
 * Hand-drawn (SVG) illustration for empty / first-run states.
 *
 * Deliberately not generated art: it is geometric, palette-locked, and stays
 * sharp at any density. Pieces are simple shapes on a warm off-white field so it
 * reads as an editorial spot illustration rather than a mascot.
 */
export function EmptyBillArt({ label = 'Meja kosong dengan satu struk' }: { label?: string }) {
  return <svg className="ds-art" viewBox="0 0 240 160" role="img" aria-label={label}>
    <defs>
      <clipPath id="ds-art-receipt">
        <path d="M96 34h48v74l-6-5-6 5-6-5-6 5-6-5-6 5-6-5-6 5z" />
      </clipPath>
    </defs>

    {/* table plane */}
    <ellipse cx="120" cy="132" rx="86" ry="12" fill="#e2f5ef" />
    <path d="M34 104h172a10 10 0 0 1-10 10H44a10 10 0 0 1-10-10z" fill="#cfe9e1" />

    {/* chairs */}
    <rect x="16" y="74" width="16" height="34" rx="8" fill="#142f3a" opacity=".16" />
    <rect x="208" y="74" width="16" height="34" rx="8" fill="#142f3a" opacity=".16" />

    {/* plate */}
    <circle cx="168" cy="92" r="21" fill="#ffffff" />
    <circle cx="168" cy="92" r="13" fill="#f2f6f6" />
    <path d="M158 92h20" stroke="#087665" strokeWidth="2.5" strokeLinecap="round" />

    {/* receipt */}
    <g clipPath="url(#ds-art-receipt)">
      <rect x="96" y="34" width="48" height="80" fill="#ffffff" />
      <rect x="104" y="46" width="32" height="3" rx="1.5" fill="#142f3a" opacity=".82" />
      <rect x="104" y="56" width="24" height="3" rx="1.5" fill="#536d78" opacity=".5" />
      <rect x="104" y="66" width="28" height="3" rx="1.5" fill="#536d78" opacity=".5" />
      <rect x="104" y="76" width="20" height="3" rx="1.5" fill="#536d78" opacity=".5" />
      <rect x="104" y="90" width="32" height="4" rx="2" fill="#087665" />
    </g>
    <path d="M96 34h48v74l-6-5-6 5-6-5-6 5-6-5-6 5-6-5-6 5z" fill="none" stroke="#dce7e7" strokeWidth="1.5" />

    {/* the one warm accent: a stray coin */}
    <circle cx="72" cy="88" r="7" fill="#8a590f" opacity=".9" />
    <circle cx="72" cy="88" r="3" fill="#fff1d8" />
  </svg>
}
