const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- KONFIGURASI ---
const WATCH_PATH = 'D:\\Image\\62001FS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';
// -------------------

console.log('--- XML Watcher Service ---');
console.log(`[INFO] Service dimulai...`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log('---------------------------');

/**
 * Fungsi untuk membaca dan mengirim file XML
 * @param {string} filePath - Path lengkap ke file XML yang baru ditemukan
 */
const sendXmlFile = async (filePath) => {
  try {
    // 1. Baca isi file XML sebagai string (gunakan 'utf-8')
    const xmlData = fs.readFileSync(filePath, 'utf-8');

    // 2. Kirim data via HTTP POST
    console.log(`[MENGIRIM] Mengirim ${path.basename(filePath)} ke ${POST_URL}...`);
    
    const response = await axios.post(POST_URL, xmlData, {
      headers: { 'Content-Type': 'application/xml' }, 
      timeout: 10000 // Waktu tunggu 10 detik
    });

    // 3. Catat hasilnya (sukses)
    console.log(`[SUKSES] Berhasil dikirim. Server merespon dengan status: ${response.status}`);
    
    // --- TAMBAHAN KODE DEBUG ---
    // Baris ini akan mencetak respons JSON sebenarnya dari server,
    // yang mungkin berisi pesan error seperti {"resultCode":false,...}
    console.log(`[SERVER SAYS] Respons: ${JSON.stringify(response.data)}`);
    // ---------------------------
    
  } catch (error) {
    // 4. Catat jika ada error
    if (error.response) {
      console.error(`[GAGAL] Server merespon dengan error: ${error.response.status} - ${error.response.data}`);
    } else if (error.request) {
      console.error(`[GAGAL] Tidak bisa terhubung ke server. ${error.message}`);
    } else {
      console.error(`[GAGAL] Terjadi error saat memproses file: ${error.message}`);
    }
  }
};

// Inisialisasi watcher
const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,      // Tetap berjalan
  ignoreInitial: true,   // Abaikan file yang sudah ada saat start
  recursive: true,       // Pantau semua sub-folder
  awaitWriteFinish: {    // Pastikan file selesai ditulis
    stabilityThreshold: 2000, 
    pollInterval: 100
  },

  // --- WAJIB UNTUK MENDETEKSI FILE BARU ---
  usePolling: true, 
  interval: 3000    
  // -------------------------------------
});

// Event listener untuk file baru ('add')
watcher.on('add', (filePath) => {
  if (path.extname(filePath).toLowerCase() === '.xml') {
    console.log(`\n[DETEKSI] File XML baru ditemukan: ${filePath}`);
    sendXmlFile(filePath);
  }
});

// Event listener untuk error pada watcher
watcher.on('error', (error) => {
  console.error(`[ERROR WATCHER] Terjadi kesalahan: ${error}`);
});

console.log('[INFO] Watcher berhasil dijalankan (mode polling). Menunggu file XML baru...');