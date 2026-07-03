# Dashboard UI Pendaftaran Massal Dropbox (HTML5)

Kami telah membuat versi UI/Dashboard berbasis HTML5 & CSS3 untuk mempermudah pendaftaran massal Dropbox, lengkap dengan input URL, input bulk email, opsi proxy, dan visualisasi progress serta console log real-time.

## Fitur Utama Dashboard
1. **Input Parameter Fleksibel**:
   - Input **URL Dropbox / Referal** langsung dari antarmuka web.
   - Input **Daftar Email Massal** (dipisahkan dengan tanda `;`).
   - Switch toggle untuk **Rotasi Proxy Singapura (SG)**.
2. **Visual Progress Ring**:
   - Menampilkan status pendaftaran secara visual (persentase progress, jumlah email terproses, dan detail status aktif).
   - Indikator status dinamis: *Standby* (idle), *Memproses* (running), *Selesai* (success), *Error*, dan *Dihentikan* (stopped).
3. **Pengaturan Mode Headless (Jalankan Tanpa Jendela)** [NEW]:
   - Switch toggle checkbox baru **Jalankan Tanpa Jendela (Headless Mode)** ditambahkan ke Dashboard UI.
   - Jika dicentang, skrip pendaftaran berjalan secara tidak terlihat (*headless*) untuk menghemat memori. Jika tidak dicentang, browser Firefox akan ditampilkan secara visual (*headed*).
4. **Tombol Hentikan (Stop)**:
   - Pengguna dapat membatalkan pendaftaran kapan saja secara instan.
   - Menggunakan mekanisme **AbortController** yang langsung menutup browser Playwright aktif dan menghentikan proses iterasi email seketika tanpa perlu me-restart server.
   - Ditambahkan penanganan khusus untuk membatalkan proses langsung saat browser Firefox sedang dimuat (launching), sehingga browser tidak akan pernah menggantung jika dihentikan di awal startup.
5. **Statistik Pendaftaran (Sukses & Gagal)**:
   - Dua kartu counter statistik di bawah progress untuk melacak jumlah pendaftaran yang **Sukses** dan **Gagal** secara real-time.
6. **Auto-Pop Email Sukses dari Daftar Input**:
   - Setiap kali pendaftaran sebuah email berhasil diselesaikan, server akan memancarkan event `email_success` ke browser.
   - Browser Dashboard secara dinamis mem-parse dan **menghapus alamat email yang sukses tersebut dari daftar input textarea**.
7. **Pencegahan Hang/Lock Firefox (No-Focus Launch)**:
   - Skrip secara otomatis mencari dan menghapus file lock profil Firefox (`parent.lock`, `lock`, `.parentlock`) sebelum browser dibuka.
   - Hal ini mencegah munculnya dialog eror "Firefox is already running..." akibat penghentian skrip tidak bersih di sesi sebelumnya. Browser kini dapat langsung terbuka di latar belakang **tanpa perlu memfokuskan jendela secara manual di awal startup**.
8. **Penghapusan Cookies, Cache, dan Data Penyimpanan Situs (Dropbox dll)**:
   - Sebelum meluncurkan browser untuk pendaftaran baru, skrip memicu fungsi `clearProfileData()` untuk membersihkan:
     * Semua database cookies (`cookies.sqlite`, `cookies.sqlite-wal`, `cookies.sqlite-shm`).
     * Riwayat penelusuran (`places.sqlite`, dll).
     * Seluruh data cache browser (`cache2`, `startupCache`, dll).
     * Data penyimpanan situs di folder `storage/default` (seperti LocalStorage, SessionStorage, dan IndexedDB milik dropbox.com).
   - **Perlindungan Ekstensi**: Skrip secara khusus menyaring folder `storage/default` dan **tidak menghapus** folder yang berawalan `moz-extension+++`. Ini memastikan ekstensi yang Anda pasang (misal Proxy Switcher, Adblocker) beserta pengaturannya tetap tersimpan dan tidak terhapus.
