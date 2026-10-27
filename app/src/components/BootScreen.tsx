/** Layar tunggu saat sesi masih divalidasi ke server. */
export function BootScreen() {
  return (
    <div className="app-shell">
      <div className="app-frame">
        <main className="app-body">
          <p className="app-note" style={{ padding: '48px 20px', textAlign: 'center' }}>
            Menyiapkan Bagiin…
          </p>
        </main>
      </div>
    </div>
  )
}
