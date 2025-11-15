const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { Parser } = require('xml2js'); // <-- LIBRARY BARU

// --- KONFIGURASI ---
const WATCH_PATH = 'D:\\Image\\62001FS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';
// -------------------

// Buat instance parser di luar fungsi agar efisien
const xmlParser = new Parser();

console.log('--- XML Watcher Service ---');
console.log(`[INFO] Service dimulai...`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log('---------------------------');

/**
 * Fungsi untuk membaca, MENGONVERSI, dan mengirim file
 * @param {string} filePath - Path lengkap ke file XML yang baru ditemukan
 */
const sendXmlFile = async (filePath) => {
  try {
    // 1. Baca isi file XML sebagai string
    const xmlData = fs.readFileSync(filePath, 'utf-8');

    // 2. Konversi XML string ke Objek JSON
    console.log(`[CONVERT] Mengubah ${path.basename(filePath)} ke JSON...`);
    const jsonData = await xmlParser.parseStringPromise(xmlData);

    // 3. Kirim Objek JSON via HTTP POST
    console.log(`[MENGIRIM] Mengirim JSON dari ${path.basename(filePath)} ke ${POST_URL}...`);
    
    const response = await axios.post(POST_URL, jsonData, { // <-- Mengirim jsonData
      headers: { 
        'Content-Type': 'application/json' // <-- Header DIUBAH ke JSON
      }, 
      timeout: 10000 
    });

    // 4. Catat hasilnya (sukses)
    // Sekarang kita HARUSNYA melihat {"resultCode":true, ...}
    console.log(`[SUKSES] Berhasil dikirim. Server merespon dengan status: ${response.status}`);
    console.log(`[SERVER SAYS] Respons: ${JSON.stringify(response.data)}`);
    
  } catch (error) {
    // 5. Catat jika ada error
    if (error.response) {
      console.error(`[GAGAL] Server merespon dengan error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`[GAGAL] Tidak bisa terhubung ke server. ${error.message}`);
    } else {
      console.error(`[GAGAL] Terjadi error saat memproses file: ${error.message}`);
    }
  }
};

// Inisialisasi watcher
const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,      
  ignoreInitial: true,   
  recursive: true,       
  awaitWriteFinish: {    
    stabilityThreshold: 2000, 
    pollInterval: 100
  },
  usePolling: true, 
  interval: 3000    
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