9. **Console Log Real-time**:
   - Mengalihkan dan memancarkan log dari script Playwright ke konsol web secara langsung melalui WebSockets.
   - Dilengkapi warna log khusus (Hijau untuk sukses, Merah untuk error/gagal, Kuning untuk peringatan).
   - Tombol *Hapus Log* untuk membersihkan layar konsol.

## Pembaruan Optimalisasi Otomasi
1. **Timeout 60 Detik untuk Mencari Field Email** [NEW]:
   - Mengganti pencarian instan menjadi pencarian berkala (polling) setiap 1 detik dengan **maksimum timeout 60 detik** untuk menunggu field input email muncul saat halaman dimuat. Ini mencegah script langsung gagal/error jika jaringan lambat saat memuat halaman pertama.
2. **Pengisian Cepat Tanpa Simulasi Mengetik & Gerakan Mouse**:
   - Menghapus fungsi simulasi pengetikan per karakter yang lambat (`humanType` diganti ke pengisian instan via `page.fill`).
   - Menghapus simulasi pergeseran koordinat kursor mouse (`humanClick` diganti ke klik langsung via `page.click`).
   - Perubahan ini memastikan script **tetap berjalan dengan andal walaupun jendela browser Firefox Playwright berada dalam keadaan minimized (di latar belakang)**.
3. **Auto-Retry Timeout 60 Detik**:
   - Setelah menekan tombol daftar (*Agree and sign up*), script akan memantau URL selama maksimum **60 detik** (sebelumnya 180 detik).
   - Jika dalam 60 detik URL halaman tidak berubah (indikasi pendaftaran macet, captcha gagal, atau koneksi terputus), script akan melempar error timeout dan memicu **otomatis pendaftaran ulang (auto-retry)** menggunakan sesi/proxy yang bersih dari awal (hingga batas maksimal 3 kali percobaan).

## Komponen yang Ditambahkan / Dimodifikasi

