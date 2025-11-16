const chokidar = require('chokidar');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// --- KONFIGURASI ---
const WATCH_PATH = 'D:\\Image\\62001FS03'; 
const POST_URL = 'http://10.226.62.32:8040/services/xRaySmg/out';
const WAIT_TIME_MS = 60000;
// -------------------

console.log('--- XML Watcher Service ---');
console.log(`[INFO] Service dimulai...`);
console.log(`[INFO] Memantau folder: ${WATCH_PATH}`);
console.log(`[INFO] Mengirim ke URL: ${POST_URL}`);
console.log('---------------------------');

/**
 * Fungsi untuk membaca file XML dengan encoding yang benar
 */
const readXmlFile = (filePath) => {
  try {
    // Baca sebagai buffer dulu
    const fileBuffer = fs.readFileSync(filePath);
    console.log(`[READ] File size: ${fileBuffer.length} bytes`);
    
    // Deteksi UTF-16 LE BOM (FF FE)
    if (fileBuffer[0] === 0xFF && fileBuffer[1] === 0xFE) {
      console.log(`[ENCODING] UTF-16 LE detected, converting...`);
      // Hapus BOM dan konversi ke string
      const content = fileBuffer.slice(2).toString('utf16le');
      // Ganti encoding declaration dari UTF-16 ke UTF-8
      return content.replace(/encoding="UTF-16"/gi, 'encoding="UTF-8"');
    }
    
    // Default: UTF-8
    return fileBuffer.toString('utf8');
    
  } catch (error) {
    throw new Error(`Gagal membaca file: ${error.message}`);
  }
};

/**
 * Fungsi untuk mendapatkan ftp_path
 */
const getFtpPath = (filePath) => {
  try {
    const relativePath = path.dirname(path.relative(WATCH_PATH, filePath));
    return `/import/62001FS03/${relativePath.replace(/\\/g, '/')}/`;
  } catch (error) {
    return '/import/62001FS03/';
  }
};

/**
 * Fungsi untuk memeriksa kelengkapan XML
 */
const checkXmlCompleteness = (xmlContent) => {
  const checks = {
    hasIDR: xmlContent.includes('<IDR>'),
    hasIDR_IMAGE: xmlContent.includes('<IDR_IMAGE>'),
    hasPICNO: xmlContent.includes('<PICNO>'),
    hasContainer: xmlContent.includes('<container_no>'),
    hasIDR_CHECK_UNIT: xmlContent.includes('<IDR_CHECK_UNIT>'),
    hasSCANIMG: xmlContent.includes('<SCANIMG>'),
    hasIMGTYPE: xmlContent.includes('<IMGTYPE>')
  };
  
  const missing = Object.keys(checks).filter(key => !checks[key]);
  
  if (missing.length > 0) {
    console.log(`[WARNING] XML missing elements: ${missing.join(', ')}`);
    return false;
  }
  
  console.log(`[CHECK] ✅ XML structure complete`);
  return true;
};

/**
 * Fungsi utama untuk memproses dan mengirim file
 */
const processAndSendXml = async (filePath) => {
  try {
    console.log(`\n[PROSES] Memproses: ${path.basename(filePath)}`);
    
    // 1. Baca file XML
    const xmlContent = readXmlFile(filePath);
    console.log(`[READ] Berhasil membaca ${xmlContent.length} karakter`);
    
    // 2. Periksa kelengkapan
    const isComplete = checkXmlCompleteness(xmlContent);
    if (!isComplete) {
      console.log(`[WARNING] XML tidak lengkap, tetapi tetap mencoba mengirim...`);
    }
    
    // 3. Ekstrak data penting untuk logging
    const picnoMatch = xmlContent.match(/<PICNO>([^<]+)<\/PICNO>/);
    const containerMatch = xmlContent.match(/<container_no>([^<]+)<\/container_no>/);
    
    console.log(`[DATA] PICNO: ${picnoMatch ? picnoMatch[1] : 'Tidak ditemukan'}`);
    console.log(`[DATA] Container: ${containerMatch ? containerMatch[1] : 'Tidak ditemukan'}`);
    
    // 4. Siapkan payload
    const ftpPath = getFtpPath(filePath);
    const payload = {
      ftp_path: ftpPath,
      image_msg: xmlContent
    };
    
    console.log(`[PAYLOAD] ftp_path: ${ftpPath}`);
    console.log(`[PAYLOAD] Mengirim ${xmlContent.length} karakter XML`);
    
    // 5. Kirim ke server
    console.log(`[MENGIRIM] Mengirim ke server...`);
    
    const response = await axios.post(POST_URL, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
    
    // 6. Handle response
    console.log(`[RESPONSE] HTTP Status: ${response.status}`);
    
    if (response.data && response.data.resultCode === true) {
      console.log(`[SUCCESS] ✅ Berhasil dikirim!`);
      console.log(`[SERVER] ${response.data.resultDesc || 'Tidak ada pesan'}`);
      if (response.data.resultData) {
        console.log(`[DATA] ${JSON.stringify(response.data.resultData)}`);
      }
    } else {
      console.log(`[FAILED] ❌ Gagal: ${response.data?.resultDesc || 'Unknown error'}`);
      
      // Analisis error
      if (response.data?.resultDesc?.includes('Container Tidak Terbaca')) {
        console.log(`[ANALYSIS] Masalah: Container number tidak terbaca`);
        console.log(`[ANALYSIS] Container dalam XML: ${containerMatch ? containerMatch[1] : 'MISSING'}`);
      }
    }
    
    return response.data?.resultCode === true;
    
  } catch (error) {
    if (error.response) {
      console.error(`[ERROR] Server error: ${error.response.status}`);
      console.error(`[SERVER] ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      console.error(`[ERROR] Tidak bisa terhubung ke server: ${error.message}`);
    } else {
      console.error(`[ERROR] Processing error: ${error.message}`);
    }
    return false;
  }
};

// Inisialisasi watcher
const watcher = chokidar.watch(WATCH_PATH, {
  persistent: true,
  ignoreInitial: true,
  recursive: true,
  usePolling: true,
  interval: 3000,
  ignored: /(^|[/\\])\../
});

// Timer management
const activeTimers = new Map();

watcher.on('add', (filePath) => {
  if (path.extname(filePath).toLowerCase() === '.xml') {
    const fileName = path.basename(filePath);
    
    // Hapus timer sebelumnya jika ada
    if (activeTimers.has(filePath)) {
      clearTimeout(activeTimers.get(filePath));
      activeTimers.delete(filePath);
    }
    
    console.log(`\n[DETECTED] XML file: ${fileName}`);
    console.log(`[INFO] Waiting ${WAIT_TIME_MS / 1000} seconds...`);
    
    // Set timer baru
    const timer = setTimeout(async () => {
      console.log(`[PROCESS] Processing ${fileName}...`);
      activeTimers.delete(filePath);
      
      try {
        const stats = fs.statSync(filePath);
        if (stats.size === 0) {
          console.error(`[ERROR] File ${fileName} is empty`);
          return;
        }
        
        await processAndSendXml(filePath);
      } catch (error) {
        console.error(`[ERROR] Cannot access file: ${error.message}`);
      }
    }, WAIT_TIME_MS);
    
    activeTimers.set(filePath, timer);
  }
});

// Error handling
watcher.on('error', (error) => {
  console.error(`[WATCHER ERROR] ${error}`);
});

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\n[INFO] Shutting down...');
  activeTimers.forEach((timer) => clearTimeout(timer));
  watcher.close();
  process.exit(0);
});

console.log(`[INFO] Watcher started. Waiting for XML files...`);