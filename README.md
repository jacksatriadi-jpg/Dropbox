# Dashboard UI Pendaftaran Massal Dropbox

Proyek ini menyediakan antarmuka web (Dashboard) modern untuk mengotomatisasi pendaftaran massal akun Dropbox, lengkap dengan monitoring progress secara visual, console log real-time, opsi rotasi IP/Proxy (Direct, Warp, Socks5), dan integrasi otomatis dengan Dropbox Daemon resmi.

---

## 🚀 Cara Setup

Anda dapat memilih antara menggunakan script otomatis (sangat disarankan) atau melakukan setup secara manual.

### Metode A: Setup Otomatis (1 Command via curl/wget)

Kami telah menyediakan script setup otomatis yang dapat diunduh dan dijalankan secara langsung dengan **satu perintah** dari terminal Anda:

**Menggunakan `curl`:**
```bash
curl -sSL https://raw.githubusercontent.com/jacksatriadi-jpg/Dropbox/webui/setup.sh | bash
```

**Menggunakan `wget`:**
```bash
wget -qO- https://raw.githubusercontent.com/jacksatriadi-jpg/Dropbox/webui/setup.sh | bash
```

> [!NOTE]
> Setelah instalasi satu perintah di atas selesai, Anda perlu masuk ke direktori proyek sebelum menjalankan aplikasi:
> ```bash
> cd Dropbox
> ```

---


### Metode B: Setup Manual

Jika Anda menggunakan Windows atau ingin melakukan instalasi langkah-demi-langkah:

1. **Instal Dependensi NPM**:
   ```bash
   npm install
   ```
2. **Instal Playwright Firefox**:
   ```bash
   npx playwright install firefox
   ```
3. **Unduh Aplikasi Dropbox Daemon**:
   - Untuk **Linux x86_64**: Unduh dari [Dropbox](https://www.dropbox.com/download?plat=lnx.x86_64) lalu ekstrak kontennya ke folder `app/` dalam proyek ini.

---

## 🐳 Panduan Khusus Lingkungan Kerja

### 1. Ubuntu x86_64 (Menggunakan Docker)
Jika Anda menggunakan **Ubuntu x86_64**, Dropbox Daemon akan dijalankan secara otomatis di dalam container Docker demi keamanan dan isolasi.

* **Prasyarat**: Pastikan Docker sudah terpasang dan berjalan di sistem Anda.
* **Instalasi Docker** (jika belum ada):
  ```bash
  sudo apt update && sudo apt install -y docker.io
  ```
* Skrip pendaftaran akan secara otomatis mendeteksi lingkungan ini dan menjalankan perintah Docker berikut di latar belakang:
  ```bash
  docker run -i --rm --init -v ~/Dropbox/app:/app -w /app -v /root/.dropbox -v /root/Dropbox --net=host ubuntu:24.04 /app/.dropbox-dist/dropboxd
  ```

### 2. Android (Termux)
Jika Anda menjalankan script ini langsung di Android menggunakan **Termux**:

* Pastikan Termux Anda telah diperbarui dan paket dasar terinstal:
  ```bash
  pkg update && pkg upgrade -y
  pkg install -y nodejs git
  ```
* Jalankan [setup.sh](setup.sh) untuk mengonfigurasi browser Playwright secara headless. Pendaftaran akan menggunakan emulator emulator `box64` secara otomatis untuk menjalankan Dropbox daemon.

---

## 🏃‍♂️ Cara Menjalankan Aplikasi

Setelah semua langkah penyiapan selesai:

1. Jalankan backend server Node.js:
   ```bash
   node server.js
   ```
2. Buka browser utama Anda dan akses ke:
   ```
   http://localhost:3000
   ```
3. Masukkan URL referal Dropbox, daftar email (pisahkan dengan titik koma `;`), atur konfigurasi proxy/headless, lalu klik **Mulai Pendaftaran**.

---

## 📂 Informasi Berkas Penting
* [server.js](server.js): Backend server Express & WebSocket.
* [register.js](register.js): Skrip inti otomasi pendaftaran menggunakan Playwright.
* [setup.sh](setup.sh): Script shell otomatisasi penyiapan lingkungan.
* [.gitignore](.gitignore): Daftar file dan direktori yang diabaikan oleh Git (termasuk folder `app/`, `node_modules/`, `data/`, dan `firefox-profile/`).
