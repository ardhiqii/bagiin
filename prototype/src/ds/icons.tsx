/**
 * Ikon navigasi, digambar tangan di grid 24 px.
 *
 * Kenapa tidak pakai ikon library: ikon bawaan Phosphor punya ketebalan garis dan
 * radius sudut sendiri, jadi di nav yang sempit campurannya terasa generik.
 * Empat ikon di sini memakai satu bahasa: garis 1,7 px, ujung bulat, tanpa isi,
 * dan versi aktif menebal ke 2,2 px. Semua memakai currentColor supaya warna
 * status tetap dipegang CSS.
 */

type IconProps = { active?: boolean };

const BASE = {
  width: 23,
  height: 23,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export function NavHome({ active }: IconProps) {
  return (
    <svg {...BASE} strokeWidth={active ? 2.2 : 1.7}>
      <path d="M4.4 10.3 12 4.1l7.6 6.2V19a1.6 1.6 0 0 1-1.6 1.6H6A1.6 1.6 0 0 1 4.4 19z" />
      <path d="M9.7 20.6v-5.1h4.6v5.1" />
    </svg>
  );
}

export function NavBill({ active }: IconProps) {
  return (
    <svg {...BASE} strokeWidth={active ? 2.2 : 1.7}>
      <path d="M6.4 3.7h11.2v16.6l-2.24-1.7-2.24 1.7-2.24-1.7-2.24 1.7-2.24-1.7z" />
      <path d="M9.3 8.3h5.4M9.3 11.9h5.4" />
    </svg>
  );
}

export function NavRecap({ active }: IconProps) {
  return (
    <svg {...BASE} strokeWidth={active ? 2.4 : 1.9}>
      <path d="M4.9 19.3v-5.6M12 19.3V5.9M19.1 19.3v-8.4" />
    </svg>
  );
}

export function NavCreate() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" aria-hidden>
      <path d="M12 5.6v12.8M5.6 12h12.8" />
    </svg>
  );
}

/**
 * Tanda merek: huruf b yang batangnya struk, ujung bawahnya bergerigi.
 *
 * Digambar sebagai path, bukan raster: dipakai dari 20 px di sidebar sampai
 * 180 px sebagai ikon PWA. Proporsinya harus huruf b sungguhan — ascender naik
 * di atas bowl, batang berhenti di baseline yang sama dengan dasar bowl. Versi
 * pertama salah di sini dan kebaca seperti huruf p.
 *
 * Di bawah 44 px gerigi dibuang: di 34 px notch-nya cuma kebaca sebagai tepi rusak.
 */
export function BrandMark({ size = 34 }: { size?: number }) {
  const detail = size >= 44
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx={size >= 28 ? 9 : 8} fill="var(--ds-navy)" />
      <g fill="var(--ds-mint)">
        {detail ? (
          <path d="M8.6 5.2h4.9v21.4l-1.22-2.1-1.23 2.1-1.22-2.1-1.23 2.1z" />
        ) : (
          <path d="M8.6 5.2h4.9v20.9H8.6z" />
        )}
        <path
          fillRule="evenodd"
          d="M11 19.4A7 7 0 1 0 25 19.4A7 7 0 1 0 11 19.4ZM14.6 19.4A3.4 3.4 0 1 1 21.4 19.4A3.4 3.4 0 1 1 14.6 19.4Z"
        />
      </g>
    </svg>
  )
}
