const { firefox } = require('playwright');
const readline = require('readline');
const https = require('https');
const path = require('path');
const fs = require('fs');
const PROFILE_PATH = path.join(__dirname, 'firefox-profile');

// Track whether Warp is already active (avoid unnecessary stop/start between cycles)
let warpActive = false;

// ── Kill helpers (accessible from server.js via global) ─────────────────────
function killAllBrowsers() {
    try { require('child_process').execSync('pkill -9 -f firefox', { stdio: 'ignore' }); } catch (_) {}
    try { require('child_process').execSync('pkill -9 -f playwright', { stdio: 'ignore' }); } catch (_) {}
    console.log('[Kill] Semua proses Firefox/Playwright dihentikan paksa.');
}

function killAllBox64() {
    try { require('child_process').execSync('pkill -9 -f dropbox-lnx.x86_64', { stdio: 'ignore' }); } catch (_) {}
    try { require('child_process').execSync('pkill -9 -f dropboxd', { stdio: 'ignore' }); } catch (_) {}
    console.log('[Kill] Semua proses box64/dropboxd dihentikan paksa.');
}

// Expose globally so server.js can call them
global.killAllBrowsers = killAllBrowsers;
global.killAllBox64 = killAllBox64;


// Helper function to get user input from the console
function askQuestion(query) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });
    return new Promise(resolve => rl.question(query, ans => {
        rl.close();
        resolve(ans.trim());
    }));
}

// Helper function to generate a random string/password that meets the criteria:
// - At least 8 characters
// - At least 1 letter (uppercase/lowercase)
// - At least 1 number
// - At least 1 special character
function generatePassword() {
    const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const numbers = "0123456789";
    const specials = "!@#$%^&*()_+~`|}{[]:;?><,./-=";
    const allChars = letters + numbers + specials;

    // Guarantee at least one of each required type
    let password = [
        letters.charAt(Math.floor(Math.random() * letters.length)),
        numbers.charAt(Math.floor(Math.random() * numbers.length)),
        specials.charAt(Math.floor(Math.random() * specials.length)),
    ];

    // Fill the rest up to 12 characters randomly
    for (let i = 0; i < 9; i++) {
        password.push(allChars.charAt(Math.floor(Math.random() * allChars.length)));
    }

    // Shuffle the array to randomize the positions of the guaranteed characters
    for (let i = password.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [password[i], password[j]] = [password[j], password[i]];
    }

    return password.join('');
}

// Helper function to detect if any CAPTCHA elements are visible on the page
async function hasCaptcha(page) {
    const captchaSelectors = [
        'iframe[src*="arkoselabs"]',
        'iframe[src*="funcaptcha"]',
        'iframe[src*="recaptcha"]',
        'iframe[title*="CAPTCHA"]',
        'iframe[title*="Verification"]',
        'div[id*="captcha"]',
        'div[class*="captcha"]',
        '.g-recaptcha',
        '#arkose-iframe',
        'iframe[src*="arkose"]'
    ];

    for (const selector of captchaSelectors) {
        try {
            const locators = page.locator(selector);
            const count = await locators.count();
            for (let i = 0; i < count; i++) {
                if (await locators.nth(i).isVisible()) {
                    return true;
                }
            }
        } catch (e) {}
    }
    return false;
}

// Helper function to detect if "Too many attempts" error is displayed
async function checkTooManyAttempts(page) {
    try {
        const textContent = await page.innerText('body');
        const hasError = [
            'too many attempts',
            'please try later',
            'terlalu banyak percobaan',
            'coba lagi nanti'
        ].some(keyword => textContent.toLowerCase().includes(keyword));

        if (hasError) {
            throw new Error("BROWSER_KILL_REQUIRED: Too many attempts. Please try later.");
        }
    } catch (e) {
        if (e.message.includes("Too many attempts")) {
            throw e;
        }
    }
}

// Helper function to generate a natural-looking random name
function getRandomName() {
    const firstNames = [
        "James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles",
        "Daniel", "Matthew", "Anthony", "Mark", "Donald", "Steven", "Paul", "Andrew", "Joshua", "Kenneth",
        "Kevin", "Brian", "George", "Edward", "Ronald", "Timothy", "Jason", "Jeffrey", "Ryan", "Jacob",
        "Gary", "Nicholas", "Eric", "Jonathan", "Stephen", "Larry", "Justin", "Scott", "Brandon", "Benjamin",
        "Samuel", "Gregory", "Alexander", "Frank", "Patrick", "Raymond", "Jack", "Dennis", "Jerry", "Tyler",
        "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen",
        "Lisa", "Nancy", "Betty", "Sandra", "Margaret", "Ashley", "Kimberly", "Emily", "Donna", "Michelle",
        "Carol", "Amanda", "Dorothy", "Melissa", "Deborah", "Stephanie", "Rebecca", "Sharon", "Laura", "Cynthia",
        "Kathleen", "Amy", "Shirley", "Angela", "Helen", "Anna", "Brenda", "Pamela", "Nicole", "Emma"
    ];

    const lastNames = [
        "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
        "Hernandez", "Lopez", "Gonzalez", "Wilson", "Anderson", "Thomas", "Taylor", "Moore", "Jackson", "Martin",
        "Lee", "Perez", "Thompson", "White", "Harris", "Sanchez", "Clark", "Ramirez", "Lewis", "Robinson",
        "Walker", "Young", "Allen", "King", "Wright", "Scott", "Torres", "Nguyen", "Hill", "Flores",
        "Green", "Adams", "Nelson", "Baker", "Hall", "Rivera", "Campbell", "Mitchell", "Carter", "Roberts",
        "Gomez", "Phillips", "Evans", "Turner", "Diaz", "Parker", "Cruz", "Edwards", "Collins", "Reyes",
        "Stewart", "Morris", "Morales", "Murphy", "Cook", "Rogers", "Gutierrez", "Ortiz", "Morgan", "Cooper"
    ];

    const first = firstNames[Math.floor(Math.random() * firstNames.length)];
    const last = lastNames[Math.floor(Math.random() * lastNames.length)];
    return { first, last };
}

// Helper to fetch server public IP (with explicit timeout)
function getServerPublicIp() {
    return new Promise((resolve) => {
        const timer = setTimeout(() => { resolve(null); }, 8000);
        try {
            const req = https.get('https://api.ipify.org?format=json', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    clearTimeout(timer);
                    try { resolve(JSON.parse(data).ip); } catch (e) { resolve(null); }
                });
                res.on('error', () => { clearTimeout(timer); resolve(null); });
            });
            req.setTimeout(7000, () => { req.destroy(); clearTimeout(timer); resolve(null); });
            req.on('error', () => { clearTimeout(timer); resolve(null); });
        } catch(e) { clearTimeout(timer); resolve(null); }
    });
}

// Check if a TCP port is accepting connections
function checkPort(host, port, timeoutMs = 3000) {
    return new Promise((resolve) => {
        const net = require('net');
        const socket = new net.Socket();
        let done = false;
        socket.setTimeout(timeoutMs);
        socket.on('connect', () => { done = true; socket.destroy(); resolve(true); });
        socket.on('timeout', () => { socket.destroy(); if (!done) resolve(false); });
        socket.on('error', () => { if (!done) resolve(false); });
        socket.connect(port, host);
    });
}

