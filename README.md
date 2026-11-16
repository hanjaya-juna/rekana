# REKANA — Sigap Bencana

Aplikasi siaga bencana dengan katalog perlengkapan, prakiraan cuaca, peringatan bencana, dan laporan kejadian masyarakat. Data disimpan di **MySQL**; browser memakai **localStorage** hanya untuk cache publik, draf laporan, antrean laporan offline, dan sesi admin.

## Fitur

- **Publik (tanpa login)**
  - Katalog produk siaga dengan pencarian, filter kategori, dan urutan.
  - Prakiraan cuaca 8 hari, peringatan aktif, dan daftar kejadian terverifikasi.
  - Formulir laporan masyarakat dengan draf otomatis di localStorage.
  - Antrean laporan offline: laporan dikirim otomatis saat koneksi kembali.
  - Cache data publik terakhir agar halaman tetap terbaca saat offline.
  - Keranjang dan checkout tanpa login: transfer bank, QRIS, e-wallet, atau tunai di tempat.
  - Kode pesanan dan cek status pesanan memakai kode + kontak pemesan.
- **Pembayaran manual**
  - Tidak memakai payment gateway maupun API key; pembayaran diverifikasi admin.
  - Status transaksi: `pending`, `verified`, `cancelled`.
  - Total dan harga selalu dihitung ulang dari MySQL; klien hanya mengirim ID produk dan jumlah.
  - Stok dikurangi saat admin memverifikasi, dan dikembalikan saat transaksi dibatalkan/dihapus.
- **Admin (login)**
  - Hanya admin dapat mengubah cuaca, peringatan, produk, kategori, dan status laporan.
  - Moderasi laporan: publikasikan, sembunyikan, tolak, atau hapus.
  - Ringkasan stok, produk unggulan, stok rendah, laporan menunggu, dan peringatan aktif.
  - Formulir login dengan password tersamarkan, tombol tampil/sembunyikan, peringatan Caps Lock, dan validasi username/password.
  - Semua perubahan admin disimpan ke MySQL melalui API yang dilindungi token JWT.

## Teknologi

- Node.js 18+ dan Express 4
- MySQL 8 (`mysql2`)
- JWT + bcrypt untuk autentikasi admin
- HTML, CSS, dan JavaScript vanilla tanpa build step

## Struktur

```
index.html               Antarmuka utama
styles.css               Gaya responsif (desktop hingga 360 px)
app.js                   Logika frontend, cache, draf, keranjang, checkout, admin
server/index.js          Entry point Express, static file, security header
server/public-routes.js  Bootstrap publik, laporan, checkout, cek status pesanan
server/admin-routes.js   Login, CRUD admin, verifikasi transaksi
server/payment.js        Metode dan instruksi pembayaran manual
server/data.js           Query SQL dan pemetaan payload API
server/auth.js           JWT dan middleware admin
server/db.js             Connection pool dan helper transaksi
database/schema.sql      Skema MySQL
scripts/init-db.js       Pembuatan skema + data awal
scripts/check-db.js      Pemeriksaan koneksi dan isi database
prototype-v1.html        Prototipe awal (arsip)
```

## Menjalankan aplikasi

1. Pastikan **MySQL 8** berjalan (Windows: service `MySQL80`).
2. Salin `.env.example` menjadi `.env`, lalu isi kredensial MySQL:

   ```env
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=password_mysql_anda
   DB_NAME=rekana
   ```

   Jika akun MySQL Anda bukan `root`, buat user khusus (disarankan):

   ```sql
   CREATE USER 'rekana'@'localhost' IDENTIFIED BY 'password_kuat';
   GRANT ALL PRIVILEGES ON rekana.* TO 'rekana'@'localhost';
   FLUSH PRIVILEGES;
   ```

   Lalu set `DB_USER=rekana` dan `DB_PASSWORD=password_kuat`.

3. Pasang dependensi dan inisialisasi database:

   ```bash
   npm install
   npm run db:init
   npm run db:check
   ```

   `db:init` membuat database/tabel jika belum ada, membuat akun admin awal, lalu mengisi data contoh. Skrip aman dijalankan ulang: data yang sudah ada tidak ditimpa.

4. Jalankan server:

   ```bash
   npm start
   ```

   Buka <http://localhost:3000>.

   Mode pengembangan dengan reload otomatis:

   ```bash
   npm run dev
   ```

## Akun admin awal

Isi `ADMIN_USERNAME` dan `ADMIN_PASSWORD` di `.env` sebelum menjalankan `npm run db:init`. Gunakan password yang kuat dan jangan memakai nilai contoh dari dokumentasi.

- Username default: `admin`
- Password: nilai yang Anda isi di `ADMIN_PASSWORD`

`db:init` akan gagal dengan pesan yang jelas jika `ADMIN_PASSWORD` masih kosong. Menjalankan `db:init` lagi akan memperbarui hash password akun admin sesuai `.env`.

## Pembayaran manual

Halaman **Pembayaran** (`#pembayaran`) dipakai publik untuk memesan perlengkapan tanpa login. Alurnya:

1. Pengguna menambah produk ke keranjang (tersimpan di localStorage).
2. Isi nama, kontak, cara menerima, dan metode bayar: transfer bank, QRIS, e-wallet, atau tunai di tempat.
3. Server memvalidasi stok, menghitung ulang total dari harga MySQL, lalu membuat kode pesanan (`RKN-YYMMDD-XXXXXX`) berstatus `pending`.
4. Admin membuka tab **Transaksi**, memeriksa pesanan, lalu memilih **Verifikasi** atau **Batalkan**.
5. Verifikasi mengurangi stok; pembatalan atau penghapusan mengembalikan stok yang sudah dikurangi.
6. Pemesan mengecek status dengan kode pesanan + kontak yang dipakai saat checkout.

Tidak ada payment gateway atau API key. Instruksi pembayaran memakai variabel berikut di `.env`:

```env
PAYMENT_BANK_NAME=BCA
PAYMENT_BANK_ACCOUNT=1234567890
PAYMENT_BANK_HOLDER=Yayasan REKANA
PAYMENT_QRIS_LABEL="QRIS REKANA (contoh)"
PAYMENT_EWALLET_NAME="GoPay / OVO / DANA"
PAYMENT_EWALLET_NUMBER=0812-0000-0000
PAYMENT_EWALLET_HOLDER=REKANA
```

Ganti nilai contoh tersebut dengan rekening/QRIS/e-wallet resmi sebelum dipakai. QRIS hanya ditampilkan sebagai label; gambar QR resmi dapat dikirim manual lewat WhatsApp admin.

## LocalStorage

| Key | Isi | Kapan dipakai |
| --- | --- | --- |
| `rekana.publicCache.v2` | Snapshot data publik terakhir | Saat offline atau sebelum server merespons |
| `rekana.reportDraft.v2` | Draf formulir laporan | Setiap kali pengguna mengetik di form laporan |
| `rekana.reportQueue.v2` | Laporan yang gagal terkirim karena offline | Dikirim ulang otomatis saat `online` |
| `rekana.session.v2` | Token JWT dan profil admin | Login admin; dihapus saat keluar |
| `rekana.cart.v2` | ID produk dan jumlah di keranjang | Setiap perubahan keranjang |
| `rekana.lastOrder.v2` | Kode dan ringkasan pesanan terakhir | Setelah checkout berhasil |

Cache publik bukan sumber kebenaran. Data admin selalu dibaca dari MySQL dan hanya tersedia setelah login.

## API utama

| Metode | Path | Akses | Keterangan |
| --- | --- | --- | --- |
| `GET` | `/api/health` | Publik | Status server dan koneksi database |
| `GET` | `/api/bootstrap` | Publik | Produk, kategori, cuaca, peringatan aktif, kejadian terbit, info pembayaran |
| `POST` | `/api/incidents` | Publik | Kirim laporan masyarakat (status awal `pending`) |
| `POST` | `/api/transactions` | Publik | Buat pesanan/checkout; mengembalikan kode pesanan dan instruksi bayar |
| `POST` | `/api/transactions/lookup` | Publik | Cek status pesanan dengan kode + kontak pemesan |
| `POST` | `/api/admin/login` | Publik | Login admin, mengembalikan token JWT |
| `GET` | `/api/admin/me` | Admin | Validasi sesi |
| `GET` | `/api/admin/data` | Admin | Semua data termasuk laporan pending dan transaksi |
| `PUT` | `/api/admin/weather` | Admin | Simpan prakiraan 8 hari |
| `POST/PUT/DELETE` | `/api/admin/warnings` | Admin | CRUD peringatan |
| `PATCH/DELETE` | `/api/admin/incidents/:id` | Admin | Moderasi/hapus laporan |
| `POST/PUT/DELETE` | `/api/admin/products` | Admin | CRUD produk |
| `POST/PUT/DELETE` | `/api/admin/categories` | Admin | CRUD kategori |
| `PATCH` | `/api/admin/transactions/:id` | Admin | Verifikasi (`verified`) atau batalkan (`cancelled`) pesanan |
| `DELETE` | `/api/admin/transactions/:id` | Admin | Hapus transaksi dan kembalikan stok bila pernah dikurangi |

## Catatan keamanan

- Endpoint admin memakai middleware `requireAdmin`; perubahan tidak dapat dilakukan hanya dengan memanipulasi UI.
- Password admin disimpan sebagai hash bcrypt.
- Login dibatasi dengan rate limit sederhana per IP.
- Header keamanan (CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`) dipasang di server.
- Folder `server/`, `scripts/`, `database/`, `.env`, dan `node_modules/` tidak disajikan sebagai file statis.
- Untuk produksi, gunakan HTTPS, ganti `JWT_SECRET`, dan batasi akses MySQL ke localhost.

## Pemecahan masalah

- **`Access denied for user`** — periksa `DB_USER`/`DB_PASSWORD` di `.env`.
- **`ECONNREFUSED`** — pastikan service MySQL berjalan dan `DB_PORT` benar.
- **`Unknown database 'rekana'`** — jalankan `npm run db:init`.
- **Halaman menampilkan cache lama** — tekan `Ctrl+F5`, atau hapus key `rekana.*` di Application → Local Storage.
- **Halaman admin kosong** — sesi mungkin kedaluwarsa; klik **Keluar** lalu login ulang.
