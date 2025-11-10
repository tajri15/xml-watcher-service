const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const WATCH_PATH = 'Z:\\62001DS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';

console.log('--- XML Watcher Service ---');
console.log(`[INFO] Service dimulai...`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log('---------------------------');

const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,      // Tetap berjalan
  ignoreInitial: true,   // Abaikan file yang sudah ada saat start
  recursive: true,       // Pantau semua sub-folder (INI PENTING untuk \2025\1110 dll)
  awaitWriteFinish: {    // Pastikan file selesai ditulis sebelum memicu event
    stabilityThreshold: 2000,
    pollInterval: 100
  }
});

// Event listener untuk file baru ('add')
watcher.on('add', (filePath) => {
  // Hanya proses jika file adalah .xml
  if (path.extname(filePath).toLowerCase() === '.xml') {
    
    console.log(`\n[DETEKSI] File XML baru ditemukan: ${filePath}`);
    
    // (Kita akan tambahkan logika pengiriman di langkah berikutnya)
    
  }
});

// Event listener untuk error pada watcher
watcher.on('error', (error) => {
  console.error(`[ERROR WATCHER] Terjadi kesalahan: ${error}`);
});

console.log('[INFO] Watcher berhasil dijalankan. Menunggu file XML baru...');