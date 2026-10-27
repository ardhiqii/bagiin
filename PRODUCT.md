# Bagiin — konteks produk dan alur bisnis

Dokumen ini mencatat keputusan pemilik produk pada 12 Oktober 2026 sebagai acuan redesign dan migrasi ke React, TypeScript, dan shadcn/ui. Ini menjelaskan **produk yang ingin dibangun**. `SPEC.md` dan kode lama menjelaskan implementasi historis; jika berbeda, keputusan produk di sini menjadi bahan diskusi sebelum mengubah perilaku. Keputusan lanjutan dari percakapan yang sama sudah digabungkan di bawah.

## Ringkasan produk

Bagiin membantu orang membagi satu pengeluaran berdasarkan bagian masing-masing, lalu melihat kewajiban dan uang yang masih akan diterima dari banyak bill. Penggunaan mencakup patungan sekali waktu maupun orang-orang yang sering bertransaksi bersama, seperti pasangan atau kelompok teman makan. Fokusnya tetap split bill untuk berbagai jenis pengeluaran, bukan hanya struk restoran.

Contoh alur paling sederhana: A makan bersama B, A membayar di tempat, A memfoto struk, memeriksa hasil baca dan membuat bill, lalu membagikan tautan ke B. Mereka memilih bagian masing-masing. B bisa membayar saat itu atau nanti. Selama belum selesai, kewajiban dari bill tersebut terlihat di akumulasi mereka.

Satu bill mempunyai orang yang **nalangin**: orang yang mengeluarkan uang lebih dahulu dan menjadi tujuan pembayaran peserta lain. Orang ini adalah pengendali bill karena uangnya yang dipakai. Perpindahan ke orang lain hanya untuk **mengoreksi siapa yang sebenarnya nalangin**, bukan menyerahkan piutang A yang benar-benar membayar kepada B. Perpindahan memerlukan permintaan dari A dan penerimaan dari B. Selama menunggu, A tetap pengendali bill, tetapi metode bayar B ditampilkan dengan label jelas **"Menunggu konfirmasi B"**; jika B menerima, wewenang beralih ke B. Penanganan jika B menolak atau ada pembayaran yang sudah dikirim ke A masih perlu ditetapkan.

## Alur inti yang sudah disepakati

1. **Buat bill.** Pengguna bisa memfoto/mengunggah struk untuk mengisi editor otomatis, atau mengetik langsung di editor yang sama. **Hasil OCR bukan bill jadi**: pembuat dapat membetulkan nama/harga, menambah, dan menghapus item sebelum menekan buat bill. Satu bill adalah transaksi yang sengaja dibuat pengguna. Aplikasi tidak menggabungkan beberapa toko, checkout, atau bill secara otomatis. Kemampuan yang sudah ada perlu tetap bisa dipakai pada rilis React pertama, dengan alur dan UI yang dirancang ulang.
2. **Tentukan pembayar dan bagian.** Satu orang nalangin pembayaran di awal. Item bisa menjadi bagian satu orang atau dibagi rata oleh beberapa orang. Jika satu hidangan memang untuk tiga orang, masing-masing menanggung sepertiga **sejak jumlah pemakannya diketahui**, walaupun baru dua yang membuka bill. Tidak perlu menghitung jumlah suapan, slice, atau porsi berbeda per orang; itu kasus yang terlalu jarang untuk alur utama.
3. **Ajak peserta.** Tautan dipakai untuk bergabung cepat bagi orang baru. Orang yang pernah patungan bersama dapat ditemukan lagi sebagai kontak/friend berdasarkan ID tetap; pembayar dapat mengundang mereka langsung ke bill dan menetapkan item untuk mereka bahkan sebelum mereka membuka bill. Penetapan itu berlaku langsung, terlihat di sisi peserta sebagai "ditetapkan oleh [nama pembayar]", dan dapat mereka koreksi. Peserta dapat keluar bila undangan salah/tidak diinginkan; pembayar dapat mengundang lagi. Pembayar juga dapat mengeluarkan peserta dari bill. Pemilik produk menginginkan hubungan sosial yang memudahkan menemukan orang, mirip daftar teman Steam, tanpa mengharuskan pembuatan grup.
4. **Pilih bagian dan hitung.** Pemilihan dan penetapan item dilakukan **setelah bill dibuat**. Setiap peserta memilih bagiannya lalu menekan **"Selesai pilih"**; sesudah itu ia melihat aksi bayar dan opsi mengedit pilihannya. Pembayar dapat menetapkan pilihan untuk kontak yang **belum memilih item apa pun di bill itu**. Penetapan itu langsung dihitung sebagai pilihan orang tersebut **yang sudah selesai**, walaupun ia belum membuka bill; tampilkan "Ditentukan oleh [nama pembayar]" dan izinkan ia mengoreksinya. Begitu orang itu mulai memilih sendiri, pembayar tidak lagi bisa menetapkan/mengubah pilihan atas namanya. Penetapan pilihan tidak menandai pembayaran: orang itu tetap perlu membuka bill sendiri untuk menekan **"Lunas"**. Pembayar tidak selalu tahu semua peserta saat membuat bill, jadi daftar orang tidak boleh menjadi syarat mutlak untuk memulai. Untuk orang baru yang belum dikenal sistem dan hanya mendapat link, pemilik produk memilih kontrol kontekstual **"Dibagi 3 orang"** pada item, sehingga bagian yang belum punya nama tetap tercatat. Jumlah tiga ini tetap; peserta keempat tidak dapat menambah bagiannya sendiri dan hanya pembayar yang boleh mengubah jumlahnya. Pembagian belum lengkap bila masih ada orang di bill yang belum selesai memilih atau ada bagian yang menunggu orang masuk. **Tidak ada konfirmasi akhir wajib dari pembayar**; ketika semua orang yang tercatat di bill selesai memilih dan semua yang berutang menandai lunas, bill selesai otomatis.
5. **Bayar.** Peserta yang berutang dapat menandai dirinya sudah bayar. Ini **hanya pencatatan status**, bukan pemrosesan transfer atau verifikasi bank. Pemeriksaan apakah uang benar-benar masuk dilakukan oleh orang yang nalangin di luar aplikasi. Orang yang nalangin sudah membayar transaksi di awal, sehingga tidak perlu menandai pembayaran ke dirinya sendiri. Peserta boleh menandai bayar sebelum semua orang menyelesaikan pilihan, berdasarkan bagian mereka saat itu; jika pembagian kemudian berubah, status dan selisihnya harus ikut diperbarui. Pembayaran yang pernah ditandai tidak dihapus: tampilkan kewajiban terbaru, nominal yang telah dinyatakan dibayar, serta selisih kurang bayar atau kelebihan bayar. Usulan status: jika jumlah yang sudah dibayar kurang dari kewajiban baru, tampilkan "Kurang bayar Rp X" dan izinkan menandai pembayaran tambahan; jika lebih, tampilkan "Lunas · Kelebihan bayar Rp X". Kelebihan itu perlu dibicarakan dengan pembayar; pencatatan pengembalian uang belum diputuskan. Perubahan nominal sebelum orang itu menandai bayar cukup tercermin pada angka sementara di layar; tidak perlu pemberitahuan khusus. **Jika nominal berubah setelah orang itu menandai bayar**, tampilkan perubahan dan selisihnya secara menonjol kepada orang tersebut dan pembayar.
6. **Lihat akumulasi.** Pengguna melihat dua lapisan: angka dari bill dengan **pembagian final**, serta angka **sementara** yang juga memasukkan bill dengan peserta yang belum memilih. Keduanya perlu menampilkan total utang dan total uang masuk, dengan rincian per orang dan per bill. Pada angka sementara, tampilkan siapa yang belum memilih dan jelaskan bahwa nominal masih dapat berubah. Pengalaman ini harus menjawab: "Aku harus bayar siapa, berapa, dan karena bill apa?" serta kebalikannya untuk uang masuk. "Final" di sini berarti alokasi sudah lengkap, bukan saldo dua arah yang saling dipotong.

