/**
 * Data for the design system page. Keeping it out of the JSX makes the spec
 * editable without touching layout, and keeps the numbers in one place so the
 * page and DESIGN_SYSTEM.md cannot drift silently.
 */

export const BRAND_TOKENS = [
  { name: 'Navy', token: '--ds-navy', value: '#142F3A', role: 'Teks utama, kartu angka, kepala bill' },
  { name: 'Navy deep', token: '--ds-navy-deep', value: '#102731', role: 'Overlay, lapisan di atas navy' },
  { name: 'Teal', token: '--ds-teal', value: '#087665', role: 'Aksi utama, item terpilih, fokus' },
  { name: 'Teal hover', token: '--ds-teal-hover', value: '#065E52', role: 'Hover dan pressed' },
  { name: 'Fog', token: '--ds-bg', value: '#F5F8F8', role: 'Latar layar' },
  { name: 'Surface', token: '--ds-surface', value: '#FFFFFF', role: 'Kartu, sheet, navigasi' },
  { name: 'Mint', token: '--ds-mint', value: '#E2F5EF', role: 'Aksi sekunder, sorotan tidak mendesak' },
  { name: 'Slate', token: '--ds-muted', value: '#536D78', role: 'Teks pendukung' },
  { name: 'Border', token: '--ds-border', value: '#DCE7E7', role: 'Pemisah, garis input, garis kartu' },
]

export const STATUS_TOKENS = [
  { tone: 'pending' as const, name: 'Menunggu', ink: '#8A590F', bg: '#FFF1D8', ratio: '5,9:1', use: 'Bagian atau orang belum memilih, nominal masih bisa berubah' },
  { tone: 'info' as const, name: 'Final', ink: '#356B8C', bg: '#E7F1F7', ratio: '5,4:1', use: 'Pembagian lengkap, angka sudah final' },
  { tone: 'success' as const, name: 'Sukses', ink: '#167354', bg: '#E5F4EB', ratio: '5,1:1', use: 'Ditandai lunas, bill selesai' },
  { tone: 'danger' as const, name: 'Butuh tindakan', ink: '#B0443D', bg: '#FDEBE9', ratio: '5,0:1', use: 'Kurang bayar, selisih, kesalahan input' },
]

export const TYPE_SCALE = [
  { name: 'Display', spec: 'Manrope 800 · 32 px · -0.06em', sample: 'Rp163.000', className: 'ds-type-display' },
  { name: 'Layar', spec: 'Manrope 800 · 26 px · -0.05em', sample: 'Siapa ambil apa?', className: 'ds-type-screen' },
  { name: 'Bagian', spec: 'Manrope 700 · 18 px · -0.03em', sample: 'Rincian biaya', className: 'ds-type-section' },
  { name: 'Isi', spec: 'DM Sans 400 · 15 px · 1,55', sample: 'Bagianmu dihitung dari item yang kamu pilih.', className: 'ds-type-body' },
  { name: 'Pendukung', spec: 'DM Sans 400 · 13 px · 1,5', sample: '1 bagian menunggu · nominal bisa berubah', className: 'ds-type-small' },
  { name: 'Label', spec: 'DM Sans 700 · 11 px · 0,08em', sample: 'TOTAL STRUK', className: 'ds-type-label' },
]

export const SPACING = [4, 8, 12, 16, 20, 24, 32]

export const RADII = [
  { name: 'Kontrol kecil', value: '8 px', token: '--ds-radius-sm', use: 'Checkbox, chip, tombol ikon kecil' },
  { name: 'Kontrol', value: '12 px', token: '--ds-radius-md', use: 'Tombol, input, kartu item' },
  { name: 'Kartu', value: '16 px', token: '--ds-radius-lg', use: 'Kartu, panel, specimen' },
  { name: 'Sheet', value: '24 px', token: '--ds-radius-xl', use: 'Bottom sheet, hero, kepala layar' },
]

export const ELEVATIONS = [
  { name: 'Datar', value: 'tanpa bayangan', use: 'Semua kartu di dalam alur konten: pakai garis border' },
  { name: 'Sheet', value: '0 -18px 48px rgba(16,39,49,.27)', use: 'Hanya lapisan yang menutup konten' },
  { name: 'Fokus', value: '0 0 0 3px rgba(8,118,101,.28)', use: 'Cincin fokus keyboard, bukan dekorasi' },
]

