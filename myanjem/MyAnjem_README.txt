MYANJEM V4.1 — PEMESANAN PENUMPANG, DRIVER, ADMIN, AKUN, OTP, QRIS MANUAL, DAN WITHDRAWAL

ISI PAKET
- index.html       : redirect dari root domain ke myanjem.html.
- myanjem.html     : beranda dan pintu masuk layanan.
- ma-pass.html     : alur penumpang, akun atau tamu, pemesanan, pelacakan, riwayat.
- ma-driver.html   : login/pendaftaran driver, operasional, dokumen, saldo dan penarikan.
- m-a-admin.html   : panel admin untuk driver, penumpang, pesanan, pembayaran, penarikan, audit, laporan, dan pengaturan.
- akun.html        : halaman akun, login/daftar, OTP email, profil, riwayat, dan informasi layanan.
- logo.png.png     : logo asli proyek (transparansi dipertahankan; ditampilkan tanpa kotak putih/rounded crop).
- code.gs          : backend Google Apps Script.

ARSITEKTUR
Frontend adalah halaman HTML statis yang saling terhubung. Backend menggunakan Google Apps Script dan Google Sheets. Unggah semua file HTML serta logo ke direktori root hosting statis yang sama; file Code.gs ditempelkan ke project Apps Script, bukan diunggah ke hosting frontend.

ALUR APLIKASI YANG TERSEDIA
1. Penumpang membuka halaman penumpang dan memilih masuk/daftar atau melanjutkan sebagai tamu. Akun penumpang memerlukan email + OTP 6 digit; tamu tetap dapat membuat pesanan tanpa profil.
2. Pendaftaran driver memerlukan email + OTP, data kendaraan, CAPTCHA server-side, serta file KTP atau KTM (JPG/PNG/PDF, maksimal 2 MB). Status awal driver adalah menunggu pemeriksaan admin.
3. Driver yang disetujui dapat online, menerima pesanan, menandai tiba, memulai perjalanan, dan menyelesaikan perjalanan. Driver dapat menyimpan tujuan pencairan BANK atau QRIS serta mengajukan penarikan saldo.
4. Admin meninjau data driver dan dokumen, mengelola penumpang/pesanan, memverifikasi pembayaran, memproses penarikan, membaca audit log, dan mengubah pengaturan tarif/QRIS.
5. Akun penumpang memiliki ringkasan akun dan riwayat perjalanan. Pesanan tamu tetap dilacak dengan kode pesanan dan nomor telepon.

PERSIAPAN GOOGLE APPS SCRIPT
1. Buka https://script.google.com/ dan buat project Apps Script.
2. Tempel seluruh isi code.gs ke Code.gs.
3. Ganti ADMIN_PASSWORD di bagian atas Code.gs dengan kata sandi admin yang kuat dan unik. Placeholder bawaan sengaja membuat login admin ditolak.
4. Periksa DB_ID_OVERRIDE. Nilai bawaan mempertahankan spreadsheet proyek sebelumnya. Cadangkan spreadsheet sebelum migrasi. Jika ingin memakai database baru, kosongkan DB_ID_OVERRIDE.
5. Jalankan setupMyAnjemV2() satu kali dari editor Apps Script. Berikan izin Spreadsheet.
6. Jalankan authorizeMyAnjemServices() satu kali dari editor dan setujui izin Spreadsheet, Google Drive, dan Mail yang diminta. Fungsi ini menyiapkan otorisasi layanan untuk OTP dan penyimpanan dokumen. Jika admin/driver belum memicu izin, jalankan ulang dan pastikan eksekusi selesai tanpa error.
7. Deploy > New deployment > Web app:
   - Execute as: Me
   - Who has access: Anyone
8. Salin URL web app yang berakhir dengan /exec.
9. Bila URL deployment berubah, perbarui konstanta API_URL pada seluruh file: ma-pass.html, ma-driver.html, m-a-admin.html, myanjem.html, dan akun.html.
10. Setelah mengubah Code.gs, buka Deploy > Manage deployments > Edit > pilih New version > Deploy. Jika memperbarui deployment yang sama, URL /exec biasanya tetap sama.