## Akumulasi dan kelompok

- Akumulasi berasal dari bill yang belum selesai. Penyelesaian **otomatis** terjadi ketika semua orang yang sudah tercatat di bill selesai memilih, tidak ada item/bagian yang menunggu pemilih, dan semua peserta yang berutang sudah menandai lunas. Pilihan yang ditetapkan pembayar untuk peserta lain dihitung selesai memilih, tetapi peserta tersebut tetap harus menandai lunas sendiri. Tidak ada langkah wajib pembayar untuk mengonfirmasi seluruh pembagian. Pembayar juga boleh menandai seluruh bill lunas **secara manual** walaupun masih ada peserta yang belum memilih, misalnya semua sudah menyelesaikan pembayaran di luar aplikasi. Ini pengecualian yang disengaja dan harus berbeda secara jelas dari status pembagian lengkap.
- Akumulasi sementara perlu memasukkan bill yang belum lengkap karena sebagian peserta mungkin tidak membuka aplikasi. Ia harus menunjukkan keterbatasan datanya, termasuk nama peserta yang belum memilih. Arah yang disukai pemilik produk: item yang belum dipilih untuk sementara ditanggung orang yang nalangin, dan perubahan potensi tagihan diberi catatan jelas. Bagian tersebut **bukan utang pembayar kepada dirinya sendiri** dan tidak boleh membuat total uang masuk palsu. Contoh: bill Rp100.000; B memilih item Rp40.000; item Rp60.000 belum dipilih. Pembayar sementara menanggung Rp60.000, sementara tagihan B Rp40.000. Rekap pembayar menunjukkan Rp40.000 akan diterima dan catatan Rp60.000 belum dipilih; jika C kelak memilih item itu, uang yang akan diterima bisa naik. Aturan persis untuk biaya/diskon terkait bagian belum dipilih masih perlu ditetapkan.
- Tampilkan **utang** dan **uang masuk** sebagai dua angka yang jelas, dengan rincian per orang dan daftar bill penyusunnya. Jangan otomatis menyatukan dua arah kewajiban antarorang menjadi satu nominal transfer dalam alur utama. Saling potong/netting dapat dipertimbangkan sebagai fitur terpisah kelak.
- Orang yang sering patungan bersama adalah kebutuhan produk, tetapi **tidak perlu membuat grup manual maupun kelompok otomatis**. Cukup akumulasikan kewajiban **per orang** dari semua bill yang relevan dan sediakan rincian bill penyusunnya. Orang yang sama dapat bertransaksi berkali-kali tanpa perlu mengelola grup.
- Akumulasi mencakup bill yang relevan tanpa mengharuskan pengguna membuat grup. Tidak ada keputusan untuk reset saldo berdasarkan kalender, perjalanan, atau periode tetap.

## Prinsip pengalaman pengguna

