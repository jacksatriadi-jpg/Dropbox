#!/bin/bash

# ==============================================================================
# Setup Script - Dashboard UI Pendaftaran Massal Dropbox
# Branch: webui
# ==============================================================================

# Warna untuk output terminal
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}======================================================================${NC}"
echo -e "${GREEN}      Memulai Setup Dashboard UI Pendaftaran Massal Dropbox           ${NC}"
echo -e "${GREEN}======================================================================${NC}"

REPO_URL="https://github.com/jacksatriadi-jpg/Dropbox.git"
BRANCH="webui"

# 1. Deteksi Lingkungan
echo -e "\n${GREEN}[1/6] Memeriksa lingkungan sistem...${NC}"

# Cek Termux
IS_TERMUX=false
if [ -n "$TERMUX_VERSION" ]; then
    IS_TERMUX=true
    echo -e "${YELLOW}Lingkungan Termux terdeteksi.${NC}"
fi

# Cek Ubuntu x86_64 (Docker hanya diperlukan pada lingkungan ini)
IS_UBUNTU_X86_64=false
if [ "$(uname -m)" = "x86_64" ] && [ -f /etc/os-release ] && grep -qi "ubuntu" /etc/os-release; then
    IS_UBUNTU_X86_64=true
    echo -e "${YELLOW}Lingkungan Ubuntu x86_64 terdeteksi.${NC}"
fi

# Cek Git
if ! command -v git &> /dev/null; then
    echo -e "${YELLOW}Git tidak terdeteksi.${NC}"
    if [ "$IS_TERMUX" = true ]; then
        echo -e "Menginstal Git di Termux..."
        pkg update && pkg install -y git
    else
        echo -e "${RED}Error: Git belum terinstal. Silakan instal Git terlebih dahulu.${NC}"
        exit 1
    fi
else
    echo -e "Git terdeteksi: $(git --version)"
fi

# Cek Node.js & NPM
if ! command -v node &> /dev/null || ! command -v npm &> /dev/null; then
    echo -e "${YELLOW}Node.js/NPM tidak terdeteksi.${NC}"
    if [ "$IS_TERMUX" = true ]; then
        echo -e "Menginstal Node.js di Termux..."
        pkg update && pkg install -y nodejs
    else
        echo -e "${RED}Error: Node.js/NPM belum terinstal. Silakan instal Node.js terlebih dahulu.${NC}"
        exit 1
    fi
else
    echo -e "Node.js terdeteksi: $(node -v)"
    echo -e "NPM terdeteksi: $(npm -v)"
fi

# Cek Docker (Hanya jika di lingkungan Ubuntu x86_64)
if [ "$IS_UBUNTU_X86_64" = true ]; then
    if ! command -v docker &> /dev/null; then
        echo -e "${YELLOW}Peringatan: Docker tidak terdeteksi.${NC}"
        echo -e "Docker diperlukan untuk menjalankan Dropbox Daemon di Ubuntu x86_64."
        if [ "$EUID" -eq 0 ]; then
            echo -e "Menginstal Docker secara otomatis..."
            apt-get update && apt-get install -y docker.io
        else
            echo -e "Untuk menginstal Docker secara manual, silakan jalankan:"
            echo -e "${YELLOW}sudo apt update && sudo apt install -y docker.io${NC}"
        fi
    else
        echo -e "Docker terdeteksi: $(docker --version)"
    fi
fi


# 2. Kloning Repositori (Jika belum berada di dalam direktori proyek)
echo -e "\n${GREEN}[2/6] Memeriksa status repositori Git...${NC}"

# Cek apakah saat ini sudah berada di dalam folder proyek Dropbox dengan branch webui
IN_REPO=false
if [ -d .git ]; then
    REMOTE_URL=$(git remote get-url origin 2>/dev/null)
    if [[ "$REMOTE_URL" == *"Dropbox"* ]]; then
        IN_REPO=true
    fi
fi

if [ "$IN_REPO" = true ]; then
    echo -e "${YELLOW}Anda sudah berada di dalam repositori Dropbox.${NC}"
    CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
    if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
        echo -e "Berpindah ke branch ${BRANCH}..."
        git checkout "$BRANCH" || git checkout -b "$BRANCH" "origin/$BRANCH"
    else
        echo -e "Sudah berada di branch ${BRANCH}."
    fi
else
    if [ -d "Dropbox" ] && [ -f "Dropbox/server.js" ]; then
        echo -e "${YELLOW}Folder 'Dropbox' sudah ada. Masuk ke folder tersebut...${NC}"
        cd Dropbox || exit 1
        # Cek branch
        CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
        if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
            echo -e "Berpindah ke branch ${BRANCH}..."
            git checkout "$BRANCH" || git checkout -b "$BRANCH" "origin/$BRANCH"
        fi
    elif [ -f "server.js" ] && [ -f "package.json" ]; then
        # Kita sudah berada di dalam folder proyek (misalnya user menjalankan dari ~/Dropbox/)
        echo -e "${YELLOW}Terdeteksi sudah berada di dalam folder proyek Dropbox.${NC}"
        CURRENT_BRANCH=$(git branch --show-current 2>/dev/null)
        if [ "$CURRENT_BRANCH" != "$BRANCH" ]; then
            echo -e "Berpindah ke branch ${BRANCH}..."
            git checkout "$BRANCH" || git checkout -b "$BRANCH" "origin/$BRANCH"
        fi
    else
        echo -e "Mengkloning repositori Dropbox branch '${BRANCH}' (shallow clone)..."
        git clone --depth 1 -b "$BRANCH" "$REPO_URL"
        cd Dropbox || exit 1
    fi
fi

