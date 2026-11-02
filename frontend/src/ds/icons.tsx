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