- Alur paling sederhana harus tetap singkat: foto struk → cek/koreksi → buat bill → bagikan → pilih item → lihat kewajiban/bayar.
- Bill manual harus sama mudah dipahami dengan bill dari OCR, tanpa membuat pengguna merasa sedang mengisi formulir teknis.
- Tampilan dan istilah untuk peserta, pembuat bill, serta orang yang nalangin harus konsisten. Hak mengelola bill mengikuti orang yang nalangin, bukan sekadar orang yang pertama membuatnya.
- Status **pembagian lengkap**, **belum bayar**, dan **selesai** harus dibedakan dengan jelas. Angka sementara dari bill yang belum lengkap harus tersedia, tetapi tidak boleh terlihat seperti utang final.
- Rekap harus membantu pengguna mengambil tindakan dan membuka asal nominal, bukan hanya menampilkan total atau teks panjang.
- **Tidak ada fitur yang terbuka tanpa identitas yang sah** (2026-10-27). Identitas tersimpan divalidasi ke server sebelum layar dibuka. Kalau server sudah tidak mengenalnya, orang diarahkan ke pendaftaran dengan penjelasan singkat — bukan dibiarkan di beranda berisi pesan "Identitas tidak ditemukan". Satu pengecualian yang disengaja: **link bill tetap terbuka untuk tamu**, karena penerima link belum tentu punya identitas.
- **Rekening tampil dengan logo providernya** (2026-10-27). Baris rekening tujuan transfer dan kartu rekening di Pengaturan memakai logo brand dari **47 provider** (bank besar, bank digital, dompet digital) di kotak 72×24 px yang sama; brand yang belum dikenal dapat ikon dompet netral, bukan inisial berwarna. Nama brand tetap ditulis sebagai teks di sampingnya — logo membantu memindai, teks yang memastikan.
- **Aksi tinggal di zona jempol, bukan di pojok atas** (2026-10-27). Layar bill punya toolbar bawah: ikon bagikan + ikon "Aksi lain" (48 px, netral) dan satu aksi pribadi sebagai pill. Kalau tidak ada aksi pribadi, sisi kanan berisi keterangan keadaan ("Semua lunas", "Ada sisa yang belum diambil"). Menu "Aksi lain" tidak lagi di header — di ponsel pojok kanan atas adalah zona paling sulit dijangkau satu tangan.
- **Menu "Aksi lain" berupa daftar tergrup**, bukan tumpukan pill: Bagikan / Kelola bill / Status / Keluar, tiap baris 56 px dengan ikon, aksi merusak di grup sendiri paling bawah.
- **Bar aksi bawah di layar bill hanya untuk aksi pribadi** (2026-10-26). Isinya cuma satu tombol: "Ikut bill ini" kalau belum masuk, atau "Tandai lunas · Rp23.000" kalau bagianmu belum lunas. Kalau tidak ada aksi pribadi, bar tidak dirender — dulu bar selalu muncul hanya untuk tombol "bagikan" dan memakan ~76px tinggi di semua bill, termasuk yang sudah lunas. Aksi sekunder (bagikan, undang, ubah, tutup, ganti pembayar, tandai semua lunas) pindah ke sheet "Aksi lain" yang dibuka dari ikon ⋮ di header, jadi selalu terjangkau tanpa memakan tinggi layar.
- **Satu kosakata uang di semua layar**: lunas / belum lunas. Chip filter beranda, lencana status di bill, dan rekap memakai kata yang sama; "selesai" dan "berjalan" dihapus karena bercabang dari "pembagian belum jelas".
- **Rekap berisi pekerjaan, bukan arsip** (2026-10-26, versi final). Rekap hanya memuat: sisa uang yang pembagiannya sudah jelas (per orang) dan bill yang pembagiannya belum jelas. Bill yang sudah lunas **tidak muncul sama sekali** — backend hanya mengirim sisa, jadi tidak perlu aturan tambahan di UI. Tidak ada arsip bulanan, tidak ada total belanja, tidak ada tab: begitu arsip dibuang, daftarnya cukup pendek untuk satu scroll.
- **Kosakata dipisah dua sumbu.** Pembagian: "pembagian belum jelas" / "sudah jelas". Uang: "lunas" / "belum lunas", "belum kamu transfer" / "belum dia transfer". Kata "final" tidak dipakai di UI karena di kepala orang berarti "bill-nya sudah selesai dibayar", bukan "pembagiannya sudah tetap".
- **Per orang, bukan per bill.** Pertanyaan yang dijawab rekap adalah "utang saya ke siapa, berapa" — jadi baris utama = orang, dengan net sebagai angka dan bruto kedua arah tetap disebut kalau ada dua arah. Rincian per bill ada di sheet saat barisnya dibuka.
- **Rekap memisahkan yang pasti dari yang belum pasti, dan tidak pernah menjumlahkannya.** "Pasti" = bill yang pembagiannya sudah final; angkanya boleh dipakai untuk transfer. "Belum pasti" = bill yang masih punya porsi atau item tanpa pengaku, sehingga nominal siapa pun masih bisa bergeser (termasuk lewat pajak/service proporsional). Kartu atas hanya memuat angka pasti; perkiraan ditulis terpisah dengan label "perkiraan".
- **Item yang belum dipilih siapa pun membuat bill belum final.** Sebelumnya kasus ini lolos sebagai final karena hanya `uncovered_idr` yang diperiksa, padahal item tanpa pengaku bisa berubah kapan saja. Kode alasan `unassigned_items` ditambahkan ke kontrak rekap.
- **Item yang tidak dipilih siapa pun dilaporkan sebagai `owner_absorbed`.** Uangnya tetap ditanggung pembayar (keputusan produk lama), tetapi nominal dan nama itemnya dibawa ke respons bill dan rekap, dan bill seperti itu tidak dianggap final sampai ditutup sadar atau ada yang mengaku. Sebelumnya tidak ada jejaknya sama sekali.
- **Bill yang realitanya sudah selesai di luar aplikasi ditutup oleh pembuatnya**, bukan dibiarkan menunggu di rekap. Tombol "Tutup bill" di rekap memakai `POST /api/bills/{id}/settle`; sisa yang belum ada pengakunya ditanggung pembayar, dan kalimat di sheet menyebut nominal serta akibatnya sebelum dikonfirmasi.
- Orang yang masuk bill diharapkan mengambil setidaknya satu item. Tidak perlu tindakan khusus "Aku tidak ambil item" dalam alur utama. Jika seseorang bergabung tanpa sengaja atau tidak jadi ikut, ia boleh keluar; **pilihannya di bill tersebut dihapus** dan nominal dihitung ulang. Catatan bahwa ia pernah menandai bayar tetap perlu dipertahankan sebagai riwayat tindakan, terpisah dari pilihan aktif.
- Peserta harus bisa memahami mana item yang mereka pilih sendiri dan mana yang ditetapkan pembayar, lalu mengubah pilihan yang tidak sesuai. Pembayar dapat mengelola peserta yang salah masuk.
- UI saat ini akan dirombak. Setelah meninjau prototype, pemilik produk memilih **layout Seimbang dengan warna Saldo** sebagai arah utama. Aturan visual dan komponen ada di [DESIGN_SYSTEM.md](DESIGN_SYSTEM.md). Varian Langkah dibuang. Halaman bill masih perlu pendalaman alur dan desain.