export const STATUS_GRAMMAR = [
  {
    dimension: 'Pembagian',
    steps: [
      { tone: 'pending' as const, label: 'Menunggu pilihan', detail: 'Belum ada yang memilih' },
      { tone: 'pending' as const, label: 'Sementara · Citra belum pilih', detail: 'Angka masih bergerak' },
      { tone: 'info' as const, label: 'Pembagian lengkap', detail: 'Semua orang tercatat sudah selesai' },
    ],
    rule: 'Label sementara wajib menyebut siapa atau bagian mana yang menunggu.',
  },
  {
    dimension: 'Pembayaran peserta',
    steps: [
      { tone: 'pending' as const, label: 'Belum bayar', detail: 'Belum ada tanda lunas' },
      { tone: 'success' as const, label: 'Lunas', detail: 'Ditandai oleh peserta' },
      { tone: 'danger' as const, label: 'Kurang bayar Rp5.000', detail: 'Nominal naik setelah ditandai' },
      { tone: 'info' as const, label: 'Lunas · kelebihan Rp3.000', detail: 'Nominal turun setelah ditandai' },
    ],
    rule: 'Nominal yang pernah ditandai dibayar selalu ikut ditampilkan, bukan dihapus.',
  },
  {
    dimension: 'Bill',
    steps: [
      { tone: 'pending' as const, label: 'Berjalan', detail: 'Masih ada yang belum selesai' },
      { tone: 'success' as const, label: 'Selesai otomatis', detail: 'Semua selesai memilih dan lunas' },
      { tone: 'info' as const, label: 'Diselesaikan oleh pembayar', detail: 'Tindakan manual, ada riwayat' },
    ],
    rule: 'Tiga dimensi ini tidak pernah digabung jadi satu badge.',
  },
]

export const RULES = [
  {
    title: 'Status tidak boleh hanya warna',
    wrong: 'Titik kuning tanpa teks',
    right: 'StatusBadge "Sementara · Citra belum pilih"',
    why: 'Sekitar 8% pria kesulitan membedakan hijau–merah. Warna mempercepat, teks yang menjelaskan.',
  },
  {
    title: 'Uang selalu dari server',
    wrong: 'Klien menghitung ulang pembagian dari harga item',
    right: 'Klien merender payload server apa adanya',
    why: 'Bug termahal di Bagiin: tamu disuruh transfer nominal yang salah karena klien punya mesin hitung kedua.',
  },
  {
    title: 'Nominal pakai tabular numbers',
    wrong: 'Rp62.120 berubah lebar saat jadi Rp63.880',
    right: 'font-variant-numeric: tabular-nums di semua angka uang',
    why: 'Angka yang bergeser membuat orang salah baca saat nilainya berubah di layar.',
  },
  {
    title: 'Target sentuh 44 px',
    wrong: 'Ikon 20 px tanpa area tekan',
    right: 'Tombol 44×44 px, seluruh baris item bisa diketuk',
    why: 'Dipakai satu tangan sambil makan. Meleset tap di layar bill berarti salah tagihan.',
  },
]

export const SHADCN_MAP = [
  { token: '--background', value: 'var(--ds-bg)', note: 'Latar layar' },
  { token: '--foreground', value: 'var(--ds-navy)', note: 'Teks utama' },
  { token: '--card', value: 'var(--ds-surface)', note: 'Permukaan kartu' },
  { token: '--primary', value: 'var(--ds-teal)', note: 'Aksi utama' },
  { token: '--secondary', value: 'var(--ds-mint)', note: 'Aksi pendamping' },
  { token: '--muted-foreground', value: 'var(--ds-muted)', note: 'Teks pendukung' },
  { token: '--border', value: 'var(--ds-border)', note: 'Garis dan pemisah' },
  { token: '--ring', value: 'var(--ds-teal)', note: 'Cincin fokus' },
  { token: '--destructive', value: 'var(--ds-danger)', note: 'Aksi merusak' },
  { token: '--radius', value: 'var(--ds-radius-md)', note: 'Radius default' },
]

export const COMPONENT_INVENTORY = [
  { component: 'Button', shadcn: 'Button', variants: 'primary · secondary · quiet · danger · loading · disabled' },
  { component: 'StatusBadge', shadcn: 'Badge', variants: 'pending · info · success · danger' },
  { component: 'Card / BalanceCard', shadcn: 'Card', variants: 'surface · mint · navy' },
  { component: 'ItemRow', shadcn: 'Card + Checkbox', variants: 'idle · picked · shared · diskon' },
  { component: 'Field', shadcn: 'Input + Label', variants: 'default · fokus · error · nominal' },
  { component: 'Sheet', shadcn: 'Drawer / Dialog', variants: 'konfirmasi · rincian · tujuan bayar' },
  { component: 'BottomNav', shadcn: 'NavigationMenu', variants: 'beranda · bill · buat · rekap' },
  { component: 'Alert', shadcn: 'Alert', variants: 'pending · info · success · danger' },
  { component: 'EmptyState', shadcn: 'custom', variants: 'belum ada bill · belum ada utang' },
  { component: 'Avatar', shadcn: 'Avatar', variants: 'navy · teal · mint · place-holder kosong' },
]