1. **[MODIFY] [server.js](file:///c:/Users/wijayad/AntiGravity/Dropbox/server.js)**:
   - Menambahkan API WebSocket untuk aksi `stop`.
   - Mengintegrasikan pemancaran event `email_success` ke klien websocket saat pendaftaran berhasil.
   - Meneruskan opsi `useHeadless` dari UI ke eksekusi `registerSingleEmail`.
   - Mengintegrasikan interupsi responsive delay dan pembersihan browser saat pembatalan aktif.
   - Menyimpan dan memancarkan hitungan `successCount` dan `failedCount` secara dinamis ke klien.

2. **[MODIFY] [register.js](file:///c:/Users/wijayad/AntiGravity/Dropbox/register.js)**:
   - Menerima opsi `headless` di `registerSingleEmail` dan memetakan konfigurasinya ke browser launch options Playwright.
   - Menambahkan polling berkala dengan timeout 60 detik untuk mencari elemen input email pada langkah pertama.
   - Mengganti fungsi pengetikan/klik simulasi manusia menjadi pengisian input dan klik langsung.
   - Mengurangi durasi deteksi URL pendaftaran sukses menjadi 60 detik dan memicu error/retry jika terlampaui.
   - Menghubungkan fungsi ke parameter `abortController` untuk mendukung pembatalan darurat dari server.
   - Menambahkan fungsi pembersihan otomatis `clearProfileData` yang dipanggil sebelum meluncurkan browser untuk pendaftaran normal.

3. **[MODIFY] [public/index.html](file:///c:/Users/wijayad/AntiGravity/Dropbox/public/index.html)** & **[public/index.css](file:///c:/Users/wijayad/AntiGravity/Dropbox/public/index.css)**:
   - Menambahkan checkbox **Jalankan Tanpa Jendela (Headless Mode)** ke form parameter.
   - Menambahkan tombol **Hentikan** (Stop) berdampingan dengan tombol **Mulai Pendaftaran**.
   - Menambahkan elemen visual **Sukses** dan **Gagal** dengan tata letak grid dan warna yang elegan.
   - Memperbarui WebSocket client JavaScript untuk menangani perintah stop dan render statistik sukses/gagal.
   - Menambahkan fungsi `removeEmailFromUIList` untuk mengeluarkan email yang sukses dari textarea input.

---

## Cara Menjalankan Dashboard UI

1. Pastikan Anda berada di direktori project:
   ```powershell
   cd c:\Users\wijayad\AntiGravity\Dropbox
   ```
2. Jalankan backend server:
   ```powershell
   $env:PATH = "C:\Program Files\nodejs;" + $env:PATH; node server.js
   ```
3. Buka browser utama Anda dan akses ke:
   ```
   http://localhost:3000
   ```
4. Masukkan URL referal, daftar email (pisahkan dengan `;`), centang proxy jika diperlukan, centang mode headless jika ingin berjalan tanpa jendela, dan klik **Mulai Pendaftaran**.
5. Jika ingin membatalkan, cukup klik **Hentikan** (Stop).

## Termux Compatibility

### Prasyarat
- Install Termux from Google Play Store or F-Droid.
- Update package repository:
  ```bash
  pkg update && pkg upgrade -y
  ```
- Install required packages:
  ```bash
  pkg install -y nodejs git python clang make binutils libandroid-glue
  ```
- (Optional) Install `proot-distro` if you prefer a Linux distro inside Termux.

### Setup Project
```bash
# Clone or copy the project into Termux home
cd ~
# Assuming you have the project folder already, navigate into it
cd AntiGravity/Dropbox

# Install npm dependencies
npm install

# Install Playwright browsers (Firefox is used)
npx playwright install firefox
```

### Menjalankan Dashboard
```bash
# Ensure Node is in PATH (usually is by default)
node server.js
```

Buka browser di perangkat Android dan akses:
`http://127.0.0.1:3000`

### Catatan Tambahan
- Skrip menggunakan path relatif (`path.join(__dirname, ...)`) sehingga tidak bergantung pada format path Windows.
- Jika menemukan error terkait dependensi sistem (mis. `libc++`), instal paket yang diperlukan via `pkg install libc++`.
- Untuk mode headless, tidak diperlukan X server; Playwright menjalankan Firefox secara headless secara native.
- Jika ingin menggunakan proxy, pastikan koneksi internet dapat diakses; script otomatis mengunduh daftar proxy.

## Alternative: Run Inside Proot‑Distro (Debian/Ubuntu)

If Playwright fails with the *Unsupported platform: android* error, run the project inside a Linux distribution using `proot-distro`.

### Install and launch a distro
```bash
pkg install -y proot-distro
proot-distro install debian   # or ubuntu
proot-distro login debian    # enters a Debian shell
```
### Node Install

# Remove existing node
apt remove nodejs npm -y

# Add NodeSource repository
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -

# Install Node.js
apt install nodejs -y

# npm comes bundled with this installation
npm -v

Inside the proot environment you have a standard Linux userland where Playwright’s pre‑built browsers work.

### Setup inside the distro
```bash
# 1️⃣ Update distro & install required system libraries (Playwright browsers need them)
apt update && apt upgrade -y
apt install -y libglib2.0-0 libnss3 libatk-bridge2.0-0 libdrm2 \
    libxkbcommon-x11-0 libgtk-3-0 libasound2 libx11-6 libx11-xcb1 \
    libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 \
    libxrandr2 libxrender1 libxshmfence1 libgbm1

# 2️⃣ Go to the project directory inside proot
cd ~/AntiGravity/Dropbox

# 3️⃣ Install Playwright locally (writes the wrapper to node_modules/.bin)
npm install --save-dev playwright

# 4️⃣ Ensure the Playwright CLI is executable (fixes "Permission denied")
chmod -R 755 node_modules/.bin

# 5️⃣ Install the browsers you need (Firefox, Chromium, etc.)
npx playwright install firefox   # or "chromium"

# 6️⃣ Start the server
node server.js
```

Now open the Android browser and navigate to `http://127.0.0.1:3000` (the server runs inside the proot instance, exposing the same localhost).

### Notes
- This approach isolates the Linux environment, providing the necessary glibc and x86_64 binaries Playwright expects.
- If you prefer not to use `proot-distro`, you can also run the script on a remote Linux machine and access the UI via your phone’s browser.

---
