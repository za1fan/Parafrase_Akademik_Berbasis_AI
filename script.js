/**
 * Academic Rewriter AI Pro v3.0 - Live Quota Monitor
 * Fitur: Multi-Pass Logic, Jaccard Similarity, Maximum Rewrite
 * Perbaikan: Live Token/RPM Tracker & Countdown Timer Cooldown Realtime
 */

const CONFIG = {
    MODEL: "llama-3.3-70b-versatile", // Model terbaru dengan performa terbaik untuk penulisan ulang
    MAX_HISTORY: 10
};

let appState = {
    apiKey: localStorage.getItem('gemini_pro_key') || '',
    history: JSON.parse(localStorage.getItem('rewrite_history_v2')) || []
};

// --- Helper: Jeda Waktu ---
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- Initialization & Event Listeners ---
document.addEventListener('DOMContentLoaded', () => {

    if (appState.apiKey) {
        document.getElementById('apiKey').value = appState.apiKey;
    }

    renderHistory();
    
    document.getElementById('themeToggle').addEventListener('click', () => {
        document.body.classList.toggle('dark-mode');
    });

    document.getElementById('inputText').addEventListener('input', (e) => {
        const words = e.target.value.trim().split(/\s+/).filter(w => w).length;
        document.getElementById('wordCount').innerText = `${words} Kata`;
    });

    document.getElementById('saveApiKey').addEventListener('click', () => {
        const key = document.getElementById('apiKey').value.trim();
        if (!key) {
            alert('Masukkan API Key terlebih dahulu!');
            return;
        }
        localStorage.setItem('gemini_pro_key', key);
        appState.apiKey = key;
        alert('API Key berhasil disimpan!');
    });

    document.getElementById('copyBtn').addEventListener('click', () => {
        const outText = document.getElementById('outputText').innerText;
        if (!outText) return alert('Tidak ada teks untuk disalin.');
        
        navigator.clipboard.writeText(outText)
            .then(() => alert('Teks berhasil disalin ke clipboard!'))
            .catch(err => alert('Gagal menyalin teks: ' + err));
    });

    document.getElementById('downloadBtn').addEventListener('click', () => {
        const outText = document.getElementById('outputText').innerText;
        if (!outText) return alert('Tidak ada teks untuk diunduh.');
        
        const blob = new Blob([outText], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        a.href = url;
        a.download = `Hasil_Parafrase_${new Date().getTime()}.txt`;
        document.body.appendChild(a);
        a.click();
        
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    document.getElementById('clearHistory').addEventListener('click', () => {
        if (appState.history.length === 0) return;
        if (confirm('Apakah Anda yakin ingin menghapus semua riwayat?')) {
            appState.history = [];
            localStorage.removeItem('rewrite_history_v2');
            renderHistory();
        }
    });
});

// --- Core Logic: Multi-Pass Rewrite ---
// --- Core Logic: Multi-Pass Rewrite (Versi Super Kebal Jaringan & Token Limit) ---
async function startRewrite(passes) {
    const text = document.getElementById('inputText').value.trim();
    const mode = document.getElementById('modeSelect').value;
    const level = document.getElementById('levelSelect').value;
    const key = document.getElementById('apiKey').value;
    const btnActions = document.querySelectorAll('.btn-action');

    if (!key) return alert("API Key diperlukan!");
    if (text.split(/\s+/).filter(w => w).length < 10) return alert("Teks terlalu pendek (min 10 kata).");

    localStorage.setItem('gemini_pro_key', key);
    appState.apiKey = key;

    // Kunci semua tombol antarmuka
    btnActions.forEach(btn => btn.disabled = true);
    toggleUI(true);
    let currentText = text;

    try {
        for (let i = 1; i <= passes; i++) {
            if (i > 1) {
                // Beri indikasi transisi antar tahapan
                const statusJedaElem = document.getElementById("quotaResetTime");
                if (statusJedaElem) {
                    statusJedaElem.innerText = "Jeda Sesi...";
                    statusJedaElem.className = "status-jeda";
                }
                updateProgress((i / passes) * 100, `Jeda Pengamanan`, `Mengistirahatkan API Google sebentar...`);
                await sleep(3500); // Istirahat sejenak antar tahap agar aman dari deteksi spam
            }

            updateProgress(
                (i / passes) * 100, 
                `Tahap ${i} dari ${passes}`,
                `AI sedang menyusun ulang teks akademik Anda...`
            );

            // LOGIKA PERTAHANAN BERLAPIS: Jika fetch gagal total karena Token/RPM penuh di menit itu
            let success = false;
            let localAttempts = 1;
            
            while (!success) {
                try {
                    currentText = await callGeminiWithRetry(mode, level, currentText, i);
                    success = true; // Jika berhasil, keluar dari loop pembungkus
                } catch (innerError) {
                    // Jika error-nya karena pembatasan kuota/token habis, paksa antre cooldown di sini!
                    if (innerError.message.includes("high demand") && localAttempts <= 3) {
                        console.log(`[Darurat Utama] Token penuh. Memaksa antrean cooldown lokal ke-${localAttempts}`);
                        
                        const statusJedaElem = document.getElementById("quotaResetTime");
                        if (statusJedaElem) {
                            statusJedaElem.className = "status-cooldown";
                        }

                        // Lakukan hitung mundur darurat 6 detik penuh agar jatah token menit baru disegarkan kembali
                        for (let countdown = 6; countdown > 0; countdown--) {
                            document.getElementById("statusMain").innerText = "Antrean Token Penuh";
                            document.getElementById("statusStep").innerText = `Server sibuk, mencoba ulang otomatis dalam ${countdown} detik...`;
                            if (statusJedaElem) statusJedaElem.innerText = `Cooldown ${countdown}s`;
                            await sleep(1000);
                        }
                        
                        localAttempts++;
                    } else {
                        // Jika memang error serius lainnya (API Key salah, internet mati), lemparkan keluar
                        throw innerError;
                    }
                }
            }
        }

        finalizeResult(text, currentText, mode);
    } catch (error) {
        console.error(error);
        alert("Koneksi Terputus Sembarangan: " + error.message);
    } finally {
        toggleUI(false);
        btnActions.forEach(btn => btn.disabled = false);
    }
}

// --- Wrapper Runner dengan Penanganan Siluman & Hitung Mundur ---
// --- Wrapper Runner dengan Penanganan Siluman & Hitung Mundur + WARNA DINAMIS ---
async function callGeminiWithRetry(mode, level, currentText, passNumber) {
    const prompt = createPrompt(mode, level, currentText, passNumber);
    let maxAttempts = 4;
    
    // Ambil elemen status jeda untuk dimanipulasi warnanya
    const statusJedaElem = document.getElementById("quotaResetTime");
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Set warna ke hijau (Normal) sebelum menembak API
            statusJedaElem.innerText = "Normal";
            statusJedaElem.className = "status-normal"; 
            
            return await callGeminiRaw(prompt);
        } catch (error) {
            if (error.message.includes("high demand") && attempt < maxAttempts) {
                console.log(`[Attempt ${attempt}] Rate limit terdeteksi. Memulai hitung mundur...`);
                
                // Ubah warna menjadi MERAH dan berkedip karena terkena limit kuota
                statusJedaElem.className = "status-cooldown";
                
                // Melakukan live countdown 5 detik ke layar UI
                for (let countdown = 5; countdown > 0; countdown--) {
                    document.getElementById("statusMain").innerText = "Sistem Mengalami Jeda";
                    document.getElementById("statusStep").innerText = `Mencoba ulang otomatis dalam ${countdown} detik...`;
                    statusJedaElem.innerText = `Cooldown ${countdown}s`;
                    await sleep(1000);
                }
                
                continue; 
            }
            throw error; 
        }
    }
}

// --- Pure API Fetcher untuk Groq Cloud ---
async function callGeminiRaw(prompt) {
    // URL Endpoint resmi milik Groq
    const url = "https://api.groq.com/openai/v1/chat/completions";

    const response = await fetch(url, {
        method: 'POST',
        headers: { 
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${appState.apiKey}` // API Key Groq kamu masukkan di kotak input web
        },
        body: JSON.stringify({
            model: CONFIG.MODEL,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.7
        })
    });

    // Indikator visual kuota di layar web kamu
    document.getElementById("quotaRemaining").innerText = "Aktif (Groq Free Tier)";

    if (response.status === 429) {
        throw new Error("high demand");
    }

    const data = await response.json();

    if (data.error) {
        throw new Error(data.error.message);
    }

    if (!data.choices || !data.choices[0] || !data.choices[0].message) {
        throw new Error("Respon kosong dari server Groq.");
    }

    return data.choices[0].message.content.trim();
}

// --- Prompt Engineering ---
function createPrompt(mode, level, text, passNumber) {
    const basePrompts = {
        academic: "Tulis ulang menggunakan bahasa akademik formal Indonesia.",
        maximum: "Tulis ulang secara menyeluruh dengan struktur kalimat, susunan paragraf, dan pilihan kata yang berbeda, namun makna tetap sama.",
        formal: "Ubah menjadi bahasa yang sangat formal dan sesuai untuk skripsi atau jurnal ilmiah.",
        humanize: "Tulis ulang agar lebih natural dan mudah dibaca seperti ditulis manusia."
    };

    return `Anda adalah ahli penulisan akademik bahasa Indonesia.
Tugas: ${basePrompts[mode]}
Ketentuan:
- Pertahankan makna asli.
- Jangan menambahkan informasi baru.
- Perbaiki tata bahasa dan ejaan.
- Hindari penggunaan kalimat yang identik dengan teks asli.
- Berikan hanya hasil akhir tanpa penjelasan.

Tahap Rewrite: ${passNumber}
Teks: ${text}`;
}

// --- Jaccard Index ---
function calculateSimilarity(str1, str2) {
    const s1 = new Set(str1.toLowerCase().match(/\b\w+\b/g));
    const s2 = new Set(str2.toLowerCase().match(/\b\w+\b/g));
    const intersection = new Set([...s1].filter(x => s2.has(x)));
    const union = new Set([...s1, ...s2]);
    return Math.round((intersection.size / union.size) * 100) || 0;
}

// --- UI Helpers ---
function toggleUI(isLoading) {
    document.getElementById('loadingOverlay').classList.toggle('hidden', !isLoading);
    document.getElementById('outputArea').classList.toggle('hidden', isLoading);
    if(isLoading) {
        document.getElementById('analysisBox').classList.add('hidden');
        document.getElementById('outputText').innerText = "";
    }
}

function updateProgress(percent, main, step) {
    document.getElementById('innerBar').style.width = `${percent}%`;
    document.getElementById('statusMain').innerText = main;
    document.getElementById('statusStep').innerText = step;
}

// --- Finalize Result ---
function finalizeResult(original, rewritten, mode) {
    const outElem = document.getElementById('outputText');
    outElem.innerText = rewritten;
    
    const score = calculateSimilarity(original, rewritten);
    const words = rewritten.split(/\s+/).filter(w => w).length;

    document.getElementById('simScore').innerText = `${score}%`;
    document.getElementById('outWordCount').innerText = words;
    document.getElementById('analysisBox').classList.remove('hidden');

    saveHistory(mode, rewritten);
}

// --- History Management ---
function saveHistory(mode, text) {
    const entry = {
        id: Date.now(),
        date: new Date().toLocaleTimeString(),
        mode: mode,
        snippet: text.substring(0, 40) + "..."
    };
    appState.history.unshift(entry);
    if(appState.history.length > CONFIG.MAX_HISTORY) appState.history.pop();
    localStorage.setItem('rewrite_history_v2', JSON.stringify(appState.history));
    renderHistory();
}

function renderHistory() {
    const container = document.getElementById('historyList');
    if(appState.history.length === 0) {
        container.innerHTML = `<p style="color:gray; font-size:0.8rem">Belum ada riwayat aktivitas.</p>`;
        return;
    }
    container.innerHTML = appState.history.map(item => `
        <div class="history-item">
            <span><strong>${item.mode}</strong>: ${item.snippet}</span>
            <small>${item.date}</small>
        </div>
    `).join('');
}