MIGRASI SPREADSHEET
- Fungsi setup/initialization menambahkan kolom baru di sebelah kanan bila header lama merupakan awalan dari skema baru; data lama tidak dihapus atau dipindah.
- Tab MA2_WITHDRAWALS dibuat otomatis.
- Kolom phone dan riderPhone diberi format teks agar nomor berawalan 08 tidak diperlakukan sebagai angka.
- Bila header tabel tidak cocok/urutannya berubah, backend sengaja berhenti dengan pesan error daripada menebak atau menimpa data. Pulihkan backup/periksa struktur sebelum melanjutkan.
- Tetap buat backup spreadsheet sebelum deploy, khususnya bila database berisi transaksi aktif.

DEPLOY FRONTEND
1. Unggah file berikut ke satu folder root website: index.html, myanjem.html, ma-pass.html, ma-driver.html, m-a-admin.html, akun.html, logo.png.png.
2. Deploy folder sebagai static site (misalnya Vercel, Netlify, GitHub Pages, atau hosting biasa).
3. Buka domain utama. index.html akan mengarahkan ke myanjem.html.
4. Halaman admin tidak ditampilkan di navigasi publik; buka m-a-admin.html secara langsung untuk login admin.

VERIFIKASI EMAIL DAN DOKUMEN DRIVER
- OTP email dikirim dari akun Google pemilik Apps Script melalui MailApp. Kode berlaku 5 menit, masa jeda pengiriman ulang 60 detik, dan percobaan kode dibatasi.
- Pastikan Apps Script memiliki izin Mail dan kuota pengiriman email masih tersedia. Periksa folder spam/junk bila email tidak masuk.
- KTP/KTM disimpan sebagai file privat dalam folder Google Drive milik pemilik Apps Script. Admin yang login dapat melihat dokumen melalui tab Driver. Jangan membagikan folder dokumen secara publik.
- Ukuran file dibatasi maksimal 2 MB; format yang diterima JPG, PNG, PDF.

PEMBAYARAN QRIS DAN DUITKU
- Pembayaran tunai dan transfer tetap tersedia.
- QRIS manual dapat diaktifkan dari Admin > Pengaturan dengan mengisi nama merchant dan URL HTTPS gambar QRIS yang valid. Pilihan QRIS hanya muncul pada penumpang setelah URL terpasang.
- QRIS pada paket ini belum dihubungkan ke Duitku. Pengguna memindai kode, mengirim nomor referensi/catatan, dan admin memverifikasi secara manual. Jangan menyatakan transaksi otomatis berhasil hanya karena pengguna mengirim referensi.
- Integrasi Duitku sesungguhnya memerlukan kredensial merchant, signature, endpoint callback/webhook, validasi status transaksi di server, dan mekanisme rekonsiliasi. Kredensial belum disediakan sehingga integrasi gateway tidak diaktifkan.

SALDO DAN PENARIKAN DRIVER
- Saldo driver dikreditkan setelah perjalanan selesai dan pembayaran transfer/QRIS dikonfirmasi admin. Satu pembayaran hanya dapat dikreditkan sekali.
- Pembayaran tunai tidak menambah saldo wallet karena uang dibayarkan langsung kepada driver.
- Driver harus menyimpan tujuan BANK atau QRIS sebelum mengajukan penarikan. Penarikan minimum Rp10.000.
- Pengajuan menahan/mengurangi saldo driver. Admin menandai sudah dibayar setelah melakukan transfer di luar aplikasi; jika ditolak, saldo dikembalikan otomatis.
- Proses pencairan masih manual; belum ada transfer otomatis melalui Duitku. Perhitungan saat ini mengkreditkan seluruh nilai pembayaran digital ke saldo driver (belum ada komisi platform/potongan layanan).