## Batasan migrasi

- Data bill lama dan tautan lama **harus tetap bekerja**. Migrasi model data/API boleh dipertimbangkan hanya dengan jalur kompatibilitas dan migrasi data yang aman.
- Identitas lama yang tersimpan di perangkat dan kode pemulihannya harus memiliki jalur aman menuju opsi Google login, tanpa kehilangan bill, kontak, metode bayar, atau hak pengelolaan yang sudah ada.
- Saat implementasi Google login, tautkan ID Bagiin ke identifier Google yang stabil (`sub`) setelah token diverifikasi di server; email dan nama tampilan bukan kunci identitas. Rujukan: [Google Identity Services](https://developers.google.com/identity/gsi/web/reference/html-reference).
- Backend lama adalah FastAPI + SQLite, dengan perhitungan split di `backend/calc.py`. Frontend lama adalah vanilla JS. React/TypeScript/shadcn belum diterapkan di branch ini.
- Rilis React pertama harus mencakup kemampuan aplikasi yang ada saat ini, termasuk OCR, input manual, pemilihan item, pembayaran, rekap, metode bayar, identitas/pemulihan, serta undangan/kontak. Ini tidak berarti setiap interaksi lama perlu disalin persis; alur dan UI akan dirancang ulang. Data cashback lama harus tetap benar, tetapi cashback bukan konsep utama dalam alur membuat bill baru dan perlu ditaruh sebagai opsi lanjutan atau tahap berikutnya.
- Angka uang final harus berasal dari aturan kalkulasi yang konsisten di server. Semua nominal rupiah diperlakukan sebagai bilangan bulat.

## Keputusan lanjutan dari pemeriksaan flow

- Input OCR mengisi editor yang sama dengan input manual. Pembuat meninjau dan mengubah item sebelum bill tercipta. Aturan saat jumlah rincian tidak cocok dengan total tercetak masih perlu diputuskan.
- Satu baris berjumlah beberapa unit dapat dibagi menurut unit yang diambil tiap orang; satu unit yang dimakan bersama dibagi rata menurut pemakannya. Detail interaksi ketika jatah unit/bagian yang direncanakan sudah terisi masih perlu dirancang.
- Bagian item yang belum dipilih dan pajak/service/diskon yang mengikutinya tetap terlihat sebagai **menunggu alokasi**. Ongkir sementara dihitung untuk orang yang mengambil item dan dapat berubah ketika orang lain memilih.
- Diskon per item opsional, voucher dapat ditargetkan ke subset item, biaya platform/kemasan umum dibagi rata, biaya kemasan khusus mengikuti item, dan pajak/service mengikuti dasar sebelum/sesudah diskon yang terlihat pada struk dengan nominal tercetak sebagai total.
- Perpindahan pembayar hanya membetulkan orang yang benar-benar nalangin. Selama B belum menerima permintaan, tampilkan metode bayar B dengan peringatan menunggu konfirmasi; A tetap memegang kendali sampai B menerima. Perlakuan bila B menolak atau A sudah menerima pembayaran masih terbuka.
- Metode bayar B selama permintaan perpindahan pending adalah **preview**, belum tujuan bayar aktif. Jika B menolak, A tetap pembayar; pembayaran yang telanjur diterima A tidak boleh dipindahkan diam-diam ke B.
- Jumlah pemakan yang sengaja disetel pada item (misalnya “Dibagi 3 orang”) bersifat tetap sampai pembayar mengubahnya; peserta keempat tidak boleh menambah bagiannya sendiri. Pembayar hanya boleh menetapkan item untuk orang yang belum memilih item apa pun di bill itu. Begitu orang tersebut memilih sendiri, pembayar tidak lagi punya hak menetapkan/mengubah pilihannya.
- Keluar dari bill menghapus pilihan orang itu dan menghitung ulang bagian lain. Ini juga berlaku bila orang tersebut pernah salah memilih; jangan menahan orang di bill hanya demi jejak pilihan. Riwayat tindakan pembayaran perlu tetap tersimpan secara terpisah agar perubahan status yang pernah dibuat dapat ditelusuri.
- Tidak ada pembayaran sebagian sukarela: tombol “Lunas” berarti menandai seluruh tagihan saat itu. Jika kewajiban naik setelahnya, pembayaran tambahan atas selisih tetap dapat dicatat. Pemeriksaan hasil OCR dilakukan di editor sebelum membuat bill, dan bill yang sudah dibuat tetap bisa diedit oleh pembayar; jangan membuat langkah draft/konfirmasi OCR tambahan.
- Guest yang memulihkan identitas dengan recovery key pada perangkat lain tetap memakai ID Bagiin yang sama. Google login ditautkan ke ID yang sedang dipakai. Jika pengguna tanpa sengaja memakai identitas guest berbeda, itu tetap identitas berbeda; jangan menggabungkan data otomatis.
- Bila rincian nominal tidak cocok dengan total struk, tampilkan selisih sederhana sebagai **belum dirinci** dan biarkan pembayar mengedit bill lagi. Bill boleh dibuat tanpa langkah draft OCR tambahan, tetapi pembagian belum dapat dianggap final selama selisih belum dibereskan.
- Bila peserta keluar setelah menandai lunas, pilihan aktifnya hilang dan kewajibannya menjadi nol; riwayat jumlah yang pernah ia tandai dibayar tetap terlihat sebagai selisih/kelebihan yang perlu dibereskan. Pembayar dapat membatalkan tanda bayar yang ternyata tidak benar. Undangan ulang setelah peserta sengaja keluar menjadi undangan yang perlu diterima; tautan tetap dapat dibagikan dan dipakai peserta untuk bergabung kembali. Pemblokiran kontak bukan syarat alur pertama, dan tindakan keluar/tolak tidak menghapus riwayat bill.
- Jika akun Google sudah terkait ke ID Bagiin lain, masuk dengan Google beralih ke ID tersebut tanpa menggabungkan data dari guest lokal. Guest lama tetap dapat diakses lewat recovery key; tampilkan peringatan identitas sebelum berpindah.
- Kelebihan bayar perlu aksi untuk menandai pengembalian uang telah diterima. Bila pembayar menandai seluruh bill lunas secara manual, status bayar tiap peserta tetap apa adanya; bill diberi label “Diselesaikan oleh pembayar”, dengan riwayat dan jalan membatalkan tindakan.
- Perubahan nominal setelah orang menandai bayar ditonjolkan dalam bill dan rekap. Angka utama utang/uang masuk hanya menghitung **sisa yang belum dibayar/dikirim**, bukan nilai transaksi historis. Bill salah/duplikat yang sudah dibagikan dibatalkan dengan jejak yang terlihat; hanya draft pribadi yang dapat dihapus permanen.

## Pertanyaan produk yang masih terbuka setelah jawaban 1–6

1. Jika B menolak perpindahan pembayar atau A sudah terlanjur menerima pembayaran sebelum koreksi A→B, bagaimana pengguna menyelesaikan status pembayaran lama tanpa memindahkan uang secara fiktif? Metode B sebelum penerimaan hanya preview. Usulan sederhana: perpindahan tidak dapat diajukan ketika sudah ada peserta menandai lunas; pembayar perlu membetulkan status pembayaran dan menyelesaikan uang yang telanjur dikirim di luar aplikasi lebih dulu.

## Identitas, kontak, dan nama

Setiap orang mempunyai **ID internal unik** yang tetap, terpisah dari nama tampilan. Nama boleh diubah oleh pemilik akun. Orang lain boleh menyimpan nickname pribadi untuk ID tersebut agar mudah mengenali teman (contoh pola Steam); nickname itu hanya mengubah tampilan di sisi pemberi nickname, bukan identitas atau nama global. Google login **opsional**: guest tetap dapat langsung memakai Bagiin. Tujuan Google login adalah memulihkan identitas, bill, kontak, dan metode bayar saat pindah perangkat tanpa harus mengetik recovery key. Google menjadi cara masuk ke ID Bagiin yang sama, bukan pengganti ID Bagiin atau alasan membuat akun baru secara diam-diam. Recovery key lama tetap perlu didukung untuk kompatibilitas.

Daftar friend/kontak **terbentuk otomatis setelah dua ID benar-benar pernah berada dalam satu bill**; tidak perlu permintaan pertemanan dua arah. Pembayar dapat mengundang kontak ke bill dan menetapkan item mereka tanpa menunggu mereka membuka bill. Peserta melihat sumber penetapan, boleh mengubah pilihannya, dan boleh keluar. Pembayar bisa mengeluarkan peserta atau mengundang ulang. Orang baru yang belum pernah berkontak tetap dapat masuk memakai link. Nama teks saja tidak boleh diperlakukan sebagai bukti bahwa dua akun adalah orang yang sama; ikatan ke bill dan hak pengelolaan harus memakai ID yang sah. Undangan pending saja tidak cukup untuk membuat dua orang menjadi kontak otomatis.

## Kasus inti: satu item dibagi sebelum semua orang membuka bill

Klarifikasi lanjutan: pembuatan bill hanya memasukkan struk dan biaya. **Pemilihan item dan penetapan orang dilakukan setelah bill tercipta**, pada halaman bill yang sama untuk pembayar dan peserta. Tautan adalah cara mengundang orang baru. Pembayar dapat mencari orang yang pernah berada dalam satu bill, lalu undangan itu langsung memasukkan orang tersebut ke bill tanpa perlu tautan atau tindakan menerima. Pembayar boleh menetapkan item mereka di halaman bill; ia tidak harus tahu pilihan semua orang. Bila tidak tahu, ia memilih bagiannya sendiri dan menunggu orang lain memilih. Pengecualian penting: sebuah item yang sudah dipilih B masih mungkin juga dimakan C, jadi status "setiap item sudah dipilih oleh seseorang" **tidak cukup** untuk menyimpulkan pembagian lengkap.

Contoh: A, B, C makan satu hidangan Rp90.000. A dan B sudah membuka bill; C belum. Ketiganya memang akan makan hidangan itu. Menampilkan Rp45.000 untuk A dan B hanya karena baru mereka yang memilih akan menyesatkan; bagian yang dimaksud adalah Rp30.000 per orang. Bagian Rp30.000 yang masih menunggu C bisa ditanggung sementara oleh A sebagai pembayar demi merekonsiliasi bill, tetapi harus tampil terpisah dari bagian makan A sendiri dan tidak boleh menjadi tagihan final ke C sebelum penetapannya jelas. Bill belum boleh otomatis dianggap selesai.

UI lama membedakan mode item `free` dan `slot`. Pemilik produk merasa pilihan itu membingungkan. Desain baru perlu membuat niat pembagian mudah dinyatakan, misalnya lewat pilihan orang yang makan bersama atau jumlah orang yang berbagi, tanpa memaksa pengguna memahami istilah mode kalkulasi. Detail kontrolnya masih terbuka. Bila C adalah kontak dengan ID yang sudah diketahui dan pembayar menetapkan item untuknya, bagian C langsung masuk hitungan meskipun ia belum membuka bill; C tetap dapat mengoreksi pilihan itu nanti.

### Hipotesis UX untuk diuji, belum keputusan final

Perbandingan produk dan penilaian terbaru dicatat di [UX_RESEARCH.md](UX_RESEARCH.md). Usulan lama di sana tentang konfirmasi akhir wajib dari pembayar **ditolak**: bill selesai otomatis dari status selesai memilih dan lunas seluruh peserta yang tercatat. Batasnya, sistem tidak dapat mengetahui orang yang belum pernah masuk atau dicatat di bill.

- Pisahkan verifikasi **isi struk** dari pembagian **siapa mengambil item**. Saat OCR/manual, tugas utama adalah membetulkan nama, harga, diskon, biaya, dan total. Jangan memaksa pembuat mengonfigurasi mode split pada setiap baris sebelum bill bisa dibuat.
- **Jangan wajibkan jumlah peserta bill di awal.** Pengguna yang hanya ingin membuat dan membagikan bill tidak perlu menjawab pertanyaan tambahan. Kontak yang diketahui bisa langsung diundang/ditetapkan; orang baru datang dari link.
- Pada item, gunakan satu bahasa manusia: **"Siapa yang ambil?"**. Item biasa cukup diketuk oleh pemakannya. Kalau satu item juga untuk orang lain, tampilkan aksi kontekstual **"Tambah yang ikut makan"**: pilih kontak, atau tambah **"1 orang belum bergabung"**. Setiap orang/placeholder mendapat satu bagian sama besar. Ini menggantikan pilihan teknis `free` versus `slot` di UI.
- Contoh: item Rp90.000 sudah dipilih A dan B. A tahu C juga makan tetapi belum masuk; satu ketukan "Tambah 1 orang belum bergabung" membuat tampilan A Rp30.000, B Rp30.000, satu bagian Rp30.000 menunggu diklaim lewat link. Saat C mengambil item, ia **mengisi bagian kosong itu**, bukan membuat bagian keempat. Tidak perlu meminta jumlah seluruh peserta pada setiap bill, dan tidak perlu memilih mode item saat membuat struk.
- Bila tak seorang pun memberi tahu aplikasi tentang C, aplikasi **tidak dapat menebak** bahwa item itu untuk tiga orang. Dengan A dan B saja, Rp45.000 per orang adalah perkiraan berdasarkan data yang ada dan harus dilabeli dapat berubah. Bila C kemudian memilih, angka berubah dan pembayaran yang sudah ditandai dibandingkan lagi dengan kewajiban baru. Desain harus menguji apakah tombol kontekstual dan label perkiraan cukup terlihat agar orang tidak melewatkannya.
- Auto-selesai hanya dapat memakai peserta dan bagian yang diketahui sistem. Jika orang ketiga tidak pernah masuk, diundang, atau diberi placeholder pada item, sistem tidak punya dasar untuk menahan bill. Ini batas informasi yang diterima untuk menjaga alur sederhana; bila perlu koreksi setelah selesai, pembayar membuka kembali pembagian.
- Item yang sudah stabil boleh dibayar lebih awal walaupun bill keseluruhan masih menunggu peserta/item lain. Jika nominal berubah kemudian, catatan jumlah yang pernah ditandai bayar dipertahankan dan selisihnya muncul.

### Keputusan baru: selesai pilih per orang dan selesai otomatis

Jangan pakai "semua item sudah ada yang ambil" sebagai sinyal pembagian final. Setiap peserta yang memilih sendiri menekan **"Selesai pilih"** setelah meninjau seluruh item. Sesudah itu, ia melihat tombol **"Lunas"** dan **"Edit pilihan"**. Pilihan yang ditetapkan pembayar untuk peserta lain langsung dianggap selesai memilih; peserta tersebut melihat siapa yang menentukan pilihannya dan tetap harus membuka bill sendiri untuk menandai lunas. Jika peserta mengedit pilihannya, status selesai pilih miliknya perlu dinilai ulang dan nominal orang terdampak diperbarui. Perubahan nominal orang yang belum menandai bayar cukup terlihat di layar tanpa pemberitahuan khusus. Jika nominal orang yang **sudah** menandai bayar berubah, tampilkan perubahan dan selisih kepada orang itu dan pembayar. Bagian kosong dan peserta yang belum selesai memilih terlihat jelas dalam daftar pemeriksaan singkat di halaman bill. Bill otomatis selesai ketika pembagian semua peserta yang tercatat lengkap dan mereka yang berutang sudah menandai lunas, tanpa konfirmasi akhir pembayar. Bila bill sudah selesai, pembayar yang membuka kembali pembagian untuk koreksi; catatan pembayaran sebelumnya tetap ada.

Alasan hipotesis ini: [Splitwise](https://kb.splitwise.com/balances-and-expenses/what-are-different-ways-i-can-split-an-expense) memulai dari pembagian rata dan menaruh opsi pembagian lain di pilihan lanjutan; [Nielsen Norman Group](https://www.nngroup.com/articles/progressive-disclosure/) merekomendasikan kontrol lanjutan muncul saat diperlukan. Ini mendukung penyederhanaan alur awal, **bukan bukti** bahwa satu kontrol Bagiin tertentu disukai mayoritas pengguna. Sebelum memilih desain final, uji prototipe dengan kasus: dua orang dengan item masing-masing; tiga orang berbagi satu makanan dengan peserta ketiga belum masuk; pembayar menetapkan item untuk kontak; serta bill platform dengan voucher dan ongkir.

## Cakupan jenis transaksi dan promo

Bagiin harus menangani bill restoran maupun pesanan dari platform seperti Shopee, Gojek, dan Grab. Harga pada struk dapat dipengaruhi diskon pada item tertentu, diskon/voucher atas seluruh pesanan, biaya kirim, biaya layanan, pajak, serta promo dari metode pembayaran. OCR dan editor manual harus memungkinkan pengguna memeriksa serta mengoreksi setiap komponen yang relevan.

- Diskon yang melekat pada satu item hanya mengurangi biaya orang yang mengambil item itu. Jika item tersebut dibagi beberapa orang, harga setelah diskon item dibagi rata di antara mereka.
- Diskon atau voucher yang berlaku untuk seluruh pesanan dibagi **proporsional** terhadap nilai item tiap orang. Contoh A mengambil Rp80.000 dan B Rp20.000 dengan voucher Rp20.000: A mendapat potongan Rp16.000, B Rp4.000.
- Pajak dan service yang mengikuti persentase nilai belanja dibagi **proporsional** terhadap bagian item setelah potongan yang relevan. Gunakan nominal pajak/service yang benar-benar tercetak atau dikoreksi pengguna; jangan mengarang ulang rate pajak dari nama biaya.
- **Ongkir dibagi rata** di antara orang yang mengambil item dalam bill, bukan proporsional terhadap nilai barang. Biaya platform/kemasan lain perlu aturan berdasarkan sifat biayanya.
- Biaya platform/kemasan yang umum dibagi rata kepada orang yang mengambil item. Biaya kemasan yang jelas melekat pada item tertentu mengikuti pemilik item itu. Bila bagian item masih menunggu pemilih, pajak, service, dan diskon terkait tetap berada pada bagian **menunggu alokasi**, bukan disamarkan sebagai konsumsi pembayar. Ongkir yang bergantung pada daftar pembeli masih berlabel sementara sampai pembagian lengkap.
- Struk dengan beberapa unit pada satu baris tetap memungkinkan tiap orang mengambil jumlah unit berbeda (contoh 3 es teh: A mengambil 2, B mengambil 1); ini berbeda dari satu unit yang dimakan bersama. Voucher yang hanya berlaku untuk subset item harus bisa ditargetkan ke item yang memenuhi syarat. Saat struk memperlihatkan apakah pajak/service dihitung sebelum atau sesudah diskon, alokasi mengikuti dasar itu dan memakai nominal tercetak sebagai totalnya.
- Cashback yang masuk belakangan ke akun pembayar biasanya diabaikan dalam patungan. Jangan otomatis membaginya. Data/fitur cashback lama tetap harus dibaca dengan benar; untuk bill baru, tampilkan hanya sebagai opsi lanjutan bila fitur itu dipertahankan.
- Satu bill tetap unit yang dipilih pengguna. Jangan otomatis mengelompokkan beberapa transaksi berdasarkan toko, merchant, atau kumpulan orang yang sama.

## Catatan implementasi historis untuk dibahas, bukan otomatis diadopsi

### Audit lanjutan sebelum merancang lima varian UX

- `backend/main.py` saat ini menolak perubahan pilihan/undangan ketika hasil perhitungan bill sudah `settled`, bahkan bila status bill masih `open`. Alur baru mengizinkan nominal berubah setelah seseorang menandai bayar, sehingga perlu aturan eksplisit untuk membuka kembali pembagian yang sudah dianggap selesai sambil mempertahankan riwayat pembayaran.
- Tabel `payment` punya `amount_idr`, tetapi aksi `mark_paid` sekarang hanya mengubah `status` dan `paid_at`; nominal yang benar-benar ditandai dibayar tidak dicatat. Kebutuhan kurang/lebih bayar tidak bisa dihitung secara andal dari status lama saja. Data lama tetap perlu dibaca dengan interpretasi yang jujur.
- `item.quantity` adalah jumlah unit yang dibeli, sedangkan `selection.qty` sekarang juga dapat berarti jumlah porsi/bagian yang diklaim. Untuk transaksi seperti membeli 3 barang identik bagi 2 orang, UX baru perlu membedakan **unit barang** dari **satu item yang dimakan bersama**.
- Undangan kontak lama dapat langsung masuk jika pengaturan `auto_accept` aktif. Bila orang itu sebelumnya menolak undangan, undangan ulang menjadi pending meskipun pengaturan aktif. Keputusan produk "kontak lama langsung masuk" perlu dipadukan dengan hak orang yang telah keluar atau menolak.
- `service` dan pajak sudah ada, tetapi belum ada komponen ongkir/biaya platform terpisah pada model bill. Aturan ongkir dibagi rata yang telah diputuskan membutuhkan representasi biaya baru tanpa mengubah hasil bill lama.

Versi lama mempunyai mode item `free` dan `slot` dengan jumlah klaim per orang, status `open`/`closed`, `settled_manual`, pemindahan pengendali ke pembayar yang dikonfirmasi, kontak/undangan, serta rekap yang memisahkan alokasi final dari yang belum final. Rekap lama juga menghitung saldo bersih per orang. Beberapa perilaku itu belum tentu cocok dengan keputusan produk di atas, khususnya porsi tidak rata, netting otomatis, dan arti "selesai". Saat migrasi, evaluasi kasusnya dan pertahankan kompatibilitas data lama.

Kesenjangan yang sudah terlihat di kode: pembuat dapat menulis nama peserta sebelum mereka membuka bill (`bill_participant`), dan frontend bill memperingatkan nama yang belum memilih. Namun kalkulasi `settled`/Rekap backend terutama memakai identitas nyata yang sudah bergabung (`payment`/`selection`) untuk menentukan peserta yang menunggu. Karena itu nama peserta yang belum membuka bill tidak otomatis menjadi penghalang finalisasi di seluruh permukaan. Model baru perlu satu definisi peserta yang konsisten untuk bill, status, dan akumulasi.

Endpoint pilihan item lama menulis pilihan untuk identitas pengirim request sendiri; pembayar belum punya jalur untuk menetapkan item atas nama peserta lain. Undangan kontak lama dapat langsung memasukkan orang bila `auto_accept` aktif, sedangkan yang menonaktifkannya mendapat undangan pending. Desain baru perlu meninjau pengaturan undangan dan asal penetapan item sebagai bagian dari privasi serta kendali peserta.

## Aturan pembagian yang berlaku (2026-10-26)

Satu cara ambil untuk semua baris, tanpa istilah mode di layar:

- **Satu ketukan = satu porsi.** Baris dengan `quantity` 3 bisa diambil 1, 2, atau
  3 kali oleh orang yang sama; ketukan saat sudah penuh mengosongkan pilihan.
- **Harga per porsi = `min(harga satuan, total baris / jumlah klaim)`.** Orang
  tidak pernah ditagih lebih dari harga satu unit hanya karena yang lain belum
  memilih. Sisa porsi muncul sebagai "belum ada yang ambil" dan ditanggung yang
  menalangi.
- **Klaim lebih banyak daripada unit** berarti baris itu memang dibagi (satu
  piring dimakan berdua, tiga gelas dinikmati enam orang): harganya turun sendiri,
  tanpa konfirmasi dan tanpa yang menalangi perlu mengatur apa pun.
- **Angka per orang masih bisa turun** selama bill terbuka, karena totalnya tetap
  dan jumlah pemakan belum final. Tidak ada dialog konfirmasi; yang tampil adalah
  harga satuan dan "N dari M diambil".
- **Mode slot dihapus dari layar.** Bill lama yang datanya bermode slot tetap
  dihitung dengan aturan lamanya dan tombol "atur jumlah bagian" hanya muncul di
  bill seperti itu.

## Foto struk di layar buat bill (2026-10-26)

Satu input file, dua niat. Di HP input ini memakai `capture="environment"`, jadi
langsung membuka kamera — tidak ada alur tempel, karena Ctrl+V memang tidak ada
di HP.

- **Scan struk, isi otomatis** — foto dikirim ke `/api/ocr`, hasilnya mengisi
  item, pajak, service, diskon, merchant. Selama menunggu, kartu berubah jadi
  status berjalan: "Membaca struk… N detik" plus tombol **Batal baca**. Form di
  bawahnya tetap bisa diketik sambil menunggu.
- **Lampirkan foto sebagai bukti** — satu atau beberapa foto diunggah ke
  `/api/photos` tanpa memanggil AI, lalu muncul sebagai grid thumbnail bertanda
  "bukti". Form tetap kosong, dan semua foto ikut tersimpan di bill. Ini jalur
  untuk orang yang memang mau mengetik manual, untuk struk panjang yang terpotong,
  atau untuk screenshot pesanan dari Gojek/ShopeeFood/Grab — dan tetap hidup saat
  kuota AI habis.
- **Batas** — maksimal 10 foto per bill. AI membaca paling banyak **2 foto** per
  permintaan (satu bill panjang yang difoto dua kali); foto ketiga dan seterusnya
  otomatis dilampirkan sebagai bukti, bukan dibuang.
- **Kalau AI gagal** — kartu pilihan disembunyikan, muncul blok "Struk gagal
  dibaca" berisi penyebab dari server plus tiga jalan keluar: **Isi manual
  sekarang**, **Coba baca lagi**, **Pakai foto struk tadi sebagai bukti** (dan
  **Foto lain**). Fotonya tidak hilang, jadi tidak perlu memotret ulang.
- **Pajak** — kalau struk menyatakan harga sudah termasuk pajak, kolom Pajak
  dikunci dan bill ditandai `tax_included`; di layar bill muncul
  "Pajak (sudah termasuk) · di harga item" supaya orang tahu kenapa tidak ada
  baris pajak.

## Layar bill: urutan dari atas ke bawah (2026-10-26)

Urutan lama menaruh rincian struk di atas item, foto struk di paling bawah, dan
sembilan tombol aksi bertumpuk di ujung halaman. Tiga masalahnya: yang paling
dibutuhkan (bagianku dan item yang harus dipilih) tenggelam, foto struk — yang
justru dipakai sebagai acuan saat mengisi — tidak kelihatan, dan aksi menumpuk.

Urutan sekarang:

1. **Kartu total + status.** Angka besar, lalu satu baris "N orang · N item ·
   bagian kamu RpX · + RpY belum diambil". Status (Belum selesai / Semua lunas /
   Dibayar <nama> / Ditutup) menempel di dalam kartu yang sama, karena
   pertanyaan pertama orang adalah "tagihanku berapa dan sudah beres belum".
   *Bug yang ketemu di sini:* `.app-body` flex column tanpa `flex-shrink: 0`
   mengompres kartu ini sampai 40 px saat isi halaman panjang, sehingga angka
   totalnya terpotong dan tidak terlihat sama sekali.
2. **Foto struk.** Strip thumbnail 84×112 tepat di bawah kartu total, dengan
   tautan "Lihat struk". Ketuk thumbnail → viewer penuh dengan tombol
   Sebelumnya/Berikutnya dan penanda "2 dari 3". Ini yang bikin struk bisa
   dipakai sebagai acuan sambil mengetuk item, tanpa memakan satu layar penuh
   seperti kalau fotonya ditaruh sebagai gambar besar.
3. **Pemberitahuan.** "Kamu belum masuk bill ini" (tamu), sisa yang belum
   diambil (pemilik), atau ajakan membagikan link kalau masih sendirian.
4. **Item.** Isi utama; tiap baris tetap satu ketukan = satu porsi.
5. **Rincian struk.** Subtotal, diskon, pajak, service, cashback — dipindah ke
   bawah item karena ini penjelasan, bukan hal pertama yang dicari.
6. **Orang**, undangan menunggu, lalu cara transfer ke yang menalangi.
7. **Bar aksi bawah.** Satu tombol utama sesuai peran: tamu yang belum lunas
   dapat "Tandai bagianku lunas", sisanya "Bagikan link bill". Semua aksi lain
   (Ubah, Undang, Tutup/Buka, Atur jumlah bagian, Ganti yang bayar, Tandai semua
   lunas, Batalkan status lunas, Keluar, Kembali) masuk sheet **Aksi lain** —
   termasuk aksi destruktif yang dulu tampil sebaris dengan tombol biasa.

Catatan tradeoff: Splitwise versi 5.0 justru membuang menu overflow dan
memindahkan fitur ke baris tombol yang bisa di-scroll, karena fitur jadi
tersembunyi. Di sini tombol yang sering dipakai cuma 2–3, jadi bar + "Aksi lain"
masih masuk akal; kalau nanti aksi harian bertambah, tiga yang paling sering
perlu dinaikkan ke bar.
