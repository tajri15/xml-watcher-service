const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- KONFIGURASI ---
// PENTING: Gunakan double backslash (\\) untuk path di Windows
const WATCH_PATH = 'Z:\\62001DS03'; 
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
      headers: {
        'Content-Type': 'application/xml' // Beri tahu server bahwa ini adalah data XML
      },
      timeout: 10000 // Waktu tunggu 10 detik
    });

    // 3. Catat hasilnya (sukses)
    console.log(`[SUKSES] Berhasil dikirim. Server merespon dengan status: ${response.status}`);
    
  } catch (error) {
    // 4. Catat jika ada error
    if (error.response) {
      // Error dari server (misal: 404, 500)
      console.error(`[GAGAL] Server merespon dengan error: ${error.response.status} - ${error.response.data}`);
    } else if (error.request) {
      // Error request (misal: tidak ada koneksi)
      console.error(`[GAGAL] Tidak bisa terhubung ke server. ${error.message}`);
    } else {
      // Error lain (misal: error saat baca file)
      console.error(`[GAGAL] Terjadi error saat memproses file: ${error.message}`);
    }
  }
};

// Inisialisasi watcher
const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,      // Tetap berjalan
  ignoreInitial: true,   // Abaikan file yang sudah ada saat start
  recursive: true,       // Pantau semua sub-folder (INI PENTING untuk \2025\1110 dll)
  awaitWriteFinish: {    // Pastikan file selesai ditulis sebelum memicu event
    stabilityThreshold: 2000, // Tunggu 2 detik setelah file tidak berubah
    pollInterval: 100
  }
});

// Event listener untuk file baru ('add')
watcher.on('add', (filePath) => {
  // Hanya proses jika file adalah .xml
  if (path.extname(filePath).toLowerCase() === '.xml') {
    
    console.log(`\n[DETEKSI] File XML baru ditemukan: ${filePath}`);
    
    // Panggil fungsi untuk mengirim file
    sendXmlFile(filePath);
    
  }
});

// Event listener untuk error pada watcher
watcher.on('error', (error) => {
  console.error(`[ERROR WATCHER] Terjadi kesalahan: ${error}`);
});

console.log('[INFO] Watcher berhasil dijalankan. Menunggu file XML baru...');