// Helper to recursively delete directories
function deleteDirRecursive(dirPath) {
    if (fs.existsSync(dirPath)) {
        try {
            fs.readdirSync(dirPath).forEach((file) => {
                const curPath = path.join(dirPath, file);
                if (fs.lstatSync(curPath).isDirectory()) {
                    deleteDirRecursive(curPath);
                } else {
                    try {
                        fs.unlinkSync(curPath);
                    } catch (e) {}
                }
            });
            fs.rmdirSync(dirPath);
        } catch (e) {}
    }
}

// Function to clear browser cache, cookies, history, and site storage
// while preserving extensions and their settings
function clearProfileData(profilePath) {
    if (!fs.existsSync(profilePath)) return;

    console.log('Membersihkan cookies, cache, dan data penyimpanan situs...');

    // Files to delete (including locks)
    const filesToDelete = [
        'cookies.sqlite',
        'cookies.sqlite-wal',
        'cookies.sqlite-shm',
        'places.sqlite',
        'places.sqlite-wal',
        'places.sqlite-shm',
        'formhistory.sqlite',
        'sessionstore.jsonlz4',
        'permissions.sqlite',
        'content-prefs.sqlite',
        'webappsstore.sqlite',
        'favicons.sqlite',
        'parent.lock',
        'lock',
        '.parentlock'
    ];

    // Directories to delete entirely
    const dirsToDelete = [
        'cache2',
        'sessionstore-backups',
        'startupCache',
        'jumpListCache',
        'entries',
    ];

    // Delete files
    for (const file of filesToDelete) {
        const filePath = path.join(profilePath, file);
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (e) {}
    }

    // Delete directories entirely
    for (const dir of dirsToDelete) {
        const dirPath = path.join(profilePath, dir);
        try {
            if (fs.existsSync(dirPath)) {
                deleteDirRecursive(dirPath);
            }
        } catch (e) {}
    }

    // Clean storage default directory while preserving moz-extensions (extension settings)
    const storagePath = path.join(profilePath, 'storage', 'default');
    if (fs.existsSync(storagePath)) {
        try {
            const items = fs.readdirSync(storagePath);
            for (const item of items) {
                if (!item.startsWith('moz-extension+++')) {
                    const itemPath = path.join(storagePath, item);
                    if (fs.lstatSync(itemPath).isDirectory()) {
                        deleteDirRecursive(itemPath);
                    } else {
                        fs.unlinkSync(itemPath);
                    }
                }
            }
            console.log('✓ Data penyimpanan situs (Dropbox dll) berhasil dibersihkan.');
        } catch (e) {}
    }
}