# 3. Instalasi Dependensi NPM
echo -e "\n${GREEN}[3/6] Menginstal dependensi NPM...${NC}"
npm install
if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Gagal menginstal dependensi NPM.${NC}"
    exit 1
fi
echo -e "${GREEN}Dependensi NPM berhasil diinstal.${NC}"

# 4. Instalasi Playwright Firefox
echo -e "\n${GREEN}[4/6] Menginstal browser Firefox untuk Playwright...${NC}"
npx playwright install firefox
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}Peringatan: Penginstalan browser normal Playwright mengalami kendala.${NC}"
    echo -e "Mencoba dengan bendera --with-deps...${NC}"
    npx playwright install --with-deps firefox
fi

# 5. Instalasi Dependensi Sistem Linux (jika berlaku)
echo -e "\n${GREEN}[5/6] Memeriksa dependensi sistem Linux...${NC}"
if [ -f /etc/debian_version ] || [ -f /etc/lsb-release ]; then
    echo -e "Mendeteksi sistem berbasis Debian/Ubuntu."
    if [ "$EUID" -ne 0 ]; then
        echo -e "${YELLOW}Catatan: Jika Playwright gagal dijalankan nanti karena pustaka yang hilang,${NC}"
        echo -e "${YELLOW}jalankan perintah berikut menggunakan sudo:${NC}"
        echo -e "sudo apt update && sudo apt install -y libglib2.0-0 libnss3 libatk-bridge2.0-0 libdrm2 \\"
        echo -e "    libxkbcommon-x11-0 libgtk-3-0 libasound2 libx11-6 libx11-xcb1 \\"
        echo -e "    libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 \\"
        echo -e "    libxrandr2 libxrender1 libxshmfence1 libgbm1"
    else
        echo -e "Menginstal dependensi sistem secara otomatis..."
        apt-get update && apt-get install -y libglib2.0-0 libnss3 libatk-bridge2.0-0 libdrm2 \
            libxkbcommon-x11-0 libgtk-3-0 libasound2 libx11-6 libx11-xcb1 \
            libxcb1 libxcomposite1 libxcursor1 libxdamage1 libxfixes3 libxi6 \
            libxrandr2 libxrender1 libxshmfence1 libgbm1
    fi
fi

# 6. Unduh dan Ekstrak Aplikasi Dropbox Resmi & Psiphon Binary
echo -e "\n${GREEN}[6/6] Menyiapkan aplikasi pihak ketiga (Dropbox & Psiphon)...${NC}"
mkdir -p app

# Download Dropbox jika belum ada
if [ ! -d "app/.dropbox-dist" ]; then
    echo -e "Mengunduh dan mengekstrak aplikasi Dropbox resmi..."
    wget -O - "https://www.dropbox.com/download?plat=lnx.x86_64" | tar -C app -xzf -
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}Aplikasi Dropbox berhasil diunduh dan diekstrak ke folder 'app'.${NC}"
    else
        echo -e "${RED}Error: Gagal mengunduh atau mengekstrak aplikasi Dropbox.${NC}"
    fi
else
    echo -e "Aplikasi Dropbox sudah terpasang di folder 'app'."
fi

# Download Psiphon Binary jika belum ada
if [ ! -f "app/psiphon-tunnel-core-x86_64" ]; then
    echo -e "Mengunduh Psiphon binary..."
    wget -O app/psiphon-tunnel-core-x86_64 "https://github.com/Psiphon-Labs/psiphon-tunnel-core-binaries/raw/master/linux/psiphon-tunnel-core-x86_64"
    if [ $? -eq 0 ]; then
        chmod +x app/psiphon-tunnel-core-x86_64
        echo -e "${GREEN}Psiphon binary berhasil diunduh dan dikonfigurasi executable.${NC}"
    else
        echo -e "${RED}Error: Gagal mengunduh Psiphon binary.${NC}"
    fi
else
    echo -e "Psiphon binary sudah ada di folder 'app'."
fi

# Download Cloudflared Binary jika belum ada
if [ ! -f "app/cloudflared-linux-amd64" ]; then
    echo -e "Mengunduh Cloudflared binary..."
    wget -O app/cloudflared-linux-amd64 "https://github.com/cloudflare/cloudflared/releases/download/2026.6.1/cloudflared-linux-amd64"
    if [ $? -eq 0 ]; then
        chmod +x app/cloudflared-linux-amd64
        echo -e "${GREEN}Cloudflared binary berhasil diunduh dan dikonfigurasi executable.${NC}"
    else
        echo -e "${RED}Error: Gagal mengunduh Cloudflared binary.${NC}"
    fi
else
    echo -e "Cloudflared binary sudah ada di folder 'app'."
fi

# Copy psiphon.config jika ada
if [ -f "psiphon.config" ]; then
    cp psiphon.config app/
    echo -e "File psiphon.config berhasil disalin ke folder 'app'."
elif [ -f "Dropbox/psiphon.config" ]; then
    cp Dropbox/psiphon.config app/
    echo -e "File psiphon.config berhasil disalin ke folder 'app'."
else
    echo -e "${YELLOW}Peringatan: File psiphon.config tidak ditemukan. Silakan buat file tersebut secara manual.${NC}"
fi

echo -e "\n${GREEN}======================================================================${NC}"
echo -e "${GREEN}                      Setup Berhasil Selesai!                         ${NC}"
echo -e "${GREEN}======================================================================${NC}"
echo -e "Untuk menjalankan server dashboard, jalankan perintah berikut:"
echo -e "${YELLOW}node server.js${NC}"
echo -e "Kemudian buka browser Anda di: ${YELLOW}http://localhost:3000${NC}"
echo -e "${GREEN}======================================================================${NC}"