PERBAIKAN DAN BATASAN PENTING
- Bottom navigation pada halaman dengan 3/4/5 item menggunakan lebar slot yang sama; ukuran tidak bergantung pada jumlah tab. Logo asli ditampilkan tanpa background putih, tanpa rounded crop, memakai object-fit: contain.
- Permintaan autentikasi, pendaftaran, pemesanan, data driver privat, dan aksi admin diarahkan melalui POST hidden-iframe bridge. Endpoint publik/bootstrap masih menggunakan JSONP untuk kompatibilitas lintas domain.
- Respons POST dari Apps Script dikirim ke window.top karena HtmlService memakai iframe sandbox bertingkat. Frontend memvalidasi origin Google Apps Script dan nonce unik; jangan mengembalikan parent.postMessage() atau menghapus validasi nonce.
- Ini belum menjadi arsitektur keamanan ideal untuk skala produksi besar. Untuk peluncuran publik, pindahkan API ke server-side proxy/API backend yang memakai HTTPS POST, rate limiting, audit keamanan, password hashing lambat (Argon2/bcrypt/PBKDF2), pembatasan percobaan login, serta kebijakan retensi data. Hash saat ini memakai SHA-256 + salt sebagai kompatibilitas proyek, bukan pengganti KDF modern.
- Nomor telepon divalidasi sebagai string lokal 08xxxxxxxxxx. Jangan ubah kolom telepon menjadi Number di Google Sheets; format kolom telah diatur sebagai Plain text.
- Halaman Syarat & Ketentuan dan Kebijakan Privasi di akun.html masih berupa draf awal, bukan nasihat hukum. Sesuaikan dengan badan usaha, proses data aktual, retensi, penghapusan data, pengaduan, dan ketentuan operasional sebelum publikasi.
- Peta/rute memakai layanan publik Leaflet, OpenStreetMap/Nominatim, dan OSRM. Ketersediaan/kecepatan layanan pihak ketiga tidak dapat dijamin; untuk produksi pertimbangkan provider peta ber-SLA.
- Lokasi driver hanya diperbarui saat halaman driver aktif dan izin lokasi tersedia. Browser yang ditutup atau membatasi background activity tidak mengirim lokasi.
- Backend Google Apps Script dan Spreadsheet memiliki batas kuota serta kapasitas; untuk trafik besar dibutuhkan backend/database khusus dan kanal realtime yang sesuai.
- Tidak ada software yang dapat dijamin “nol bug”. Pemeriksaan pada paket ini mencakup pemeriksaan sintaks JavaScript/Apps Script dan pemeriksaan statis kode. Pengujian end-to-end dengan akun Google, izin Mail/Drive, spreadsheet, perangkat, jaringan, dan deployment produksi harus dilakukan setelah deploy.

CHECKLIST UJI WAJIB SETELAH DEPLOY
1. Buka beranda di desktop dan ponsel; pastikan logo utuh/transparan serta nav 3/4/5 tab tidak berubah janggal.
2. Penumpang: uji masuk/daftar/OTP email, logout/login kembali, dan uji pemesanan tamu.
3. Akun: pastikan nama/email/nomor muncul; riwayat hanya memuat perjalanan yang terhubung ke akun; tombol Lacak membuka pesanan yang benar.
4. Nomor: daftar dengan nomor contoh 081234567890; periksa di Sheets bahwa sel tersimpan sebagai teks dan angka 0 tetap tampil.
5. Driver: uji kirim OTP, unggah KTP/KTM JPG/PNG/PDF ukuran di bawah 2 MB, daftar, dan pastikan dokumen dapat dilihat admin namun tidak muncul pada daftar publik.
6. Admin: setujui driver hanya setelah dokumen diperiksa; uji status driver dan pesanan.
7. Perjalanan: uji alur Terima → Tiba → Mulai → Selesai.
8. Pembayaran: uji tunai, transfer, dan QRIS manual. Cek bahwa admin hanya menandai lunas setelah dana benar-benar diterima.
9. Wallet: pastikan pembayaran digital yang dikonfirmasi mengkredit saldo driver satu kali; tunai tidak mengkredit; uji penarikan minimum, tujuan rekening/QRIS, status dibayar, dan penolakan yang mengembalikan saldo.
10. Uji jaringan lambat, refresh halaman, sesi kedaluwarsa, serta tampilan ponsel dan desktop.