// Single registration process for one email
async function registerSingleEmail(url, email, proxyType, proxyHost, isInit, abortController, headless, passwordMode, fixedPassword, globalTimeout = 30, daemonTimeout = 120, alias = '', globalRetry = 3, isRetry = false, uaMode = 'generate', selectedUaString = '', selectedDeviceType = 'desktop') {
    const gtMs = globalTimeout * 1000;
    
    let proxyServer = null;
    if (proxyType === 'warp') {
        proxyServer = 'socks5://127.0.0.1:8086';

        // Force restart warp if this is a retry
        if (isRetry && warpActive) {
            console.log(`\n[Warp] Retry terdeteksi, memaksa restart Warp...`);
            warpActive = false;
        }

        if (warpActive) {
            // Verify port is still open before reusing
            const portOk = await checkPort('127.0.0.1', 8086, 2000);
            if (portOk) {
                console.log(`\n[Warp] Koneksi Warp+Socks5 sudah aktif, menggunakan sesi yang ada di 127.0.0.1:8086`);
            } else {
                console.log(`\n[Warp] Port 8086 tidak lagi tersedia, restart Warp...`);
                warpActive = false;
            }
        }

        if (!warpActive) {
            const { exec } = require('child_process');
            console.log(`\nMengaktifkan koneksi Warp+Socks5...`);

            const runCmd = (cmd, timeoutMs = 8000) => new Promise((resolve) => {
                exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
                    resolve(stdout || '');
                });
                setTimeout(() => resolve(''), timeoutMs + 500);
            });

            const checkWarp = (desiredStatus) => new Promise(resolve => {
                exec('warp-ctl status', { timeout: 3000 }, (err, stdout) => {
                    if (err) return resolve(false);
                    const out = (stdout || '').toLowerCase();
                    if (desiredStatus === 'stop' && (out.includes('berhenti') || out.includes('disconnected'))) resolve(true);
                    else if (desiredStatus === 'start' && (out.includes('terhubung') || out.includes('connected'))) resolve(true);
                    else resolve(false);
                });
            });

            let portReady = false;
            while (!portReady) {
                if (abortController && abortController.shouldStop) {
                    throw new Error("Pendaftaran dihentikan oleh pengguna.");
                }

                console.log(`[Warp] Menjalankan: warp-ctl stop`);
                await runCmd('warp-ctl stop', 5000);
                for(let i = 0; i < 5; i++) {
                    if (await checkWarp('stop')) break;
                    await new Promise(r => setTimeout(r, 1000));
                }

                console.log(`[Warp] Menjalankan: warp-ctl start...`);
                let started = false;
                for (let i = 0; i < 20; i++) {
                    const startOut = await runCmd('warp-ctl start', 2000);
                    // Check if the custom warp-ctl script outputs the success substring
                    if (startOut.includes('WARP Berhasil aktif')) {
                        started = true;
                        console.log(`[Warp] WARP Berhasil aktif`);
                        break;
                    }
                    // Fallback check using status just in case
                    if (await checkWarp('start')) {
                        started = true;
                        break;
                    }
                    await new Promise(r => setTimeout(r, 1000));
                }

                if (started) {
                    console.log(`[Warp] Menunggu 5 detik agar port siap...`);
                    await new Promise(r => setTimeout(r, 5000));
                    portReady = await checkPort('127.0.0.1', 8086, 3000);
                }

                if (portReady) {
                    console.log(`[Warp] ✓ Port 8086 tersedia. Koneksi siap.`);
                    warpActive = true;
                } else {
                    console.log(`[Warp] ⚠️ Port 8086 belum tersedia atau gagal terhubung. Mengulang proses restart Warp...`);
                }
            }
        }
    } else if (proxyType === 'socks5') {
        proxyServer = `socks5://${proxyHost}`;
        console.log(`\n[Proxy] Menggunakan custom Socks5 host: ${proxyHost}`);
        // Ensure warp is stopped when using direct or custom socks5 to prevent conflicts
        if (warpActive) {
            const { exec } = require('child_process');
            exec('warp-ctl stop', { timeout: 5000 }, () => {});
            warpActive = false;
            console.log(`[Warp] Koneksi Warp dihentikan (beralih ke Proxy Socks5).`);
        }
    } else {
        // Direct connection — stop warp if it was previously active
        if (warpActive) {
            const { exec } = require('child_process');
            exec('warp-ctl stop', { timeout: 5000 }, () => {});
            warpActive = false;
            console.log(`[Warp] Koneksi Warp dihentikan (beralih ke Direct Connection).`);
        }
    }

    console.log(`\n==========================================`);
    console.log(`Memulai pendaftaran untuk email: ${email}`);
    if (proxyServer) {
        console.log(`Menggunakan Proxy   : Warp+Socks5 (${proxyServer})`);
    } else {
        console.log(`Menggunakan Proxy   : TIDAK ADA (Direct Connection)`);
    }
    console.log(`==========================================`);

    const { first: firstName, last: lastName } = getRandomName();
    // Use fixed or random password based on mode
    const password = (passwordMode === 'fixed' && fixedPassword) ? fixedPassword : generatePassword();

    console.log(`- First Name: ${firstName}`);
    console.log(`- Last Name : ${lastName}`);
    console.log(`- Password  : ${password}`);

    const contextOptions = {
        headless: headless !== undefined ? !!headless : false,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        args: [
            '--start-maximized',
        ]
    };

    // Inject proxy into this context if one is available
    if (proxyServer) {
        contextOptions.proxy = { server: proxyServer };
    }

    if (abortController && abortController.shouldStop) {
        throw new Error("Pendaftaran dihentikan oleh pengguna.");
    }

    if (!isInit) {
        // Full clean for normal registration run
        clearProfileData(PROFILE_PATH);
    } else {
        // In initialization mode, only clean lock files to allow configuration retention
        const lockFiles = ['parent.lock', 'lock', '.parentlock'];
        for (const file of lockFiles) {
            const filePath = path.join(PROFILE_PATH, file);
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`✓ Membersihkan file lock profil: ${file}`);
                }
            } catch (e) {}
        }
    }

    console.log(`Membuka Firefox dengan mode User Agent: ${uaMode === 'extension' ? 'Ekstensi (Profile)' : `Generate Local (${selectedDeviceType})`}`);
    
    // Launch with timeout to avoid hanging if proxy is not ready
    const launchTimeout = Math.max(gtMs, 60000);
    let context;
    let browserObj = null;

    const launchFirefoxMode = async () => {
        if (uaMode === 'extension') {
            return await firefox.launchPersistentContext(PROFILE_PATH, contextOptions);
        } else {
            contextOptions.userAgent = selectedUaString;
            browserObj = await firefox.launch({
                headless: contextOptions.headless,
                proxy: contextOptions.proxy,
                args: contextOptions.args
            });
            return await browserObj.newContext(contextOptions);
        }
    };

    try {
        context = await Promise.race([
            launchFirefoxMode(),
            new Promise((_, reject) => setTimeout(() => reject(new Error(`[Firefox] Launch timeout ${launchTimeout/1000}s — proxy mungkin tidak tersedia`)), launchTimeout))
        ]);
    } catch (launchErr) {
        // If warp proxy caused a hang, retry without proxy
        if (proxyType === 'warp') {
            console.log(`[Firefox] Gagal launch dengan Warp proxy: ${launchErr.message}`);
            console.log(`[Firefox] Mencoba ulang tanpa proxy sebagai fallback...`);
            delete contextOptions.proxy;
            context = await launchFirefoxMode();
        } else {
            throw launchErr;
        }
    }

    // Grab UA and IP via browser (goes through the actual proxy/direct used by Firefox)
    let playwrightUA = 'Unknown';
    let serverIp = 'Unknown';
    try {
        const infoPage = context.pages()[0] || await context.newPage();

        // Navigate to a real page first so the UA Switcher extension content script can inject.
        // Reading navigator.userAgent on about:blank returns the raw browser UA before extension activates.
        try {
            console.log(`[Playwright] Navigasi ke ipify untuk cek IP dan UA (timeout ${globalTimeout} detik)...`);
            await infoPage.goto('https://api.ipify.org?format=json', { waitUntil: 'domcontentloaded', timeout: gtMs });

            // Small wait for extension content scripts to settle
            await infoPage.waitForTimeout(800);

            // Read IP from page body
            const ipJson = await infoPage.innerText('body').catch(() => '{}');
            serverIp = JSON.parse(ipJson).ip || ipJson.trim() || 'Unknown';
            console.log(`[Server] Public IP (via browser/${proxyServer ? 'Warp' : 'Direct'}): ${serverIp}`);

            // Read UA AFTER navigation — extension has had time to inject its content script
            playwrightUA = await infoPage.evaluate(() => navigator.userAgent).catch(() => 'Unknown');
            console.log(`[Playwright] User Agent (post-nav): ${playwrightUA}`);

        } catch(ipErr) {
            console.log(`[Playwright] Gagal cek IP/UA via browser: ${ipErr.message.split('\n')[0]}`);
            // Fallback: Node.js direct IP, raw UA from blank page
            serverIp = await getServerPublicIp() || 'Unknown';
            console.log(`[Server] Public IP (fallback/direct): ${serverIp}`);
            playwrightUA = await infoPage.evaluate(() => navigator.userAgent).catch(() => 'Unknown');
        }
    } catch(e) {
        console.log(`[Playwright] Error infoPage: ${e.message}`);
        serverIp = await getServerPublicIp() || 'Unknown';
    }


    // Broadcast Info ke UI WebSockets
    if (global.safeSend) {
        global.safeSend({
            type: 'info',
            info: {
                alias: alias || '-',
                mode: proxyType === 'warp' ? 'Warp+Socks5' : (proxyType === 'socks5' ? `Socks5 Only (${proxyHost})` : 'Direct Connection'),
                email: email,
                ip: serverIp,
                ua: playwrightUA
            }
        });
    }

    if (playwrightUA.includes('NT 6')) {
        throw new Error("BROWSER_KILL_REQUIRED: Bad User Agent terdeteksi (mengandung 'NT 6'). Ulangi dari awal.");
    }

    if (abortController) {
        abortController.abort = async () => {
            try {
                console.log("[Abort] Menutup browser context secara paksa karena perintah berhenti...");
                await context.close();
            } catch (e) {}
        };
        // If stopped while launching, abort immediately
        if (abortController.shouldStop) {
            await abortController.abort();
            throw new Error("Pendaftaran dihentikan oleh pengguna.");
        }
    }
    
    if (isInit) {
        console.log("\n========================================================");
        console.log("MODE INISIALISASI AKTIF (-init=true)");
        console.log("Silakan pasang ekstensi dan lakukan konfigurasi secara manual.");
        console.log("Tutup jendela browser Firefox setelah Anda selesai untuk melanjutkan.");
        console.log("========================================================\n");
        
        await new Promise(resolve => {
            context.on('close', resolve);
        });
        return true;
    }

    // Clear cookies for this session to ensure a clean registration session
    await context.clearCookies();

    // Advanced evasions to make browser tracking significantly harder
    await context.addInitScript(() => {
        // 1. Evade navigator.webdriver
        try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch (e) {}

        // 2. Mock Plugins list (biasanya 0 pada headless/bot)
        try {
            const pluginData = [
                { name: 'PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', version: '' },
                { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgieooff', description: 'Portable Document Format', version: '' },
                { name: 'Chromium PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', version: '' },
                { name: 'Microsoft Edge PDF Viewer', filename: 'internal-pdf-viewer', description: 'Portable Document Format', version: '' },
            ];
            Object.defineProperty(navigator, 'plugins', { get: () => pluginData });
            Object.defineProperty(navigator, 'mimeTypes', { get: () => [{ type: 'application/pdf', suffixes: 'pdf', description: '', enabledPlugin: pluginData[0] }] });
        } catch (e) {}

        // 3. Override permissions API
        try {
            const originalQuery = navigator.permissions.query;
            navigator.permissions.query = (parameters) =>
                parameters.name === 'notifications' ?
                    Promise.resolve({ state: Notification.permission }) :
                    originalQuery(parameters);
        } catch (e) {}
    });

    // launchPersistentContext secara bawaan sudah membuka 1 halaman kosong.
    // Kita gunakan halaman pertama yang sudah terbuka agar tidak meluncurkan 2 jendela browser.
    const pages = context.pages();
    const page = pages.length > 0 ? pages[0] : await context.newPage();

    // Helper to fill input directly
    async function humanType(selector, text) {
        await page.fill(selector, text);
    }

    // Helper to click directly
    async function humanClick(selector) {
        await page.click(selector);
    }

    let isRegistered = false;
    let tabAttempt = 0;
    const maxTabAttempts = globalRetry || 3;

    while (tabAttempt < maxTabAttempts && !isRegistered) {
        tabAttempt++;
        if (tabAttempt > 1) {
            console.log(`\n[Tab Reload] Mencoba ulang proses pendaftaran di tab yang sama (Percobaan ${tabAttempt}/${maxTabAttempts})...`);
        }
        
        try {
            console.log(`[Navigasi] Ke: ${url} (timeout ${gtMs/1000} detik)`);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gtMs });
            // Wait for network to quiet down so JS-rendered form has time to appear
            try { await page.waitForLoadState('networkidle', { timeout: Math.min(gtMs, 20000) }); } catch (_) {}
            await checkTooManyAttempts(page);

        console.log("Mencari form input pendaftaran...");
        // More human-like: random wait before starting
        await page.waitForTimeout(2000 + Math.random() * 2000);

        // Optional: Dismiss cookie banners
        try {
            const cookieBannerButton = page.locator('button:has-text("Accept"), button:has-text("Setuju"), #consent-accept-button');
            if (await cookieBannerButton.isVisible()) {
                await cookieBannerButton.click();
                console.log("✓ Menutup banner cookie");
                await page.waitForTimeout(1000);
            }
        } catch (e) {}

        // --- STEP 1: Fill Email & Click Continue ---
        console.log(`\n[Langkah 1] Menunggu field email muncul (timeout ${globalTimeout} detik)...`);
        const emailSelectors = [
            'input[id^="susi_email"]',
            'input[type="email"]',
            'input[name="email"]',
            'input[placeholder*="Email"]',
            'input[placeholder*="email"]'
        ];
        
        // First try a direct waitForSelector — more efficient than polling
        let activeEmailSelector = null;
        for (const sel of emailSelectors) {
            try {
                await page.waitForSelector(sel, { state: 'visible', timeout: Math.min(gtMs, 15000) });
                activeEmailSelector = sel;
                console.log(`✓ Field email ditemukan via waitForSelector: ${sel}`);
                break;
            } catch (_) {}
        }

        // Fallback: if still not found, scroll page to trigger lazy rendering and poll
        if (!activeEmailSelector) {
            console.log(`[Langkah 1] waitForSelector habis, scroll dan polling...`);
            try { await page.evaluate(() => window.scrollBy(0, 200)); } catch (_) {}
            await page.waitForTimeout(2000);

            const emailDeadline = Date.now() + gtMs;
            while (Date.now() < emailDeadline && !activeEmailSelector) {
                for (const selector of emailSelectors) {
                    try {
                        const isVisible = await page.locator(selector).first().isVisible();
                        if (isVisible) { activeEmailSelector = selector; break; }
                    } catch (e) {}
                }
                if (!activeEmailSelector) await page.waitForTimeout(1000);
            }
        }

        if (!activeEmailSelector) {
            // Throw BROWSER_KILL_REQUIRED so server kills all browsers and performs Warp retry
            throw new Error(`BROWSER_KILL_REQUIRED: Field email tidak muncul dalam ${globalTimeout} detik (waitForSelector + fallback scroll habis).`);
        }

        await humanType(activeEmailSelector, email);
        console.log("✓ Mengisi Email");

        await page.waitForTimeout(500 + Math.random() * 800);

        // Click "Continue" with humanized mouse movement
        console.log("Mengklik tombol 'Continue'...");
        const continueSelectors = [
            'button.email-submit-button',
            'button:has-text("Continue")',
            'button:has-text("Lanjutkan")',
            'button[type="submit"]'
        ];
        let clickedContinue = false;
        for (const selector of continueSelectors) {
            try {
                if (await page.isVisible(selector)) {
                    await humanClick(selector);
                    clickedContinue = true;
                    console.log("✓ Mengklik tombol Continue (human-click)");
                    break;
                }
            } catch (e) {}
        }

        if (!clickedContinue) {
            console.log("Peringatan: Tombol Continue tidak terdeteksi, mencoba menekan Enter...");
            let enterPressed = false;
            for (const selector of emailSelectors) {
                try {
                    if (await page.isVisible(selector)) {
                        await page.locator(selector).press('Enter');
                        enterPressed = true;
                        break;
                    }
                } catch (e) {}
            }
            if (!enterPressed) {
                await page.keyboard.press('Enter');
            }
        }

        // Wait for Step 2 fields to load and be visible
        await page.waitForTimeout(2000);
        await checkTooManyAttempts(page);
        const step2Timeout = Math.round(globalTimeout / 2);
        console.log(`\n[Langkah 2] Menunggu form detail nama dan password muncul (timeout ${step2Timeout} detik)...`);
        
        const firstNameSelectors = [
            'input[id^="fname"]',
            'input[name="fname"]',
            'input[autocomplete="given-name"]',
            'input[placeholder*="First name"]',
            'input[placeholder*="Nama depan"]'
        ];

        let step2Visible = false;
        // First try a direct waitForSelector
        for (const sel of firstNameSelectors) {
            try {
                await page.waitForSelector(sel, { state: 'visible', timeout: Math.min(gtMs / 2, 10000) });
                step2Visible = true;
                console.log(`✓ Form Langkah 2 terdeteksi via waitForSelector: ${sel}`);
                break;
            } catch (_) {}
        }

        // Fallback: if still not found, scroll page to trigger lazy rendering and poll
        if (!step2Visible) {
            console.log(`[Langkah 2] waitForSelector habis, scroll dan polling...`);
            try { await page.evaluate(() => window.scrollBy(0, 200)); } catch (_) {}
            await page.waitForTimeout(2000);

            const step2Deadline = Date.now() + (gtMs / 2);
            while (Date.now() < step2Deadline && !step2Visible) {
                for (const selector of firstNameSelectors) {
                    try {
                        const isVisible = await page.locator(selector).first().isVisible();
                        if (isVisible) { step2Visible = true; break; }
                    } catch (e) {}
                }
                if (!step2Visible) await page.waitForTimeout(1000);
            }
        }

        if (!step2Visible) {
            throw new Error(`BROWSER_KILL_REQUIRED: Form Langkah 2 tidak muncul dalam ${step2Timeout} detik.`);
        }

        // Fill First Name
        let firstNameFilled = false;
        for (const selector of firstNameSelectors) {
            try {
                if (await page.isVisible(selector)) {
                    await humanType(selector, firstName);
                    firstNameFilled = true;
                    console.log("✓ Mengisi First Name (human-typed)");
                    break;
                }
            } catch (e) {}
        }

        await page.waitForTimeout(400 + Math.random() * 600);

        // Fill Last Name
        const lastNameSelectors = [
            'input[id^="lname"]',
            'input[name="lname"]',
            'input[autocomplete="family-name"]',
            'input[placeholder*="Last name"]',
            'input[placeholder*="Nama belakang"]'
        ];
        let lastNameFilled = false;
        for (const selector of lastNameSelectors) {
            try {
                if (await page.isVisible(selector)) {
                    await humanType(selector, lastName);
                    lastNameFilled = true;
                    console.log("✓ Mengisi Last Name (human-typed)");
                    break;
                }
            } catch (e) {}
        }

        await page.waitForTimeout(400 + Math.random() * 600);

        // Fill Password
        const passwordSelectors = [
            'input[id^="password"]',
            'input[name="password"]',
            'input[type="password"]',
            'input[placeholder*="Password"]',
            'input[placeholder*="Kata sandi"]'
        ];
        let passwordFilled = false;
        for (const selector of passwordSelectors) {
            try {
                if (await page.isVisible(selector)) {
                    await humanType(selector, password);
                    passwordFilled = true;
                    console.log("✓ Mengisi Password (human-typed)");
                    break;
                }
            } catch (e) {}
        }

        await page.waitForTimeout(600 + Math.random() * 800);

        // Click Agree to Terms Checkbox (if present)
        const checkboxSelectors = [
            'input[type="checkbox"][name="tos_agree"]',
            'input[type="checkbox"]',
            '.agree-checkbox'
        ];
        for (const selector of checkboxSelectors) {
            try {
                if (await page.isVisible(selector)) {
                    const isChecked = await page.isChecked(selector);
                    if (!isChecked) {
                        await humanClick(selector);
                        console.log("✓ Menyetujui syarat dan ketentuan (TOS)");
                        break;
                    }
                }
            } catch (e) {}
        }

        await page.waitForTimeout(1000);

        // Highlight/Focus Agree and Sign Up button
        const submitSelectors = [
            'button._register-button_1k6no_4',
            'button:has-text("Agree and sign up")',
            'button:has-text("Setuju dan daftar")',
            'button[type="submit"]',
            'button:has-text("Sign up")'
        ];
        
        console.log("\nProses pengisian field selesai. Mencoba menekan tombol 'Agree and sign up'...");

        let clickedSubmit = false;
        for (const selector of submitSelectors) {
            try {
                if (await page.isVisible(selector)) {
                    await page.click(selector);
                    clickedSubmit = true;
                    console.log("✓ Berhasil mengklik tombol Daftar.");
                    break;
                }
            } catch (e) {}
        }

        if (!clickedSubmit) {
            console.log("Mencoba mengirimkan form dengan menekan Enter...");
            let enterPressed = false;
            for (const selector of passwordSelectors) {
                try {
                    if (await page.isVisible(selector)) {
                        await page.locator(selector).press('Enter');
                        enterPressed = true;
                        break;
                    }
                } catch (e) {}
            }
            if (!enterPressed) {
                await page.keyboard.press('Enter');
            }
            clickedSubmit = true;
        }

        console.log("\nTombol Daftar telah diklik secara otomatis.");
        console.log("Catatan: Jika ada CAPTCHA yang muncul di layar browser, silakan selesaikan secara manual.");
        console.log("Menunggu pendaftaran selesai (mendeteksi perubahan URL/trial_first)...");

        // Loop to check if the user has successfully registered
        console.log(`\n[Langkah 3] Menunggu redirect URL sukses pendaftaran (timeout ${globalTimeout} detik)...`);
        const regDeadline = Date.now() + gtMs;
        let previewShown = false;
        const previewInterval = 3000; // update preview setiap 3 detik
        let lastPreviewTime = 0;
        while (Date.now() < regDeadline) {
            await page.waitForTimeout(2000);
            await checkTooManyAttempts(page);
            const currentUrl = page.url();

            // Preview browser dari awal, update setiap 3 detik
            const now = Date.now();
            if (!previewShown || (now - lastPreviewTime >= previewInterval)) {
                try {
                    if (!previewShown) {
                        console.log(`[Preview] Menampilkan preview browser dari awal...`);
                    }
                    const screenshot = await page.screenshot({ 
                        type: 'jpeg', 
                        quality: 50,
                        fullPage: false // hanya viewport, ukuran kecil
                    });
                    const base64Screenshot = screenshot.toString('base64');
                    if (global.safeSend) {
                        global.safeSend({
                            type: 'browser_preview',
                            preview: base64Screenshot,
                            url: currentUrl,
                            timestamp: now
                        });
                    }
                    previewShown = true;
                    lastPreviewTime = now;
                } catch (previewErr) {
                    console.log(`[Preview] Gagal mengambil screenshot: ${previewErr.message}`);
                }
            }

            // Check for trial_first, verify_email, or general successful redirection strings
            if (currentUrl.includes('trial_first') || currentUrl.includes('verify_email') || (!currentUrl.includes('/register') && !currentUrl.includes('/login') && (currentUrl.includes('/home') || currentUrl.includes('/personal') || currentUrl.includes('/dashboard') || currentUrl.includes('dropbox.com/h')))) {
                console.log(`\n✓ Pendaftaran/Verifikasi terdeteksi! URL saat ini: ${currentUrl}`);
                isRegistered = true;
                break;
            }
        }

        if (!isRegistered) {
            console.log(`\n⚠️ URL tidak berubah dalam ${globalTimeout} detik setelah menekan tombol daftar.`);
            throw new Error("NO_URL_CHANGE");
        }

    } catch (innerError) {
            const errMsg = (innerError.message || '').toLowerCase();

            // ── BROWSER_KILL_REQUIRED pass-through ───────────────────────────
            if (innerError.message && innerError.message.includes('BROWSER_KILL_REQUIRED')) {
                throw innerError;
            }

            // ── NO_URL_CHANGE: browser must be killed and restarted ──────────
            if (innerError.message === 'NO_URL_CHANGE') {
                throw new Error(`BROWSER_KILL_REQUIRED: URL tidak berubah setelah ${globalTimeout} detik.`);
            }

            // ── Hard browser errors: session gone, context closed, etc ───────
            const isBrowserCrash = errMsg.includes('target closed') || errMsg.includes('context') ||
                                   errMsg.includes('ns_error') || errMsg.includes('session') ||
                                   errMsg.includes('connection refused') || errMsg.includes('crashed');
            if (isBrowserCrash) {
                console.log(`\n💥 Error berat browser (Percobaan ${tabAttempt}): ${innerError.message.split('\n')[0]}`);
                throw new Error(`BROWSER_KILL_REQUIRED: ${innerError.message}`);
            }

            // ── Timeout / soft error: reload tab, retry step ─────────────────
            console.log(`\n⚠️ Timeout/error ringan (Percobaan ${tabAttempt}/${maxTabAttempts}): ${innerError.message.split('\n')[0]}`);
            if (tabAttempt >= maxTabAttempts) {
                throw new Error(`BROWSER_KILL_REQUIRED: Batas ${maxTabAttempts} percobaan tab tercapai. ${innerError.message}`);
            }
            console.log(`[Tab Reload] Memuat ulang URL dan mengulangi pendaftaran (timeout ${globalTimeout} detik)...`);
            try { await page.reload({ waitUntil: 'domcontentloaded', timeout: gtMs }); } catch (_) {
                try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout: gtMs }); } catch (__) {}
            }
            await page.waitForTimeout(2000);
        }
    }

    try {
        if (isRegistered) {
            console.log('✅ Pendaftaran berhasil! Browser tetap terbuka — memulai verifikasi email...');
            await page.waitForTimeout(1500);

            console.log('\n[dropboxd] Memulai proses Dropbox daemon...');

            // ── Spawn dropboxd via bash (avoids ELF header warning) ──────────────
            const { spawn, execSync } = require('child_process');
            const homeDir = process.env.HOME || '/root';
            let dropboxProc = null;
            let cliLinkUrl  = null;

            const killDropbox = () => {
                if (dropboxProc) {
                    try { dropboxProc.kill('SIGTERM'); } catch (_) {}
                }
                try {
                    execSync('pkill -9 -f dropbox-lnx.x86_64-256.4.3790', { stdio: 'ignore' });
                    console.log('[dropboxd] ✓ Proses dropbox lama berhasil dihentikan (pkill).');
                } catch (_) {}
            };

            let finalStatus = 'VERIF';
            try {
                console.log(`[dropboxd] Menjalankan via bash: box64 ./.dropbox-dist/dropboxd (HOME=${homeDir})`);
                dropboxProc = spawn('bash', ['-c', 'box64 ./.dropbox-dist/dropboxd'], {
                    cwd: homeDir,
                    env: { ...process.env, HOME: homeDir },
                });

                // Wait up to dtMs for a CLI link URL in the daemon output
                const dtMs = daemonTimeout * 1000;
                await new Promise((resolve, reject) => {
                    const deadline = setTimeout(() => {
                        killDropbox();
                        reject(new Error(`[dropboxd] Timeout ${daemonTimeout} detik — URL cli_link tidak muncul`));
                    }, dtMs);

                    const scanForLink = (chunk) => {
                        const text = chunk.toString();
                        text.split('\n').forEach(line => {
                            const trimmed = line.trim();
                            if (trimmed) {
                                // Hide the BOX64 ELF header warning
                                if (trimmed.includes('Reading elf header of') && trimmed.includes('Try to launch using bash instead')) {
                                    return;
                                }
                                console.log(`[dropboxd] ${trimmed}`);
                            }
                        });
                        const match = text.match(/https:\/\/www\.dropbox\.com\/cli_link[^\s"'<]*/i);
                        if (match && !cliLinkUrl) {
                            cliLinkUrl = match[0];
                            clearTimeout(deadline);
                            console.log(`[dropboxd] ✓ URL CLI Link ditemukan: ${cliLinkUrl}`);
                            // Terminate immediately as requested
                            killDropbox();
                            resolve();
                        }
                    };

                    dropboxProc.stdout.on('data', scanForLink);
                    dropboxProc.stderr.on('data', scanForLink);
                    dropboxProc.on('error', (err) => { clearTimeout(deadline); killDropbox(); reject(err); });
                    dropboxProc.on('close', (code) => {
                        if (!cliLinkUrl) {
                            clearTimeout(deadline);
                            reject(new Error(`[dropboxd] Proses berhenti (kode ${code}) sebelum URL ditemukan`));
                        }
                    });
                });

                // ── Navigate browser to CLI link (retry loop, no browser kill) ────────
                let connected = false;
                let cliAttempt = 0;
                const maxCliAttempts = maxTabAttempts; // reuse globalRetry

                while (!connected && cliAttempt < maxCliAttempts) {
                    cliAttempt++;
                    if (cliAttempt > 1) {
                        console.log(`\n[CLI Reload] Memuat ulang URL CLI Link (Percobaan ${cliAttempt}/${maxCliAttempts})...`);
                    }

                    try {
                        console.log(`[Browser] Navigasi ke URL CLI Link (timeout ${globalTimeout} detik)...`);
                        await page.goto(cliLinkUrl, { waitUntil: 'domcontentloaded', timeout: gtMs });
                        await page.waitForTimeout(2000);

                        // ── Wait for Connect button and click it ─────────────────────
                        console.log(`[Browser] Menunggu tombol Connect (timeout ${globalTimeout * 2} detik)...`);
                        const connectSelectors = [
                            'button:has-text("Connect")',
                            'button[aria-label="Connect"]',
                            'button:has-text("Hubungkan")',
                            'input[type="submit"][value*="Connect"]',
                            'a:has-text("Connect")',
                        ];

                        let connectBtnFound = false;
                        for (const sel of connectSelectors) {
                            try {
                                await page.waitForSelector(sel, { state: 'visible', timeout: gtMs / 2 });
                                connectBtnFound = true;
                                console.log(`[Browser] ✓ Tombol Connect terdeteksi via waitForSelector: ${sel}`);
                                break;
                            } catch (_) {}
                        }

                        if (!connectBtnFound) {
                            console.log(`[Browser] waitForSelector habis, scroll dan polling untuk Connect...`);
                            try { await page.evaluate(() => window.scrollBy(0, 200)); } catch (_) {}
                            await page.waitForTimeout(2000);

                            const connectDeadline = Date.now() + (gtMs * 2);
                            while (Date.now() < connectDeadline && !connectBtnFound) {
                                for (const sel of connectSelectors) {
                                    try {
                                        const isVisible = await page.locator(sel).first().isVisible();
                                        if (isVisible) { connectBtnFound = true; break; }
                                    } catch (e) {}
                                }
                                if (!connectBtnFound) await page.waitForTimeout(1000);
                            }
                        }

                        if (!connectBtnFound) {
                            throw new Error(`[Browser] Timeout ${globalTimeout * 2} detik — tombol Connect tidak ditemukan`);
                        }

                        // We just verified the button is visible, now click it
                        for (const sel of connectSelectors) {
                            try {
                                if (await page.isVisible(sel)) {
                                    await page.click(sel);
                                    console.log(`[Browser] ✓ Tombol Connect berhasil ditekan!`);
                                    connected = true;
                                    break;
                                }
                            } catch (e) {}
                        }

                        if (!connected) {
                            throw new Error(`[Browser] Gagal mengklik tombol Connect meski sudah terlihat.`);
                        }

                    } catch (cliErr) {
                        console.log(`\n⚠️ Error saat navigasi CLI Link (Percobaan ${cliAttempt}/${maxCliAttempts}): ${cliErr.message.split('\n')[0]}`);
                        if (cliAttempt >= maxCliAttempts) {
                            console.log(`[CLI] Batas ${maxCliAttempts} percobaan habis. Melanjutkan tanpa konfirmasi Connect...`);
                            break;
                        }
                        await page.waitForTimeout(2000);
                        // Loop will retry by reloading the CLI URL — browser stays open
                    }
                }

                // ── Wait for "successfully" confirmation ──────────────────────────────
                if (connected) {
                    console.log('[Browser] Menunggu konfirmasi berhasil dihubungkan...');
                    const successKeywords = ['successfully', 'berhasil', 'linked', 'connected', 'you can now close'];
                    let confirmedSuccess = false;
                    const successDeadline = Date.now() + (gtMs * 2);
                    while (Date.now() < successDeadline && !confirmedSuccess) {
                        try {
                            const bodyText = (await page.innerText('body')).toLowerCase();
                            confirmedSuccess = successKeywords.some(kw => bodyText.includes(kw));
                            if (confirmedSuccess) break;
                        } catch (e) {}
                        await page.waitForTimeout(1500);
                    }

                    if (confirmedSuccess) {
                        console.log(`✅ [dropboxd] Akun ${email} berhasil dihubungkan ke Dropbox daemon!`);
                    } else {
                        console.log(`⚠️ [dropboxd] Konfirmasi tidak terdeteksi, melanjutkan...`);
                    }
                }

            // ── Verify email flow (NEW: home -> avatar -> settings -> general -> verify) ──────
            console.log('\n[Browser] Memulai verifikasi email via dropbox.com/home -> Avatar -> Settings...');
            
            let verifyClicked = false;
            let emailSent = false;
            let verifAttempt = 0;
            const maxVerifAttempts = globalRetry || 3;

            while (verifAttempt < maxVerifAttempts && !verifyClicked) {
                verifAttempt++;
                if (verifAttempt > 1) {
                    console.log(`\n[Tab Reload] Mencoba ulang verifikasi email (Percobaan ${verifAttempt}/${maxVerifAttempts})...`);
                }

                try {
                    // Step 1: Go to dropbox.com/home
                    console.log(`[Navigasi] Ke dropbox.com/home (timeout ${globalTimeout} detik)...`);
                    await page.goto('https://www.dropbox.com/home', { waitUntil: 'domcontentloaded', timeout: gtMs });
                    
                    // Step 2: Click avatar/nickname icon in top right
                    console.log('[Browser] Mencari avatar/nickname di pojok kanan atas...');
                    const avatarSelectors = [
                        'button[aria-label*="Account"]',
                        'button[aria-label*="akun"]',
                        'button[aria-label*="Profile"]',
                        'button[aria-label*="Profil"]',
                        'button[data-testid="account-menu-button"]',
                        'div[data-testid="account-menu-button"]',
                        'button:has(svg[data-icon="user"])',
                        'button:has(svg[data-icon="person"])',
                        '[role="button"][aria-haspopup="menu"]',
                        'header button[aria-expanded]',
                    ];
                    
                    let avatarClicked = false;
                    for (const sel of avatarSelectors) {
                        try {
                            if (await page.isVisible(sel, { timeout: 3000 })) {
                                await page.click(sel);
                                console.log(`[Browser] ✓ Avatar diklik via: ${sel}`);
                                avatarClicked = true;
                                break;
                            }
                        } catch (e) {}
                    }
                    
                    if (!avatarClicked) {
                        console.log('[Browser] ⚠️ Avatar tidak ketemu via selector, coba click coordinate fallback...');
                        // Fallback: click top-right area (avatar usually there)
                        const viewport = page.viewportSize();
                        if (viewport) {
                            await page.mouse.click(viewport.width - 50, 50);
                            avatarClicked = true;
                        }
                    }
                    
                    if (!avatarClicked) {
                        throw new Error('Gagal klik avatar/nickname');
                    }
                    
                    await page.waitForTimeout(1000); // wait for dropdown menu
                    
                    // Step 3: Click "Settings" in dropdown
                    console.log('[Browser] Mencari menu Settings...');
                    const settingsSelectors = [
                        'a:has-text("Settings")',
                        'a:has-text("Pengaturan")',
                        'button:has-text("Settings")',
                        'button:has-text("Pengaturan")',
                        '[role="menuitem"]:has-text("Settings")',
                        '[role="menuitem"]:has-text("Pengaturan")',
                        'a[href*="/account"]',
                        'a[href*="/settings"]',
                    ];
                    
                    let settingsClicked = false;
                    for (const sel of settingsSelectors) {
                        try {
                            if (await page.isVisible(sel, { timeout: 3000 })) {
                                await page.click(sel);
                                console.log(`[Browser] ✓ Settings diklik via: ${sel}`);
                                settingsClicked = true;
                                break;
                            }
                        } catch (e) {}
                    }
                    
                    if (!settingsClicked) {
                        throw new Error('Gagal klik Settings di dropdown');
                    }
                    
                    // Step 4: Wait for Settings page, ensure General tab active
                    console.log('[Browser] Menunggu halaman Settings load...');
                    await page.waitForLoadState('domcontentloaded', { timeout: gtMs });
                    await page.waitForTimeout(2000);
                    
                    // Make sure we're on General tab (usually default)
                    const generalTabSelectors = [
                        'button[role="tab"]:has-text("General")',
                        'button[role="tab"]:has-text("Umum")',
                        'a[href*="/account/general"]',
                        '[data-testid="general-tab"]',
                    ];
                    for (const sel of generalTabSelectors) {
                        try {
                            if (await page.isVisible(sel, { timeout: 2000 })) {
                                await page.click(sel);
                                console.log(`[Browser] ✓ Tab General aktif via: ${sel}`);
                                break;
                            }
                        } catch (e) {}
                    }
                    
                    // Step 5: Scroll down to find "Verify email" 
                    console.log('[Browser] Scroll ke bawah cari "Verify email"...');
                    await page.evaluate(() => window.scrollBy(0, 500));
                    await page.waitForTimeout(1000);
                    await page.evaluate(() => window.scrollBy(0, 500));
                    await page.waitForTimeout(1000);
                    
                    // Step 6: Click "Verify email" button/link
                    const verifySelectors = [
                        'button:has-text("Verify email")',
                        'button:has-text("Verifikasi email")',
                        'a:has-text("Verify email")',
                        'a:has-text("Verifikasi email")',
                        'button[aria-label*="Verify email"]',
                        'button[aria-label*="Verifikasi email"]',
                        '[data-testid="verify-email-button"]',
                        'button.account-key-value-block__link:has-text("Verify email")',
                        'button.account-key-value-block__link:has-text("Verifikasi email")',
                    ];
                    
                    let verifyBtnFound = false;
                    for (const sel of verifySelectors) {
                        try {
                            if (await page.isVisible(sel, { timeout: 3000 })) {
                                await page.click(sel);
                                console.log(`[Browser] ✓ Tombol Verify email diklik via: ${sel}`);
                                verifyBtnFound = true;
                                verifyClicked = true;
                                break;
                            }
                        } catch (e) {}
                    }
                    
                    if (!verifyBtnFound) {
                        // Fallback: scroll more and search all buttons/links
                        console.log('[Browser] Scroll lebih dalam & polling untuk Verify email...');
                        for (let i = 0; i < 5; i++) {
                            await page.evaluate(() => window.scrollBy(0, 300));
                            await page.waitForTimeout(500);
                            for (const sel of verifySelectors) {
                                try {
                                    const el = page.locator(sel).first();
                                    if (await el.isVisible({ timeout: 1000 })) {
                                        await el.click();
                                        console.log(`[Browser] ✓ Verify email ditemukan & diklik via polling: ${sel}`);
                                        verifyBtnFound = true;
                                        verifyClicked = true;
                                        break;
                                    }
                                } catch (e) {}
                            }
                            if (verifyBtnFound) break;
                        }
                    }
                    
                    if (!verifyBtnFound) {
                        throw new Error('Tombol Verify email tidak ditemukan setelah scroll');
                    }
                    
                    // Step 7: Wait for modal, click "Send email" / "Kirim email"
                    console.log('[Browser] Menunggu modal verifikasi...');
                    await page.waitForTimeout(2000);
                    
                    const sendEmailSelectors = [
                        'button.js-email-modal-button.dig-Button--primary',
                        'button:has-text("Send email")',
                        'button:has-text("Kirim email")',
                        'button:has-text("Send verification email")',
                        'button:has-text("Kirim email verifikasi")',
                        '[data-testid="send-verification-email"]',
                    ];
                    
                    let sendBtnFound = false;
                    for (const sel of sendEmailSelectors) {
                        try {
                            if (await page.isVisible(sel, { timeout: 5000 })) {
                                await page.click(sel);
                                console.log(`✅ [Browser] Email verifikasi berhasil dikirim untuk ${email} via: ${sel}!`);
                                emailSent = true;
                                sendBtnFound = true;
                                break;
                            }
                        } catch (e) {}
                    }
                    
                    if (!sendBtnFound) {
                        console.log('[Browser] ⚠️ Tombol Send email tidak ditemukan di modal.');
                    }

                    if (verifyClicked) {
                        // Click Send email button inside the modal
                        const sendEmailSelectors = [
                            'button.js-email-modal-button.dig-Button--primary',
                            'button:has-text("Send email")',
                            'button:has-text("Kirim email")',
                        ];

                        let sendBtnFound = false;
                        for (const sel of sendEmailSelectors) {
                            try {
                                await page.waitForSelector(sel, { state: 'visible', timeout: 5000 });
                                sendBtnFound = true;
                                break;
                            } catch (_) {}
                        }

                        if (sendBtnFound) {
                            for (const sel of sendEmailSelectors) {
                                try {
                                    if (await page.isVisible(sel)) {
                                        await page.click(sel);
                                        console.log(`✅ [Browser] Email verifikasi berhasil dikirim untuk ${email}!`);
                                        emailSent = true;
                                        break;
                                    }
                                } catch (e) {}
                            }
                        }

                        if (!emailSent) {
                            console.log('[Browser] ⚠️ Tombol Send email tidak ditemukan di modal.');
                        }
                    } else {
                        console.log(`[Browser] ⚠️ Tombol Verify email tidak ditemukan pada percobaan ${verifAttempt}.`);
                    }
                } catch (err) {
                    console.log(`\n⚠️ Error saat navigasi/verifikasi email (Percobaan ${verifAttempt}): ${err.message}`);
                    if (verifAttempt >= maxVerifAttempts) {
                        console.log(`Batas maksimal percobaan verifikasi email tercapai.`);
                    }
                    await page.waitForTimeout(2000);
                }
            }
            const finalStatusVal = verifyClicked ? 'success' : 'VERIF';
            finalStatus = finalStatusVal;
            } finally {
                // Kill daemon + any lingering dropbox processes
                killDropbox();
            }

            return { success: true, status: finalStatus, password, ip: serverIp || '', ua: playwrightUA || '' };


        } else {
            throw new Error(`Pendaftaran gagal setelah mencoba ${maxTabAttempts} kali reload tab.`);
        }

    } catch (error) {
        console.error(`Terjadi error untuk email ${email}:`, error);
        throw error;
    } finally {
        if (abortController) {
            abortController.abort = null;
        }
        // Always close the browser context to clear cookies, session data, and anti-fingerprinting details before the next iteration
        console.log(`Menutup browser context untuk ${email}...`);
        try { await context.close(); } catch (e) {}
        if (browserObj) {
            try { await browserObj.close(); } catch (e) {}
        }
        // Force-kill any lingering Firefox/playwright + box64 processes
        killAllBrowsers();
        killAllBox64();
    }
}

async function run() {
    console.log("=== Dropbox Automated Signup Script (Bulk Email) ===");

    // Parse command line arguments
    // Mencari argumen seperti -proxy=true atau --proxy=true
    const useProxyArg = process.argv.find(arg => arg.startsWith('-proxy=') || arg.startsWith('--proxy='));
    const useProxy = useProxyArg ? useProxyArg.split('=')[1] === 'true' : false;

    const useInitArg = process.argv.find(arg => arg.startsWith('-init=') || arg.startsWith('--init='));
    const useInit = useInitArg ? useInitArg.split('=')[1] === 'true' : false;

    if (useInit) {
        console.log("Status Inisialisasi: AKTIF");
        await registerSingleEmail("https://www.dropbox.com/register", "init@init.com", null, true);
        console.log("Inisialisasi selesai. Silakan jalankan script kembali tanpa parameter -init.");
        return;
    }

    if (useProxy) {
        console.log("Status Proxy: AKTIF (Menggunakan rotasi proxy SG dari Proxifly)");
    } else {
        console.log("Status Proxy: NON-AKTIF (Koneksi langsung tanpa proxy)");
    }

    // 1. Get Dropbox URL
    let url = await askQuestion("Masukkan URL Dropbox (misal: https://www.dropbox.com/register): ");
    if (!url) {
        url = "https://www.dropbox.com/register";
        console.log(`Menggunakan default URL: ${url}`);
    }

    // 2. Get Bulk Emails input delimited by ";"
    const bulkEmailsInput = await askQuestion("Masukkan daftar Email (pisahkan dengan tanda ';' misal: email1@gmail.com;email2@gmail.com): ");
    if (!bulkEmailsInput) {
        console.error("Error: Alamat email wajib diisi!");
        return;
    }

    // Parse and filter out empty email entries
    const emails = bulkEmailsInput.split(';')
                                  .map(e => e.trim())
                                  .filter(e => e.length > 0);

    if (emails.length === 0) {
        console.error("Error: Tidak ada email valid yang ditemukan!");
        return;
    }

    console.log(`\nDitemukan ${emails.length} email yang akan didaftarkan.`);
    console.log("Memulai proses pendaftaran...");

    // Run registration for each email sequentially
    for (let i = 0; i < emails.length; i++) {
        const email = emails[i];
        console.log(`\n---------------------------------------------------------`);
        console.log(`Memproses email ke-${i+1} dari ${emails.length}`);
        console.log(`---------------------------------------------------------`);

        // Proxy type
        let proxyType = 'direct';
        if (useProxy) {
            proxyType = 'warp';
        }
        
        // Retry logic for proxy errors or "Too many attempts"
        let registrationSuccess = false;
        let attempts = 0;
        const maxAttempts = 3; 
        let currentProxyType = proxyType;

        while (!registrationSuccess && attempts < maxAttempts) {
            attempts++;
            if (attempts > 1) {
                if (useProxy) {
                    console.log(`\n[Mencoba Kembali] Mencoba mendaftarkan ulang ${email} dengan proxy baru (Percobaan ke-${attempts} dari ${maxAttempts})...`);
                    currentProxyType = 'warp';
                } else {
                    console.log(`\n[Mencoba Kembali] Mencoba mendaftarkan ulang ${email} (Percobaan ke-${attempts} dari ${maxAttempts})...`);
                }
            }

            try {
                const result = await registerSingleEmail(url, email, currentProxyType, false);
                if (result) {
                    registrationSuccess = true;
                } else {
                    console.log(`Pendaftaran untuk ${email} selesai dengan status tidak berhasil (mungkin halaman ditutup/timeout). Tidak mencoba ulang.`);
                    break;
                }
            } catch (error) {
                console.log(`\n⚠️ Terjadi kesalahan saat registrasi: ${error.message}`);
                
                const errorMsg = (error.message || '').toLowerCase();
                const isConnectionError = [
                    'net::err',
                    'timeout',
                    'connection',
                    'proxy',
                    'tunnel'
                ].some(keyword => errorMsg.includes(keyword));

                const isTooManyAttempts = errorMsg.includes('too many attempts') || errorMsg.includes('please try later') || errorMsg.includes('terlalu banyak percobaan') || errorMsg.includes('coba lagi nanti');

                if (isTooManyAttempts && attempts < maxAttempts) {
                    console.log(`Terdeteksi pesan "Too many attempts". Mencoba kembali...`);
                } else if (useProxy && isConnectionError && attempts < maxAttempts) {
                    console.log(`Terdeteksi masalah koneksi/proxy. Mengambil proxy baru dan mencoba kembali...`);
                } else {
                    console.log(`Sudah mencapai batas maksimal percobaan atau kesalahan permanen. Melewati email ini.`);
                    break;
                }
            }
        }
        

    }

    console.log("\nSemua email dalam daftar telah diproses.");
    console.log("Script selesai dijalankan.");
}

if (require.main === module) {
    run();
} else {
    module.exports = {
        registerSingleEmail,
        PROFILE_PATH
    };
}
